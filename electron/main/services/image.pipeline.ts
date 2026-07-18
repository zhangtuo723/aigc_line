import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import log from 'electron-log/main';
import type { Project, ProjectManifest, Scene, WorkflowOptions } from '../../../src/shared/ipc.types';
import { generateScenePrompt } from './claude.client';
import { ComfyClient } from './comfy.client';
import {
  ensureProjectDirs,
  getStoryboardsDir,
  readManifest,
  writeManifest,
} from './project.store';

export interface ImagePipelineCallbacks {
  onPromptStart?: (cueId: number) => void;
  onPromptComplete?: (cueId: number, prompt: string) => void;
  onImageStart?: (cueId: number) => void;
  onImageComplete?: (cueId: number, imagePath: string) => void;
  onProgress?: (message: string) => void;
}

export interface ImagePipelineContext {
  project: Project;
  manifest: ProjectManifest;
  options?: WorkflowOptions;
  callbacks?: ImagePipelineCallbacks;
  abortSignal?: AbortSignal;
}

function getWorkflowPath(): string {
  return path.join(process.env.APP_ROOT ?? process.cwd(), 'resources', 'comfyui_workflows', 'sketch_storyboard.json');
}

export async function generateStoryboards(context: ImagePipelineContext): Promise<ProjectManifest> {
  const { project, options, callbacks, abortSignal } = context;
  let manifest = context.manifest;

  await ensureProjectDirs(project.folderPath);
  const storyboardsDir = getStoryboardsDir(project.folderPath);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('未设置 ANTHROPIC_API_KEY 环境变量');
  }
  const anthropic = new Anthropic({ apiKey });
  const comfy = new ComfyClient(options?.comfyuiBaseUrl ?? project.comfyuiBaseUrl);

  const cues = manifest.cues;
  if (cues.length === 0) {
    throw new Error('工作区中未找到有效的字幕 cue');
  }

  // Ensure all scenes exist
  if (manifest.scenes.length !== cues.length) {
    const sceneMap = new Map(manifest.scenes.map((s) => [s.cueId, s]));
    manifest.scenes = cues.map((cue) => sceneMap.get(cue.id) ?? { cueId: cue.id, prompt: '' });
  }

  // Step 1: generate prompts
  for (let i = 0; i < cues.length; i++) {
    checkAbort(abortSignal);
    const cue = cues[i];
    let scene = manifest.scenes[i];

    if (!scene.prompt) {
      callbacks?.onPromptStart?.(cue.id);
      callbacks?.onProgress?.(`正在为 cue ${cue.id} 生成提示词...`);
      log.info(`[ImagePipeline] generating prompt for cue ${cue.id}`);

      const previousContext = i > 0 ? manifest.scenes[i - 1]?.prompt : undefined;
      const prompt = await generateScenePrompt(anthropic, cue, options?.imageStyle, previousContext);

      scene = { ...scene, prompt };
      manifest.scenes[i] = scene;
      manifest = await saveManifest(project.folderPath, manifest);

      callbacks?.onPromptComplete?.(cue.id, prompt);
    }
  }

  // Step 2: generate images
  const workflowPath = getWorkflowPath();
  for (let i = 0; i < cues.length; i++) {
    checkAbort(abortSignal);
    const cue = cues[i];
    const scene = manifest.scenes[i];

    if (!scene.imagePath || !(await fileExists(scene.imagePath))) {
      callbacks?.onImageStart?.(cue.id);
      callbacks?.onProgress?.(`正在为 cue ${cue.id} 生成图片...`);
      log.info(`[ImagePipeline] generating image for cue ${cue.id}`);

      const outputPath = path.join(storyboardsDir, `${cue.id}.png`);
      await comfy.generateImage(workflowPath, scene.prompt, outputPath);

      scene.imagePath = outputPath;
      manifest = await saveManifest(project.folderPath, manifest);

      callbacks?.onImageComplete?.(cue.id, outputPath);
    } else {
      callbacks?.onProgress?.(`cue ${cue.id} 图片已存在，跳过生成`);
      log.info(`[ImagePipeline] image exists for cue ${cue.id}, skipping`);
    }
  }

  return manifest;
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('图片生成已取消');
  }
}

async function saveManifest(folderPath: string, manifest: ProjectManifest): Promise<ProjectManifest> {
  await writeManifest(folderPath, manifest);
  const refreshed = await readManifest(folderPath);
  return refreshed ?? manifest;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await import('node:fs/promises').then((fs) => fs.access(filePath));
    return true;
  } catch {
    return false;
  }
}
