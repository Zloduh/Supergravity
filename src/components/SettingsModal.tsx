import { useState, useEffect } from 'react';
import {
  X,
  Server,
  Cpu,
  BookOpen,
  Sliders,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Eye,
  RotateCcw,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { ThemeMode } from '../types/config';

type ModalTab = 'providers' | 'mcp' | 'skills' | 'preferences';

export function SettingsModal() {
  const {
    settingsOpen,
    setSettingsOpen,
    settingsTab,
    config,
    providers,
    activeProviderId,
    skills,
    mcpServers,
    actionStatus,
    lastError,
    clearError,
    clearActionStatus,
    fetchConfig,
    saveConfig,
    resetConfig,
    fetchProviders,
    addProvider,
    removeProvider,
    setActiveProvider,
    refreshProviderModels,
    loadSkill,
    unloadSkill,
    reloadSkills,
    getSkillSchema,
    fetchMCPServers,
    addServer,
    removeServer,
    connectServer,
    disconnectServer,
    setTheme,
    setActiveArtifact,
    setArtifactPaneOpen,
  } = useAppStore();

  const [tab, setTab] = useState<ModalTab>(settingsTab);

  // Add Provider form state
  const [name, setName] = useState('Strata (Local)');
  const [providerType, setProviderType] = useState<
    'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | 'custom'
  >('custom');
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:47831/v1');
  const [apiKey, setApiKey] = useState('strata');
  const [savingProvider, setSavingProvider] = useState(false);

  // LLM Parameters state
  const [contextLength, setContextLength] = useState(32768);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [timeoutSeconds, setTimeoutSeconds] = useState(120);
  const [searxngUrl, setSearxngUrl] = useState('');
  const [inheritModelSettings, setInheritModelSettings] = useState(true);

  // Add MCP Server form state
  const [mcpName, setMcpName] = useState('');
  const [mcpTransportType, setMcpTransportType] = useState<'stdio' | 'sse'>('stdio');
  const [mcpCommand, setMcpCommand] = useState('npx');
  const [mcpArgs, setMcpArgs] = useState('');
  const [mcpUrl, setMcpUrl] = useState('http://127.0.0.1:3001/sse');
  const [mcpAutoStart, setMcpAutoStart] = useState(false);
  const [expandedMcpId, setExpandedMcpId] = useState<string | null>(null);

  // Skills state
  const [skillFilter, setSkillFilter] = useState('');
  const [inspectedSkillContent, setInspectedSkillContent] = useState<{
    name: string;
    path: string;
    content: string;
  } | null>(null);

  // Agent & UI Preferences state
  const [maxIterations, setMaxIterations] = useState(50);
  const [maxSubagents, setMaxSubagents] = useState(10);
  const [toolTimeout, setToolTimeout] = useState(60);
  const [enableStreaming, setEnableStreaming] = useState(true);
  const [requireApproval, setRequireApproval] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [uiTheme, setUiTheme] = useState<ThemeMode>('dark');
  const [uiFontSize, setUiFontSize] = useState(14);
  const [compactMode, setCompactMode] = useState(false);
  const [terminalShell, setTerminalShell] = useState('');
  const [terminalScrollback, setTerminalScrollback] = useState(5000);
  const [ignoredPatterns, setIgnoredPatterns] = useState('');
  const [interfaceLayout, setInterfaceLayout] = useState('standard');
  const [sandboxEnabled, setSandboxEnabled] = useState(true);
  const [nonWorkspaceFileAccess, setNonWorkspaceFileAccess] = useState('allow');
  const [internetAccessPolicy, setInternetAccessPolicy] = useState('allow');
  const [commandAllowlist, setCommandAllowlist] = useState('');
  const [commandDenylist, setCommandDenylist] = useState('');

  useEffect(() => {
    setTab(settingsTab);
  }, [settingsTab]);

  useEffect(() => {
    if (!settingsOpen) return;
    fetchConfig().then((cfg) => {
      setContextLength(cfg.llm.context_length ?? 32768);
      setMaxTokens(cfg.llm.max_tokens ?? 4096);
      setTemperature(cfg.llm.temperature ?? 0.7);
      setTimeoutSeconds(cfg.llm.timeout_seconds ?? 120);
      setSearxngUrl(cfg.llm.searxng_url ?? '');
      setInheritModelSettings(cfg.llm.inherit_model_settings ?? true);

      setMaxIterations(cfg.agent.max_iterations ?? 50);
      setMaxSubagents(cfg.agent.max_subagents ?? 10);
      setToolTimeout(cfg.agent.tool_timeout_seconds ?? 60);
      setEnableStreaming(cfg.agent.enable_streaming ?? true);
      setRequireApproval(cfg.agent.require_command_approval ?? false);
      setSystemPrompt(cfg.agent.system_prompt ?? '');
      setSandboxEnabled(cfg.agent.sandbox_enabled ?? true);
      setNonWorkspaceFileAccess(cfg.agent.non_workspace_file_access || 'allow');
      setInternetAccessPolicy(cfg.agent.internet_access_policy || 'allow');
      setCommandAllowlist((cfg.agent.command_allowlist || []).join(', '));
      setCommandDenylist((cfg.agent.command_denylist || []).join(', '));

      setUiTheme(cfg.ui.theme ?? 'dark');
      setUiFontSize(cfg.ui.font_size ?? 14);
      setCompactMode(cfg.ui.compact_mode ?? false);
      setTerminalShell(cfg.terminal.shell ?? '');
      setTerminalScrollback(cfg.terminal.scrollback ?? 5000);
      setIgnoredPatterns((cfg.workspace.ignored_patterns || []).join(', '));
      setInterfaceLayout(cfg.workspace.interface_layout || 'standard');
    });
  }, [settingsOpen, fetchConfig]);

  if (!settingsOpen) return null;

  const presetUrl = (t: typeof providerType) => {
    setProviderType(t);
    if (t === 'ollama') {
      setName('Ollama (Local)');
      setBaseUrl('http://127.0.0.1:11434/v1');
      setApiKey('');
    } else if (t === 'lmstudio') {
      setName('LM Studio');
      setBaseUrl('http://127.0.0.1:1234/v1');
      setApiKey('');
    } else if (t === 'llamacpp') {
      setName('llama.cpp');
      setBaseUrl('http://127.0.0.1:8080/v1');
      setApiKey('');
    } else if (t === 'vllm') {
      setName('vLLM');
      setBaseUrl('http://127.0.0.1:8000/v1');
      setApiKey('');
    } else {
      setName('Strata (Local)');
      setBaseUrl('http://127.0.0.1:47831/v1');
      setApiKey('strata');
    }
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProvider(true);
    try {
      const normalizedUrl = baseUrl.trim().replace(/\/+$/, '').toLowerCase();
      const existing = providers.find(
        (p) => p.base_url.trim().replace(/\/+$/, '').toLowerCase() === normalizedUrl
      );
      const id = existing ? existing.id : `${providerType}-${Date.now()}`;
      const created = await addProvider({
        id,
        name: name.trim() || existing?.name || 'Local Provider',
        provider_type: providerType,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim() ? apiKey.trim() : null,
        models: existing?.models || [],
        enabled: true,
        headers: null,
      });
      if (created) {
        await setActiveProvider(created.id);
        await refreshProviderModels(created.id);
      }
    } finally {
      setSavingProvider(false);
    }
  };

  const handleSaveLLMParams = async () => {
    await saveConfig({
      llm: {
        ...config.llm,
        context_length: contextLength,
        max_tokens: maxTokens,
        temperature,
        timeout_seconds: timeoutSeconds,
        searxng_url: searxngUrl.trim() ? searxngUrl.trim() : null,
        inherit_model_settings: inheritModelSettings,
      },
    });
  };

  const handleAddMCPServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mcpName.trim()) return;
    const id = `mcp-${Date.now()}`;
    const transport =
      mcpTransportType === 'stdio'
        ? {
            type: 'stdio' as const,
            command: mcpCommand.trim(),
            args: mcpArgs
              .split(/\s+/)
              .map((s) => s.trim())
              .filter(Boolean),
            env: null,
            cwd: null,
          }
        : {
            type: 'sse' as const,
            url: mcpUrl.trim(),
            headers: null,
          };

    await addServer({
      id,
      name: mcpName.trim(),
      transport,
      enabled: true,
      auto_start: mcpAutoStart,
    });
    setMcpName('');
  };

  const handleToggleMCP = async (id: string, connected: boolean) => {
    if (connected) {
      await disconnectServer(id);
    } else {
      await connectServer(id);
    }
  };

  const handleInspectSkill = async (
    skillId: string,
    skillName: string,
    skillPath: string,
    loaded: boolean
  ) => {
    if (!loaded) {
      await loadSkill(skillId);
    }
    const schema = await getSkillSchema(skillId);
    const md =
      (schema?.parameters as { markdown?: string } | undefined)?.markdown ||
      JSON.stringify(schema || { name: skillName }, null, 2);
    setInspectedSkillContent({ name: skillName, path: skillPath, content: md });
  };

  const handleSavePreferences = async () => {
    setTheme(uiTheme);
    await saveConfig({
      agent: {
        ...config.agent,
        max_iterations: maxIterations,
        max_subagents: maxSubagents,
        tool_timeout_seconds: toolTimeout,
        enable_streaming: enableStreaming,
        require_command_approval: requireApproval,
        system_prompt: systemPrompt.trim() ? systemPrompt.trim() : null,
        sandbox_enabled: sandboxEnabled,
        non_workspace_file_access: nonWorkspaceFileAccess,
        internet_access_policy: internetAccessPolicy,
        command_allowlist: commandAllowlist
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        command_denylist: commandDenylist
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
      ui: {
        ...config.ui,
        theme: uiTheme,
        font_size: uiFontSize,
        compact_mode: compactMode,
      },
      terminal: {
        ...config.terminal,
        shell: terminalShell.trim() ? terminalShell.trim() : null,
        scrollback: terminalScrollback,
      },
      workspace: {
        ...config.workspace,
        interface_layout: interfaceLayout,
        ignored_patterns: ignoredPatterns
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
  };

  const filteredSkills = skills.filter(
    (sk) =>
      !skillFilter ||
      sk.name.toLowerCase().includes(skillFilter.toLowerCase()) ||
      sk.description.toLowerCase().includes(skillFilter.toLowerCase())
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Local Settings & Connections"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => setSettingsOpen(false)}
    >
      <div
        className="w-full max-w-3xl max-h-[88vh] bg-[#111827] border border-gray-800 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-800">
          <h2 className="text-base font-semibold text-white">Local Settings & Connections</h2>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status / Error Banner */}
        {(lastError || actionStatus) && (
          <div
            className={`px-5 py-2 border-b flex items-center justify-between text-xs ${
              lastError || actionStatus?.type === 'error'
                ? 'bg-red-950/60 border-red-500/30 text-red-200'
                : actionStatus?.type === 'success'
                  ? 'bg-emerald-950/50 border-emerald-500/30 text-emerald-200'
                  : 'bg-blue-950/50 border-blue-500/30 text-blue-200'
            }`}
          >
            <span className="truncate">{lastError || actionStatus?.message}</span>
            <button
              type="button"
              onClick={() => {
                clearError();
                clearActionStatus();
              }}
              className="p-0.5 hover:text-white"
              aria-label="Dismiss status message"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-800 px-5 gap-4 bg-gray-950/40 overflow-x-auto flex-shrink-0">
          <button
            type="button"
            onClick={() => setTab('providers')}
            className={`flex items-center gap-2 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'providers'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Cpu className="w-4 h-4" />
            Local LLM Providers
          </button>
          <button
            type="button"
            onClick={() => setTab('mcp')}
            className={`flex items-center gap-2 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'mcp'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Server className="w-4 h-4" />
            MCP Servers ({mcpServers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('skills')}
            className={`flex items-center gap-2 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'skills'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            Skills ({skills.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('preferences')}
            className={`flex items-center gap-2 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              tab === 'preferences'
                ? 'border-blue-500 text-white'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <Sliders className="w-4 h-4" />
            Agent & Preferences
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {tab === 'providers' && (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-300">Configured Local Servers</h3>
                  <button
                    type="button"
                    onClick={() => fetchProviders()}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Refresh All
                  </button>
                </div>
                {providers.map((p) => {
                  const isConnected = p.status === 'connected';
                  const errMsg =
                    p.status && typeof p.status === 'object' && 'error' in p.status
                      ? p.status.error
                      : null;
                  const isActive = p.id === activeProviderId;
                  return (
                    <div
                      key={p.id}
                      className={`p-3 rounded-lg border flex items-center justify-between gap-3 ${
                        isActive
                          ? 'border-blue-500/60 bg-blue-500/10'
                          : 'border-gray-800 bg-gray-950/50'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          {isConnected ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                          ) : errMsg ? (
                            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                          )}
                          <span className="font-medium text-white text-sm">{p.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                            {p.provider_type}
                          </span>
                          {isActive && (
                            <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">
                              Active
                            </span>
                          )}
                          {p.models.length > 0 && (
                            <span className="text-xs text-gray-400">
                              {p.models.length} model(s)
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-1 truncate font-mono">
                          {p.base_url}
                        </p>
                        {errMsg && (
                          <p className="text-xs text-red-400 mt-1 truncate">
                            Status: {errMsg}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => setActiveProvider(p.id)}
                            className="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-white rounded"
                          >
                            Use
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => refreshProviderModels(p.id)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                          aria-label={`Refresh models for ${p.name}`}
                          title="Auto-discover models (GET /v1/models)"
                        >
                          <RefreshCw className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeProvider(p.id)}
                          className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded"
                          aria-label={`Remove ${p.name}`}
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <form
                onSubmit={handleAddProvider}
                className="p-4 rounded-lg border border-gray-800 bg-gray-950/50 space-y-3"
              >
                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add OpenAI-Compatible Local Server
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Provider Type</label>
                    <select
                      aria-label="Provider Type"
                      value={providerType}
                      onChange={(e) => presetUrl(e.target.value as any)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    >
                      <option value="custom">Strata / Custom OpenAI-Compatible</option>
                      <option value="ollama">Ollama</option>
                      <option value="lmstudio">LM Studio</option>
                      <option value="llamacpp">llama.cpp</option>
                      <option value="vllm">vLLM</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Display Name</label>
                    <input
                      aria-label="Display Name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Base URL</label>
                    <input
                      aria-label="Base URL"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="http://127.0.0.1:47831/v1"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Optional API Key
                    </label>
                    <input
                      aria-label="Optional API Key"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Optional"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={savingProvider}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors"
                >
                  {savingProvider ? 'Connecting...' : 'Connect & Discover Models'}
                </button>
              </form>

              <div className="p-4 rounded-lg border border-gray-800 bg-gray-950/50 space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-medium text-white">
                    Inference & Search Parameters
                  </h3>
                  <label className="flex items-center gap-2 text-xs text-indigo-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={inheritModelSettings}
                      onChange={(e) => setInheritModelSettings(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-indigo-500"
                    />
                    Inherit Context, Max Tokens & Temperature from Strata / Provider
                  </label>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Context Length</label>
                    <input
                      aria-label="Context Length"
                      type="number"
                      disabled={inheritModelSettings}
                      value={contextLength}
                      onChange={(e) => setContextLength(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white disabled:opacity-45"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max Tokens</label>
                    <input
                      aria-label="Max Tokens"
                      type="number"
                      disabled={inheritModelSettings}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white disabled:opacity-45"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Temperature</label>
                    <input
                      aria-label="Temperature"
                      type="number"
                      step="0.1"
                      min="0"
                      max="2"
                      disabled={inheritModelSettings}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white disabled:opacity-45"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Timeout (sec)</label>
                    <input
                      aria-label="Timeout seconds"
                      type="number"
                      min="5"
                      value={timeoutSeconds}
                      onChange={(e) => setTimeoutSeconds(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    SearXNG URL (optional local web search endpoint)
                  </label>
                  <input
                    aria-label="SearXNG URL"
                    value={searxngUrl}
                    onChange={(e) => setSearxngUrl(e.target.value)}
                    placeholder="http://127.0.0.1:8888"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveLLMParams}
                  className="px-3.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-white text-xs font-medium rounded-lg transition-colors"
                >
                  Save Parameters
                </button>
              </div>
            </>
          )}

          {tab === 'mcp' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-400">
                  Discovered from ~/.gemini/config/plugins/*/.mcp.json and user MCP config files.
                </p>
                <button
                  type="button"
                  onClick={() => fetchMCPServers()}
                  className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" />
                  Refresh
                </button>
              </div>

              {mcpServers.length === 0 ? (
                <p className="text-sm text-gray-500">No MCP servers configured or discovered.</p>
              ) : (
                <div className="space-y-2">
                  {mcpServers.map((s) => {
                    const connected = s.status === 'connected';
                    const errText =
                      s.status && typeof s.status === 'object' && 'error' in s.status
                        ? s.status.error
                        : null;
                    const isExpanded = expandedMcpId === s.id;
                    return (
                      <div
                        key={s.id}
                        className="p-3 rounded-lg border border-gray-800 bg-gray-950/50 space-y-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm text-white">{s.name}</span>
                              <span
                                className={`text-xs px-2 py-0.5 rounded ${
                                  connected
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : errText
                                      ? 'bg-red-500/20 text-red-300'
                                      : 'bg-gray-800 text-gray-400'
                                }`}
                              >
                                {typeof s.status === 'string' ? s.status : `error: ${errText}`}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 mt-1">
                              {s.tools.length} tools loaded •{' '}
                              {s.transport.type === 'stdio'
                                ? `stdio: ${s.transport.command}`
                                : `sse: ${s.transport.url}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {s.tools.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedMcpId(isExpanded ? null : s.id)
                                }
                                className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 rounded"
                              >
                                {isExpanded ? 'Hide Tools' : 'Tools'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleToggleMCP(s.id, connected)}
                              className={`px-3 py-1.5 text-xs rounded-lg ${
                                connected
                                  ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                                  : 'bg-blue-600 text-white hover:bg-blue-500'
                              }`}
                            >
                              {connected ? 'Disconnect' : 'Connect'}
                            </button>
                            <button
                              type="button"
                              onClick={() => removeServer(s.id)}
                              className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded"
                              aria-label={`Remove MCP server ${s.name}`}
                              title="Remove MCP Server"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && s.tools.length > 0 && (
                          <div className="pt-2 border-t border-gray-800 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {s.tools.map((tool) => (
                              <div
                                key={tool.name}
                                className="p-2 rounded bg-gray-900 border border-gray-800 text-xs"
                              >
                                <div className="font-mono text-blue-300 font-medium">
                                  {tool.name}
                                </div>
                                <div className="text-gray-400 text-[11px] mt-0.5">
                                  {tool.description}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Add MCP Server Form */}
              <form
                onSubmit={handleAddMCPServer}
                className="p-4 rounded-lg border border-gray-800 bg-gray-950/50 space-y-3"
              >
                <h3 className="text-sm font-medium text-white flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Add MCP Server
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Server Name</label>
                    <input
                      aria-label="MCP Server Name"
                      value={mcpName}
                      onChange={(e) => setMcpName(e.target.value)}
                      placeholder="e.g. filesystem-mcp"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Transport</label>
                    <select
                      aria-label="MCP Transport"
                      value={mcpTransportType}
                      onChange={(e) => setMcpTransportType(e.target.value as 'stdio' | 'sse')}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    >
                      <option value="stdio">Stdio Process</option>
                      <option value="sse">HTTP / SSE Endpoint</option>
                    </select>
                  </div>
                  {mcpTransportType === 'stdio' ? (
                    <>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Command</label>
                        <input
                          aria-label="MCP Command"
                          value={mcpCommand}
                          onChange={(e) => setMcpCommand(e.target.value)}
                          placeholder="npx"
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Arguments</label>
                        <input
                          aria-label="MCP Arguments"
                          value={mcpArgs}
                          onChange={(e) => setMcpArgs(e.target.value)}
                          placeholder="-y @modelcontextprotocol/server-filesystem ."
                          className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                        />
                      </div>
                    </>
                  ) : (
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-400 mb-1">Endpoint URL</label>
                      <input
                        aria-label="MCP Endpoint URL"
                        value={mcpUrl}
                        onChange={(e) => setMcpUrl(e.target.value)}
                        placeholder="http://127.0.0.1:3001/sse"
                        className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                      />
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between pt-1">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mcpAutoStart}
                      onChange={(e) => setMcpAutoStart(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-blue-600"
                    />
                    Auto-connect on startup
                  </label>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg"
                  >
                    Add MCP Server
                  </button>
                </div>
              </form>
            </div>
          )}

          {tab === 'skills' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <input
                  type="text"
                  value={skillFilter}
                  onChange={(e) => setSkillFilter(e.target.value)}
                  placeholder="Filter skills..."
                  aria-label="Filter skills"
                  className="px-3 py-1.5 bg-gray-950 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 w-56"
                />
                <button
                  type="button"
                  onClick={() => reloadSkills()}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-xs text-white rounded-lg"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Reload Skills
                </button>
              </div>

              {inspectedSkillContent && (
                <div className="p-3 rounded-lg border border-blue-500/40 bg-blue-950/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-blue-300">
                      SKILL.md: {inspectedSkillContent.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveArtifact({
                            title: `${inspectedSkillContent.name}.md`,
                            path: inspectedSkillContent.path,
                            content: inspectedSkillContent.content,
                            language: 'markdown',
                          });
                          setArtifactPaneOpen(true);
                          setSettingsOpen(false);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 underline"
                      >
                        Open in Artifact Pane
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectedSkillContent(null)}
                        className="text-gray-400 hover:text-white"
                        aria-label="Close skill preview"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <pre className="p-2.5 rounded bg-gray-950 text-xs font-mono text-gray-200 max-h-48 overflow-y-auto whitespace-pre-wrap">
                    {inspectedSkillContent.content}
                  </pre>
                </div>
              )}

              {filteredSkills.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No SKILL.md files found in configured directories.
                </p>
              ) : (
                <div className="space-y-2">
                  {filteredSkills.map((sk) => (
                    <div
                      key={sk.id}
                      className="p-3 rounded-lg border border-gray-800 bg-gray-950/50 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm text-white">{sk.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-300">
                            {sk.source}
                          </span>
                          <span
                            className={`text-xs px-2 py-0.5 rounded ${
                              sk.loaded
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-gray-800 text-gray-400'
                            }`}
                          >
                            {sk.loaded ? 'Loaded' : 'Unloaded'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">{sk.description}</p>
                        <p className="text-[11px] text-gray-500 mt-1 font-mono truncate">
                          {sk.path}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={() => handleInspectSkill(sk.id, sk.name, sk.path, sk.loaded)}
                          className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                          aria-label={`Inspect ${sk.name}`}
                          title="Inspect SKILL.md"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            sk.loaded ? unloadSkill(sk.id) : loadSkill(sk.id)
                          }
                          className={`px-2.5 py-1 text-xs rounded ${
                            sk.loaded
                              ? 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                              : 'bg-blue-600 hover:bg-blue-500 text-white'
                          }`}
                        >
                          {sk.loaded ? 'Unload' : 'Load'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'preferences' && (
            <div className="space-y-4">
              {/* Agent Settings */}
              <div className="p-4 rounded-lg border border-gray-800 bg-gray-950/50 space-y-3">
                <h3 className="text-sm font-medium text-white">Agent Engine Controls</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max Iterations</label>
                    <input
                      aria-label="Max Iterations"
                      type="number"
                      min="1"
                      max="200"
                      value={maxIterations}
                      onChange={(e) => setMaxIterations(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Max Subagents</label>
                    <input
                      aria-label="Max Subagents"
                      type="number"
                      min="1"
                      max="50"
                      value={maxSubagents}
                      onChange={(e) => setMaxSubagents(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Tool Timeout (sec)
                    </label>
                    <input
                      aria-label="Tool Timeout"
                      type="number"
                      min="5"
                      value={toolTimeout}
                      onChange={(e) => setToolTimeout(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 pt-1">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={enableStreaming}
                      onChange={(e) => setEnableStreaming(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-blue-600"
                    />
                    Enable Live SSE Token Streaming
                  </label>
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={requireApproval}
                      onChange={(e) => setRequireApproval(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-blue-600"
                    />
                    Require User Approval Before Running Shell Commands
                  </label>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Custom Global System Prompt (optional)
                  </label>
                  <textarea
                    aria-label="Custom Global System Prompt"
                    rows={2}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Additional instructions appended to the agent system prompt..."
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-gray-800">
                  <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer pt-5">
                    <input
                      type="checkbox"
                      checked={sandboxEnabled}
                      onChange={(e) => setSandboxEnabled(e.target.checked)}
                      className="rounded border-gray-700 bg-gray-900 text-blue-600"
                    />
                    Enable Terminal Sandbox
                  </label>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Non-Workspace File Access
                    </label>
                    <select
                      aria-label="Non-Workspace File Access"
                      value={nonWorkspaceFileAccess}
                      onChange={(e) => setNonWorkspaceFileAccess(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white"
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Internet Access Policy
                    </label>
                    <select
                      aria-label="Internet Access Policy"
                      value={internetAccessPolicy}
                      onChange={(e) => setInternetAccessPolicy(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white"
                    >
                      <option value="allow">Allow</option>
                      <option value="ask">Ask</option>
                      <option value="deny">Deny</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Command Allowlist (comma-separated)
                    </label>
                    <input
                      aria-label="Command Allowlist"
                      value={commandAllowlist}
                      onChange={(e) => setCommandAllowlist(e.target.value)}
                      placeholder="cargo test, npm test, git status"
                      className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Command Denylist (comma-separated)
                    </label>
                    <input
                      aria-label="Command Denylist"
                      value={commandDenylist}
                      onChange={(e) => setCommandDenylist(e.target.value)}
                      placeholder="rm -rf /, mkfs, dd if="
                      className="w-full px-3 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white font-mono"
                    />
                  </div>
                </div>
              </div>

              {/* Appearance & Terminal */}
              <div className="p-4 rounded-lg border border-gray-800 bg-gray-950/50 space-y-3">
                <h3 className="text-sm font-medium text-white">
                  Appearance, Terminal & Workspace
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Theme</label>
                    <select
                      aria-label="Theme"
                      value={uiTheme}
                      onChange={(e) => setUiTheme(e.target.value as ThemeMode)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    >
                      <option value="dark">Dark</option>
                      <option value="light">Light</option>
                      <option value="system">System</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">UI Font Size</label>
                    <input
                      aria-label="UI Font Size"
                      type="number"
                      min="11"
                      max="20"
                      value={uiFontSize}
                      onChange={(e) => setUiFontSize(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Terminal Scrollback
                    </label>
                    <input
                      aria-label="Terminal Scrollback"
                      type="number"
                      min="500"
                      max="100000"
                      value={terminalScrollback}
                      onChange={(e) => setTerminalScrollback(Number(e.target.value))}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-sm text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Default Shell Override (optional)
                    </label>
                    <input
                      aria-label="Default Shell Override"
                      value={terminalShell}
                      onChange={(e) => setTerminalShell(e.target.value)}
                      placeholder="/bin/bash or /bin/fish"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Workspace Ignored Patterns (comma-separated)
                    </label>
                    <input
                      aria-label="Workspace Ignored Patterns"
                      value={ignoredPatterns}
                      onChange={(e) => setIgnoredPatterns(e.target.value)}
                      placeholder="node_modules, .git, target, dist"
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white font-mono"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">
                      Interface Layout (Projects & Worktree Selector)
                    </label>
                    <select
                      aria-label="Interface Layout"
                      value={interfaceLayout}
                      onChange={(e) => setInterfaceLayout(e.target.value)}
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-xs text-white"
                    >
                      <option value="standard">
                        Standard Layout (Show Local vs New Worktree selector in projects)
                      </option>
                      <option value="knowledge_work">
                        Knowledge Work Layout (Run directly in project folders, hide worktree selector)
                      </option>
                    </select>
                  </div>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => resetConfig()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-red-900/40 text-gray-300 hover:text-red-200 text-xs rounded-lg transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset All to Defaults
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePreferences}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
