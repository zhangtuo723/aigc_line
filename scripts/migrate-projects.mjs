#!/usr/bin/env node
// One-time, repeat-safe import of the old app-level projects.json into projects.sqlite.
// Usage: node scripts/migrate-projects.mjs --data-dir "<Electron userData>/aigc-line"
import fs from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const flag = process.argv.indexOf('--data-dir')
if (flag < 0 || !process.argv[flag + 1] || !path.isAbsolute(process.argv[flag + 1])) {
  console.error('用法：node scripts/migrate-projects.mjs --data-dir "<Electron userData>/aigc-line"')
  process.exitCode = 1
} else {
  const dataDir = path.resolve(process.argv[flag + 1])
  const legacyFile = path.join(dataDir, 'projects.json')
  const databaseFile = path.join(dataDir, 'projects.sqlite')
  await fs.mkdir(dataDir, { recursive: true })
  const db = new DatabaseSync(databaseFile)
  try {
      const version = db.prepare('PRAGMA user_version').get().user_version
      if (version === 1) {
        console.log(`已迁移，跳过：${databaseFile}`)
      } else if (version !== 0) {
        throw new Error(`不支持的项目数据库版本：${version}`)
      } else {
        let source
        try {
          source = JSON.parse(await fs.readFile(legacyFile, 'utf8'))
          if (!source || !Array.isArray(source.projects)) throw new Error('项目列表结构无效')
        } catch (error) {
          throw new Error(`历史项目读取失败：${error.message}`)
        }
        db.exec('BEGIN IMMEDIATE')
        try {
          // Version 0 is an unfinished import. Recreate the table atomically so
          // old indexes with stricter constraints cannot drop historical rows.
          db.exec(`
            DROP TABLE IF EXISTS projects;
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
          `)
          const insert = db.prepare(`INSERT INTO projects
            (id, name, folder_path, folder_path_key, comfyui_base_url, agent_provider, agent_model, created_at, updated_at, restore_on_launch)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          for (const project of source.projects) {
            if (typeof project.id !== 'string' || !project.id || typeof project.folderPath !== 'string' || !path.isAbsolute(project.folderPath)) {
              throw new Error('历史项目缺少有效的 ID 或目录')
            }
            const provider = project.agent?.provider ?? 'claude-code'
            if (provider !== 'claude-code' && provider !== 'codex') throw new Error(`无效 Agent：${provider}`)
            const model = project.agent?.model ?? ''
            if (typeof model !== 'string') throw new Error('无效模型名称')
            const folderKey = process.platform === 'win32' ? path.resolve(project.folderPath).toLowerCase() : path.resolve(project.folderPath)
            insert.run(project.id, typeof project.name === 'string' && project.name.trim() ? project.name : path.basename(project.folderPath),
              project.folderPath, folderKey, typeof project.comfyuiBaseUrl === 'string' ? project.comfyuiBaseUrl : 'http://127.0.0.1:8188',
              provider, model, Number.isFinite(project.createdAt) ? project.createdAt : 0,
              Number.isFinite(project.updatedAt) ? project.updatedAt : 0, project.id === source.lastOpenedId ? 1 : 0)
          }
          db.exec('PRAGMA user_version = 1')
          db.exec('COMMIT')
          console.log(`已迁移 ${source.projects.length} 个项目：${databaseFile}`)
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
  } catch (error) {
    console.error(`迁移失败，原 projects.json 已保留：${error.message}`)
    process.exitCode = 1
  } finally {
    db.close()
  }
}
