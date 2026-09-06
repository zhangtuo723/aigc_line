import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const environment = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => environment.root } }));
vi.mock('electron-log/main', () => ({ default: { warn: vi.fn(), info: vi.fn() } }));
import { createProject, listProjects, readManifest, readSessionId, writeSessionId } from '../electron/main/services/project.store';
import { normalizeProjectAgent } from '../src/shared/agent-config';
let workspace: string;
beforeEach(async () => { environment.root = await fs.mkdtemp(path.join(os.tmpdir(), 'aigc-agent-project-')); workspace = path.join(environment.root, 'workspace'); await fs.mkdir(workspace); });
afterEach(async () => { await fs.rm(environment.root, { recursive: true, force: true }); });
describe('project agent persistence', () => {
  it('defaults legacy projects to Claude without rewriting their session', async () => {
    await fs.mkdir(path.join(environment.root, 'aigc-line'));
    await fs.writeFile(path.join(environment.root, 'aigc-line/projects.json'), JSON.stringify({ projects: [{ id:'legacy', folderPath:workspace }] }));
    await writeSessionId(workspace, 'claude-session');
    expect((await listProjects()).projects[0].agent).toEqual({provider:'claude-code',model:''});
    expect(await readSessionId(workspace)).toBe('claude-session');
    expect(await readSessionId(workspace, 'codex')).toBeNull();
  });
  it('persists provider/model in the index and workspace manifest with isolated sessions', async () => {
    const agent = { provider:'codex' as const, model:'custom-model' };
    expect((await createProject('Codex project', workspace, agent)).agent).toEqual(agent);
    expect((await listProjects()).projects[0].agent).toEqual(agent);
    expect((await readManifest(workspace))?.agent).toEqual(agent);
    await writeSessionId(workspace, 'claude-session');
    await writeSessionId(workspace, 'codex-session', 'codex');
    expect(await readSessionId(workspace)).toBe('claude-session');
    expect(await readSessionId(workspace, 'codex')).toBe('codex-session');
    await writeSessionId(workspace, '', 'codex');
    expect(await readSessionId(workspace)).toBe('claude-session');
  });
  it('rejects invalid providers, duplicate directories and concurrent duplicate creation', async () => {
    expect(() => normalizeProjectAgent({provider:'other'})).toThrow();
    const results = await Promise.allSettled([createProject('One',workspace),createProject('Two',workspace)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await listProjects()).projects).toHaveLength(1);
  });
  it('does not overwrite a malformed existing workspace manifest or hide a corrupt index', async () => {
    await fs.mkdir(path.join(workspace, '.aigc-line'));
    await fs.writeFile(path.join(workspace, '.aigc-line/manifest.json'), '{broken');
    await expect(createProject('One', workspace)).rejects.toThrow('已有项目');
    await fs.writeFile(path.join(environment.root,'aigc-line/projects.json'), '{broken');
    await expect(listProjects()).rejects.toThrow('项目列表读取失败');
  });
});
