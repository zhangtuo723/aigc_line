import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AvailableSkill, AvailableSkillSource } from '../../../../src/shared/ipc.types';
import { resolveBuiltinPluginPath } from './builtin-plugin';
import { parseSkillFrontmatter } from './skill-metadata';

const MAX_SKILLS_PER_SOURCE = 200;
const MAX_SKILL_FILE_BYTES = 64 * 1024;

async function readSmallTextFile(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > MAX_SKILL_FILE_BYTES) return null;
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function scanSkillDirectory(
  root: string,
  source: AvailableSkillSource,
  namespace?: string,
): Promise<AvailableSkill[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const skills: AvailableSkill[] = [];
  for (const entry of entries.slice(0, MAX_SKILLS_PER_SOURCE)) {
    if (!entry.isDirectory()) continue;
    const content = await readSmallTextFile(path.join(root, entry.name, 'SKILL.md'));
    if (!content) continue;
    const metadata = parseSkillFrontmatter(content, entry.name);
    skills.push({
      ...metadata,
      name: namespace ? `${namespace}:${metadata.name}` : metadata.name,
      source,
    });
  }
  return skills;
}

async function readBuiltinPluginNamespace(pluginPath: string): Promise<string> {
  const manifest = await readSmallTextFile(
    path.join(pluginPath, '.claude-plugin', 'plugin.json'),
  );
  if (!manifest) return 'aigc-canvas';
  try {
    const parsed = JSON.parse(manifest) as { name?: unknown };
    return typeof parsed.name === 'string' && parsed.name.trim()
      ? parsed.name.trim()
      : 'aigc-canvas';
  } catch {
    return 'aigc-canvas';
  }
}

export async function scanAvailableSkills(folderPath: string): Promise<AvailableSkill[]> {
  const builtinPluginPath = resolveBuiltinPluginPath({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
  });
  const builtinNamespace = await readBuiltinPluginNamespace(builtinPluginPath);

  const [userSkills, builtinSkills, projectSkills] = await Promise.all([
    scanSkillDirectory(path.join(app.getPath('home'), '.claude', 'skills'), 'user'),
    scanSkillDirectory(
      path.join(builtinPluginPath, 'skills'),
      'builtin',
      builtinNamespace,
    ),
    scanSkillDirectory(path.join(folderPath, '.claude', 'skills'), 'project'),
  ]);

  // Later sources take precedence for identical unqualified names.
  return [...new Map(
    [...userSkills, ...builtinSkills, ...projectSkills].map((skill) => [skill.name, skill]),
  ).values()].sort((a, b) => a.name.localeCompare(b.name));
}
