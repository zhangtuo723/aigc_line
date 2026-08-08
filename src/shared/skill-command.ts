import type { AvailableSkill } from './ipc.types';

/** Return the slash-menu query while the user is editing the first token. */
export function getSkillSearchQuery(content: string): string | null {
  const match = /^\/([^\s]*)$/.exec(content);
  return match ? match[1].toLowerCase() : null;
}

export function makeSkillCommand(skillName: string): string {
  return `/${skillName} `;
}

export function filterAvailableSkills(
  skills: AvailableSkill[],
  query: string,
): AvailableSkill[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return skills;
  return skills.filter((skill) =>
    skill.name.toLowerCase().includes(normalized)
    || skill.description.toLowerCase().includes(normalized),
  );
}
