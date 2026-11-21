export type SkillType = 'builtin' | 'plugin' | 'user' | 'system';

export type SkillSource =
  | 'builtinskills'
  | 'pluginskills'
  | 'configskills'
  | 'claudeskills'
  | 'agentsskills';

export type SkillSourceFilter = 'builtin' | 'plugin' | 'config' | 'claude' | 'agents';
export type SkillTypeFilter = SkillType;

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  path: string;
  skill_type: SkillType;
  schema?: Record<string, unknown> | null;
  loaded: boolean;
  source: SkillSource;
}

export type SkillInfo = Skill;

export interface SkillSchema {
  name: string;
  description: string;
  parameters: unknown;
  returns?: unknown | null;
}
