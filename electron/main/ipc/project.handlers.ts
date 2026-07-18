import { ipcMain, dialog, shell } from 'electron';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import {
  createProject,
  listProjects,
  loadProject,
  deleteProject,
  setLastOpened,
  readManifest,
  writeManifest,
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

  ipcMain.handle(IPC_CHANNELS.manifest.read, async (_event, folderPath: string) => {
    return readManifest(folderPath);
  });

  ipcMain.handle(
    IPC_CHANNELS.manifest.updateScene,
    async (_event, folderPath: string, cueId: number, prompt: string) => {
      const manifest = await readManifest(folderPath);
      if (!manifest) {
        throw new Error('项目清单不存在');
      }
      const scene = manifest.scenes.find((s) => s.cueId === cueId);
      if (!scene) {
        throw new Error(`未找到 cue ${cueId} 对应的 scene`);
      }
      scene.prompt = prompt;
      await writeManifest(folderPath, manifest);
      return manifest;
    },
  );

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
