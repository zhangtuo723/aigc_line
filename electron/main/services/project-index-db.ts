import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import type { Project, ProjectIndex, ProjectPage, ProjectPageQuery } from '../../../src/shared/ipc.types';
import { normalizeProjectAgent } from '../../../src/shared/agent-config';

export const PROJECT_DATABASE_FILE = 'projects.sqlite';
// Vite 5 predates node:sqlite; resolve this built-in at runtime in Electron's Node process.
const { DatabaseSync: SQLiteDatabase } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
const LEGACY_FILE = 'projects.json';
const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188';
const PROJECT_SCHEMA = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    folder_path TEXT NOT NULL,
    folder_path_key TEXT NOT NULL,
    comfyui_base_url TEXT NOT NULL,
    agent_provider TEXT NOT NULL CHECK (agent_provider IN ('claude-code', 'codex')),
    agent_model TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    restore_on_launch INTEGER NOT NULL DEFAULT 0 CHECK (restore_on_launch IN (0, 1))
  );
  CREATE INDEX projects_folder ON projects(folder_path_key);
  CREATE UNIQUE INDEX projects_one_restore ON projects(restore_on_launch) WHERE restore_on_launch = 1;
  CREATE INDEX projects_created ON projects(created_at DESC, id);
`;

interface ProjectRow {
  id: string;
  name: string;
  folder_path: string;
  comfyui_base_url: string;
  agent_provider: 'claude-code' | 'codex';
  agent_model: string;
  created_at: number;
  updated_at: number;
  restore_on_launch: number;
}

const PROJECT_COLUMNS = 'id, name, folder_path, comfyui_base_url, agent_provider, agent_model, created_at, updated_at, restore_on_launch';

export function projectFolderKey(folderPath: string): string {
  const resolved = path.resolve(folderPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function projectFromRow(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    folderPath: row.folder_path,
    comfyuiBaseUrl: row.comfyui_base_url,
    agent: { provider: row.agent_provider, model: row.agent_model },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function normalizeLegacyProject(value: unknown): Project {
  if (!value || typeof value !== 'object') throw new Error('历史项目记录格式无效');
  const project = value as Partial<Project>;
  if (typeof project.id !== 'string' || !project.id || typeof project.folderPath !== 'string' || !path.isAbsolute(project.folderPath)) {
    throw new Error('历史项目缺少有效的 ID 或目录');
  }
  const agent = normalizeProjectAgent(project.agent);
  return {
    id: project.id,
    name: typeof project.name === 'string' && project.name.trim() ? project.name : path.basename(project.folderPath),
    folderPath: project.folderPath,
    comfyuiBaseUrl: typeof project.comfyuiBaseUrl === 'string' ? project.comfyuiBaseUrl : DEFAULT_COMFY_URL,
    agent,
    createdAt: Number.isFinite(project.createdAt) ? project.createdAt! : 0,
    updatedAt: Number.isFinite(project.updatedAt) ? project.updatedAt! : 0,
  };
}

export function insertProject(db: DatabaseSync, project: Project, restore = false): void {
  db.prepare(`INSERT INTO projects (${PROJECT_COLUMNS}, folder_path_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    project.id, project.name, project.folderPath, project.comfyuiBaseUrl,
    project.agent?.provider ?? 'claude-code', project.agent?.model ?? '',
    project.createdAt, project.updatedAt, restore ? 1 : 0, projectFolderKey(project.folderPath),
  );
}

async function importLegacyIndex(db: DatabaseSync, dataDir: string): Promise<void> {
  let legacy: ProjectIndex = { projects: [] };
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(path.join(dataDir, LEGACY_FILE), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as ProjectIndex).projects)) {
      throw new Error('项目列表结构无效');
    }
    legacy = parsed as ProjectIndex;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new Error(`项目列表读取失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const projects = legacy.projects.map(normalizeLegacyProject);
  db.exec('BEGIN IMMEDIATE');
  try {
    // Version 0 is never committed by this app. Replace any interrupted schema
    // inside the transaction, while preserving every historical project row.
    db.exec('DROP TABLE IF EXISTS projects');
    db.exec(PROJECT_SCHEMA);
    for (const project of projects) insertProject(db, project, project.id === legacy.lastOpenedId);
    db.exec('PRAGMA user_version = 1');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw new Error(`历史项目迁移失败，projects.json 已保留：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Opens the single app-level projects table and imports projects.json once. */
export async function openProjectDatabase(dataDir: string): Promise<DatabaseSync> {
  await fs.mkdir(dataDir, { recursive: true });
  const db = new SQLiteDatabase(path.join(dataDir, PROJECT_DATABASE_FILE));
  try {
    const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version === 0) await importLegacyIndex(db, dataDir);
    else if (version !== 1) throw new Error(`不支持的项目数据库版本：${version}`);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function listProjectIndex(db: DatabaseSync): ProjectIndex {
  const rows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at DESC, id`).all() as unknown as ProjectRow[];
  return {
    projects: rows.map(projectFromRow),
    lastOpenedId: rows.find(row => row.restore_on_launch === 1)?.id,
  };
}

export function findProject(db: DatabaseSync, id: string): Project | null {
  const row = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`).get(id) as ProjectRow | undefined;
  return row ? projectFromRow(row) : null;
}

export function queryProjectPage(db: DatabaseSync, query: ProjectPageQuery = {}): ProjectPage {
  const search = (query.search ?? '').trim();
  const pageSize = Number.isInteger(query.pageSize) ? Math.min(100, Math.max(1, query.pageSize!)) : 18;
  const requestedPage = Number.isInteger(query.page) ? Math.max(1, query.page!) : 1;
  const where = search ? `WHERE instr(lower(name), lower(?)) > 0
    OR instr(lower(folder_path), lower(?)) > 0
    OR instr(lower(agent_model), lower(?)) > 0
    OR instr(lower(CASE agent_provider WHEN 'codex' THEN 'Codex' ELSE 'Claude Code' END), lower(?)) > 0
    OR (agent_model = '' AND instr('默认模型', ?) > 0)` : '';
  const params = search ? [search, search, search, search, search] : [];
  const total = (db.prepare(`SELECT count(*) AS count FROM projects ${where}`).get(...params) as { count: number }).count;
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / pageSize)));
  let projects: Project[];
  if (query.sort === 'name') {
    // Preserve the existing Chinese/numeric name order; SQLite NOCASE cannot reproduce Intl.Collator.
    const rows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ${where}`).all(...params) as unknown as ProjectRow[];
    projects = rows.map(projectFromRow).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))
      .slice((page - 1) * pageSize, page * pageSize);
  } else {
    const rows = db.prepare(`SELECT ${PROJECT_COLUMNS} FROM projects ${where} ORDER BY created_at DESC, name, id LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize) as unknown as ProjectRow[];
    projects = rows.map(projectFromRow);
  }
  return { projects, total, page, pageSize };
}
