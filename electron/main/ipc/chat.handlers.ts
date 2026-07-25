import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type { Attachment, ChatMessage } from '../../../src/shared/ipc.types';
import { runAgent } from '../services/claude-agent.service';
import { messageHub } from '../services/message-hub';
import { loadProject, readChatHistory } from '../services/project.store';
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
  // Load chat history for a project
  ipcMain.handle(
    IPC_CHANNELS.chat.loadHistory,
    async (_event, folderPath: string) => {
      try {
        const history = await readChatHistory(folderPath);
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

        // Run the Claude Agent SDK (directly pushes to frontend via MessageHub)
        await runAgent(stagedMessage, {
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
      } finally {
        // Ensure the thinking indicator clears even if runAgent never started
        messageHub.notifyTurnEnd();
      }
    },
  );
}
