import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type { Attachment, ChatMessage } from '../../../src/shared/ipc.types';
import { normalizeInterruptedToolCalls } from '../../../src/shared/tool-call-status';
import { clearAgentContext, enqueueAgentMessage, interruptAgentTurn, listAvailableSkills } from '../services/agent';
import { messageHub } from '../services/message-hub';
import { loadProject, readChatHistory, writeChatHistory } from '../services/project.store';
import log from 'electron-log/main';

/**
 * Copy uploaded attachments into the project workspace (uploads/) so the
 * agent can actually read them - its tools are scoped to the project folder.
 */
async function stageAttachments(
  folderPath: string,
  attachments?: Attachment[],
): Promise<Attachment[] | undefined> {
  if (!attachments || attachments.length === 0) return attachments;
  const uploadsDir = path.join(folderPath, 'uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const staged: Attachment[] = [];
  for (const att of attachments) {
    if (!att.path) {
      staged.push(att);
      continue;
    }
    try {
      const dest = path.join(uploadsDir, `${Date.now()}-${path.basename(att.path)}`);
      await fs.copyFile(att.path, dest);
      staged.push({ ...att, path: dest });
    } catch (err) {
      log.warn('[Chat] Failed to stage attachment:', att.path, err);
      staged.push(att);
    }
  }
  return staged;
}

export function registerChatHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.chat.clearContext,
    async (_event, projectId: string) => {
      try {
        const project = await loadProject(projectId);
        if (!project) return { success: false, error: '项目不存在或已被删除' };
        await clearAgentContext({
          projectId,
          folderPath: project.folderPath,
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
      return listAvailableSkills(project.id, project.folderPath);
    },
  );

  // Load chat history for a project
  ipcMain.handle(
    IPC_CHANNELS.chat.loadHistory,
    async (_event, folderPath: string) => {
      try {
        const persistedHistory = await readChatHistory(folderPath);
        // A restarted process cannot still be executing persisted tool calls.
        const { messages: history, changed: historyChanged } =
          normalizeInterruptedToolCalls(persistedHistory);
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
        if (historyChanged) await writeChatHistory(folderPath, history);
        return history;
      } catch (err) {
        log.error('[Chat] load history failed:', err);
        return [];
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
          messageHub.pushToFrontend({
            id: `error-${Date.now()}`,
            role: 'assistant',
            content: '项目不存在，请先创建或选择一个项目。',
            timestamp: Date.now(),
          });
          return;
        }

        // Stage uploaded files into the workspace before the agent runs
        const stagedMessage: ChatMessage = {
          ...message,
          attachments: await stageAttachments(project.folderPath, message.attachments),
        };

        // Queue into the project's long-lived streaming agent session.
        // Returns immediately; output streams to the frontend via MessageHub
        // and the turn-end signal arrives when the agent finishes this turn.
        await enqueueAgentMessage(stagedMessage, {
          projectId,
          folderPath: project.folderPath,
          allowedTools: ['Read', 'Bash', 'Glob', 'Grep', 'Edit', 'Write'],
        });
      } catch (err) {
        log.error('[Chat] handle message failed:', err);
        messageHub.notifyError(
          projectId,
          err instanceof Error ? err.message : String(err),
        );
        messageHub.notifyTurnEnd();
      }
    },
  );

  // Interrupt the currently running agent turn for a project
  ipcMain.handle(
    IPC_CHANNELS.chat.interrupt,
    async (_event, projectId: string) => {
      await interruptAgentTurn(projectId);
    },
  );
}
