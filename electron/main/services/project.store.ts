import path from 'node:path';
import { normalizeProjectAgent, type AgentProvider } from '../../../src/shared/agent-config';
import fs from 'node:fs/promises';
import { app } from 'electron';
import log from 'electron-log/main';
import { v4 as uuidv4 } from 'uuid';
import { atomicWriteFile, serializeFileOperation } from './atomic-file';
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
    return { projects: (parsed.projects ?? []).map(p => ({ ...p, agent: normalizeProjectAgent(p.agent) })), lastOpenedId: parsed.lastOpenedId };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { projects: [] };
    throw new Error(`项目列表读取失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeProjectsFile(index: ProjectIndex): Promise<void> {
  await ensureAppDir();
  const filePath = path.join(getAppDataDir(), PROJECTS_FILE);
  await atomicWriteFile(filePath, JSON.stringify(index, null, 2));
}

const indexTransaction = <T>(operation: () => Promise<T>): Promise<T> =>
  serializeFileOperation(path.join(getAppDataDir(), PROJECTS_FILE), operation);
export function createProject(name: string, folderPath: string, agentConfig?: unknown): Promise<Project> {
  return indexTransaction(() => createProjectInternal(name, folderPath, agentConfig));
}

async function createProjectInternal(
  name: string,
  folderPath: string,
  agentConfig?: unknown,
): Promise<Project> {
  const agent = normalizeProjectAgent(agentConfig);
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('请选择有效的项目目录');
  folderPath = await fs.realpath(folderPath);
  if (!(await fs.stat(folderPath)).isDirectory()) throw new Error('项目路径必须是文件夹');
  const index = await readProjectsFile();
  if (index.projects.some(p => path.resolve(p.folderPath).toLowerCase() === folderPath.toLowerCase())) throw new Error('该目录已有项目，请直接打开历史项目');
  try {
    await fs.access(path.join(folderPath, PROJECT_DIR_NAME, MANIFEST_FILE));
    throw new Error('该目录包含已有项目，请选择一个新的目录');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const now = Date.now();
  const project: Project = {
    id: uuidv4(),
    agent,
    name: name.trim() || path.basename(folderPath),
    folderPath,
    comfyuiBaseUrl: 'http://127.0.0.1:8188',
    createdAt: now,
    updatedAt: now,
  };

  await fs.mkdir(path.join(folderPath, PROJECT_DIR_NAME), { recursive: true });
  const manifest: ProjectManifest = {
    projectId: project.id,
    agent,
    folderPath,
    cues: [],
    scenes: [],
    runs: [],
  };
  await writeManifest(folderPath, manifest);
  index.projects.push(project);
  await writeProjectsFile(index);
  return project;
}

export async function listProjects(): Promise<ProjectIndex> {
  return indexTransaction(readProjectsFile);
}

export async function loadProject(id: string): Promise<Project | null> {
  const index = await listProjects();
  return index.projects.find((p) => p.id === id) ?? null;
}

export async function deleteProject(id: string): Promise<void> {
  return indexTransaction(async () => {
  const index = await readProjectsFile();
  index.projects = index.projects.filter((p) => p.id !== id);
  if (index.lastOpenedId === id) {
    delete index.lastOpenedId;
  }
  await writeProjectsFile(index);
  });
}

export async function setLastOpened(id: string): Promise<void> {
  return indexTransaction(async () => {
  const index = await readProjectsFile();
  if (index.projects.some((p) => p.id === id)) {
    if (index.lastOpenedId === id) return;
    index.lastOpenedId = id;
    await writeProjectsFile(index);
  }
  });
}

export async function readManifest(folderPath: string): Promise<ProjectManifest | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, MANIFEST_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as ProjectManifest;
    return {
      projectId: parsed.projectId,
      agent: normalizeProjectAgent(parsed.agent),
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
  const filePath = path.join(dir, MANIFEST_FILE);
  await serializeFileOperation(filePath, () => atomicWriteFile(filePath, JSON.stringify(manifest, null, 2)));
}

// The log remains append-only; its current message index is rebuilt only after external changes.
interface ChatIndex {
  signature: string;
  nextSeq: number;
  messages: ChatMessage[];
  indexes: Map<string, number>;
  incompleteContent?: string;
}
const chatIndexes = new Map<string, ChatIndex>();
const chatEventsPath = (folderPath: string): string => path.join(folderPath, PROJECT_DIR_NAME, CHAT_EVENTS_FILE);
const chatKey = (folderPath: string): string => process.platform === 'win32' ? path.resolve(folderPath).toLowerCase() : path.resolve(folderPath);
async function chatSignature(filePath: string): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino].join(':');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}
async function loadChatIndex(folderPath: string, forWrite: boolean): Promise<ChatIndex> {
  const filePath = chatEventsPath(folderPath);
  const key = chatKey(folderPath);
  const signature = await chatSignature(filePath);
  let cached = chatIndexes.get(key);
  if (!cached || cached.signature !== signature) {
    const parsed = signature === 'missing'
      ? { events: [] as ChatHistoryEvent[], ignoredIncompleteTail: false }
      : parseChatEventLog(await fs.readFile(filePath, 'utf8'));
    const messages = replayChatEvents(parsed.events);
    cached = { signature, nextSeq: (parsed.events.at(-1)?.seq ?? 0) + 1, messages,
      indexes: new Map(messages.map((message, index) => [message.id, index])),
      incompleteContent: parsed.ignoredIncompleteTail ? parsed.events.map(event => JSON.stringify(event)).join('\n') : undefined };
    if (parsed.ignoredIncompleteTail) log.warn('[ProjectStore] Ignoring incomplete final chat event:', filePath);
    chatIndexes.set(key, cached);
  }
  // Bound retained project indexes; entries can always be reconstructed from the log.
  chatIndexes.delete(key); chatIndexes.set(key, cached);
  if (chatIndexes.size > 8) chatIndexes.delete(chatIndexes.keys().next().value!);
  if (forWrite && cached.incompleteContent !== undefined) {
    await fs.copyFile(filePath, filePath + '.corrupt-' + uuidv4());
    await atomicWriteFile(filePath, cached.incompleteContent ? cached.incompleteContent + '\n' : '');
    cached.incompleteContent = undefined;
    cached.signature = await chatSignature(filePath);
  }
  return cached;
}
export async function readChatHistory(folderPath: string): Promise<ChatMessage[]> {
  return serializeFileOperation(chatEventsPath(folderPath), async () => structuredClone((await loadChatIndex(folderPath, false)).messages));
}
async function writeChatEvent(folderPath: string, cached: ChatIndex, event: ChatHistoryEvent): Promise<void> {
  const filePath = chatEventsPath(folderPath);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, JSON.stringify(event) + '\n', 'utf8');
    cached.nextSeq = event.seq + 1;
    if (event.type === 'message.created') {
      cached.indexes.set(event.message.id, cached.messages.length);
      cached.messages.push(event.message);
    } else {
      const index = cached.indexes.get(event.messageId);
      if (index !== undefined) {
        cached.messages[index] = event.message;
        cached.indexes.delete(event.messageId);
        cached.indexes.set(event.message.id, index);
      }
    }
    cached.signature = await chatSignature(filePath);
  } catch (error) {
    chatIndexes.delete(chatKey(folderPath));
    throw error;
  }
}
export function appendChatMessage(folderPath: string, message: ChatMessage): Promise<void> {
  const captured = structuredClone(message);
  return serializeFileOperation(chatEventsPath(folderPath), async () => {
    const cached = await loadChatIndex(folderPath, true);
    await writeChatEvent(folderPath, cached, { version: 1, seq: cached.nextSeq, type: 'message.created', message: captured });
  });
}
export function updateChatMessage(folderPath: string, messageId: string, updater: (msg: ChatMessage) => ChatMessage): Promise<void> {
  return serializeFileOperation(chatEventsPath(folderPath), async () => {
    const cached = await loadChatIndex(folderPath, true);
    const index = cached.indexes.get(messageId);
    if (index === undefined) return;
    const message = structuredClone(updater(structuredClone(cached.messages[index])));
    await writeChatEvent(folderPath, cached, { version: 1, seq: cached.nextSeq, type: 'message.replaced', messageId, message });
  });
}

// Session persistence for Claude Agent SDK
export async function readSessionId(folderPath: string, provider: AgentProvider = 'claude-code'): Promise<string | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, provider === 'codex' ? 'codex-session.json' : SESSION_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data) as { sessionId: string };
    return parsed.sessionId ?? null;
  } catch {
    return null;
  }
}

export async function writeSessionId(folderPath: string, sessionId: string, provider: AgentProvider = 'claude-code'): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  const filePath = path.join(dir, provider === 'codex' ? 'codex-session.json' : SESSION_FILE);
  await serializeFileOperation(filePath, () => atomicWriteFile(filePath, JSON.stringify({ sessionId }, null, 2)));
}

// Canvas snapshot persistence
export async function readCanvasSnapshot(folderPath: string): Promise<unknown | null> {
  const filePath = path.join(folderPath, PROJECT_DIR_NAME, CANVAS_SNAPSHOT_FILE);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`画布快照读取失败，原文件已保留：${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeCanvasSnapshot(folderPath: string, snapshot: unknown): Promise<void> {
  const dir = path.join(folderPath, PROJECT_DIR_NAME);
  const filePath = path.join(dir, CANVAS_SNAPSHOT_FILE);
  const content = JSON.stringify(snapshot);
  await serializeFileOperation(filePath, () => atomicWriteFile(filePath, content));
}
