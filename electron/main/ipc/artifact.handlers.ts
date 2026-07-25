import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import { loadProject } from '../services/project.store';

export function registerArtifactHandlers(): void {
  // Save updated artifact content back to its source file in the workspace
  // (e.g. edited storyboard prompts -> .storyboard.json)
  ipcMain.handle(
    IPC_CHANNELS.artifact.save,
    async (_event, projectId: string, relPath: string, content: string) => {
      try {
        const project = await loadProject(projectId);
        if (!project) throw new Error('项目不存在');

        const filePath = path.resolve(project.folderPath, relPath);
        if (!filePath.startsWith(path.resolve(project.folderPath) + path.sep)) {
          throw new Error(`路径超出工作区: ${relPath}`);
        }
        await fs.writeFile(filePath, content, 'utf-8');
        log.info('[Artifact] Saved:', relPath);
        return { success: true };
      } catch (err) {
        log.error('[Artifact] Save failed:', err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  );
}
