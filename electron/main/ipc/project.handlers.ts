import { ipcMain, dialog, shell } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import {
  createProject,
  listProjects,
  loadProject,
  deleteProject,
  setLastOpened,
  readManifest,
} from '../services/project.store';

export function registerProjectHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.project.create,
    async (_event, name: string, folderPath: string) => {
      return createProject(name, folderPath);
    },
  );

  ipcMain.handle(IPC_CHANNELS.project.list, async () => {
    return listProjects();
  });

  ipcMain.handle(IPC_CHANNELS.project.load, async (_event, id: string) => {
    const project = await loadProject(id);
    if (project) {
      await setLastOpened(id);
    }
    return project;
  });

  ipcMain.handle(IPC_CHANNELS.project.delete, async (_event, id: string) => {
    await deleteProject(id);
  });

  ipcMain.handle('manifest:read', async (_event, folderPath: string) => {
    return readManifest(folderPath);
  });

  ipcMain.handle('dialog:showOpenDialog', async (_event, options) => {
    const result = await dialog.showOpenDialog({
      ...options,
      properties: ['openDirectory'],
    });
    return result.filePaths;
  });

  ipcMain.on('shell:showItemInFolder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });
}
