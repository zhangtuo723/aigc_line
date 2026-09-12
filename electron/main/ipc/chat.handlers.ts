import { ipcMain, nativeImage } from 'electron';
import { listAgentModels } from '../services/agent/models';
import { getCodexQueue, sendCodexQueuedNow, isCodexMessagePending, getActiveCodexToolIds } from '../services/agent/codex-session';
import { getActiveClaudeToolIds } from '../services/agent/session-manager';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type { ChatMessage } from '../../../src/shared/ipc.types';
import { normalizeInactiveChatTools } from '../../../src/shared/chat-history-tools';
import { clearAgentContext, enqueueAgentMessage, interruptAgentTurn, listAvailableSkills } from '../services/agent';
import { saveChatTextAttachment, stageChatAttachments } from '../services/chat-attachment.service';
import { loadProject, readChatHistory, updateChatMessage } from '../services/project.store';
import log from 'electron-log/main';

const PASTED_IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
const activeToolIds = (folderPath: string) => new Set([...getActiveClaudeToolIds(folderPath), ...getActiveCodexToolIds(folderPath)]);

export function registerChatHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.chat.saveTextAttachment, async (_event, projectId: string, content: string) => {
    try {
      const project = await loadProject(projectId);
      if (!project) return { success: false, error: '项目不存在或已被删除' };
      return { success: true, attachment: await saveChatTextAttachment(project.folderPath, content) };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(IPC_CHANNELS.chat.listModels, (_event, provider) => listAgentModels(provider));
  ipcMain.handle(
    IPC_CHANNELS.chat.savePastedImage,
    async (_event, projectId: string, data: ArrayBuffer, mimeType: string) => {
      try {
        const project = await loadProject(projectId);
        if (!project) return { success: false, error: '项目不存在或已被删除' };

        const extension = PASTED_IMAGE_EXTENSIONS[mimeType.toLowerCase()];
        if (!extension) return { success: false, error: '剪贴板图片格式不支持' };
        if (!(data instanceof ArrayBuffer) || data.byteLength === 0) {
          return { success: false, error: '剪贴板图片内容为空' };
        }
        if (data.byteLength > MAX_PASTED_IMAGE_BYTES) {
          return { success: false, error: '粘贴图片不能超过 20 MB' };
        }

        const bytes = Buffer.from(data);
        if (nativeImage.createFromBuffer(bytes).isEmpty()) {
          return { success: false, error: '剪贴板内容不是有效图片' };
        }

        const imagesDir = path.join(project.folderPath, 'uploads', 'images');
        await fs.mkdir(imagesDir, { recursive: true });
        const name = `pasted-image-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
        const imagePath = path.join(imagesDir, name);
        await fs.writeFile(imagePath, bytes);
        return {
          success: true,
          attachment: { type: extension, name, path: imagePath },
        };
      } catch (error) {
        log.error('[Chat] Failed to save pasted image:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.chat.clearContext,
    async (_event, projectId: string) => {
      try {
        const project = await loadProject(projectId);
        if (!project) return { success: false, error: '项目不存在或已被删除' };
        await clearAgentContext({
          projectId,
          folderPath: project.folderPath,
          agent: project.agent,
          allowedTools: ['Read', 'Bash', 'Glob', 'Grep', 'Edit', 'Write'],
        });
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.chat.listSkills,
    async (_event, projectId: string) => {
      const project = await loadProject(projectId);
      if (!project) return [];
      return listAvailableSkills(project.id, project.folderPath, project.agent?.provider);
    },
  );

  // Load chat history for a project
  ipcMain.handle(
    IPC_CHANNELS.chat.loadHistory,
    async (_event, folderPath: string) => {
      try {
        const persistedHistory = await readChatHistory(folderPath);
        const persistedById = new Map(persistedHistory.map((message) => [message.id, message]));
        for (const message of persistedHistory) {
          if (message.deliveryStatus === 'queued' && !isCodexMessagePending(folderPath, message.id)) {
            await updateChatMessage(folderPath, message.id, (current) => {
              const next = current.deliveryStatus === 'queued' && !isCodexMessagePending(folderPath, current.id)
                ? { ...current, deliveryStatus: 'cancelled' as const } : current;
              Object.assign(message, next);
              return next;
            });
          }
        }
        // Keep actual calls from this process running when a user reopens a project.
        const { messages: history, changed: historyChanged } =
          normalizeInactiveChatTools(persistedHistory, activeToolIds(folderPath));
        // Artifacts with a source file may have been edited on disk (or via
        // artifact:save) since they were pushed - refresh content from the file
        for (const message of history) {
          const artifact = message.artifact;
          // Images store a data URL in content, not file text - skip them
          if (!artifact?.path || artifact.type === 'image') continue;
          try {
            const filePath = path.resolve(folderPath, artifact.path);
            if (!filePath.startsWith(path.resolve(folderPath) + path.sep)) continue;
            artifact.content = await fs.readFile(filePath, 'utf-8');
          } catch {
            // File missing or unreadable - keep the content from history
          }
        }
        if (historyChanged) {
          for (const message of history) {
            const previous = persistedById.get(message.id);
            if (previous?.toolCall?.status === 'running' && message.toolCall?.status === 'interrupted') {
              await updateChatMessage(folderPath, message.id, (current) => {
                const normalized = normalizeInactiveChatTools([current], activeToolIds(folderPath)).messages[0];
                Object.assign(message, normalized);
                return normalized;
              });
            }
          }
        }
        return history;
      } catch (err) {
        log.error('[Chat] load history failed:', err);
        throw new Error(`聊天记录加载失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.chat.sendMessage,
    async (_event, projectId: string, message: ChatMessage) => {
      try {
        // Get project info
        const project = await loadProject(projectId);
        if (!project) {
          throw new Error('项目不存在，请先创建或选择一个项目。');
        }

        // Stage uploaded files into the workspace before the agent runs
        const stagedMessage: ChatMessage = {
          ...message,
          attachments: await stageChatAttachments(project.folderPath, message.attachments),
        };

        // Queue into the project's long-lived streaming agent session.
        // Returns immediately; output streams to the frontend via MessageHub
        // and the turn-end signal arrives when the agent finishes this turn.
        await enqueueAgentMessage(stagedMessage, {
          projectId,
          folderPath: project.folderPath,
          agent: project.agent,
          allowedTools: ['Read', 'Bash', 'Glob', 'Grep', 'Edit', 'Write'],
        });
      } catch (err) {
        log.error('[Chat] handle message failed:', err);
        // This is an enqueue failure, not the end of any already running turn.
        // The rejected IPC displays a retryable error beside the retained draft.
        throw err;
      }
    },
  );

  // Interrupt the currently running agent turn for a project
  ipcMain.handle(IPC_CHANNELS.chat.codexQueue, (_event, projectId: string) => ({ messages: getCodexQueue(projectId) }));
  ipcMain.handle(IPC_CHANNELS.chat.codexSendNow, async (_event, projectId: string, messageId: string) => {
    const project = await loadProject(projectId);
    if (project?.agent?.provider !== 'codex') throw new Error('只有 Codex 项目支持立即发送排队消息');
    sendCodexQueuedNow(projectId, messageId);
  });
  ipcMain.handle(
    IPC_CHANNELS.chat.interrupt,
    async (_event, projectId: string) => {
      await interruptAgentTurn(projectId);
    },
  );
}
