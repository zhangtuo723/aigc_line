import path from 'node:path';
import { ipcMain, BrowserWindow } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log/main';
import { IPC_CHANNELS } from '../../../src/shared/ipc.channels';
import type {
  Project,
  ProjectManifest,
  WorkflowOptions,
  WorkflowProgress,
  WorkflowResult,
  WorkflowStep,
} from '../../../src/shared/ipc.types';
import {
  ensureProjectDirs,
  getOutputDir,
  getStoryboardsDir,
  loadProject,
  readManifest,
  writeManifest,
} from '../services/project.store';
import { scanWorkspace } from '../services/workspace.watcher';
import { generateStoryboards } from '../services/image.pipeline';
import { runHyperframes } from '../services/hyperframes.runner';

interface ActiveRun {
  runId: string;
  projectId: string;
  controller: AbortController;
}

let activeRun: ActiveRun | null = null;

export function registerWorkflowHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.workflow.run,
    async (_event, projectId: string, options?: WorkflowOptions) => {
      if (activeRun) {
        throw new Error('已有工作流正在运行');
      }
      const runId = uuidv4();
      activeRun = { runId, projectId, controller: new AbortController() };

      try {
        await runWorkflow(runId, projectId, options);
        return runId;
      } finally {
        if (activeRun?.runId === runId) {
          activeRun = null;
        }
      }
    },
  );

  ipcMain.handle(IPC_CHANNELS.workflow.cancel, async () => {
    if (activeRun) {
      log.info(`[Workflow] cancelling run ${activeRun.runId}`);
      activeRun.controller.abort();
      pushComplete({
        runId: activeRun.runId,
        projectId: activeRun.projectId,
        status: 'cancelled',
      });
      activeRun = null;
    }
  });
}

export async function runWorkflow(
  runId: string,
  projectId: string,
  options?: WorkflowOptions,
): Promise<void> {
  const project = await loadProject(projectId);
  if (!project) {
    throw new Error(`项目不存在: ${projectId}`);
  }

  const controller = activeRun?.controller;
  if (!controller) {
    throw new Error('未找到活动的工作流运行');
  }

  const runRecord: {
    runId: string;
    startedAt: number;
    status: string;
    finishedAt?: number;
    outputPath?: string;
  } = {
    runId,
    startedAt: Date.now(),
    status: 'running',
  };

  try {
    await ensureProjectDirs(project.folderPath);

    // parsing
    pushProgress(runId, projectId, 'parsing', 0, '正在解析工作区文件...');
    await scanWorkspace(project.folderPath);
    pushProgress(runId, projectId, 'parsing', 10, '工作区扫描完成');

    let manifest = await readManifest(project.folderPath);
    if (!manifest) {
      throw new Error('项目清单不存在');
    }
    manifest = await addRunToManifest(project.folderPath, manifest, runRecord);

    checkAbort(controller.signal);

    // prompting + generating
    pushProgress(runId, projectId, 'prompting', 10, '开始生成提示词与图片...');

    let generatedCount = 0;
    const cueCount = manifest.cues.length;

    manifest = await generateStoryboards({
      project,
      manifest,
      options,
      abortSignal: controller.signal,
      callbacks: {
        onPromptStart: (cueId) => {
          pushProgress(runId, projectId, 'prompting', 10, `正在为 cue ${cueId} 生成提示词...`, cueId);
        },
        onPromptComplete: (cueId) => {
          generatedCount++;
          const percent = 10 + Math.min(10, Math.round((generatedCount / cueCount) * 10));
          pushProgress(runId, projectId, 'prompting', percent, `cue ${cueId} 提示词已生成`, cueId);
        },
        onImageStart: (cueId) => {
          pushProgress(runId, projectId, 'generating', 20, `正在为 cue ${cueId} 生成图片...`, cueId);
        },
        onImageComplete: (cueId) => {
          const percent = 20 + Math.round((cueId / cueCount) * 60);
          pushProgress(runId, projectId, 'generating', Math.min(80, percent), `cue ${cueId} 图片已生成`, cueId);
        },
        onProgress: (message) => {
          pushProgress(runId, projectId, 'generating', 50, message);
        },
      },
    });

    checkAbort(controller.signal);

    // assembling
    pushProgress(runId, projectId, 'assembling', 80, '开始合成视频...');
    if (!manifest.audioPath || !manifest.srtPath) {
      throw new Error('缺少音频或字幕文件，无法合成视频');
    }

    const outputDir = getOutputDir(project.folderPath);
    const outputPath = path.join(outputDir, `final_video_${runId}.mp4`);

    await runHyperframes({
      audioPath: manifest.audioPath,
      imagesDir: getStoryboardsDir(project.folderPath),
      srtPath: manifest.srtPath,
      outputPath,
      onProgress: (message) => {
        pushProgress(runId, projectId, 'assembling', 90, message);
      },
      abortSignal: controller.signal,
    });

    runRecord.status = 'success';
    runRecord.finishedAt = Date.now();
    runRecord.outputPath = outputPath;
    await updateRunInManifest(project.folderPath, runId, runRecord);

    pushProgress(runId, projectId, 'done', 100, '视频合成完成');
    pushComplete({
      runId,
      projectId,
      status: 'success',
      outputPath,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error('[Workflow] run failed:', err);

    runRecord.status = 'error';
    runRecord.finishedAt = Date.now();
    try {
      await updateRunInManifest(project.folderPath, runId, runRecord);
    } catch (manifestErr) {
      log.error('[Workflow] failed to update manifest:', manifestErr);
    }

    pushProgress(runId, projectId, 'error', 0, `工作流失败: ${message}`);
    pushComplete({
      runId,
      projectId,
      status: 'error',
      error: message,
    });
  }
}

function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('工作流已取消');
  }
}

function pushProgress(
  runId: string,
  projectId: string,
  step: WorkflowStep,
  percent: number,
  message: string,
  cueId?: number,
): void {
  const payload: WorkflowProgress = { runId, projectId, step, percent, message, cueId };
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.push.progress, payload);
  });
}

function pushComplete(result: WorkflowResult): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.push.complete, result);
  });
}

async function addRunToManifest(
  folderPath: string,
  manifest: ProjectManifest,
  run: { runId: string; startedAt: number; status: string },
): Promise<ProjectManifest> {
  manifest.runs = [...manifest.runs, run];
  await writeManifest(folderPath, manifest);
  return manifest;
}

async function updateRunInManifest(
  folderPath: string,
  runId: string,
  updates: Partial<{ finishedAt?: number; outputPath?: string; status: string }>,
): Promise<void> {
  const manifest = await readManifest(folderPath);
  if (!manifest) return;
  manifest.runs = manifest.runs.map((run) => (run.runId === runId ? { ...run, ...updates } : run));
  await writeManifest(folderPath, manifest);
}
