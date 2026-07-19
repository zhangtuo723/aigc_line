import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type {
  Project,
  ProjectIndex,
  ProjectManifest,
  Cue,
  ChatMessage,
} from '../../../src/shared/ipc.types';

const APP_DIR_NAME = 'aigc-line';
const PROJECTS_FILE = 'projects.json';
const PROJECT_DIR_NAME = '.aigc-line';
const MANIFEST_FILE = 'manifest.json';
const CHAT_HISTORY_FILE = 'chat-history.json';
const SESSION_FILE = 'session.json';
const CANVAS_SNAPSHOT_FILE = 'canvas-snapshot.json';

export function getAppDataDir(): string {
  const dir = path.join(app.getPath('userData'), APP_DIR_NAME);
  return dir;
}

async function ensureAppDir(): Promise<void> {
  const dir = getAppDataDir();
  await fs.mkdir(dir, { recursive: true });
}

async function readProjectsFile(): Promise<ProjectIndex> {
  await ensureAppDir();
  const filePath = path.join(getAppDataDir(), PROJECTS_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ProjectIndex;
    return { projects: parsed.projects ?? [], lastOpenedId: parsed.lastOpenedId };
  } catch {
    return { projects: [] };
  }
}

async function writeProjectsFile(index: ProjectIndex): Promise<void> {
  await ensureAppDir();
  const filePath = path.join(getAppDataDir(), PROJECTS_FILE);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(index, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function createProject(
  name: string,
  folderPath: string,
): Promise<Project> {
  const index = await readProjectsFile();
  const now = Date.now();
  const project: Project = {
    id: uuidv4(),
    name: name.trim() || path.basename(folderPath),
    folderPath,
    comfyuiBaseUrl: 'http://127.0.0.1:8188',
    createdAt: now,
    updatedAt: now,
  };
  index.projects.push(project);
  await writeProjectsFile(index);

  await fs.mkdir(path.join(folderPath, PROJECT_DIR_NAME), { recursive: true });
  const manifest: ProjectManifest = {
    projectId: project.id,
    folderPath,
    cues: [],
    scenes: [],
    runs: [],
  };
  await writeManifest(folderPath, manifest);
  return project;
}

export async function listProjects(): Promise<ProjectIndex> {
  return readProjectsFile();
}

export async function loadProject(id: string): Promise<Project | null> {
  const index = await readProjectsFile();
  return index.projects.find((p) => p.id === id) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  const index = await readProjectsFile();
  index.projects = index.projects.filter((p) => p.id !== id);
  if (index.lastOpenedId === id) {
    delete index.lastOpenedId;
  }
  await writeProjectsFile(index);
}

export async function updateProject(project: Project): Promise<void> {
  const index = await readProjectsFile();
  const idx = index.projects.findIndex((p) => p.id === project.id);
  if (idx === -1) return;
  index.projects[idx] = { ...project, updatedAt: Date.now() };
  await writeProjectsFile(index);
}

export async function setLastOpened(id: string): Promise<void> {
  const index = await readProjectsFile();
  if (index.projects.some((p) => p.id === id)) {
    index.lastOpenedId = id;
    await writeProjectsFile(index);
  }
}

export async function readManifest(folderPath: string): Promise<ProjectManifest | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, MANIFEST_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ProjectManifest;
    return {
      projectId: parsed.projectId,
      folderPath: parsed.folderPath,
      audioPath: parsed.audioPath,
      srtPath: parsed.srtPath,
      cues: parsed.cues ?? [],
      scenes: parsed.scenes ?? [],
      runs: parsed.runs ?? [],
    };
  } catch {
    return null;
  }
}

export async function writeManifest(
  folderPath: string,
  manifest: ProjectManifest,
): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, MANIFEST_FILE);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function ensureProjectDirs(folderPath: string): Promise<void> {
  await fs.mkdir(path.join(folderPath, PROJECT_DIR_NAME, 'storyboards'), { recursive: true });
  await fs.mkdir(path.join(folderPath, PROJECT_DIR_NAME, 'output'), { recursive: true });
}

export function getStoryboardsDir(folderPath: string): string {
  return path.join(folderPath, PROJECT_DIR_NAME, 'storyboards');
}

export function getOutputDir(folderPath: string): string {
  return path.join(folderPath, PROJECT_DIR_NAME, 'output');
}

export function createEmptyManifest(folderPath: string, projectId: string): ProjectManifest {
  return {
    projectId,
    folderPath,
    cues: [],
    scenes: [],
    runs: [],
  };
}

export function updateManifestCues(
  manifest: ProjectManifest,
  cues: Cue[],
): ProjectManifest {
  const existingScenes = new Map(manifest.scenes.map((s) => [s.cueId, s]));
  const scenes = cues.map((cue) => {
    const existing = existingScenes.get(cue.id);
    return existing ?? { cueId: cue.id, prompt: '', imagePath: undefined };
  });
  return { ...manifest, cues, scenes };
}

export function getSceneByCueId(manifest: ProjectManifest, cueId: number) {
  return manifest.scenes.find((s) => s.cueId === cueId);
}

// Chat history persistence
export async function readChatHistory(folderPath: string): Promise<ChatMessage[]> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, CHAT_HISTORY_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function writeChatHistory(folderPath: string, messages: ChatMessage[]): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, CHAT_HISTORY_FILE);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(messages, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function appendChatMessage(folderPath: string, message: ChatMessage): Promise<void> {
  const messages = await readChatHistory(folderPath);
  messages.push(message);
  await writeChatHistory(folderPath, messages);
}

export async function updateChatMessage(
  folderPath: string,
  messageId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): Promise<void> {
  const messages = await readChatHistory(folderPath);
  const idx = messages.findIndex((m) => m.id === messageId);
  if (idx !== -1) {
    messages[idx] = updater(messages[idx]);
    await writeChatHistory(folderPath, messages);
  }
}

// Session persistence for Claude Agent SDK
export async function readSessionId(folderPath: string): Promise<string | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, SESSION_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as { sessionId: string };
    return parsed.sessionId ?? null;
  } catch {
    return null;
  }
}

export async function writeSessionId(folderPath: string, sessionId: string): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, SESSION_FILE);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify({ sessionId }, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

// Canvas snapshot persistence
export async function readCanvasSnapshot(folderPath: string): Promise<unknown | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, CANVAS_SNAPSHOT_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function writeCanvasSnapshot(folderPath: string, snapshot: unknown): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, CANVAS_SNAPSHOT_FILE);
  const tmpPath = `${filePath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}
