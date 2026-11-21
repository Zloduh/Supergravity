export type ProviderType = 'ollama' | 'llamacpp' | 'vllm' | 'lmstudio' | 'custom';
export type LLMProviderType = ProviderType;

export type ThemeMode = 'dark' | 'light' | 'system';
export type TerminalTheme = ThemeMode;
export type UITheme = ThemeMode;

export type MCPTransportConfig =
  | {
      type: 'stdio';
      command: string;
      args: string[];
      env?: Record<string, string> | null;
      cwd?: string | null;
    }
  | {
      type: 'sse';
      url: string;
      headers?: Record<string, string> | null;
    };

export interface LLMProviderConfig {
  id: string;
  name: string;
  provider_type: LLMProviderType;
  base_url: string;
  api_key?: string | null;
  models: string[];
  enabled: boolean;
  headers?: Record<string, string> | null;
}

export interface LLMConfig {
  providers: LLMProviderConfig[];
  active_provider?: string | null;
  default_model?: string | null;
  max_tokens?: number | null;
  context_length?: number | null;
  temperature?: number | null;
  timeout_seconds?: number | null;
  searxng_url?: string | null;
  inherit_model_settings?: boolean;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: MCPTransportConfig;
  enabled: boolean;
  auto_start: boolean;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
  auto_connect: boolean;
}

export interface AgentConfig {
  max_iterations: number;
  max_subagents: number;
  tool_timeout_seconds: number;
  enable_streaming: boolean;
  system_prompt?: string | null;
  require_command_approval: boolean;
  sandbox_enabled?: boolean;
  non_workspace_file_access?: 'allow' | 'ask' | 'deny' | string;
  internet_access_policy?: 'allow' | 'ask' | 'deny' | string;
  command_allowlist?: string[];
  command_denylist?: string[];
  browser_allowlist?: string[];
}

export interface TerminalConfig {
  shell?: string | null;
  args: string[];
  env: Record<string, string>;
  cwd?: string | null;
  cols: number;
  rows: number;
  scrollback: number;
  font_size: number;
  font_family: string;
  theme: TerminalTheme;
}

export interface UIConfig {
  theme: UITheme;
  sidebar_width: number;
  terminal_height: number;
  artifact_panel_width: number;
  font_size: number;
  font_family: string;
  animations_enabled: boolean;
  compact_mode: boolean;
}

export interface SkillsConfig {
  directories: string[];
  auto_load: boolean;
  builtin_skills_path?: string | null;
}

export type ProjectPermissionPreset =
  | 'inherit_global'
  | 'default'
  | 'auto'
  | 'always_ask';

export type WorktreeMode = 'local' | 'new_worktree';

export interface ProjectFolder {
  path: string;
  name: string;
  is_git?: boolean;
  git_branch?: string | null;
  ssh_host?: string | null;
}

export interface ProjectSettings {
  permission_preset: ProjectPermissionPreset;
  default_worktree_mode: WorktreeMode;
  system_prompt?: string | null;
  require_command_approval?: boolean | null;
  allowed_paths: string[];
  file_access_policy?: string | null;
  internet_access_policy?: string | null;
  sandbox_enabled?: boolean | null;
}

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string | null;
  folders: ProjectFolder[];
  settings: ProjectSettings;
  created_at?: string;
  updated_at?: string;
}

export interface ScheduledTaskConfig {
  id: string;
  name: string;
  prompt: string;
  cron_expression?: string | null;
  duration_seconds?: number | null;
  project_id?: string | null;
  enabled: boolean;
  created_at: string;
}

export interface WorkspaceConfig {
  recent_paths: string[];
  max_recent: number;
  default_path?: string | null;
  ignored_patterns: string[];
  projects?: ProjectConfig[];
  active_project_id?: string | null;
  interface_layout?: 'standard' | 'knowledge_work' | string;
  scheduled_tasks?: ScheduledTaskConfig[];
}

export interface AppConfig {
  llm: LLMConfig;
  mcp: MCPConfig;
  agent: AgentConfig;
  terminal: TerminalConfig;
  ui: UIConfig;
  skills: SkillsConfig;
  workspace: WorkspaceConfig;
}

export const DEFAULT_APP_CONFIG: AppConfig = {
  llm: {
    providers: [
      {
        id: 'strata',
        name: 'Strata (Local)',
        provider_type: 'custom',
        base_url: 'http://127.0.0.1:47831/v1',
        api_key: 'strata',
        models: ['coder-iq1_m'],
        enabled: true,
        headers: null,
      },
      {
        id: 'strata-lan',
        name: 'Strata (LAN)',
        provider_type: 'custom',
        base_url: 'http://192.168.0.92:47832/v1',
        api_key: 'strata',
        models: ['coder-iq1_m'],
        enabled: true,
        headers: null,
      },
    ],
    active_provider: 'strata',
    default_model: 'coder-iq1_m',
    max_tokens: 8192,
    context_length: 32768,
    temperature: 0.7,
    timeout_seconds: 120,
    searxng_url: null,
    inherit_model_settings: true,
  },
  mcp: {
    servers: [],
    auto_connect: true,
  },
  agent: {
    max_iterations: 25,
    max_subagents: 4,
    tool_timeout_seconds: 60,
    enable_streaming: true,
    system_prompt: null,
    require_command_approval: false,
    sandbox_enabled: true,
    non_workspace_file_access: 'allow',
    internet_access_policy: 'allow',
    command_allowlist: [],
    command_denylist: [],
    browser_allowlist: [],
  },
  terminal: {
    shell: null,
    args: [],
    env: {},
    cwd: null,
    cols: 80,
    rows: 24,
    scrollback: 5000,
    font_size: 13,
    font_family: 'JetBrains Mono, Fira Code, monospace',
    theme: 'dark',
  },
  ui: {
    theme: 'dark',
    sidebar_width: 288,
    terminal_height: 260,
    artifact_panel_width: 420,
    font_size: 14,
    font_family: 'Inter, system-ui, sans-serif',
    animations_enabled: true,
    compact_mode: false,
  },
  skills: {
    directories: [],
    auto_load: true,
    builtin_skills_path: null,
  },
  workspace: {
    recent_paths: [],
    max_recent: 10,
    default_path: null,
    ignored_patterns: ['node_modules', '.git', 'target', 'dist'],
    projects: [],
    active_project_id: null,
    interface_layout: 'standard',
    scheduled_tasks: [],
  },
};
