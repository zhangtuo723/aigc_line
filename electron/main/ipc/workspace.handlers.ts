import { ipcMain, BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import { scanWorkspace, watchWorkspace } from '../services/workspace.watcher';

const activeWatchers = new Map<string, () => void>();

export function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.workspace.scan, async (_event, folderPath: string) => {
    return scanWorkspace(folderPath);
  });

  ipcMain.handle(IPC_CHANNELS.workspace.validate, async (_event, folderPath: string) => {
    return scanWorkspace(folderPath);
  });
}

export function startWatchingProject(
  projectId: string,
  folderPath: string,
): void {
  stopWatchingProject(projectId);
  const stop = watchWorkspace(folderPath, () => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send(IPC_CHANNELS.push.changed);
    });
  });
  activeWatchers.set(projectId, stop);
}

export function stopWatchingProject(projectId: string): void {
  const stop = activeWatchers.get(projectId);
  if (stop) {
    stop();
    activeWatchers.delete(projectId);
  }
}

export function stopAllWatchers(): void {
  activeWatchers.forEach((stop) => stop());
  activeWatchers.clear();
}
