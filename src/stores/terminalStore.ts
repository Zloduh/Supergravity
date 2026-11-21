import { create } from 'zustand';
import {
  formatTerminalStatus,
  getTerminalExitCode,
  isTerminalAlive,
  type Terminal,
  type TerminalStatus,
} from '../types/terminal';
import * as terminalIpc from '../ipc/terminal';
import { formatTauriError, isTauri, type UnlistenFn } from '../utils/tauri';

export type { Terminal, TerminalStatus };
export { formatTerminalStatus, getTerminalExitCode, isTerminalAlive };

const MAX_OUTPUT_CHARS = 500_000;

interface TerminalState {
  terminals: Terminal[];
  activeTerminalId: string | null;
  output: Map<string, string>;
  loading: boolean;
  error: string | null;
  initListeners: () => Promise<() => void>;
  fetchTerminals: () => Promise<void>;
  spawnTerminal: (
    shell?: string,
    cwd?: string,
    cols?: number,
    rows?: number
  ) => Promise<Terminal | null>;
  writeToTerminal: (terminalId: string, data: string) => Promise<void>;
  resizeTerminal: (terminalId: string, cols: number, rows: number) => Promise<void>;
  killTerminal: (terminalId: string) => Promise<void>;
  setActiveTerminal: (terminalId: string | null) => void;
  appendOutput: (terminalId: string, data: string) => void;
  clearOutput: (terminalId: string) => void;
  clearError: () => void;
  subscribeOutput: (terminalId: string, cb: (chunk: string) => void) => () => void;
  subscribeClear: (terminalId: string, cb: () => void) => () => void;
}

const outputSubscribers = new Map<string, Set<(chunk: string) => void>>();
const clearSubscribers = new Map<string, Set<() => void>>();

let listenerRefCount = 0;
let activeUnlistens: UnlistenFn[] = [];
let listenerInitPromise: Promise<void> | null = null;
let demoTerminalSeq = 0;

function notifyOutputSubscribers(terminalId: string, data: string) {
  const subs = outputSubscribers.get(terminalId);
  if (!subs) return;
  for (const cb of subs) {
    try {
      cb(data);
    } catch {
      // ignore subscriber callback error
    }
  }
}

