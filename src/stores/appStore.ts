import { create } from 'zustand';
import {
  DEFAULT_APP_CONFIG,
  type AppConfig,
  type LLMProviderConfig,
  type MCPServerConfig,
  type ProjectConfig,
  type ProjectFolder,
  type ProjectSettings,
  type ThemeMode,
} from '../types/config';
import type { LLMModel, LLMProvider } from '../types/llm';
import type { MCPServer, MCPTool } from '../types/mcp';
import type { SkillInfo, SkillSchema } from '../types/skills';
import type { ArtifactItem } from '../types/agent';
import type { DirEntry } from '../types/fs';
import * as llmIpc from '../ipc/llm';
import * as mcpIpc from '../ipc/mcp';
import * as skillsIpc from '../ipc/skills';
import * as configIpc from '../ipc/config';
import * as agentIpc from '../ipc/agent';
import * as fsIpc from '../ipc/fs';
import { formatTauriError, isTauri } from '../utils/tauri';

export type { LLMModel, LLMProvider, SkillInfo, MCPTool, MCPServer, ArtifactItem };

export interface ActionStatus {
  type: 'idle' | 'loading' | 'success' | 'error';
  message: string;
}

export interface AppNotification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  createdAt: string;
}

export type PartialAppConfig = {
  [K in keyof AppConfig]?: Partial<AppConfig[K]>;
};

export function resolveTheme(theme: ThemeMode): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export function applyThemeToDocument(theme: ThemeMode): 'dark' | 'light' {
  const resolved = resolveTheme(theme);
  if (typeof document !== 'undefined' && document.documentElement) {
    const root = document.documentElement;
    if (root.classList) {
      root.classList.toggle('dark', resolved === 'dark');
      root.classList.toggle('light', resolved === 'light');
    }
    if (root.dataset) {
      root.dataset.theme = resolved;
    }
    if (root.style) {
      root.style.colorScheme = resolved;
    }
  }
  return resolved;
}

function mergeAppConfig(base: AppConfig, patch: PartialAppConfig | AppConfig): AppConfig {
  return {
    llm: { ...base.llm, ...(patch.llm || {}) },
    mcp: { ...base.mcp, ...(patch.mcp || {}) },
    agent: { ...base.agent, ...(patch.agent || {}) },
    terminal: { ...base.terminal, ...(patch.terminal || {}) },
    ui: { ...base.ui, ...(patch.ui || {}) },
    skills: { ...base.skills, ...(patch.skills || {}) },
    workspace: { ...base.workspace, ...(patch.workspace || {}) },
  };
}

function cloneDefaultConfig(): AppConfig {
  return mergeAppConfig(DEFAULT_APP_CONFIG, {});
}

const INITIAL_STRATA_PROVIDERS: LLMProvider[] = [
  {
    id: 'strata',
    name: 'Strata (Local)',
    provider_type: 'custom',
    base_url: 'http://127.0.0.1:47831/v1',
    api_key: 'strata',
    models: [],
    enabled: true,
    headers: {},
    status: 'unknown',
  },
  {
    id: 'strata-lan',
    name: 'Strata (LAN)',
    provider_type: 'custom',
    base_url: 'http://192.168.0.92:47832/v1',
    api_key: 'strata',
    models: [],
    enabled: true,
    headers: {},
    status: 'unknown',
  },
];

interface AppState {
  sidebarOpen: boolean;
  terminalOpen: boolean;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  settingsTab: 'providers' | 'mcp' | 'skills';
  artifactPaneOpen: boolean;
  activeArtifact: { title: string; content: string; path?: string; language?: string } | null;
  artifacts: ArtifactItem[];
  theme: ThemeMode;
  activeWorkspace: string;
  workspaceFiles: DirEntry[];
  workspaceFilesLoading: boolean;
  config: AppConfig;
  providers: LLMProvider[];
  activeProviderId: string | null;
  models: LLMModel[];
  selectedModel: string;
  skills: SkillInfo[];
  mcpServers: MCPServer[];
  lastError: string | null;
  actionStatus: ActionStatus | null;
  notifications: AppNotification[];
  projectModalOpen: boolean;
  editingProjectId: string | null;

