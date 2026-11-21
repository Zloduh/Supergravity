import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTauriEnv } from './mock_tauri.ts';

const env = createMockTauriEnv();
const { useAppStore } = await import('../../src/stores/appStore.ts');
const { DEFAULT_APP_CONFIG } = await import('../../src/types/config.ts');

describe('appStore', () => {
  beforeEach(() => {
    env.reset();
    useAppStore.setState({
      theme: 'dark',
      config: structuredClone(DEFAULT_APP_CONFIG),
      providers: [
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
      ],
      activeProviderId: 'strata',
      models: [],
      selectedModel: '',
      skills: [],
      mcpServers: [],
      workspaceFiles: [],
      lastError: null,
      actionStatus: null,
      notifications: [],
    });
  });

  it('preserves R3 Strata Local and Strata LAN defaults', () => {
    const { providers, activeProviderId, config } = useAppStore.getState();
    assert.equal(activeProviderId, 'strata');
    const local = providers.find((p) => p.id === 'strata');
    const lan = providers.find((p) => p.id === 'strata-lan');
    assert.equal(local?.base_url, 'http://127.0.0.1:47831/v1');
    assert.equal(local?.api_key, 'strata');
    assert.equal(lan?.base_url, 'http://192.168.0.92:47832/v1');
    assert.equal(lan?.api_key, 'strata');
    assert.equal(config.llm.default_model, 'coder-iq1_m');
  });

  it('applies dark, light, and system themes to documentElement and persists config', async () => {
    env.setHandler('set_config', () => null);
    env.setHandler('get_config', () => structuredClone(DEFAULT_APP_CONFIG));
    env.setHandler('list_providers', () => []);
    env.setHandler('list_servers', () => []);
    env.setHandler('list_skills', () => []);

    useAppStore.getState().setTheme('light');
    assert.equal(env.documentRoot.classList.contains('light'), true);
    assert.equal(env.documentRoot.classList.contains('dark'), false);
    assert.equal(env.documentRoot.dataset.theme, 'light');
    assert.equal(env.documentRoot.style.colorScheme, 'light');

    useAppStore.getState().setTheme('system');
    env.setPrefersDark(true);
    assert.equal(env.documentRoot.dataset.theme, 'dark');
    env.setPrefersDark(false);
    assert.equal(env.documentRoot.dataset.theme, 'light');

    const saved = await useAppStore.getState().saveConfig({
      ui: { theme: 'dark' },
    });
    assert.equal(saved, true);
    assert.equal(useAppStore.getState().theme, 'dark');
    assert.equal(env.documentRoot.dataset.theme, 'dark');

    env.setHandler('reset_config', () => null);
    const resetOk = await useAppStore.getState().resetConfig();
    assert.equal(resetOk, true);
    assert.ok(env.invocations.some((i) => i.cmd === 'reset_config'));
  });

  it('executes Provider, MCP, and Skills CRUD and surfaces IPC errors to lastError', async () => {
    const addedProvider = {
      id: 'ollama-1',
      name: 'Ollama',
      provider_type: 'ollama',
      base_url: 'http://127.0.0.1:11434/v1',
      models: [],
      enabled: true,
      headers: {},
      status: 'connected',
    };
    env.setHandler('add_provider', () => addedProvider);
    env.setHandler('list_providers', () => [addedProvider]);
    env.setHandler('get_config', () => structuredClone(DEFAULT_APP_CONFIG));
    env.setHandler('list_models', () => [
      {
        id: 'qwen2.5-coder',
        name: 'Qwen 2.5 Coder',
        supports_streaming: true,
        supports_tools: true,
        supports_vision: false,
      },
    ]);
    env.setHandler('set_active_provider', () => null);
    env.setHandler('refresh_provider_models', () => [
      {
        id: 'qwen2.5-coder',
        name: 'Qwen 2.5 Coder',
        supports_streaming: true,
        supports_tools: true,
        supports_vision: false,
      },
    ]);
    env.setHandler('remove_provider', () => null);

    const p = await useAppStore.getState().addProvider({
      id: 'ollama-1',
      name: 'Ollama',
      provider_type: 'ollama',
      base_url: 'http://127.0.0.1:11434/v1',
      api_key: null,
      models: [],
      enabled: true,
      headers: null,
    });
    assert.equal(p?.id, 'ollama-1');

    await useAppStore.getState().setActiveProvider('ollama-1');
    const models = await useAppStore.getState().refreshProviderModels('ollama-1');
    assert.equal(models.length, 1);
    assert.equal(await useAppStore.getState().removeProvider('ollama-1'), true);

    const server = {
      id: 'mcp-1',
      name: 'Filesystem',
      transport: { type: 'stdio', command: 'npx', args: [] },
      enabled: true,
      auto_start: false,
      status: 'disconnected',
      tools: [],
    };
    env.setHandler('add_server', () => server);
    env.setHandler('list_servers', () => [server]);
    env.setHandler('connect_server', () => ({ ...server, status: 'connected' }));
    env.setHandler('disconnect_server', () => ({ ...server, status: 'disconnected' }));
    env.setHandler('remove_server', () => null);

    await useAppStore.getState().addMCPServer({
      id: 'mcp-1',
      name: 'Filesystem',
      transport: { type: 'stdio', command: 'npx', args: [] },
      enabled: true,
      auto_start: false,
    });
    const connected = await useAppStore.getState().connectMCPServer('mcp-1');
    assert.equal(connected?.status, 'connected');
    const disconnected = await useAppStore.getState().disconnectMCPServer('mcp-1');
    assert.equal(disconnected?.status, 'disconnected');
    assert.equal(await useAppStore.getState().removeMCPServer('mcp-1'), true);

    const skill = {
      id: 'skill-1',
      name: 'chrome-devtools',
      description: 'Browser debugging',
      version: '1.0.0',
      path: '/skills/chrome-devtools/SKILL.md',
      skill_type: 'user',
      loaded: true,
      source: 'agentsskills',
    };
    env.setHandler('load_skill', () => skill);
    env.setHandler('unload_skill', () => null);
    env.setHandler('reload_skills', () => [skill]);

    const loadedSkill = await useAppStore.getState().loadSkill('skill-1');
    assert.equal(loadedSkill?.loaded, true);
    assert.equal(await useAppStore.getState().unloadSkill('skill-1'), true);
    assert.equal((await useAppStore.getState().reloadSkills()).length, 1);

    env.setReject('connect_server', 'connection refused');
    const failedConnect = await useAppStore.getState().connectMCPServer('mcp-1');
    assert.equal(failedConnect, null);
    assert.match(useAppStore.getState().lastError || '', /connection refused/);
    useAppStore.getState().clearError();
    assert.equal(useAppStore.getState().lastError, null);
  });

  it('creates multi-folder Projects (create on drive, existing Git checkout, SSH host), updates settings, and deletes', async () => {
    let savedConfig = structuredClone(DEFAULT_APP_CONFIG);
    env.setHandler('create_dir', () => null);
    env.setHandler('read_file', (args) => {
      if (String(args?.request?.path || '').includes('/existing-repo/.git/HEAD')) {
        return { content: 'ref: refs/heads/main\n', is_binary: false };
      }
      throw new Error('not a git repo');
    });
    env.setHandler('list_dir', () => ({ entries: [] }));
    env.setHandler('set_config', (args) => {
      savedConfig = structuredClone(args.config);
      return null;
    });
    env.setHandler('get_config', () => savedConfig);

    const created = await useAppStore.getState().createProject({
      name: 'Multi-Folder Project',
      description: 'Frontend + Backend + Remote SSH',
      folders: [
        { path: '/workspace/new-drive-folder', createOnDisk: true },
        { path: '/workspace/existing-repo', createOnDisk: false },
        { path: '/srv/remote-repo', createOnDisk: false, sshHost: 'dev@10.0.0.5' },
      ],
      settings: {
        permission_preset: 'default',
        default_worktree_mode: 'new_worktree',
        system_prompt: 'Project specific instructions',
        allowed_paths: ['/tmp/shared'],
      },
    });

    assert.ok(created);
    assert.equal(created?.name, 'Multi-Folder Project');
    assert.equal(created?.folders.length, 3);
    assert.equal(created?.folders[0].is_git, false);
    assert.equal(created?.folders[1].is_git, true);
    assert.equal(created?.folders[1].git_branch, 'main');
    assert.equal(created?.folders[2].ssh_host, 'dev@10.0.0.5');
    assert.equal(created?.settings.permission_preset, 'default');
    assert.equal(created?.settings.default_worktree_mode, 'new_worktree');
    assert.ok(env.invocations.some((i) => i.cmd === 'create_dir'));

    await useAppStore.getState().addFolderToProject(created!.id, {
      path: '/workspace/extra-folder',
      createOnDisk: true,
    });
    const afterAdd = (useAppStore.getState().config.workspace.projects || []).find(
      (p) => p.id === created!.id
    );
    assert.equal(afterAdd?.folders.length, 4);

    await useAppStore
      .getState()
      .removeFolderFromProject(created!.id, '/workspace/extra-folder');
    const afterRemove = (useAppStore.getState().config.workspace.projects || []).find(
      (p) => p.id === created!.id
    );
    assert.equal(afterRemove?.folders.length, 3);

    await useAppStore.getState().deleteProject(created!.id);
    assert.equal((useAppStore.getState().config.workspace.projects || []).length, 0);
  });
});