function notifyClearSubscribers(terminalId: string) {
  const subs = clearSubscribers.get(terminalId);
  if (!subs) return;
  for (const cb of subs) {
    try {
      cb();
    } catch {
      // ignore subscriber callback error
    }
  }
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: [],
  activeTerminalId: null,
  output: new Map(),
  loading: false,
  error: null,

  initListeners: async () => {
    if (!isTauri()) {
      return () => {};
    }

    listenerRefCount += 1;

    if (listenerRefCount === 1 && !listenerInitPromise) {
      listenerInitPromise = (async () => {
        const registered: UnlistenFn[] = [];
        try {
          const [unOutput, unStatus] = await Promise.all([
            terminalIpc
              .onTerminalOutput((payload) => {
                get().appendOutput(payload.terminal_id, payload.data);
              })
              .then((u) => {
                registered.push(u);
                return u;
              }),
            terminalIpc
              .onTerminalStatus((payload) => {
                const now = new Date().toISOString();
                set((state) => ({
                  terminals: state.terminals.map((t) =>
                    t.id === payload.terminal_id
                      ? { ...t, status: payload.status, last_activity: now }
                      : t
                  ),
                }));
              })
              .then((u) => {
                registered.push(u);
                return u;
              }),
          ]);
          activeUnlistens = [unOutput, unStatus];
        } catch (err) {
          for (const fn of registered) {
            try {
              fn();
            } catch {
              // ignore cleanup failure
            }
          }
          activeUnlistens = [];
          throw err;
        }
      })().finally(() => {
        listenerInitPromise = null;
      });
    }

    if (listenerInitPromise) {
      try {
        await listenerInitPromise;
      } catch (err) {
        listenerRefCount = Math.max(0, listenerRefCount - 1);
        throw err;
      }
    }

    let cleaned = false;
    return () => {
      if (cleaned) return;
      cleaned = true;
      listenerRefCount = Math.max(0, listenerRefCount - 1);
      if (listenerRefCount === 0) {
        const fns = activeUnlistens;
        activeUnlistens = [];
        for (const fn of fns) {
          try {
            fn();
          } catch {
            // ignore unlisten failure
          }
        }
      }
    };
  },

  fetchTerminals: async () => {
    if (!isTauri()) return;
    set({ loading: true, error: null });
    try {
      const terminals = await terminalIpc.listTerminals();
      set((state) => ({
        terminals,
        activeTerminalId:
          state.activeTerminalId && terminals.some((t) => t.id === state.activeTerminalId)
            ? state.activeTerminalId
            : terminals[0]?.id ?? null,
        loading: false,
      }));
    } catch (error) {
      set({ error: formatTauriError(error), loading: false });
    }
  },

  spawnTerminal: async (shell, cwd, cols, rows) => {
    if (!isTauri()) {
      const now = new Date().toISOString();
      const id = `demo-term-${Date.now()}-${++demoTerminalSeq}`;
      const terminal: Terminal = {
        id,
        pid: null,
        shell: shell || '/bin/bash',
        args: [],
        cwd: cwd || '.',
        cols: cols ?? 80,
        rows: rows ?? 24,
        status: 'running',
        created_at: now,
        last_activity: now,
      };
      set((state) => ({
        terminals: [...state.terminals, terminal],
        activeTerminalId: id,
        loading: false,
        error: null,
      }));
      get().appendOutput(
        id,
        '\x1b[36mAntigravity Demo Terminal\x1b[0m (browser preview — run Tauri desktop for live PTY)\r\n$ '
      );
      return terminal;
    }

    set({ loading: true, error: null });
    try {
      const terminal = await terminalIpc.spawnTerminal({
        shell: shell || null,
        cwd: cwd || null,
        cols: cols ?? null,
        rows: rows ?? null,
      });
      set((state) => {
        const exists = state.terminals.some((t) => t.id === terminal.id);
        return {
          terminals: exists
            ? state.terminals.map((t) => (t.id === terminal.id ? terminal : t))
            : [...state.terminals, terminal],
          activeTerminalId: terminal.id,
          loading: false,
        };
      });
      return terminal;
    } catch (error) {
      set({ error: formatTauriError(error), loading: false });
      return null;
    }
  },

  writeToTerminal: async (terminalId, data) => {
    if (!isTauri()) {
      if (data === '\r' || data === '\n') {
        get().appendOutput(terminalId, '\r\n$ ');
      } else if (data === '\x7f' || data === '\b') {
        get().appendOutput(terminalId, '\b \b');
      } else {
        get().appendOutput(terminalId, data);
      }
      return;
    }

    try {
      await terminalIpc.writeTerminal({ terminal_id: terminalId, data });
    } catch (error) {
      set({ error: formatTauriError(error) });
    }
  },

  resizeTerminal: async (terminalId, cols, rows) => {
    if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols < 1 || rows < 1) {
      return;
    }
    const normCols = Math.floor(cols);
    const normRows = Math.floor(rows);
    set((state) => ({
      terminals: state.terminals.map((t) =>
        t.id === terminalId ? { ...t, cols: normCols, rows: normRows } : t
      ),
    }));
    if (!isTauri()) return;
    try {
      await terminalIpc.resizeTerminal({
        terminal_id: terminalId,
        cols: normCols,
        rows: normRows,
      });
    } catch (error) {
      set({ error: formatTauriError(error) });
    }
  },

  killTerminal: async (terminalId) => {
    if (isTauri()) {
      try {
        await terminalIpc.killTerminal(terminalId);
      } catch (error) {
        set({ error: formatTauriError(error) });
        return;
      }
    }
    set((state) => {
      const remaining = state.terminals.filter((t) => t.id !== terminalId);
      const nextOutput = new Map(state.output);
      nextOutput.delete(terminalId);
      return {
        terminals: remaining,
        activeTerminalId:
          state.activeTerminalId === terminalId
            ? remaining[0]?.id ?? null
            : state.activeTerminalId,
        output: nextOutput,
      };
    });
  },

  setActiveTerminal: (terminalId) => set({ activeTerminalId: terminalId }),

  appendOutput: (terminalId, data) => {
    if (!data) return;
    set((state) => {
      const newOutput = new Map(state.output);
      const combined = (newOutput.get(terminalId) || '') + data;
      const bounded =
        combined.length > MAX_OUTPUT_CHARS
          ? combined.slice(combined.length - MAX_OUTPUT_CHARS)
          : combined;
      newOutput.set(terminalId, bounded);
      return { output: newOutput };
    });
    notifyOutputSubscribers(terminalId, data);
  },

  clearOutput: (terminalId) => {
    set((state) => {
      const newOutput = new Map(state.output);
      newOutput.set(terminalId, '');
      return { output: newOutput };
    });
    notifyClearSubscribers(terminalId);
  },

  clearError: () => set({ error: null }),

  subscribeOutput: (terminalId, cb) => {
    let subs = outputSubscribers.get(terminalId);
    if (!subs) {
      subs = new Set();
      outputSubscribers.set(terminalId, subs);
    }
    subs.add(cb);
    return () => {
      const current = outputSubscribers.get(terminalId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) {
        outputSubscribers.delete(terminalId);
      }
    };
  },

  subscribeClear: (terminalId, cb) => {
    let subs = clearSubscribers.get(terminalId);
    if (!subs) {
      subs = new Set();
      clearSubscribers.set(terminalId, subs);
    }
    subs.add(cb);
    return () => {
      const current = clearSubscribers.get(terminalId);
      if (!current) return;
      current.delete(cb);
      if (current.size === 0) {
        clearSubscribers.delete(terminalId);
      }
    };
  },
}));
