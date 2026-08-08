import type { AvailableSkill } from '../../../../src/shared/ipc.types';
import type { SlashCommand } from '@anthropic-ai/claude-agent-sdk';

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseSkillFrontmatter(
  content: string,
  fallbackName: string,
): Pick<AvailableSkill, 'name' | 'description' | 'argumentHint'> {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? '';
  const readField = (field: string): string => {
    const match = new RegExp(`^${field}:\\s*(.+)$`, 'mi').exec(frontmatter);
    return match ? unquote(match[1]) : '';
  };

  return {
    name: readField('name') || fallbackName,
    description: readField('description') || '无描述',
    argumentHint: readField('argument-hint') || undefined,
  };
}

/** Enrich real filesystem skills without leaking SDK control commands into the Skill menu. */
export function mergeDiscoveredSkills(
  discovered: AvailableSkill[],
  sdkCommands: SlashCommand[],
): AvailableSkill[] {
  const merged = new Map(discovered.map((skill) => [skill.name, skill]));
  for (const command of sdkCommands) {
    const existing = merged.get(command.name);
    if (!existing) continue;
    merged.set(command.name, {
      ...existing,
      description: command.description || existing.description,
      argumentHint: command.argumentHint || existing.argumentHint,
    });
  }
  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name));
}
