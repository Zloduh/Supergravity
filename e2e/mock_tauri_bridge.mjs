import crypto from 'node:crypto';
import path from 'node:path';

export const ALL_56_COMMANDS = [
  // FS (12)
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'create_dir',
  'delete_path',
  'copy_path',
  'move_path',
  'search_files',
  'read_file_range',
  'watch_path',
  'unwatch_path',
  // Terminal (5)
  'spawn_terminal',
  'write_terminal',
  'resize_terminal',
  'kill_terminal',
  'list_terminals',
  // LLM (8)
  'list_providers',
  'add_provider',
  'remove_provider',
  'set_active_provider',
  'chat_completion',
  'stream_chat_completion',
  'list_models',
  'refresh_provider_models',
  // MCP (7)
  'list_servers',
  'add_server',
  'remove_server',
  'connect_server',
  'disconnect_server',
  'list_tools',
  'call_tool',
  // Agent (11)
  'start_agent_task',
  'cancel_agent_task',
  'get_agent_status',
  'list_conversations',
  'create_conversation',
  'delete_conversation',
  'get_conversation',
  'send_message',
  'answer_question',
  'approve_command',
  'list_artifacts',
  // Skills (5)
  'list_skills',
  'load_skill',
  'unload_skill',
  'reload_skills',
  'get_skill_schema',
  // Config (3)
  'get_config',
  'set_config',
  'reset_config',
  // Window (5)
  'create_window',
  'close_window',
  'minimize_window',
  'maximize_window',
  'list_windows',
];

const SNAKE_CASE_KEY_RE = /^[a-z][a-z0-9_]*$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

function makeDefaultConfig() {
  return {
    llm: {
      providers: [
        {
          id: 'strata',
          name: 'Strata (Local)',
          provider_type: 'custom',
          base_url: 'http://127.0.0.1:47831/v1',
          api_key: 'strata',
          models: [],
          enabled: true,
          headers: null,
        },
        {
          id: 'strata-lan',
          name: 'Strata (LAN)',
          provider_type: 'custom',
          base_url: 'http://192.168.0.92:47832/v1',
          api_key: 'strata',
          models: [],
          enabled: true,
          headers: null,
        },
      ],
      active_provider: 'strata',
      default_model: null,
      max_tokens: 4096,
      context_length: 32768,
      temperature: 0.7,
      timeout_seconds: 120,
      searxng_url: null,
    },
    mcp: {
      servers: [],
      auto_connect: true,
    },
    agent: {
      max_iterations: 50,
      max_subagents: 10,
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
      shell: '/bin/bash',
      args: [],
      env: {},
      cwd: null,
      cols: 120,
      rows: 30,
      scrollback: 10000,
      font_size: 13.0,
      font_family: 'JetBrains Mono, Fira Code, Consolas, monospace',
      theme: 'system',
    },
    ui: {
      theme: 'system',
      sidebar_width: 280,
      terminal_height: 200,
      artifact_panel_width: 400,
      font_size: 13.0,
      font_family: 'Inter, system-ui, sans-serif',
      animations_enabled: true,
      compact_mode: false,
    },
    skills: {
      directories: [
        '~/.gemini/antigravity/builtin/skills',
        '~/.gemini/config/plugins/*/skills',
        '~/.gemini/config/skills',
        '~/.claude/skills',
        '~/.agents/skills',
      ],
      auto_load: true,
      builtin_skills_path: null,
    },
    workspace: {
      recent_paths: [],
      max_recent: 20,
      default_path: null,
      ignored_patterns: [
        'node_modules',
        '.git',
        'target',
        'dist',
        'build',
        '*.log',
        '*.tmp',
        '.DS_Store',
      ],
      projects: [],
      active_project_id: null,
      interface_layout: 'standard',
      scheduled_tasks: [],
    },
  };
}

function formatModelInfo(raw) {
  const id = raw.id || 'unknown-model';
  const meta = raw.meta ?? null;
  let name = raw.name ?? '';
  if (!name) {
    const label = meta && typeof meta.label === 'string' ? meta.label : null;
    name = label ? `${label} (${id})` : id;
  }
  return {
    id,
    name,
    context_length: raw.context_length ?? 32768,
    supports_streaming: raw.supports_streaming ?? true,
    supports_tools: raw.supports_tools ?? true,
    supports_vision: raw.supports_vision ?? false,
    owned_by: raw.owned_by ?? null,
    meta,
  };
}

function makeDefaultProvidersFromConfig(cfg) {
  return (cfg.llm.providers || []).map((p) => ({
    id: p.id,
    name: p.name,
    provider_type: p.provider_type || 'custom',
    base_url: p.base_url,
    api_key: p.api_key ?? null,
    models:
      p.id === 'strata'
        ? [
            formatModelInfo({
              id: 'coder-iq1_m',
              name: '',
              owned_by: 'strata',
              meta: { label: 'Qwen3.8-Flash-Next Coder IQ1_M' },
            }),
          ]
        : [],
    enabled: p.enabled ?? true,
    headers: p.headers ? { ...p.headers } : {},
    status: 'unknown',
    last_checked: null,
  }));
}

function makeDefaultSkills() {
  return [
    {
      id: 'code-review',
      name: 'code-review',
      description: 'Review code changes for correctness, edge cases, and regressions',
      version: '1.0.0',
      path: '/workspace/.agents/skills/code-review/SKILL.md',
      skill_type: 'builtin',
      schema: null,
      loaded: false,
      source: 'builtinskills',
    },
    {
      id: 'tdd-workflow',
      name: 'tdd-workflow',
      description: 'Test-driven development workflow with red-green-refactor loop',
      version: '1.0.0',
      path: '/workspace/.agents/skills/tdd-workflow/SKILL.md',
      skill_type: 'user',
      schema: null,
      loaded: false,
      source: 'configskills',
    },
  ];
}

function makeDefaultVfs() {
  const m = new Map();
  const ts = String(Math.floor(Date.now() / 1000));
  m.set('/workspace', { is_dir: true, content: '', modified: ts });
  m.set('/workspace/README.md', {
    is_dir: false,
    content: '# Antigravity Workspace\n\nMock workspace file for E2E verification.\n',
    modified: ts,
  });
  m.set('/workspace/src', { is_dir: true, content: '', modified: ts });
  m.set('/workspace/src/main.ts', {
    is_dir: false,
    content: 'export function greet(name: string): string {\n  return `Hello, ${name}`;\n}\n',
    modified: ts,
  });
  return m;
}

function normalizePosixPath(p) {
  if (!p || p === '.') return '/workspace';
  const norm = path.posix.normalize(String(p));
  if (norm.length > 1 && norm.endsWith('/')) return norm.slice(0, -1);
  return norm;
}