  setSidebarOpen: (open: boolean) => void;
  setTerminalOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean, tab?: 'providers' | 'mcp' | 'skills') => void;
  setProjectModalOpen: (open: boolean, projectId?: string | null) => void;
  setArtifactPaneOpen: (open: boolean) => void;
  setActiveArtifact: (
    artifact: { title: string; content: string; path?: string; language?: string } | null
  ) => void;
  setTheme: (theme: ThemeMode) => void;
  setActiveWorkspace: (path: string) => void;
  setSelectedModel: (model: string) => void;
  toggleSidebar: () => void;
  toggleTerminal: () => void;
  toggleCommandPalette: () => void;
  toggleArtifactPane: () => void;

  clearError: () => void;
  clearActionStatus: () => void;
  addNotification: (type: AppNotification['type'], message: string) => void;
  dismissNotification: (id: string) => void;
  clearNotifications: () => void;

  fetchConfig: () => Promise<AppConfig>;
  saveConfig: (partialOrFull: PartialAppConfig | AppConfig) => Promise<boolean>;
  resetConfig: () => Promise<boolean>;
  fetchWorkspaceFiles: (path?: string, recursive?: boolean) => Promise<DirEntry[]>;

  fetchProviders: () => Promise<void>;
  fetchModels: (providerId?: string) => Promise<void>;
  addProvider: (config: LLMProviderConfig) => Promise<LLMProvider | null>;
  removeProvider: (id: string) => Promise<boolean>;
  setActiveProvider: (id: string) => Promise<boolean>;
  refreshProviderModels: (providerId: string) => Promise<LLMModel[]>;

  fetchSkills: () => Promise<void>;
  loadSkill: (id: string) => Promise<SkillInfo | null>;
  unloadSkill: (id: string) => Promise<boolean>;
  reloadSkills: () => Promise<SkillInfo[]>;
  getSkillSchema: (id: string) => Promise<SkillSchema | null>;

  fetchMCPServers: () => Promise<void>;
  addServer: (config: MCPServerConfig) => Promise<MCPServer | null>;
  addMCPServer: (config: MCPServerConfig) => Promise<MCPServer | null>;
  removeServer: (id: string) => Promise<boolean>;
  removeMCPServer: (id: string) => Promise<boolean>;
  connectServer: (id: string) => Promise<MCPServer | null>;
  connectMCPServer: (id: string) => Promise<MCPServer | null>;
  disconnectServer: (id: string) => Promise<MCPServer | null>;
  disconnectMCPServer: (id: string) => Promise<MCPServer | null>;
  listMcpTools: (serverId?: string) => Promise<MCPTool[]>;

  fetchArtifacts: (conversationId: string) => Promise<void>;

  createProject: (params: {
    name: string;
    description?: string;
    folders: Array<{ path: string; name?: string; createOnDisk?: boolean; sshHost?: string | null }>;
    settings?: Partial<ProjectSettings>;
  }) => Promise<ProjectConfig | null>;
  updateProject: (projectId: string, patch: Partial<ProjectConfig>) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  setActiveProject: (projectId: string | null) => Promise<void>;
  addFolderToProject: (
    projectId: string,
    folder: { path: string; name?: string; createOnDisk?: boolean; sshHost?: string | null }
  ) => Promise<boolean>;
  removeFolderFromProject: (projectId: string, folderPath: string) => Promise<boolean>;
}

applyThemeToDocument(DEFAULT_APP_CONFIG.ui.theme);

let systemThemeListenerAttached = false;
function ensureSystemThemeListener() {
  if (systemThemeListenerAttached) return;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  if (typeof media?.addEventListener === 'function') {
    media.addEventListener('change', () => {
      if (useAppStore.getState().theme === 'system') {
        applyThemeToDocument('system');
      }
    });
    systemThemeListenerAttached = true;
  }
}

