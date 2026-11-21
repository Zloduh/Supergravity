export interface RecordedInvocation {
  cmd: string;
  args: Record<string, unknown> | undefined;
}

type InvokeHandler = (args: Record<string, unknown> | undefined) => unknown | Promise<unknown>;

export interface MockDocumentRoot {
  classes: Set<string>;
  classList: {
    toggle: (token: string, force?: boolean) => boolean;
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    contains: (token: string) => boolean;
  };
  dataset: Record<string, string>;
  style: Record<string, string>;
}

export interface MockTauriEnv {
  invocations: RecordedInvocation[];
  handlers: Map<string, InvokeHandler>;
  documentRoot: MockDocumentRoot;
  setHandler: (cmd: string, handler: InvokeHandler) => void;
  setReject: (cmd: string, message: string) => void;
  emitEvent: (eventName: string, payload: unknown) => void;
  listenerCount: (eventName?: string) => number;
  setPrefersDark: (prefersDark: boolean) => void;
  uninstallTauri: () => void;
  installTauri: () => void;
  reset: () => void;
}

export function createMockTauriEnv(): MockTauriEnv {
  const invocations: RecordedInvocation[] = [];
  const handlers = new Map<string, InvokeHandler>();
  const callbacks = new Map<number, (data: unknown) => void>();
  const eventListeners = new Map<string, Map<number, number>>();
  const mediaListeners = new Set<() => void>();
  let nextCallbackId = 1;
  let nextEventId = 100;
  let prefersDark = true;

  const classes = new Set<string>();
  const documentRoot: MockDocumentRoot = {
    classes,
    classList: {
      toggle(token: string, force?: boolean) {
        if (force === undefined) {
          if (classes.has(token)) {
            classes.delete(token);
            return false;
          }
          classes.add(token);
          return true;
        }
        if (force) {
          classes.add(token);
          return true;
        }
        classes.delete(token);
        return false;
      },
      add(...tokens: string[]) {
        for (const t of tokens) classes.add(t);
      },
      remove(...tokens: string[]) {
        for (const t of tokens) classes.delete(t);
      },
      contains(token: string) {
        return classes.has(token);
      },
    },
    dataset: {},
    style: {},
  };

  const tauriInternals = {
    transformCallback(callback: (data: unknown) => void) {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    async invoke(cmd: string, args?: Record<string, unknown>) {
      if (cmd === 'plugin:event|listen') {
        const event = String(args?.event || '');
        const handlerId = Number(args?.handler);
        const eventId = nextEventId++;
        let map = eventListeners.get(event);
        if (!map) {
          map = new Map();
          eventListeners.set(event, map);
        }
        map.set(eventId, handlerId);
        return eventId;
      }

      if (cmd === 'plugin:event|unlisten') {
        const event = String(args?.event || '');
        const eventId = Number(args?.eventId);
        const map = eventListeners.get(event);
        if (map) {
          const handlerId = map.get(eventId);
          map.delete(eventId);
          if (handlerId !== undefined) {
            callbacks.delete(handlerId);
          }
        }
        return null;
      }

      invocations.push({ cmd, args });
      const handler = handlers.get(cmd);
      if (handler) {
        return await handler(args);
      }
      throw new Error(`No mock handler registered for Tauri command: ${cmd}`);
    },
  };

  const eventPluginInternals = {
    unregisterListener(event: string, eventId: number) {
      const map = eventListeners.get(event);
      if (map) {
        map.delete(eventId);
      }
    },
  };

  const mockWindow: Record<string, unknown> = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia(query: string) {
      return {
        media: query,
        get matches() {
          return query.includes('dark') ? prefersDark : !prefersDark;
        },
        addEventListener(_type: string, cb: () => void) {
          mediaListeners.add(cb);
        },
        removeEventListener(_type: string, cb: () => void) {
          mediaListeners.delete(cb);
        },
      };
    },
  };

  function installTauri() {
    mockWindow.__TAURI_INTERNALS__ = tauriInternals;
    mockWindow.__TAURI_EVENT_PLUGIN_INTERNALS__ = eventPluginInternals;
  }

  function uninstallTauri() {
    delete mockWindow.__TAURI_INTERNALS__;
    delete mockWindow.__TAURI_EVENT_PLUGIN_INTERNALS__;
  }

  installTauri();
  (globalThis as unknown as Record<string, unknown>).window = mockWindow;
  (globalThis as unknown as Record<string, unknown>).document = {
    compatMode: 'CSS1Compat',
    documentElement: documentRoot,
    getElementById: () => null,
  };

  return {
    invocations,
    handlers,
    documentRoot,
    setHandler(cmd, handler) {
      handlers.set(cmd, handler);
    },
    setReject(cmd, message) {
      handlers.set(cmd, () => {
        throw new Error(message);
      });
    },
    emitEvent(eventName, payload) {
      const map = eventListeners.get(eventName);
      if (!map) return;
      for (const [eventId, handlerId] of map.entries()) {
        const cb = callbacks.get(handlerId);
        if (cb) {
          cb({ event: eventName, id: eventId, payload });
        }
      }
    },
    listenerCount(eventName?: string) {
      if (eventName) {
        return eventListeners.get(eventName)?.size ?? 0;
      }
      let total = 0;
      for (const map of eventListeners.values()) {
        total += map.size;
      }
      return total;
    },
    setPrefersDark(val: boolean) {
      prefersDark = val;
      for (const cb of mediaListeners) {
        cb();
      }
    },
    uninstallTauri,
    installTauri,
    reset() {
      invocations.length = 0;
      handlers.clear();
      callbacks.clear();
      eventListeners.clear();
      installTauri();
    },
  };
}