function globToRegex(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function isIgnored(filePath, ignorePatterns) {
  if (!Array.isArray(ignorePatterns) || ignorePatterns.length === 0) return false;
  const parts = filePath.split('/');
  const base = parts[parts.length - 1] || '';
  return ignorePatterns.some((pat) => {
    const re = globToRegex(pat);
    return re.test(base) || parts.some((seg) => re.test(seg));
  });
}

function parseChannelId(ref) {
  if (typeof ref === 'number') return ref;
  if (typeof ref === 'string' && ref.startsWith('__CHANNEL__:')) {
    const n = Number(ref.slice('__CHANNEL__:'.length));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isLoopbackUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return false;
  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return (
    host === '127.0.0.1' ||
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]'
  );
}

/**
 * Generate the browser-side init script injected before module evaluation via
 * Page.addScriptToEvaluateOnNewDocument.
 */
export function getInitScript(initialState = {}) {
  const serializedInitial = JSON.stringify(initialState || {});
  return `(() => {
    if (window.__E2E_TAURI_BRIDGE_INSTALLED__) return;
    window.__E2E_TAURI_BRIDGE_INSTALLED__ = true;
    window.__E2E_INITIAL_STATE__ = ${serializedInitial};

    const callbacks = new Map();
    const eventListeners = new Map(); // eventName -> Map<handlerId, target>
    let nextCallbackId = 1;
    let nextCallId = 1;
    const pendingHostCalls = new Map();

    function transformCallback(callback, once = false) {
      const id = nextCallbackId++;
      callbacks.set(id, (data) => {
        if (once) callbacks.delete(id);
        if (typeof callback === 'function') {
          return callback(data);
        }
      });
      return id;
    }

    function unregisterCallback(id) {
      callbacks.delete(id);
    }

    function runCallback(id, data) {
      const cb = callbacks.get(id);
      if (typeof cb === 'function') {
        return cb(data);
      }
    }

    function unregisterListener(event, eventId) {
      const map = eventListeners.get(event);
      if (map) {
        map.delete(eventId);
        if (map.size === 0) eventListeners.delete(event);
      }
      unregisterCallback(eventId);
    }

    window.__e2eDispatchTauriEvent = function(eventName, payload) {
      const map = eventListeners.get(eventName);
      if (!map) return 0;
      let count = 0;
      for (const [handlerId] of [...map.entries()]) {
        runCallback(handlerId, { event: eventName, id: handlerId, payload });
        count++;
      }
      return count;
    };

    window.__e2eSendChannelMessage = function(channelRef, index, message) {
      let id = channelRef;
      if (typeof channelRef === 'string' && channelRef.indexOf('__CHANNEL__:') === 0) {
        id = Number(channelRef.slice('__CHANNEL__:'.length));
      }
      runCallback(id, { index, message });
    };

    window.__e2eEndChannel = function(channelRef, index) {
      let id = channelRef;
      if (typeof channelRef === 'string' && channelRef.indexOf('__CHANNEL__:') === 0) {
        id = Number(channelRef.slice('__CHANNEL__:'.length));
      }
      runCallback(id, { index, end: true });
    };

    window.__e2eBridgeResolve = function(callId, ok, value) {
      const entry = pendingHostCalls.get(callId);
      if (!entry) return;
      pendingHostCalls.delete(callId);
      if (ok) {
        entry.resolve(value);
      } else {
        const msg = typeof value === 'string' ? value : (value && value.message) || JSON.stringify(value);
        entry.reject(new Error(msg));
      }
    };

    function sanitizeForJson(val) {
      if (val instanceof Uint8Array) {
        return Array.from(val);
      }
      return val;
    }

    function notifyHost(cmd, args, options) {
      if (typeof window.__e2eTauriHostCall !== 'function') return;
      try {
        window.__e2eTauriHostCall(JSON.stringify({
          id: null,
          cmd,
          args: sanitizeForJson(args),
          options: options || null
        }));
      } catch {
        // ignore notification errors
      }
    }

    function callHost(cmd, args, options) {
      if (typeof window.__e2eTauriHostCall !== 'function') {
        return Promise.reject(new Error('Tauri E2E host binding (__e2eTauriHostCall) not attached for command: ' + cmd));
      }
      const id = nextCallId++;
      return new Promise((resolve, reject) => {
        pendingHostCalls.set(id, { resolve, reject });
        try {
          window.__e2eTauriHostCall(JSON.stringify({
            id,
            cmd,
            args: sanitizeForJson(args),
            options: options || null
          }));
        } catch (err) {
          pendingHostCalls.delete(id);
          reject(err);
        }
      });
    }

    async function invoke(cmd, args, options) {
      args = args ?? {};
      if (cmd === 'plugin:event|listen') {
        const eventName = args && args.event;
        const handlerId = args && args.handler;
        const target = (args && args.target) || { kind: 'Any' };
        if (eventName && typeof handlerId === 'number') {
          let map = eventListeners.get(eventName);
          if (!map) {
            map = new Map();
            eventListeners.set(eventName, map);
          }
          map.set(handlerId, target);
        }
        notifyHost(cmd, args, options);
        return handlerId;
      }

      if (cmd === 'plugin:event|unlisten') {
        if (args && args.event && typeof args.eventId === 'number') {
          unregisterListener(args.event, args.eventId);
        }
        notifyHost(cmd, args, options);
        return null;
      }

      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        if (args && args.event) {
          window.__e2eDispatchTauriEvent(args.event, args.payload);
        }
        notifyHost(cmd, args, options);
        return null;
      }

      return callHost(cmd, args, options);
    }

    window.isTauri = true;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener,
    };
    window.__TAURI_INTERNALS__ = {
      invoke,
      transformCallback,
      unregisterCallback,
      runCallback,
      callbacks,
      convertFileSrc(filePath, protocol = 'asset') {
        return protocol + '://localhost/' + encodeURIComponent(String(filePath));
      },
      metadata: {
        currentWindow: { label: 'main' },
        currentWebview: { windowLabel: 'main', label: 'main' },
      },
    };
  })();`;
}

export class MockTauriBackend {
  constructor(options = {}) {
    this._llm = options.llm || options.llmServer || null;
    this._llmBaseUrl = options.llmBaseUrl || null;
    this._redirectStrata = options.redirectStrata ?? true;

    this._invocations = [];
    this._waiters = [];
    this._emittedEvents = [];
    this._page = null;
    this._seq = 0;

    this._config = makeDefaultConfig();
    if (options.initialConfig) {
      this._mergeConfig(options.initialConfig);
    }

    this._providers = makeDefaultProvidersFromConfig(this._config);
    this._conversations = new Map();
    this._tasks = new Map();
    this._terminals = new Map();
    this._terminalInputs = new Map();
    this._servers = new Map();
    this._skills = new Map(makeDefaultSkills().map((s) => [s.id, s]));
    this._artifacts = new Map(); // conversationId -> ArtifactInfo[]
    this._vfs = makeDefaultVfs();
    this._watchedPaths = new Set();
    this._windows = ['main'];
    this._windowState = { minimized: false, maximized: false };
    this._pendingQuestions = new Map();
    this._pendingApprovals = new Map();
    this._questionAnswers = new Map();
    this._approvalDecisions = new Map();

    // Plugin state
    this._clipboard = '';
    this._dialogResult = {
      open: '/workspace',
      save: '/workspace/export.txt',
      message: 'Ok',
    };
    this._registeredShortcuts = new Map();
    this._shellProcesses = new Map();
    this._resources = new Map();
    this._updaterResult = null;

    if (options.initialState) {
      this.setState(options.initialState);
    }
  }

  _nextId(prefix) {
    return `${prefix}-${++this._seq}-${crypto.randomBytes(3).toString('hex')}`;
  }

  _getLlmBaseUrl() {
    if (this._llm && typeof this._llm.baseUrl === 'string') return this._llm.baseUrl;
    if (this._llmBaseUrl) return this._llmBaseUrl;
    return null;
  }

  _resolveProviderTargetUrl(provider) {
    const mockUrl = this._getLlmBaseUrl();
    if (
      mockUrl &&
      this._redirectStrata &&
      (provider.id === 'strata' ||
        provider.base_url === 'http://127.0.0.1:47831/v1')
    ) {
      return mockUrl.replace(/\/+$/, '');
    }
    return String(provider.base_url || '').replace(/\/+$/, '');
  }

  _mergeConfig(patch) {
    if (!patch || typeof patch !== 'object') return;
    for (const section of Object.keys(patch)) {
      if (
        patch[section] &&
        typeof patch[section] === 'object' &&
        !Array.isArray(patch[section]) &&
        this._config[section] &&
        typeof this._config[section] === 'object'
      ) {
        this._config[section] = {
          ...this._config[section],
          ...clone(patch[section]),
        };
      } else {
        this._config[section] = clone(patch[section]);
      }
    }
  }

  getInvocations() {
    return clone(this._invocations);
  }

  clearInvocations() {
    this._invocations = [];
  }

  getEmittedEvents() {
    return clone(this._emittedEvents);
  }

  getState() {
    return clone({
      config: this._config,
      providers: this._providers,
      conversations: [...this._conversations.values()],
      tasks: [...this._tasks.values()],
      terminals: [...this._terminals.values()],
      servers: [...this._servers.values()],
      skills: [...this._skills.values()],
      windows: this._windows,
      windowState: this._windowState,
      clipboard: this._clipboard,
      dialogResult: this._dialogResult,
      watchedPaths: [...this._watchedPaths],
    });
  }

  setState(patch = {}) {
    if (!patch || typeof patch !== 'object') return;
    if (patch.config) {
      this._mergeConfig(patch.config);
      if (patch.config.llm?.providers && !patch.providers) {
        this._providers = makeDefaultProvidersFromConfig(this._config);
      }
    }
    if (Array.isArray(patch.providers)) {
      this._providers = clone(patch.providers);
      this._config.llm.providers = this._providers.map((p) => ({
        id: p.id,
        name: p.name,
        provider_type: p.provider_type || 'custom',
        base_url: p.base_url,
        api_key: p.api_key ?? null,
        models: (p.models || []).map((m) => (typeof m === 'string' ? m : m.id)),
        enabled: p.enabled ?? true,
        headers: p.headers ?? null,
      }));
    }
    if (Array.isArray(patch.conversations)) {
      this._conversations.clear();
      for (const c of patch.conversations) {
        this._conversations.set(c.id, clone(c));
      }
    }
    if (Array.isArray(patch.tasks)) {
      this._tasks.clear();
      for (const t of patch.tasks) {
        this._tasks.set(t.id, clone(t));
      }
    }
    if (Array.isArray(patch.terminals)) {
      this._terminals.clear();
      for (const t of patch.terminals) {
        this._terminals.set(t.id, clone(t));
      }
    }
    if (Array.isArray(patch.servers)) {
      this._servers.clear();
      for (const s of patch.servers) {
        this._servers.set(s.id, clone(s));
      }
    }
    if (Array.isArray(patch.skills)) {
      this._skills.clear();
      for (const s of patch.skills) {
        this._skills.set(s.id, clone(s));
      }
    }
    if (patch.artifacts && typeof patch.artifacts === 'object') {
      for (const [convId, list] of Object.entries(patch.artifacts)) {
        this._artifacts.set(convId, clone(list));
      }
    }
    if (patch.files && typeof patch.files === 'object') {
      for (const [filePath, content] of Object.entries(patch.files)) {
        const norm = normalizePosixPath(filePath);
        const dir = path.posix.dirname(norm);
        if (dir && dir !== '/' && !this._vfs.has(dir)) {
          this._ensureParentDirs(norm);
        }
        if (typeof content === 'string') {
          this._vfs.set(norm, {
            is_dir: false,
            content,
            is_binary: false,
            modified: String(Math.floor(Date.now() / 1000)),
          });
        } else if (content && typeof content === 'object') {
          this._vfs.set(norm, {
            is_dir: Boolean(content.is_dir),
            content: content.content ?? '',
            is_binary: Boolean(content.is_binary),
            modified: content.modified || String(Math.floor(Date.now() / 1000)),
          });
        }
      }
    }
    if (patch.dialogResult) {
      this._dialogResult = { ...this._dialogResult, ...clone(patch.dialogResult) };
    }
    if ('clipboard' in patch) {
      this._clipboard = String(patch.clipboard ?? '');
    }
    if ('updaterResult' in patch) {
      this._updaterResult = clone(patch.updaterResult);
    }
    if (Array.isArray(patch.windows)) {
      this._windows = [...patch.windows];
    }
    if (patch.llm !== undefined) {
      this._llm = patch.llm;
    }
  }

  _ensureParentDirs(filePath) {
    const parts = normalizePosixPath(filePath).split('/').filter(Boolean);
    let cur = '';
    for (let i = 0; i < parts.length - 1; i++) {
      cur += '/' + parts[i];
      if (!this._vfs.has(cur)) {
        this._vfs.set(cur, {
          is_dir: true,
          content: '',
          modified: String(Math.floor(Date.now() / 1000)),
        });
      }
    }
  }

  async emitEvent(name, payload) {
    const rec = { event: name, payload: clone(payload), timestamp: Date.now() };
    this._emittedEvents.push(rec);
    if (this._page) {
      await this._page
        .evaluate(
          (evName, evPayload) => {
            if (typeof window.__e2eDispatchTauriEvent === 'function') {
              return window.__e2eDispatchTauriEvent(evName, evPayload);
            }
            return 0;
          },
          name,
          payload
        )
        .catch(() => {});
    }
    return rec;
  }

  async sendChannelMessage(channelRef, index, message) {
    if (!this._page) return;
    await this._page
      .evaluate(
        (ref, idx, msg) => {
          window.__e2eSendChannelMessage?.(ref, idx, msg);
        },
        channelRef,
        index,
        message
      )
      .catch(() => {});
  }

  async endChannel(channelRef, index) {
    if (!this._page) return;
    await this._page
      .evaluate(
        (ref, idx) => {
          window.__e2eEndChannel?.(ref, idx);
        },
        channelRef,
        index
      )
      .catch(() => {});
  }

  waitForInvocation(cmd, predicateOrTimeoutMs, timeoutMsArg) {
    let predicate = null;
    let timeoutMs = 5000;
    if (typeof predicateOrTimeoutMs === 'function') {
      predicate = predicateOrTimeoutMs;
      if (typeof timeoutMsArg === 'number') timeoutMs = timeoutMsArg;
    } else if (typeof predicateOrTimeoutMs === 'number') {
      timeoutMs = predicateOrTimeoutMs;
    }

    const match = this._invocations.find(
      (inv) => inv.cmd === cmd && (!predicate || predicate(inv))
    );
    if (match) return Promise.resolve(clone(match));

    return new Promise((resolve, reject) => {
      const entry = { cmd, predicate, resolve, timer: null };
      entry.timer = setTimeout(() => {
        const idx = this._waiters.indexOf(entry);
        if (idx !== -1) this._waiters.splice(idx, 1);
        reject(new Error(`Timed out after ${timeoutMs}ms waiting for invocation "${cmd}"`));
      }, timeoutMs);
      this._waiters.push(entry);
    });
  }

  _recordAndNotify(cmd, args) {
    args = args ?? {};
    const isPlugin = String(cmd).startsWith('plugin:');
    const casingErrors = [];
    if (!isPlugin && args && typeof args === 'object' && !Array.isArray(args)) {
      for (const key of Object.keys(args)) {
        if (!SNAKE_CASE_KEY_RE.test(key)) {
          casingErrors.push(key);
        }
      }
    }
    const casingOk = casingErrors.length === 0;
    const record = {
      cmd,
      args: clone(args ?? {}),
      timestamp: Date.now(),
      casingOk,
      casingErrors,
    };
    this._invocations.push(record);

    for (let i = this._waiters.length - 1; i >= 0; i--) {
      const w = this._waiters[i];
      if (w.cmd === cmd && (!w.predicate || w.predicate(record))) {
        clearTimeout(w.timer);
        this._waiters.splice(i, 1);
        w.resolve(clone(record));
      }
    }

    if (!casingOk) {
      throw new Error(
        `IPC snake_case validation failed for "${cmd}": non-snake_case top-level key(s): ${casingErrors.join(', ')}`
      );
    }
  }

  async invoke(cmd, args, options = null) {
    args = args ?? {};
    this._recordAndNotify(cmd, args);

    if (String(cmd).startsWith('plugin:')) {
      return this._handlePluginCommand(cmd, args, options);
    }
    return this._handleAppCommand(cmd, args);
  }

  async _handlePluginCommand(cmd, args, options = null) {
    args = args ?? {};
    switch (cmd) {
      case 'plugin:event|listen':
      case 'plugin:event|unlisten':
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        return args?.handler ?? null;

      case 'plugin:resources|close': {
        if (args?.rid !== undefined) this._resources.delete(args.rid);
        return null;
      }

      // Dialog
      case 'plugin:dialog|open':
        return clone(this._dialogResult.open);
      case 'plugin:dialog|save':
        return clone(this._dialogResult.save);
      case 'plugin:dialog|message':
      case 'plugin:dialog|ask':
      case 'plugin:dialog|confirm':
        return clone(this._dialogResult.message);

      // Clipboard
      case 'plugin:clipboard-manager|write_text':
      case 'plugin:clipboard-manager|write_secret':
        this._clipboard = String(args?.text ?? '');
        return null;
      case 'plugin:clipboard-manager|write_html':
        this._clipboard = String(args?.html ?? '');
        return null;
      case 'plugin:clipboard-manager|read_text':
        return this._clipboard;
      case 'plugin:clipboard-manager|clear':
        this._clipboard = '';
        return null;

      // Global shortcut
      case 'plugin:global-shortcut|register': {
        const shortcuts = Array.isArray(args?.shortcuts) ? args.shortcuts : [];
        for (const s of shortcuts) {
          this._registeredShortcuts.set(s, args?.handler ?? null);
        }
        return null;
      }
      case 'plugin:global-shortcut|unregister': {
        const shortcuts = Array.isArray(args?.shortcuts) ? args.shortcuts : [];
        for (const s of shortcuts) this._registeredShortcuts.delete(s);
        return null;
      }
      case 'plugin:global-shortcut|unregister_all':
        this._registeredShortcuts.clear();
        return null;
      case 'plugin:global-shortcut|is_registered':
        return this._registeredShortcuts.has(args?.shortcut);

      // Plugin FS
      case 'plugin:fs|read_file':
      case 'plugin:fs|read_text_file': {
        const p = normalizePosixPath(args?.path || options?.headers?.path || '');
        const entry = this._vfs.get(p);
        if (!entry || entry.is_dir) throw new Error(`ENOENT: ${p}`);
        return cmd === 'plugin:fs|read_text_file'
          ? entry.content
          : Array.from(Buffer.from(entry.content, 'utf8'));
      }
      case 'plugin:fs|write_file':
      case 'plugin:fs|write_text_file': {
        const rawPath = options?.headers?.path
          ? decodeURIComponent(options.headers.path)
          : args?.path || '';
        const p = normalizePosixPath(rawPath);
        this._ensureParentDirs(p);
        const content = Array.isArray(args)
          ? Buffer.from(args).toString('utf8')
          : String(args?.content ?? '');
        this._vfs.set(p, {
          is_dir: false,
          content,
          modified: String(Math.floor(Date.now() / 1000)),
        });
        return null;
      }
      case 'plugin:fs|exists': {
        const p = normalizePosixPath(args?.path || '');
        return this._vfs.has(p);
      }
      case 'plugin:fs|mkdir': {
        const p = normalizePosixPath(args?.path || '');
        this._ensureParentDirs(p);
        this._vfs.set(p, {
          is_dir: true,
          content: '',
          modified: String(Math.floor(Date.now() / 1000)),
        });
        return null;
      }
      case 'plugin:fs|remove': {
        const p = normalizePosixPath(args?.path || '');
        this._vfs.delete(p);
        return null;
      }
      case 'plugin:fs|stat':
      case 'plugin:fs|lstat': {
        const p = normalizePosixPath(args?.path || '');
        const entry = this._vfs.get(p);
        if (!entry) throw new Error(`ENOENT: ${p}`);
        return {
          isFile: !entry.is_dir,
          isDirectory: entry.is_dir,
          isSymlink: false,
          size: Buffer.byteLength(entry.content || '', 'utf8'),
        };
      }
      case 'plugin:fs|read_dir': {
        const res = await this._handleAppCommand('list_dir', {
          request: { path: args?.path || '/workspace' },
        });
        return res.entries.map((e) => ({
          name: e.name,
          isDirectory: e.is_dir,
          isFile: !e.is_dir,
          isSymlink: false,
        }));
      }

      // Shell
      case 'plugin:shell|open':
        return null;
      case 'plugin:shell|execute':
        return { code: 0, signal: null, stdout: '', stderr: '' };
      case 'plugin:shell|spawn': {
        const pid = Math.floor(1000 + Math.random() * 9000);
        this._shellProcesses.set(pid, {
          program: args?.program,
          args: args?.args || [],
          onEvent: args?.onEvent ?? null,
        });
        return pid;
      }
      case 'plugin:shell|stdin_write':
        return null;
      case 'plugin:shell|kill':
        this._shellProcesses.delete(args?.pid);
        return null;

      // Notification
      case 'plugin:notification|is_permission_granted':
        return true;
      case 'plugin:notification|request_permission':
        return 'granted';
      case 'plugin:notification|notify':
      case 'plugin:notification|register_action_types':
      case 'plugin:notification|cancel':
      case 'plugin:notification|remove_active':
      case 'plugin:notification|create_channel':
      case 'plugin:notification|delete_channel':
        return null;
      case 'plugin:notification|get_pending':
      case 'plugin:notification|get_active':
      case 'plugin:notification|list_channels':
        return [];

      // Updater
      case 'plugin:updater|check':
        return clone(this._updaterResult);
      case 'plugin:updater|download':
      case 'plugin:updater|install':
      case 'plugin:updater|download_and_install':
        return null;

      // Window / App plugins
      case 'plugin:window|minimize':
        this._windowState.minimized = true;
        return null;
      case 'plugin:window|toggle_maximize':
      case 'plugin:window|maximize':
        this._windowState.maximized = !this._windowState.maximized;
        return null;
      case 'plugin:window|is_maximized':
        return this._windowState.maximized;
      case 'plugin:window|is_minimized':
        return this._windowState.minimized;
      case 'plugin:window|is_visible':
        return true;
      case 'plugin:window|title':
        return 'Antigravity';
      case 'plugin:window|close':
      case 'plugin:window|destroy':
      case 'plugin:window|set_theme':
      case 'plugin:window|set_title':
        return null;
      case 'plugin:app|version':
        return '0.1.0';
      case 'plugin:app|name':
        return 'Antigravity';
      case 'plugin:app|tauri_version':
        return '2.0.0';
      case 'plugin:app|identifier':
        return 'com.antigravity.app';
      case 'plugin:app|exit':
      case 'plugin:app|app_show':
      case 'plugin:app|app_hide':
        return null;

      default:
        return null;
    }
  }

  async _handleAppCommand(cmd, args) {
    args = args ?? {};
    switch (cmd) {
      // --- FS (12) ---
      case 'read_file': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        const entry = this._vfs.get(p);
        if (!entry || entry.is_dir) {
          throw new Error(`Failed to read file "${p}": No such file`);
        }
        return {
          path: p,
          content: entry.content,
          size: Buffer.byteLength(entry.content || '', 'utf8'),
          is_binary: Boolean(entry.is_binary),
        };
      }
      case 'write_file': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        if (req.create_dirs !== false) {
          this._ensureParentDirs(p);
        }
        this._vfs.set(p, {
          is_dir: false,
          content: String(req.content ?? ''),
          is_binary: false,
          modified: String(Math.floor(Date.now() / 1000)),
        });
        if (this._isWatched(p)) {
          await this.emitEvent('fs-change', { path: p, kind: 'modify' });
        }
        return null;
      }
      case 'edit_file': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        const entry = this._vfs.get(p);
        if (!entry || entry.is_dir) {
          throw new Error(`Failed to edit file "${p}": No such file`);
        }
        if (!entry.content.includes(req.old_text)) {
          throw new Error(`old_text not found in "${p}"`);
        }
        const updated = req.replace_all
          ? entry.content.split(req.old_text).join(req.new_text)
          : entry.content.replace(req.old_text, req.new_text);
        this._vfs.set(p, {
          ...entry,
          content: updated,
          modified: String(Math.floor(Date.now() / 1000)),
        });
        if (this._isWatched(p)) {
          await this.emitEvent('fs-change', { path: p, kind: 'modify' });
        }
        return null;
      }
      case 'list_dir': {
        const req = args.request || args;
        const dirPath = normalizePosixPath(req.path || '/workspace');
        const dirEntry = this._vfs.get(dirPath);
        if (!dirEntry || !dirEntry.is_dir) {
          throw new Error(`Directory not found: ${dirPath}`);
        }
        const recursive = Boolean(req.recursive);
        const ignore = req.ignore_patterns || [];
        const prefix = dirPath === '/' ? '/' : `${dirPath}/`;
        const entries = [];
        for (const [k, v] of this._vfs.entries()) {
          if (!k.startsWith(prefix)) continue;
          const rel = k.slice(prefix.length);
          if (!rel) continue;
          if (!recursive && rel.includes('/')) continue;
          if (isIgnored(k, ignore)) continue;
          entries.push({
            name: path.posix.basename(k),
            path: k,
            is_dir: v.is_dir,
            size: v.is_dir ? null : Buffer.byteLength(v.content || '', 'utf8'),
            modified: v.modified || null,
          });
        }
        entries.sort((a, b) => Number(b.is_dir) - Number(a.is_dir) || a.name.localeCompare(b.name));
        return { path: dirPath, entries };
      }
      case 'create_dir': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        if (req.recursive !== false) {
          this._ensureParentDirs(p);
        }
        this._vfs.set(p, {
          is_dir: true,
          content: '',
          modified: String(Math.floor(Date.now() / 1000)),
        });
        return null;
      }
      case 'delete_path': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        if (!this._vfs.has(p)) {
          throw new Error(`Path not found: ${p}`);
        }
        const entry = this._vfs.get(p);
        if (entry.is_dir && req.recursive) {
          const prefix = p === '/' ? '/' : `${p}/`;
          for (const k of [...this._vfs.keys()]) {
            if (k === p || k.startsWith(prefix)) this._vfs.delete(k);
          }
        } else {
          this._vfs.delete(p);
        }
        if (this._isWatched(p)) {
          await this.emitEvent('fs-change', { path: p, kind: 'remove' });
        }
        return null;
      }
      case 'copy_path': {
        const req = args.request || args;
        const src = normalizePosixPath(req.source);
        const dst = normalizePosixPath(req.destination);
        const entry = this._vfs.get(src);
        if (!entry) throw new Error(`Source not found: ${src}`);
        this._ensureParentDirs(dst);
        this._vfs.set(dst, { ...clone(entry), modified: String(Math.floor(Date.now() / 1000)) });
        return null;
      }
      case 'move_path': {
        const req = args.request || args;
        const src = normalizePosixPath(req.source);
        const dst = normalizePosixPath(req.destination);
        const entry = this._vfs.get(src);
        if (!entry) throw new Error(`Source not found: ${src}`);
        this._ensureParentDirs(dst);
        this._vfs.set(dst, { ...clone(entry), modified: String(Math.floor(Date.now() / 1000)) });
        this._vfs.delete(src);
        return null;
      }
      case 'search_files': {
        const req = args.request || args;
        const root = normalizePosixPath(req.path || '/workspace');
        const prefix = root === '/' ? '/' : `${root}/`;
        const ignore = req.ignore_patterns || [];
        const filePatRe = req.file_pattern ? globToRegex(req.file_pattern) : null;
        let regex;
        try {
          regex = new RegExp(req.pattern);
        } catch {
          regex = new RegExp(req.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const results = [];
        for (const [k, v] of this._vfs.entries()) {
          if (v.is_dir) continue;
          if (k !== root && !k.startsWith(prefix)) continue;
          if (isIgnored(k, ignore)) continue;
          if (filePatRe && !filePatRe.test(path.posix.basename(k))) continue;
          const lines = (v.content || '').split('\n');
          const matches = [];
          lines.forEach((line, idx) => {
            const m = regex.exec(line);
            if (m) {
              matches.push({
                line_number: idx + 1,
                line,
                column: m.index + 1,
              });
            }
          });
          if (matches.length > 0) {
            results.push({ path: k, matches });
          }
        }
        return results;
      }
      case 'read_file_range': {
        const req = args.request || args;
        const p = normalizePosixPath(req.path);
        const entry = this._vfs.get(p);
        if (!entry || entry.is_dir) throw new Error(`File not found: ${p}`);
        const allLines = (entry.content || '').split('\n');
        const start = Math.max(1, Number(req.start_line || 1));
        const end = Math.min(allLines.length, Number(req.end_line || allLines.length));
        const lines = allLines.slice(start - 1, end);
        return {
          path: p,
          lines,
          start_line: start,
          end_line: end,
        };
      }
      case 'watch_path': {
        const p = normalizePosixPath(args.path);
        this._watchedPaths.add(p);
        return null;
      }
      case 'unwatch_path': {
        const p = normalizePosixPath(args.path);
        this._watchedPaths.delete(p);
        return null;
      }

      // --- Terminal (5) ---
      case 'spawn_terminal': {
        const req = args.request || {};
        const id = this._nextId('term');
        const now = nowIso();
        const term = {
          id,
          pid: 10000 + this._seq,
          shell: req.shell || this._config.terminal.shell || '/bin/bash',
          args: req.args ? [...req.args] : [...(this._config.terminal.args || [])],
          cwd: req.cwd ?? this._config.terminal.cwd ?? '/workspace',
          cols: req.cols ?? this._config.terminal.cols ?? 120,
          rows: req.rows ?? this._config.terminal.rows ?? 30,
          status: 'running',
          created_at: now,
          last_activity: now,
        };
        this._terminals.set(id, term);
        this._terminalInputs.set(id, []);
        await this.emitEvent('terminal-status', {
          terminal_id: id,
          status: 'running',
        });
        return clone(term);
      }
      case 'write_terminal': {
        const req = args.request || args;
        const term = this._terminals.get(req.terminal_id);
        if (!term) throw new Error(`Terminal not found: ${req.terminal_id}`);
        term.last_activity = nowIso();
        const history = this._terminalInputs.get(term.id) || [];
        history.push(req.data);
        this._terminalInputs.set(term.id, history);
        if (req.data) {
          await this.emitEvent('terminal-output', {
            terminal_id: term.id,
            data: req.data,
          });
        }
        return null;
      }
      case 'resize_terminal': {
        const req = args.request || args;
        const term = this._terminals.get(req.terminal_id);
        if (!term) throw new Error(`Terminal not found: ${req.terminal_id}`);
        term.cols = req.cols;
        term.rows = req.rows;
        term.last_activity = nowIso();
        return null;
      }
      case 'kill_terminal': {
        const term = this._terminals.get(args.terminal_id);
        if (!term) throw new Error(`Terminal not found: ${args.terminal_id}`);
        term.status = 'closed';
        term.last_activity = nowIso();
        await this.emitEvent('terminal-status', {
          terminal_id: term.id,
          status: 'closed',
        });
        this._terminals.delete(args.terminal_id);
        return null;
      }
      case 'list_terminals': {
        return clone([...this._terminals.values()]);
      }

      // --- LLM (8) ---
      case 'list_providers': {
        return clone(this._providers);
      }
      case 'add_provider': {
        const cfg = clone(args.config);
        const provider = {
          id: cfg.id || this._nextId('provider'),
          name: cfg.name || cfg.id || 'Custom Provider',
          provider_type: cfg.provider_type || 'custom',
          base_url: cfg.base_url,
          api_key: cfg.api_key ?? null,
          models: (cfg.models || []).map((m) =>
            typeof m === 'string' ? formatModelInfo({ id: m }) : formatModelInfo(m)
          ),
          enabled: cfg.enabled ?? true,
          headers: cfg.headers ? { ...cfg.headers } : {},
          status: 'unknown',
          last_checked: null,
        };
        const idx = this._providers.findIndex((p) => p.id === provider.id);
        if (idx >= 0) {
          this._providers[idx] = provider;
        } else {
          this._providers.push(provider);
        }
        const cfgIdx = this._config.llm.providers.findIndex((p) => p.id === provider.id);
        const providerCfg = {
          id: provider.id,
          name: provider.name,
          provider_type: provider.provider_type,
          base_url: provider.base_url,
          api_key: provider.api_key,
          models: provider.models.map((m) => m.id),
          enabled: provider.enabled,
          headers: cfg.headers ?? null,
        };
        if (cfgIdx >= 0) {
          this._config.llm.providers[cfgIdx] = providerCfg;
        } else {
          this._config.llm.providers.push(providerCfg);
        }
        return clone(provider);
      }
      case 'remove_provider': {
        this._providers = this._providers.filter((p) => p.id !== args.id);
        this._config.llm.providers = this._config.llm.providers.filter(
          (p) => p.id !== args.id
        );
        if (this._config.llm.active_provider === args.id) {
          this._config.llm.active_provider = this._providers[0]?.id || null;
        }
        return null;
      }
      case 'set_active_provider': {
        const exists = this._providers.some((p) => p.id === args.id);
        if (!exists) throw new Error(`Provider not found: ${args.id}`);
        this._config.llm.active_provider = args.id;
        return null;
      }
      case 'list_models': {
        const pid = args.provider_id || this._config.llm.active_provider || 'strata';
        const provider = this._providers.find((p) => p.id === pid);
        if (!provider) return [];
        return clone(provider.models || []);
      }
      case 'refresh_provider_models': {
        const provider = this._providers.find((p) => p.id === args.provider_id);
        if (!provider) throw new Error(`Provider not found: ${args.provider_id}`);
        const targetBase = this._resolveProviderTargetUrl(provider);
        if (!targetBase) {
          provider.status = { error: 'Missing provider base_url' };
          provider.last_checked = nowIso();
          return [];
        }
        if (!isLoopbackUrl(targetBase)) {
          provider.status = {
            error: `Offline E2E harness blocked non-loopback provider URL: ${targetBase}`,
          };
          provider.last_checked = nowIso();
          return [];
        }
        try {
          const headers = { ...(provider.headers || {}) };
          if (provider.api_key) {
            headers.Authorization = `Bearer ${provider.api_key}`;
          }
          const resp = await fetch(`${targetBase}/models`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(5000),
          });
          if (!resp.ok) {
            provider.status = { error: `HTTP ${resp.status}` };
            provider.last_checked = nowIso();
            return [];
          }
          const data = await resp.json();
          const models = (Array.isArray(data?.data) ? data.data : []).map(
            formatModelInfo
          );
          provider.models = models;
          provider.status = 'connected';
          provider.last_checked = nowIso();
          return clone(models);
        } catch (err) {
          provider.status = { error: String(err?.message || err) };
          provider.last_checked = nowIso();
          return [];
        }
      }
      case 'chat_completion': {
        const req = args.request || args;
        return this._executeChatCompletion(req, { stream: false });
      }
      case 'stream_chat_completion': {
        const req = args.request || args;
        await this._executeChatCompletion(req, { stream: true, emitLlmChunks: true });
        return null;
      }

      // --- MCP (7) ---
      case 'list_servers': {
        return clone([...this._servers.values()]);
      }
      case 'add_server': {
        const cfg = clone(args.config) || {};
        const id = cfg.id || this._nextId('mcp');
        cfg.id = id;
        const srv = {
          id,
          name: cfg.name || id || 'MCP Server',
          transport: cfg.transport,
          enabled: cfg.enabled ?? true,
          auto_start: cfg.auto_start ?? false,
          status: 'disconnected',
          tools: cfg.tools ? clone(cfg.tools) : [],
        };
        this._servers.set(srv.id, srv);
        const idx = this._config.mcp.servers.findIndex((s) => s.id === srv.id);
        if (idx >= 0) this._config.mcp.servers[idx] = cfg;
        else this._config.mcp.servers.push(cfg);
        return clone(srv);
      }
      case 'remove_server': {
        this._servers.delete(args.id);
        this._config.mcp.servers = this._config.mcp.servers.filter(
          (s) => s.id !== args.id
        );
        return null;
      }
      case 'connect_server': {
        const srv = this._servers.get(args.id);
        if (!srv) throw new Error(`MCP server not found: ${args.id}`);
        if (srv.transport?.type === 'sse' && srv.transport?.url?.includes('invalid')) {
          srv.status = { error: `Failed to connect to ${srv.transport.url}` };
          return clone(srv);
        }
        if (
          srv.transport?.type === 'stdio' &&
          (!srv.transport?.command || srv.transport.command === 'nonexistent-cmd')
        ) {
          srv.status = {
            error: `Failed to spawn MCP server: ${srv.transport?.command || 'missing command'}`,
          };
          return clone(srv);
        }
        srv.status = 'connected';
        if (!srv.tools || srv.tools.length === 0) {
          srv.tools = [
            {
              name: `${srv.id}_ping`,
              description: `Ping tool for ${srv.name}`,
              input_schema: { type: 'object', properties: {} },
              server_id: srv.id,
            },
          ];
        }
        return clone(srv);
      }
      case 'disconnect_server': {
        const srv = this._servers.get(args.id);
        if (!srv) throw new Error(`MCP server not found: ${args.id}`);
        srv.status = 'disconnected';
        return clone(srv);
      }
      case 'list_tools': {
        const tools = [];
        for (const srv of this._servers.values()) {
          if (args.server_id && srv.id !== args.server_id) continue;
          if (Array.isArray(srv.tools)) {
            tools.push(...srv.tools);
          }
        }
        return clone(tools);
      }
      case 'call_tool': {
        const req = args.request || args;
        const srv = this._servers.get(req.server_id);
        if (!srv) {
          return {
            success: false,
            result: null,
            error: `MCP server not found: ${req.server_id}`,
          };
        }
        if (srv.status !== 'connected') {
          return {
            success: false,
            result: null,
            error: `MCP server "${srv.id}" is not connected`,
          };
        }
        const tool = (srv.tools || []).find((t) => t.name === req.tool_name);
        if (!tool) {
          return {
            success: false,
            result: null,
            error: `Tool "${req.tool_name}" not found on server "${srv.id}"`,
          };
        }
        return {
          success: true,
          result: { ok: true, tool: req.tool_name, arguments: req.arguments ?? {} },
          error: null,
        };
      }

      // --- Agent (11) ---
      case 'list_conversations': {
        const list = [...this._conversations.values()];
        list.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        return clone(list);
      }
      case 'create_conversation': {
        if (args.conversation_id) {
          const existing = this._conversations.get(args.conversation_id);
          if (!existing) throw new Error(`Conversation not found: ${args.conversation_id}`);
          if (args.title) existing.title = args.title;
          if (args.system_prompt !== undefined && args.system_prompt !== null) {
            existing.system_prompt = args.system_prompt || null;
          }
          if (args.workspace_path !== undefined && args.workspace_path !== null) {
            existing.workspace_path = args.workspace_path || null;
          }
          if (args.project_id !== undefined && args.project_id !== null) {
            existing.project_id = args.project_id ? args.project_id : null;
          }
          if (args.worktree_mode) {
            existing.worktree_mode = args.worktree_mode;
          }
          existing.updated_at = nowIso();
          await this.emitEvent('agent-conversation-update', existing);
          return clone(existing);
        }
        const id = this._nextId('conv');
        const now = nowIso();
        const conv = {
          id,
          title: args.title || 'New Conversation',
          messages: [],
          created_at: now,
          updated_at: now,
          system_prompt: args.system_prompt ?? null,
          provider_id: this._config.llm.active_provider || 'strata',
          model: this._config.llm.default_model || 'coder-iq1_m',
          workspace_path: args.workspace_path ?? null,
          project_id: args.project_id ? args.project_id : null,
          worktree_mode: args.worktree_mode ?? 'local',
          worktree_paths: [],
        };
        this._conversations.set(id, conv);
        await this.emitEvent('agent-conversation-update', conv);
        return clone(conv);
      }
      case 'delete_conversation': {
        this._conversations.delete(args.conversation_id);
        this._artifacts.delete(args.conversation_id);
        return null;
      }
      case 'get_conversation': {
        const conv = this._conversations.get(args.conversation_id) || null;
        return clone(conv);
      }
      case 'send_message': {
        const req = args.request || args;
        const conv = this._conversations.get(req.conversation_id);
        if (!conv) throw new Error(`Conversation not found: ${req.conversation_id}`);
        const now = nowIso();
        conv.messages.push({
          id: this._nextId('msg'),
          role: 'user',
          content: req.content,
          created_at: now,
        });
        if (req.provider_id) conv.provider_id = req.provider_id;
        if (req.model) conv.model = req.model;
        if (req.workspace_path) conv.workspace_path = req.workspace_path;
        if (req.project_id !== undefined && req.project_id !== null) {
          conv.project_id = req.project_id ? req.project_id : null;
        }
        if (req.worktree_mode) conv.worktree_mode = req.worktree_mode;
        conv.updated_at = now;
        await this.emitEvent('agent-conversation-update', conv);
        return clone(conv);
      }
      case 'start_agent_task': {
        const req = args.request || args;
        const now = nowIso();
        let conv = req.conversation_id
          ? this._conversations.get(req.conversation_id)
          : null;
        if (!conv) {
          const id = req.conversation_id || this._nextId('conv');
          conv = {
            id,
            title: String(req.prompt || 'New Conversation').slice(0, 48),
            messages: [],
            created_at: now,
            updated_at: now,
            system_prompt: req.system_prompt ?? null,
            provider_id:
              req.provider_id || this._config.llm.active_provider || 'strata',
            model: req.model || this._config.llm.default_model || 'coder-iq1_m',
            workspace_path: req.workspace_path ?? null,
            project_id: req.project_id ? req.project_id : null,
            worktree_mode: req.worktree_mode ?? 'local',
            worktree_paths: [],
          };
          this._conversations.set(id, conv);
        }

        // Synchronous user-message insertion
        conv.messages.push({
          id: this._nextId('msg'),
          role: 'user',
          content: req.prompt,
          created_at: now,
        });
        conv.updated_at = now;
        if (req.provider_id) conv.provider_id = req.provider_id;
        if (req.model) conv.model = req.model;
        if (req.workspace_path) conv.workspace_path = req.workspace_path;
        if (req.project_id !== undefined && req.project_id !== null) {
          conv.project_id = req.project_id ? req.project_id : null;
        }
        if (req.worktree_mode) conv.worktree_mode = req.worktree_mode;

        const taskId = this._nextId('task');
        const task = {
          id: taskId,
          conversation_id: conv.id,
          prompt: req.prompt,
          status: 'running',
          created_at: now,
          updated_at: now,
          iterations: 1,
          max_iterations: this._config.agent.max_iterations ?? 50,
          result: null,
          error: null,
        };
        this._tasks.set(taskId, task);

        await this.emitEvent('agent-conversation-update', conv);
        await this.emitEvent('agent-task-update', task);

        // Drive background completion asynchronously
        queueMicrotask(() => {
          this._runAgentTaskLoop(task, conv, req).catch(() => {});
        });

        return clone(task);
      }
      case 'cancel_agent_task': {
        const task = this._tasks.get(args.task_id);
        if (!task) throw new Error(`Task not found: ${args.task_id}`);
        task.status = 'cancelled';
        task.updated_at = nowIso();
        await this.emitEvent('agent-task-update', task);
        return clone(task);
      }
      case 'get_agent_status': {
        return clone(this._tasks.get(args.task_id) || null);
      }
      case 'answer_question': {
        this._pendingQuestions.delete(args.question_id);
        this._questionAnswers.set(args.question_id, clone(args.answers));
        return null;
      }
      case 'approve_command': {
        this._pendingApprovals.delete(args.approval_id);
        this._approvalDecisions.set(args.approval_id, Boolean(args.approved));
        return null;
      }
      case 'list_artifacts': {
        return clone(this._artifacts.get(args.conversation_id) || []);
      }

      // --- Skills (5) ---
      case 'list_skills': {
        let list = [...this._skills.values()];
        if (args.source) {
          list = list.filter((s) => s.source === args.source);
        }
        if (args.skill_type) {
          list = list.filter((s) => s.skill_type === args.skill_type);
        }
        return clone(list);
      }
      case 'load_skill': {
        const skill = this._skills.get(args.id);
        if (!skill) throw new Error(`Skill not found: ${args.id}`);
        skill.loaded = true;
        if (!skill.schema) {
          skill.schema = {
            markdown: `# ${skill.name}\n\n${skill.description}\n`,
          };
        }
        return clone(skill);
      }
      case 'unload_skill': {
        const skill = this._skills.get(args.id);
        if (!skill) throw new Error(`Skill not found: ${args.id}`);
        skill.loaded = false;
        skill.schema = null;
        return null;
      }
      case 'reload_skills': {
        return clone([...this._skills.values()]);
      }
      case 'get_skill_schema': {
        const skill = this._skills.get(args.id);
        if (!skill) return null;
        return {
          name: skill.name,
          description: skill.description,
          parameters: { type: 'object', properties: {} },
          returns: null,
        };
      }

      // --- Config (3) ---
      case 'get_config': {
        return clone(this._config);
      }
      case 'set_config': {
        this._config = clone(args.config);
        if (Array.isArray(this._config?.llm?.providers)) {
          const prevStatus = new Map(
            this._providers.map((p) => [p.id, { status: p.status, models: p.models, last_checked: p.last_checked }])
          );
          this._providers = this._config.llm.providers.map((p) => {
            const prev = prevStatus.get(p.id);
            return {
              id: p.id,
              name: p.name,
              provider_type: p.provider_type || 'custom',
              base_url: p.base_url,
              api_key: p.api_key ?? null,
              models: prev?.models?.length
                ? prev.models
                : (p.models || []).map((m) =>
                    typeof m === 'string' ? formatModelInfo({ id: m }) : formatModelInfo(m)
                  ),
              enabled: p.enabled ?? true,
              headers: p.headers ? { ...p.headers } : {},
              status: prev?.status || 'unknown',
              last_checked: prev?.last_checked || null,
            };
          });
        }
        return null;
      }
      case 'reset_config': {
        this._config = makeDefaultConfig();
        this._providers = makeDefaultProvidersFromConfig(this._config);
        return null;
      }

      // --- Window (5) ---
      case 'create_window': {
        const label = args.label || this._nextId('win');
        if (!this._windows.includes(label)) {
          this._windows.push(label);
        }
        return null;
      }
      case 'close_window': {
        if (args.label && args.label !== 'main') {
          this._windows = this._windows.filter((w) => w !== args.label);
        }
        return null;
      }
      case 'minimize_window': {
        this._windowState.minimized = true;
        return null;
      }
      case 'maximize_window': {
        this._windowState.maximized = !this._windowState.maximized;
        return null;
      }
      case 'list_windows': {
        return [...this._windows];
      }

      default:
        throw new Error(`Unknown Tauri command: ${cmd}`);
    }
  }

  _isWatched(p) {
    for (const w of this._watchedPaths) {
      if (p === w || p.startsWith(w === '/' ? '/' : `${w}/`)) return true;
    }
    return false;
  }

  async _executeChatCompletion(req, { stream = false, emitLlmChunks = false } = {}) {
    const providerId = this._config.llm.active_provider || 'strata';
    const provider =
      this._providers.find((p) => p.id === providerId) || this._providers[0];
    const targetBase = provider ? this._resolveProviderTargetUrl(provider) : null;

    if (!targetBase) {
      return {
        id: this._nextId('chatcmpl'),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: req.model || 'coder-iq1_m',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Mock offline response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
      };
    }

    if (!isLoopbackUrl(targetBase)) {
      const msg = `Offline E2E harness blocked non-loopback provider URL: ${targetBase}`;
      if (provider) {
        provider.status = { error: msg };
        provider.last_checked = nowIso();
      }
      throw new Error(msg);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...(provider?.headers || {}),
    };
    if (provider?.api_key) {
      headers.Authorization = `Bearer ${provider.api_key}`;
    }

    const payload = {
      ...req,
      model: req.model || this._config.llm.default_model || 'coder-iq1_m',
      stream,
    };

    const resp = await fetch(`${targetBase}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`LLM HTTP ${resp.status}: ${errBody || resp.statusText}`);
    }

    if (!stream) {
      return resp.json();
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() || '';
      for (const part of parts) {
        for (const line of part.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const dataStr = trimmed.slice(5).trim();
          if (dataStr === '[DONE]') continue;
          try {
            const chunk = JSON.parse(dataStr);
            chunks.push(chunk);
            if (emitLlmChunks) {
              await this.emitEvent('llm-stream-chunk', chunk);
            }
          } catch {
            // skip invalid SSE line
          }
        }
      }
    }
    return chunks;
  }

  async _runAgentTaskLoop(task, conv, req) {
    if (task.status === 'cancelled') return;

    const providerId =
      req.provider_id ||
      conv.provider_id ||
      this._config.llm.active_provider ||
      'strata';
    const provider =
      this._providers.find((p) => p.id === providerId) || this._providers[0];
    const targetBase = provider ? this._resolveProviderTargetUrl(provider) : null;
    const msgId = this._nextId('msg');

    if (!targetBase) {
      const reply = `Mock assistant response to: ${req.prompt}`;
      await this.emitEvent('agent-stream-delta', {
        conversation_id: conv.id,
        message_id: msgId,
        content_delta: reply,
        reasoning_delta: '',
      });
      conv.messages.push({
        id: msgId,
        role: 'assistant',
        content: reply,
        created_at: nowIso(),
      });
      conv.updated_at = nowIso();
      task.status = 'completed';
      task.result = reply;
      task.updated_at = nowIso();
      await this.emitEvent('agent-conversation-update', conv);
      await this.emitEvent('agent-task-update', task);
      return;
    }

    try {
      if (!isLoopbackUrl(targetBase)) {
        throw new Error(
          `Offline E2E harness blocked non-loopback provider URL: ${targetBase}`
        );
      }

      const headers = {
        'Content-Type': 'application/json',
        ...(provider?.headers || {}),
      };
      if (provider?.api_key) {
        headers.Authorization = `Bearer ${provider.api_key}`;
      }

      const useStream = this._config.agent.enable_streaming !== false;
      const messages = conv.messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      if (conv.system_prompt || this._config.agent.system_prompt) {
        messages.unshift({
          role: 'system',
          content: conv.system_prompt || this._config.agent.system_prompt,
        });
      }

      const resp = await fetch(`${targetBase}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: req.model || conv.model || 'coder-iq1_m',
          messages,
          temperature: this._config.llm.temperature ?? 0.7,
          max_tokens: this._config.llm.max_tokens ?? 4096,
          stream: useStream,
        }),
      });

      if (task.status === 'cancelled') return;

      if (!resp.ok) {
        const errText = await resp.text().catch(() => resp.statusText);
        if (provider) {
          provider.status = { error: `HTTP ${resp.status}` };
          provider.last_checked = nowIso();
        }
        task.status = 'failed';
        task.error = `HTTP ${resp.status}: ${errText}`;
        task.updated_at = nowIso();
        await this.emitEvent('agent-task-update', task);
        return;
      }

      if (provider) {
        provider.status = 'connected';
        provider.last_checked = nowIso();
      }

      let fullContent = '';
      let fullReasoning = '';
      const toolCallsByIdx = new Map();

      if (!useStream) {
        const json = await resp.json();
        const choice = json?.choices?.[0];
        fullContent = choice?.message?.content || '';
        fullReasoning = choice?.message?.reasoning_content || '';
        if (Array.isArray(choice?.message?.tool_calls)) {
          choice.message.tool_calls.forEach((tc, i) => toolCallsByIdx.set(i, tc));
        }
      } else {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        while (true) {
          if (task.status === 'cancelled') {
            await reader.cancel().catch(() => {});
            return;
          }
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() || '';
          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.slice(5).trim();
              if (dataStr === '[DONE]') continue;
              let chunk;
              try {
                chunk = JSON.parse(dataStr);
              } catch {
                continue;
              }
              const delta = chunk?.choices?.[0]?.delta;
              if (!delta) continue;
              const contentDelta = delta.content || '';
              const reasoningDelta = delta.reasoning_content || '';
              if (contentDelta || reasoningDelta) {
                fullContent += contentDelta;
                fullReasoning += reasoningDelta;
                await this.emitEvent('agent-stream-delta', {
                  conversation_id: conv.id,
                  message_id: msgId,
                  content_delta: contentDelta,
                  reasoning_delta: reasoningDelta,
                });
              }
              if (Array.isArray(delta.tool_calls)) {
                for (const td of delta.tool_calls) {
                  const idx = td.index ?? 0;
                  const cur = toolCallsByIdx.get(idx) || {
                    id: td.id || `call_${idx}`,
                    type: td.type || 'function',
                    function: { name: '', arguments: '' },
                  };
                  if (td.id) cur.id = td.id;
                  if (td.function?.name) cur.function.name += td.function.name;
                  if (td.function?.arguments) {
                    cur.function.arguments += td.function.arguments;
                  }
                  toolCallsByIdx.set(idx, cur);
                }
              }
            }
          }
        }
      }

      if (task.status === 'cancelled') return;

      const assistantMsg = {
        id: msgId,
        role: 'assistant',
        content: fullContent,
        created_at: nowIso(),
      };
      if (fullReasoning) assistantMsg.reasoning_content = fullReasoning;
      if (toolCallsByIdx.size > 0) {
        assistantMsg.tool_calls = [...toolCallsByIdx.values()];
      }
      conv.messages.push(assistantMsg);
      conv.updated_at = nowIso();
      task.status = 'completed';
      task.result = fullContent;
      task.updated_at = nowIso();

      await this.emitEvent('agent-conversation-update', conv);
      await this.emitEvent('agent-task-update', task);
    } catch (err) {
      if (task.status === 'cancelled') return;
      if (provider) {
        provider.status = { error: String(err?.message || err) };
        provider.last_checked = nowIso();
      }
      task.status = 'failed';
      task.error = String(err?.message || err);
      task.updated_at = nowIso();
      await this.emitEvent('agent-task-update', task);
    }
  }

  async attachToPage(page) {
    this._page = page;
    await page.addBinding('__e2eTauriHostCall', async (payloadStr) => {
      let msg;
      try {
        msg = JSON.parse(payloadStr);
      } catch (err) {
        return;
      }
      const { id, cmd, args, options } = msg;
      if (id === null || id === undefined) {
        // Notification-only call (e.g. plugin:event|listen already resolved in-page)
        try {
          this._recordAndNotify(cmd, args);
        } catch {
          // ignore
        }
        return;
      }

      try {
        const result = await this.invoke(cmd, args, options);
        await page
          .evaluate(
            (callId, val) => {
              window.__e2eBridgeResolve?.(callId, true, val);
            },
            id,
            result === undefined ? null : result
          )
          .catch(() => {});
      } catch (err) {
        await page
          .evaluate(
            (callId, message) => {
              window.__e2eBridgeResolve?.(callId, false, message);
            },
            id,
            String(err?.message || err)
          )
          .catch(() => {});
      }
    });
  }
}

export function createTauriBridge(options = {}) {
  const backend = new MockTauriBackend(options);
  return {
    backend,
    getInitScript(initialState) {
      return getInitScript(initialState ?? options.initialState ?? {});
    },
    attachToPage(page) {
      return backend.attachToPage(page);
    },
    getInvocations() {
      return backend.getInvocations();
    },
    clearInvocations() {
      return backend.clearInvocations();
    },
    getEmittedEvents() {
      return backend.getEmittedEvents();
    },
    getState() {
      return backend.getState();
    },
    setState(patch) {
      return backend.setState(patch);
    },
    emitEvent(name, payload) {
      return backend.emitEvent(name, payload);
    },
    sendChannelMessage(channelRef, index, message) {
      return backend.sendChannelMessage(channelRef, index, message);
    },
    endChannel(channelRef, index) {
      return backend.endChannel(channelRef, index);
    },
    waitForInvocation(cmd, predicateOrTimeoutMs, timeoutMs) {
      return backend.waitForInvocation(cmd, predicateOrTimeoutMs, timeoutMs);
    },
    invoke(cmd, args, options) {
      return backend.invoke(cmd, args, options);
    },
  };
}