export const useAppStore = create<AppState>((set, get) => {
  ensureSystemThemeListener();

  let workspaceFilesGen = 0;
  let artifactsGen = 0;
  let activeArtifactsTargetId: string | null = null;
  let skillSchemaGen = 0;
  let activeSkillSchemaId: string | null = null;
  let modelsGen = 0;

  const notifyAndSetError = (err: unknown, context?: string): string => {
    const msg = formatTauriError(err);
    const fullMsg = context ? `${context}: ${msg}` : msg;
    set({
      lastError: fullMsg,
      actionStatus: { type: 'error', message: fullMsg },
    });
    return fullMsg;
  };

  return {
    sidebarOpen: true,
    terminalOpen: false,
    commandPaletteOpen: false,
    settingsOpen: false,
    settingsTab: 'providers',
    artifactPaneOpen: false,
    activeArtifact: null,
    artifacts: [],
    theme: 'dark',
    activeWorkspace: '.',
    workspaceFiles: [],
    workspaceFilesLoading: false,
    config: cloneDefaultConfig(),
    providers: INITIAL_STRATA_PROVIDERS,
    activeProviderId: 'strata',
    models: [],
    selectedModel: '',
    skills: [],
    mcpServers: [],
    lastError: null,
    actionStatus: null,
    notifications: [],
    projectModalOpen: false,
    editingProjectId: null,

    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setTerminalOpen: (open) => set({ terminalOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setSettingsOpen: (open, tab) =>
      set((s) => ({ settingsOpen: open, settingsTab: tab || s.settingsTab })),
    setProjectModalOpen: (open, projectId = null) =>
      set({ projectModalOpen: open, editingProjectId: open ? projectId ?? null : null }),
    setArtifactPaneOpen: (open) => set({ artifactPaneOpen: open }),
    setActiveArtifact: (artifact) => set({ activeArtifact: artifact, artifactPaneOpen: !!artifact }),
    setTheme: (theme) => {
      ensureSystemThemeListener();
      applyThemeToDocument(theme);
      set((state) => ({
        theme,
        config: {
          ...state.config,
          ui: { ...state.config.ui, theme },
        },
      }));
    },
    setActiveWorkspace: (path) => {
      workspaceFilesGen += 1;
      set({ activeWorkspace: path });
    },
    setSelectedModel: (model) => set({ selectedModel: model }),
    toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    toggleTerminal: () => set((state) => ({ terminalOpen: !state.terminalOpen })),
    toggleCommandPalette: () =>
      set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
    toggleArtifactPane: () => set((state) => ({ artifactPaneOpen: !state.artifactPaneOpen })),

    clearError: () => set({ lastError: null }),
    clearActionStatus: () => set({ actionStatus: null }),
    addNotification: (type, message) =>
      set((state) => ({
        notifications: [
          ...state.notifications,
          {
            id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            type,
            message,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
    dismissNotification: (id) =>
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      })),
    clearNotifications: () => set({ notifications: [] }),

    fetchConfig: async () => {
      if (!isTauri()) return get().config;
      try {
        const cfg = await configIpc.getConfig();
        const theme = cfg.ui?.theme || 'dark';
        applyThemeToDocument(theme);
        set((state) => {
          const activeProj = (cfg.workspace?.projects || []).find(
            (p) => p.id === cfg.workspace?.active_project_id
          );
          const projFirstFolder = activeProj?.folders?.[0]?.path;
          return {
            config: cfg,
            theme,
            activeProviderId: cfg.llm?.active_provider ?? state.activeProviderId,
            selectedModel: state.selectedModel || cfg.llm?.default_model || '',
            activeWorkspace:
              state.activeWorkspace === '.' && (projFirstFolder || cfg.workspace?.default_path)
                ? projFirstFolder || cfg.workspace?.default_path || '.'
                : state.activeWorkspace,
          };
        });
        return cfg;
      } catch (err) {
        notifyAndSetError(err, 'Failed to load config');
        return get().config;
      }
    },

    saveConfig: async (partialOrFull) => {
      const next = mergeAppConfig(get().config, partialOrFull);
      set({ actionStatus: { type: 'loading', message: 'Saving settings...' }, lastError: null });
      try {
        if (isTauri()) {
          await configIpc.setConfig(next);
        }
        applyThemeToDocument(next.ui.theme);
        set({
          config: next,
          theme: next.ui.theme,
          actionStatus: { type: 'success', message: 'Settings saved' },
        });
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to save config');
        return false;
      }
    },

    resetConfig: async () => {
      set({ actionStatus: { type: 'loading', message: 'Resetting settings...' }, lastError: null });
      try {
        if (isTauri()) {
          await configIpc.resetConfig();
          await Promise.all([
            get().fetchConfig(),
            get().fetchProviders(),
            get().fetchMCPServers(),
            get().fetchSkills(),
          ]);
        } else {
          const def = cloneDefaultConfig();
          applyThemeToDocument(def.ui.theme);
          set({
            config: def,
            theme: def.ui.theme,
            providers: INITIAL_STRATA_PROVIDERS,
            activeProviderId: 'strata',
          });
        }
        set({ actionStatus: { type: 'success', message: 'Settings reset to defaults' } });
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to reset config');
        return false;
      }
    },

    fetchWorkspaceFiles: async (path, recursive = false) => {
      const targetPath = path || get().activeWorkspace || '.';
      const gen = ++workspaceFilesGen;
      if (!isTauri()) {
        set({ workspaceFiles: [], workspaceFilesLoading: false });
        return [];
      }
      set({ workspaceFilesLoading: true, lastError: null });
      try {
        const res = await fsIpc.listDir({
          path: targetPath,
          recursive,
          ignore_patterns: get().config.workspace.ignored_patterns,
        });
        if (gen !== workspaceFilesGen || (!path && get().activeWorkspace !== targetPath)) {
          if (gen === workspaceFilesGen) {
            set({ workspaceFilesLoading: false });
          }
          return get().workspaceFiles;
        }
        set({ workspaceFiles: res.entries, workspaceFilesLoading: false });
        return res.entries;
      } catch (err) {
        if (gen !== workspaceFilesGen) {
          return get().workspaceFiles;
        }
        set({ workspaceFilesLoading: false });
        notifyAndSetError(err, 'Failed to list workspace files');
        return [];
      }
    },

    fetchProviders: async () => {
      if (!isTauri()) return;
      try {
        const [providers, cfg] = await Promise.all([
          llmIpc.listProviders(),
          configIpc.getConfig().catch(() => null),
        ]);
        if (cfg) {
          const theme = cfg.ui?.theme || 'dark';
          applyThemeToDocument(theme);
          set({ config: cfg, theme });
        }
        if (providers.length === 0) {
          modelsGen += 1;
          set({
            providers: [],
            activeProviderId: null,
            models: [],
            selectedModel: '',
          });
          return;
        }
        const cfgActive = cfg?.llm?.active_provider;
        const activeId =
          providers.find((p) => p.id === cfgActive)?.id ||
          providers.find((p) => p.id === 'strata')?.id ||
          providers[0].id;
        set({ providers, activeProviderId: activeId });
        await get().fetchModels(activeId);
      } catch (err) {
        notifyAndSetError(err, 'Failed to load providers');
      }
    },

    fetchModels: async (providerId) => {
      if (!isTauri()) return;
      const targetProviderId = providerId ?? get().activeProviderId;
      const gen = ++modelsGen;
      if (!targetProviderId) {
        set({ models: [], selectedModel: '' });
        return;
      }
      try {
        const models = await llmIpc.listModels(targetProviderId);
        if (
          gen !== modelsGen ||
          (providerId === undefined && get().activeProviderId !== targetProviderId)
        ) {
          return;
        }
        set((s) => {
          if (models.length === 0) {
            return { models: [], selectedModel: '' };
          }
          const stillValid = models.some((m) => m.id === s.selectedModel);
          return {
            models,
            selectedModel: stillValid ? s.selectedModel : models[0].id,
          };
        });
      } catch (err) {
        if (gen !== modelsGen) return;
        notifyAndSetError(err, 'Failed to load models');
      }
    },

    addProvider: async (config) => {
      set({ actionStatus: { type: 'loading', message: 'Adding provider...' }, lastError: null });
      if (!isTauri()) {
        const demoProvider: LLMProvider = {
          id: config.id,
          name: config.name,
          provider_type: config.provider_type,
          base_url: config.base_url,
          api_key: config.api_key ?? undefined,
          models: [],
          enabled: config.enabled,
          headers: config.headers ?? {},
          status: 'unknown',
        };
        set((state) => ({
          providers: [...state.providers, demoProvider],
          actionStatus: { type: 'success', message: `Added provider ${config.name}` },
        }));
        return demoProvider;
      }
      try {
        const created = await llmIpc.addProvider(config);
        await get().fetchProviders();
        set({ actionStatus: { type: 'success', message: `Added provider ${created.name}` } });
        return created;
      } catch (err) {
        notifyAndSetError(err, 'Failed to add provider');
        return null;
      }
    },

    removeProvider: async (id) => {
      set({ lastError: null });
      if (!isTauri()) {
        set((state) => ({
          providers: state.providers.filter((p) => p.id !== id),
          activeProviderId:
            state.activeProviderId === id
              ? state.providers.find((p) => p.id !== id)?.id ?? null
              : state.activeProviderId,
        }));
        return true;
      }
      try {
        await llmIpc.removeProvider(id);
        await get().fetchProviders();
        set({ actionStatus: { type: 'success', message: 'Provider removed' } });
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to remove provider');
        return false;
      }
    },

    setActiveProvider: async (id) => {
      set({ lastError: null });
      if (!isTauri()) {
        set((s) => {
          const provider = s.providers.find((p) => p.id === id);
          const nextModels = provider?.models ?? [];
          const stillValid = nextModels.some((m) => m.id === s.selectedModel);
          return {
            activeProviderId: id,
            models: nextModels,
            selectedModel:
              nextModels.length === 0 ? '' : stillValid ? s.selectedModel : nextModels[0].id,
          };
        });
        return true;
      }
      try {
        await llmIpc.setActiveProvider(id);
        await get().fetchProviders();
        set((s) => ({
          activeProviderId: s.providers.some((p) => p.id === id) ? id : s.activeProviderId,
        }));
        await get().fetchModels(id);
        set({ actionStatus: { type: 'success', message: 'Active provider updated' } });
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to set active provider');
        return false;
      }
    },

    refreshProviderModels: async (providerId) => {
      set({ lastError: null });
      if (!isTauri()) return [];
      try {
        const models = await llmIpc.refreshProviderModels(providerId);
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId ? { ...p, models } : p
          ),
          models: state.activeProviderId === providerId ? models : state.models,
          actionStatus: {
            type: 'success',
            message: `Discovered ${models.length} model(s)`,
          },
        }));
        return models;
      } catch (err) {
        notifyAndSetError(err, 'Failed to refresh provider models');
        return [];
      }
    },

    fetchSkills: async () => {
      if (!isTauri()) return;
      try {
        const skills = await skillsIpc.listSkills();
        set({ skills });
      } catch (err) {
        notifyAndSetError(err, 'Failed to load skills');
      }
    },

    loadSkill: async (id) => {
      set({ lastError: null });
      if (!isTauri()) return null;
      try {
        const skill = await skillsIpc.loadSkill(id);
        set((state) => ({
          skills: state.skills.some((s) => s.id === skill.id)
            ? state.skills.map((s) => (s.id === skill.id ? skill : s))
            : [...state.skills, skill],
          actionStatus: { type: 'success', message: `Loaded skill ${skill.name}` },
        }));
        return skill;
      } catch (err) {
        notifyAndSetError(err, 'Failed to load skill');
        return null;
      }
    },

    unloadSkill: async (id) => {
      set({ lastError: null });
      if (!isTauri()) return false;
      try {
        await skillsIpc.unloadSkill(id);
        set((state) => ({
          skills: state.skills.map((s) => (s.id === id ? { ...s, loaded: false } : s)),
          actionStatus: { type: 'success', message: 'Skill unloaded' },
        }));
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to unload skill');
        return false;
      }
    },

    reloadSkills: async () => {
      set({ lastError: null });
      if (!isTauri()) return [];
      try {
        const skills = await skillsIpc.reloadSkills();
        set({
          skills,
          actionStatus: { type: 'success', message: `Reloaded ${skills.length} skill(s)` },
        });
        return skills;
      } catch (err) {
        notifyAndSetError(err, 'Failed to reload skills');
        return [];
      }
    },

    getSkillSchema: async (id) => {
      if (!isTauri()) return null;
      const gen = ++skillSchemaGen;
      activeSkillSchemaId = id;
      try {
        const schema = await skillsIpc.getSkillSchema(id);
        if (gen !== skillSchemaGen || activeSkillSchemaId !== id) {
          return null;
        }
        return schema;
      } catch (err) {
        if (gen !== skillSchemaGen) return null;
        notifyAndSetError(err, 'Failed to inspect skill schema');
        return null;
      }
    },

    fetchMCPServers: async () => {
      if (!isTauri()) return;
      try {
        const mcpServers = await mcpIpc.listServers();
        set({ mcpServers });
      } catch (err) {
        notifyAndSetError(err, 'Failed to load MCP servers');
      }
    },

    addServer: async (config) => {
      set({ lastError: null });
      if (!isTauri()) {
        const server: MCPServer = {
          id: config.id,
          name: config.name,
          transport: config.transport,
          enabled: config.enabled,
          auto_start: config.auto_start,
          status: 'disconnected',
          tools: [],
        };
        set((state) => ({
          mcpServers: [...state.mcpServers, server],
          actionStatus: { type: 'success', message: `Added MCP server ${config.name}` },
        }));
        return server;
      }
      try {
        const server = await mcpIpc.addServer(config);
        await get().fetchMCPServers();
        set({ actionStatus: { type: 'success', message: `Added MCP server ${server.name}` } });
        return server;
      } catch (err) {
        notifyAndSetError(err, 'Failed to add MCP server');
        return null;
      }
    },

    addMCPServer: async (config) => get().addServer(config),

    removeServer: async (id) => {
      set({ lastError: null });
      if (!isTauri()) {
        set((state) => ({
          mcpServers: state.mcpServers.filter((s) => s.id !== id),
        }));
        return true;
      }
      try {
        await mcpIpc.removeServer(id);
        await get().fetchMCPServers();
        set({ actionStatus: { type: 'success', message: 'MCP server removed' } });
        return true;
      } catch (err) {
        notifyAndSetError(err, 'Failed to remove MCP server');
        return false;
      }
    },

    removeMCPServer: async (id) => get().removeServer(id),

    connectServer: async (id) => {
      set({ lastError: null });
      if (!isTauri()) return null;
      try {
        const server = await mcpIpc.connectServer(id);
        set((state) => ({
          mcpServers: state.mcpServers.map((s) => (s.id === id ? server : s)),
          actionStatus: { type: 'success', message: `Connected ${server.name}` },
        }));
        return server;
      } catch (err) {
        notifyAndSetError(err, 'Failed to connect MCP server');
        await get().fetchMCPServers().catch(() => {});
        return null;
      }
    },

    connectMCPServer: async (id) => get().connectServer(id),

    disconnectServer: async (id) => {
      set({ lastError: null });
      if (!isTauri()) return null;
      try {
        const server = await mcpIpc.disconnectServer(id);
        set((state) => ({
          mcpServers: state.mcpServers.map((s) => (s.id === id ? server : s)),
          actionStatus: { type: 'success', message: `Disconnected ${server.name}` },
        }));
        return server;
      } catch (err) {
        notifyAndSetError(err, 'Failed to disconnect MCP server');
        return null;
      }
    },

    disconnectMCPServer: async (id) => get().disconnectServer(id),

    listMcpTools: async (serverId) => {
      if (!isTauri()) return [];
      try {
        return await mcpIpc.listTools(serverId ?? null);
      } catch (err) {
        notifyAndSetError(err, 'Failed to list MCP tools');
        return [];
      }
    },

    fetchArtifacts: async (conversationId) => {
      if (!isTauri() || !conversationId) return;
      const gen = ++artifactsGen;
      activeArtifactsTargetId = conversationId;
      try {
        const artifacts = await agentIpc.listArtifacts(conversationId);
        if (gen !== artifactsGen || activeArtifactsTargetId !== conversationId) {
          return;
        }
        set({ artifacts });
      } catch (err) {
        if (gen !== artifactsGen) return;
        notifyAndSetError(err, 'Failed to load artifacts');
      }
    },

    createProject: async (params) => {
      const now = new Date().toISOString();
      const builtFolders: ProjectFolder[] = [];

      for (const f of params.folders) {
        const cleanPath = f.path.trim();
        if (!cleanPath) continue;
        if (f.createOnDisk && isTauri() && !f.sshHost) {
          try {
            await fsIpc.createDir({ path: cleanPath, recursive: true });
          } catch (err) {
            notifyAndSetError(err, `Failed to create folder ${cleanPath}`);
            return null;
          }
        }
        const baseName =
          f.name?.trim() ||
          cleanPath.replace(/\/+$/, '').split('/').filter(Boolean).pop() ||
          cleanPath;
        let isGit = false;
        let gitBranch: string | null = null;
        if (isTauri() && !f.sshHost) {
          try {
            const headRes = await fsIpc.readFile({
              path: `${cleanPath.replace(/\/+$/, '')}/.git/HEAD`,
            });
            if (headRes && typeof headRes.content === 'string') {
              isGit = true;
              const trimmed = headRes.content.trim();
              gitBranch = trimmed.startsWith('ref: refs/heads/')
                ? trimmed.slice('ref: refs/heads/'.length)
                : trimmed.slice(0, 7);
            }
          } catch {
            isGit = false;
          }
        }
        builtFolders.push({
          path: cleanPath,
          name: baseName,
          is_git: isGit,
          git_branch: gitBranch,
          ssh_host: f.sshHost || null,
        });
      }

      const newProj: ProjectConfig = {
        id: `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: params.name.trim() || 'Untitled Project',
        description: params.description?.trim() || null,
        folders: builtFolders,
        settings: {
          permission_preset: params.settings?.permission_preset || 'inherit_global',
          default_worktree_mode: params.settings?.default_worktree_mode || 'local',
          system_prompt: params.settings?.system_prompt ?? null,
          require_command_approval: params.settings?.require_command_approval ?? null,
          allowed_paths: params.settings?.allowed_paths || [],
        },
        created_at: now,
        updated_at: now,
      };

      const prevWs = get().config.workspace;
      const existingProjects = prevWs.projects || [];
      const firstPath = builtFolders[0]?.path;
      const recentPaths = firstPath
        ? [firstPath, ...(prevWs.recent_paths || []).filter((p) => p !== firstPath)].slice(
            0,
            prevWs.max_recent || 20
          )
        : prevWs.recent_paths || [];

      const ok = await get().saveConfig({
        workspace: {
          ...prevWs,
          projects: [newProj, ...existingProjects],
          active_project_id: newProj.id,
          default_path: firstPath || prevWs.default_path || null,
          recent_paths: recentPaths,
        },
      });
      if (!ok) return null;

      if (firstPath) {
        get().setActiveWorkspace(firstPath);
        void get().fetchWorkspaceFiles(firstPath);
      }
      // Refresh config from backend so Rust-inspected git branches sync back
      if (isTauri()) {
        await get().fetchConfig();
      }
      set({
        actionStatus: { type: 'success', message: `Created project "${newProj.name}"` },
      });
      return (
        (get().config.workspace.projects || []).find((p) => p.id === newProj.id) || newProj
      );
    },

    updateProject: async (projectId, patch) => {
      const prevWs = get().config.workspace;
      const projects = (prevWs.projects || []).map((p) =>
        p.id === projectId
          ? {
              ...p,
              ...patch,
              settings: patch.settings ? { ...p.settings, ...patch.settings } : p.settings,
              updated_at: new Date().toISOString(),
            }
          : p
      );
      const ok = await get().saveConfig({
        workspace: {
          ...prevWs,
          projects,
        },
      });
      if (ok && isTauri()) {
        await get().fetchConfig();
      }
      return ok;
    },

    deleteProject: async (projectId) => {
      const prevWs = get().config.workspace;
      const remaining = (prevWs.projects || []).filter((p) => p.id !== projectId);
      const nextActiveId =
        prevWs.active_project_id === projectId
          ? remaining[0]?.id || null
          : prevWs.active_project_id || null;
      const ok = await get().saveConfig({
        workspace: {
          ...prevWs,
          projects: remaining,
          active_project_id: nextActiveId,
        },
      });
      if (ok && nextActiveId) {
        const nextProj = remaining.find((p) => p.id === nextActiveId);
        if (nextProj?.folders?.[0]?.path) {
          get().setActiveWorkspace(nextProj.folders[0].path);
          void get().fetchWorkspaceFiles(nextProj.folders[0].path);
        }
      }
      return ok;
    },

    setActiveProject: async (projectId) => {
      const prevWs = get().config.workspace;
      const proj = (prevWs.projects || []).find((p) => p.id === projectId) || null;
      const firstFolder = proj?.folders?.[0]?.path;
      await get().saveConfig({
        workspace: {
          ...prevWs,
          active_project_id: projectId,
          default_path: firstFolder || prevWs.default_path || null,
        },
      });
      if (firstFolder) {
        get().setActiveWorkspace(firstFolder);
        void get().fetchWorkspaceFiles(firstFolder);
      }
    },

    addFolderToProject: async (projectId, folder) => {
      const cleanPath = folder.path.trim();
      if (!cleanPath) return false;
      const proj = (get().config.workspace.projects || []).find((p) => p.id === projectId);
      if (!proj) return false;

      if (folder.createOnDisk && isTauri() && !folder.sshHost) {
        try {
          await fsIpc.createDir({ path: cleanPath, recursive: true });
        } catch (err) {
          notifyAndSetError(err, `Failed to create folder ${cleanPath}`);
          return false;
        }
      }

      const baseName =
        folder.name?.trim() ||
        cleanPath.replace(/\/+$/, '').split('/').filter(Boolean).pop() ||
        cleanPath;
      let isGit = false;
      let gitBranch: string | null = null;
      if (isTauri() && !folder.sshHost) {
        try {
          const headRes = await fsIpc.readFile({
            path: `${cleanPath.replace(/\/+$/, '')}/.git/HEAD`,
          });
          if (headRes && typeof headRes.content === 'string') {
            isGit = true;
            const trimmed = headRes.content.trim();
            gitBranch = trimmed.startsWith('ref: refs/heads/')
              ? trimmed.slice('ref: refs/heads/'.length)
              : trimmed.slice(0, 7);
          }
        } catch {
          isGit = false;
        }
      }

      const exists = proj.folders.some(
        (f) => f.path === cleanPath && (f.ssh_host || null) === (folder.sshHost || null)
      );
      if (exists) return true;

      const nextFolders: ProjectFolder[] = [
        ...proj.folders,
        {
          path: cleanPath,
          name: baseName,
          is_git: isGit,
          git_branch: gitBranch,
          ssh_host: folder.sshHost || null,
        },
      ];
      return get().updateProject(projectId, { folders: nextFolders });
    },

    removeFolderFromProject: async (projectId, folderPath) => {
      const proj = (get().config.workspace.projects || []).find((p) => p.id === projectId);
      if (!proj) return false;
      const nextFolders = proj.folders.filter((f) => f.path !== folderPath);
      return get().updateProject(projectId, { folders: nextFolders });
    },
  };
});
