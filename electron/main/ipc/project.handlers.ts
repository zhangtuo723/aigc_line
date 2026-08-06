import { ipcMain, dialog, shell } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
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

  ipcMain.handle(IPC_CHANNELS.project.importAudio, async (_event, projectId: string) => {
    try {
      const project = await loadProject(projectId);
      if (!project) return { success: false, error: '项目不存在或已被删除' };
      const result = await dialog.showOpenDialog({
        title: '选择本地音频',
        properties: ['openFile'],
        filters: [
          { name: '音频文件', extensions: ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'aac'] },
        ],
      });
      if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };

      const sourcePath = path.resolve(result.filePaths[0]);
      const extension = path.extname(sourcePath).toLowerCase();
      if (!['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.aac'].includes(extension)) {
        return { success: false, error: '不支持的音频格式' };
      }
      const destinationDir = path.join(project.folderPath, 'uploads', 'audio');
      await fs.mkdir(destinationDir, { recursive: true });
      const originalName = path.basename(sourcePath);
      const safeBase = path.basename(originalName, extension).replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 80) || 'audio';
      const destinationPath = path.join(destinationDir, `${Date.now()}-${safeBase}${extension}`);
      await fs.copyFile(sourcePath, destinationPath);
      return {
        success: true,
        name: originalName,
        relativePath: path.relative(project.folderPath, destinationPath).split(path.sep).join('/'),
      };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
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
