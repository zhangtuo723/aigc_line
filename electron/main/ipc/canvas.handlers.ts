import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import * as projectStore from '../services/project.store';
import log from 'electron-log/main';
import type { CanvasCommandResponse } from '../../../src/shared/ipc.types';
import { resolveCanvasCommand } from '../services/agent/canvas-bridge';

export function registerCanvasHandlers(): void {
  ipcMain.on(
    IPC_CHANNELS.canvas.commandResult,
    (_event, response: CanvasCommandResponse) => resolveCanvasCommand(response),
  );
  // Save canvas snapshot to project folder
  ipcMain.handle(
    IPC_CHANNELS.canvas.save,
    async (_event, folderPath: string, snapshot: unknown) => {
      try {
        await projectStore.writeCanvasSnapshot(folderPath, snapshot);
        return { success: true };
      } catch (err) {
        log.error('[Canvas] save failed:', err);
        throw err;
      }
    },
  );

  // Load canvas snapshot from project folder
  ipcMain.handle(
    IPC_CHANNELS.canvas.load,
    async (_event, folderPath: string) => {
      try {
        const snapshot = await projectStore.readCanvasSnapshot(folderPath);
        return snapshot;
      } catch (err) {
        log.error('[Canvas] load failed:', err);
        return null;
      }
    },
  );
}
