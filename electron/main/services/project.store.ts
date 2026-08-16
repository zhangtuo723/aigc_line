import path from 'node:path';
import fs from 'node:fs/promises';
import { app } from 'electron';
import log from 'electron-log/main';
import { v4 as uuidv4 } from 'uuid';
import type {
  Project,
  ProjectIndex,
  ProjectManifest,
  ChatMessage,
} from '../../../src/shared/ipc.types';
import {
  parseChatEventLog,
  replayChatEvents,
  type ChatHistoryEvent,
} from '../../../src/shared/chat-event-log';

const APP_DIR_NAME = 'aigc-line';
const PROJECTS_FILE = 'projects.json';
const PROJECT_DIR_NAME = '.aigc-line';
const MANIFEST_FILE = 'manifest.json';
const CHAT_EVENTS_FILE = 'chat-events.jsonl';
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

export async function setLastOpened(id: string): Promise<void> {
  const index = await readProjectsFile();
  if (index.projects.some((p) => p.id === id)) {
    if (index.lastOpenedId === id) return;
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

// Chat history persistence. Each project has one append-only JSONL event log.
const chatWriteQueues = new Map<string, Promise<void>>();
const chatNextSequences = new Map<string, number>();

function chatEventsPath(folderPath: string): string {
  return path.join(folderPath, PROJECT_DIR_NAME, CHAT_EVENTS_FILE);
}

async function readChatEventLog(folderPath: string): Promise<ReturnType<typeof parseChatEventLog>> {
  const filePath = chatEventsPath(folderPath);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return parseChatEventLog(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { events: [], ignoredIncompleteTail: false };
    }
    throw error;
  }
}

export async function readChatHistory(folderPath: string): Promise<ChatMessage[]> {
  const pendingWrite = chatWriteQueues.get(path.resolve(folderPath));
  if (pendingWrite) await pendingWrite;
  const { events, ignoredIncompleteTail } = await readChatEventLog(folderPath);
  if (ignoredIncompleteTail) {
    log.warn('[ProjectStore] Ignoring incomplete final chat event:', chatEventsPath(folderPath));
  }
  return replayChatEvents(events);
}

function enqueueChatWrite(folderPath: string, operation: () => Promise<void>): Promise<void> {
  const key = path.resolve(folderPath);
  const previous = chatWriteQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  chatWriteQueues.set(key, current);
  void current.finally(() => {
    if (chatWriteQueues.get(key) === current) chatWriteQueues.delete(key);
  }).catch(() => undefined);
  return current;
}

async function appendChatEvent(
  folderPath: string,
  makeEvent: (seq: number) => ChatHistoryEvent,
): Promise<void> {
  await enqueueChatWrite(folderPath, async () => {
    const dir = path.join(folderPath, PROJECT_DIR_NAME);
    await fs.mkdir(dir, { recursive: true });
    const filePath = chatEventsPath(folderPath);
    const key = path.resolve(folderPath);
    let nextSeq = chatNextSequences.get(key);
    if (nextSeq === undefined) {
      const parsed = await readChatEventLog(folderPath);
      if (parsed.ignoredIncompleteTail) {
        const corruptPath = `${filePath}.corrupt-${Date.now()}`;
        await fs.copyFile(filePath, corruptPath);
        const validContent = parsed.events.map((event) => JSON.stringify(event)).join('\n');
        await fs.writeFile(filePath, validContent ? `${validContent}\n` : '', 'utf-8');
      }
      nextSeq = (parsed.events.at(-1)?.seq ?? 0) + 1;
    }
    const event = makeEvent(nextSeq);
    try {
      await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
      chatNextSequences.set(key, nextSeq + 1);
    } catch (error) {
      chatNextSequences.delete(key);
      throw error;
    }
  });
}

export function appendChatMessage(folderPath: string, message: ChatMessage): Promise<void> {
  return appendChatEvent(folderPath, (seq) => ({
    version: 1,
    seq,
    type: 'message.created',
    message,
  }));
}

export async function updateChatMessage(
  folderPath: string,
  messageId: string,
  updater: (msg: ChatMessage) => ChatMessage,
): Promise<void> {
  await enqueueChatWrite(folderPath, async () => {
    const parsed = await readChatEventLog(folderPath);
    if (parsed.ignoredIncompleteTail) {
      throw new Error('聊天事件日志末行不完整，请重新加载后再更新消息');
    }
    const current = replayChatEvents(parsed.events).find((message) => message.id === messageId);
    if (!current) return;
    const key = path.resolve(folderPath);
    const seq = chatNextSequences.get(key) ?? ((parsed.events.at(-1)?.seq ?? 0) + 1);
    const event: ChatHistoryEvent = {
      version: 1,
      seq,
      type: 'message.replaced',
      messageId,
      message: updater(current),
    };
    try {
      await fs.appendFile(chatEventsPath(folderPath), `${JSON.stringify(event)}\n`, 'utf-8');
      chatNextSequences.set(key, seq + 1);
    } catch (error) {
      chatNextSequences.delete(key);
      throw error;
    }
  });
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
