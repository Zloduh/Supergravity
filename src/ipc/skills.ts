import { safeInvoke } from '../utils/tauri';
import type { Skill, SkillSchema, SkillSourceFilter, SkillTypeFilter } from '../types';

export function listSkills(params?: {
  source?: SkillSourceFilter | string | null;
  skill_type?: SkillTypeFilter | string | null;
}): Promise<Skill[]> {
  const args: Record<string, unknown> = {};
  if (params?.source !== undefined && params.source !== null) {
    args.source = params.source;
  }
  if (params?.skill_type !== undefined && params.skill_type !== null) {
    args.skill_type = params.skill_type;
  }
  return safeInvoke<Skill[]>('list_skills', args);
}

export function loadSkill(id: string): Promise<Skill> {
  return safeInvoke<Skill>('load_skill', { id });
}

export function unloadSkill(id: string): Promise<void> {
  return safeInvoke<void>('unload_skill', { id });
}

export function reloadSkills(): Promise<Skill[]> {
  return safeInvoke<Skill[]>('reload_skills');
}

export function getSkillSchema(id: string): Promise<SkillSchema | null> {
  return safeInvoke<SkillSchema | null>('get_skill_schema', { id });
}
