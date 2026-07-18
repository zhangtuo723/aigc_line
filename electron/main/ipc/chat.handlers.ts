import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type { ChatMessage } from '../../../src/shared/ipc.types';
import { runAgent } from '../services/claude-agent.service';
import { messageHub } from '../services/message-hub';
import { loadProject, readChatHistory } from '../services/project.store';
import log from 'electron-log/main';

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

        // Reset message hub state for new conversation
        messageHub.reset();

        // Notify that agent is thinking
        messageHub.notifyThinking(projectId);

        // Run the Claude Agent SDK (directly pushes to frontend via MessageHub)
        await runAgent(message, {
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
      }
    },
  );
}
