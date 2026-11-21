import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useTerminalStore,
  formatTerminalStatus,
  isTerminalAlive,
} from '../stores/terminalStore';
import { useAppStore } from '../stores/appStore';
import {
  Terminal as TerminalIcon,
  Plus,
  Trash2,
  Ban,
  ChevronDown,
  ChevronUp,
  X,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../utils/cn';
import 'xterm/css/xterm.css';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

interface XTermInstance {
  term: {
    write: (data: string) => void;
    clear: () => void;
    focus: () => void;
    dispose: () => void;
    cols: number;
    rows: number;
  };
  fitAddon: {
    fit: () => void;
    proposeDimensions: () => { cols: number; rows: number } | undefined;
  };
  dispose: () => void;
}

const DEFAULT_HEIGHT = 260;
const EXPANDED_HEIGHT = 440;
const MIN_HEIGHT = 140;

function TerminalTabDot({
  status,
}: {
  status: ReturnType<typeof formatTerminalStatus>;
}) {
  const dotClass =
    status.kind === 'starting'
      ? 'bg-amber-400 animate-pulse'
      : status.kind === 'running'
        ? 'bg-emerald-400'
        : status.kind === 'exited'
          ? status.exitCode === 0
            ? 'bg-gray-400'
            : 'bg-red-500'
          : 'bg-gray-600';

  return (
    <span
      className={cn('inline-block w-2 h-2 rounded-full flex-shrink-0', dotClass)}
      title={status.label}
      aria-label={`Terminal status: ${status.label}`}
    />
  );
}

function XTermViewport({
  terminalId,
  isActive,
  alive,
  onData,
  onResize,
  onFallback,
}: {
  terminalId: string;
  isActive: boolean;
  alive: boolean;
  onData: (terminalId: string, data: string) => void;
  onResize: (terminalId: string, cols: number, rows: number) => void;
  onFallback: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<XTermInstance | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;
  const aliveRef = useRef(alive);
  aliveRef.current = alive;
  const onDataRef = useRef(onData);
  onDataRef.current = onData;
  const onResizeRef = useRef(onResize);
  onResizeRef.current = onResize;
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  const fitAndSyncSize = useCallback(() => {
    const inst = instanceRef.current;
    const container = containerRef.current;
    if (!inst || !container || container.clientWidth === 0 || container.clientHeight === 0) {
      return;
    }
    try {
      const dims = inst.fitAddon.proposeDimensions();
      if (!dims || dims.cols < 1 || dims.rows < 1) return;
      inst.fitAddon.fit();
      if (
        aliveRef.current &&
        (lastSizeRef.current.cols !== inst.term.cols ||
          lastSizeRef.current.rows !== inst.term.rows)
      ) {
        lastSizeRef.current = { cols: inst.term.cols, rows: inst.term.rows };
        onResizeRef.current(terminalId, inst.term.cols, inst.term.rows);
      }
    } catch {
      // ignore transient layout measurement failures
    }
  }, [terminalId]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let unsubOutput: (() => void) | null = null;
    let unsubClear: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let rafId: number | null = null;

    (async () => {
      try {
        const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }] = await Promise.all([
          import('xterm'),
          import('xterm-addon-fit'),
          import('xterm-addon-web-links'),
        ]);
        if (cancelled) return;

        const term = new XTerm({
          cursorBlink: true,
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Fira Code, ui-monospace, SFMono-Regular, monospace',
          scrollback: 5000,
          convertEol: false,
          theme: {
            background: '#0b0f17',
            foreground: '#e5e7eb',
            cursor: '#60a5fa',
            selectionBackground: 'rgba(59, 130, 246, 0.35)',
          },
        });

        const fitAddon = new FitAddon();
        const webLinksAddon = new WebLinksAddon((_event, uri) => {
          if (/^https?:\/\//i.test(uri) && typeof window !== 'undefined') {
            window.open(uri, '_blank', 'noopener,noreferrer');
          }
        });

        term.loadAddon(fitAddon);
        term.loadAddon(webLinksAddon);
        term.open(container);

        const dataSub = term.onData((data: string) => {
          onDataRef.current(terminalId, data);
        });

        instanceRef.current = {
          term,
          fitAddon,
          dispose: () => {
            dataSub.dispose();
            term.dispose();
          },
        };

        const store = useTerminalStore.getState();
        const existing = store.output.get(terminalId) || '';
        if (existing) {
          term.write(existing);
        }

        unsubOutput = store.subscribeOutput(terminalId, (chunk) => {
          term.write(chunk);
        });
        unsubClear = store.subscribeClear(terminalId, () => {
          term.clear();
        });

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (rafId !== null && typeof cancelAnimationFrame === 'function') {
              cancelAnimationFrame(rafId);
            }
            if (typeof requestAnimationFrame === 'function') {
              rafId = requestAnimationFrame(() => {
                rafId = null;
                fitAndSyncSize();
              });
            } else {
              fitAndSyncSize();
            }
          });
          resizeObserver.observe(container);
        }

        fitAndSyncSize();
        if (isActiveRef.current) {
          term.focus();
        }
      } catch {
        if (!cancelled) {
          onFallbackRef.current();
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      }
      resizeObserver?.disconnect();
      unsubOutput?.();
      unsubClear?.();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
  }, [terminalId, fitAndSyncSize]);

  useEffect(() => {
    if (!isActive) return;
    if (typeof requestAnimationFrame === 'function') {
      const id = requestAnimationFrame(() => {
        fitAndSyncSize();
        instanceRef.current?.term.focus();
      });
      return () => cancelAnimationFrame(id);
    }
    fitAndSyncSize();
    instanceRef.current?.term.focus();
  }, [isActive, fitAndSyncSize]);

  return (
    <div
      ref={containerRef}
      className={isActive ? 'h-full w-full px-2 py-1' : 'hidden'}
      data-testid={`xterm-container-${terminalId}`}
    />
  );
}

function HeadlessTerminalFallback({
  activeTerminalId,
  activeAlive,
  onSend,
}: {
  activeTerminalId: string | null;
  activeAlive: boolean;
  onSend: (terminalId: string, data: string) => Promise<void>;
}) {
  const outputText = useTerminalStore((s) =>
    activeTerminalId ? s.output.get(activeTerminalId) || '' : ''
  );
  const [fallbackInput, setFallbackInput] = useState<string>('');

  const handleFallbackSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTerminalId) return;
    await onSend(activeTerminalId, fallbackInput + '\r');
    setFallbackInput('');
  };

  return (
    <div className="flex flex-col h-full p-2 gap-2">
      <pre
        data-testid="terminal-fallback-output"
        className="flex-1 overflow-y-auto font-mono text-xs text-gray-200 whitespace-pre-wrap select-text"
      >
        {outputText}
      </pre>
      <form onSubmit={handleFallbackSend} className="flex gap-2">
        <input
          value={fallbackInput}
          onChange={(e) => setFallbackInput(e.target.value)}
          disabled={!activeTerminalId || !activeAlive}
          placeholder={activeAlive ? 'Type command...' : 'Terminal exited'}
          className="flex-1 px-2.5 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-white font-mono focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          disabled={!activeTerminalId || !activeAlive}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs rounded"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export function TerminalDrawer({ isOpen, onClose }: TerminalDrawerProps) {
  const terminals = useTerminalStore((s) => s.terminals);
  const activeTerminalId = useTerminalStore((s) => s.activeTerminalId);
  const error = useTerminalStore((s) => s.error);
  const initListeners = useTerminalStore((s) => s.initListeners);
  const setActiveTerminal = useTerminalStore((s) => s.setActiveTerminal);
  const spawnTerminal = useTerminalStore((s) => s.spawnTerminal);
  const writeToTerminal = useTerminalStore((s) => s.writeToTerminal);
  const resizeTerminal = useTerminalStore((s) => s.resizeTerminal);
  const killTerminal = useTerminalStore((s) => s.killTerminal);
  const clearOutput = useTerminalStore((s) => s.clearOutput);
  const clearError = useTerminalStore((s) => s.clearError);
  const fetchTerminals = useTerminalStore((s) => s.fetchTerminals);

  const activeWorkspace = useAppStore((s) => s.activeWorkspace);

  const [drawerHeight, setDrawerHeight] = useState<number>(DEFAULT_HEIGHT);
  const [headlessFallback, setHeadlessFallback] = useState<boolean>(false);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const handleFallback = useCallback(() => setHeadlessFallback(true), []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let active = true;
    initListeners()
      .then((fn) => {
        if (active) {
          cleanup = fn;
        } else {
          fn();
        }
      })
      .catch(() => {});
    fetchTerminals();
    return () => {
      active = false;
      cleanup?.();
    };
  }, [initListeners, fetchTerminals]);

  useEffect(() => {
    if (terminals.length > 0 && !activeTerminalId) {
      setActiveTerminal(terminals[0].id);
    }
  }, [terminals, activeTerminalId, setActiveTerminal]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId) || null;
  const activeStatus = activeTerminal ? formatTerminalStatus(activeTerminal.status) : null;
  const activeAlive = activeTerminal ? isTerminalAlive(activeTerminal.status) : false;

  const clampHeight = useCallback((h: number) => {
    const maxH =
      typeof window !== 'undefined'
        ? Math.max(260, Math.floor(window.innerHeight * 0.75))
        : 600;
    return Math.min(maxH, Math.max(MIN_HEIGHT, h));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onWindowResize = () => {
      setDrawerHeight((prev) => clampHeight(prev));
    };
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, [clampHeight]);

  const expandedTarget = clampHeight(EXPANDED_HEIGHT);
  const isExpanded =
    drawerHeight >= EXPANDED_HEIGHT ||
    (expandedTarget > DEFAULT_HEIGHT && drawerHeight >= expandedTarget);

  const handleToggleExpand = () => {
    if (isExpanded) {
      setDrawerHeight(clampHeight(DEFAULT_HEIGHT));
    } else {
      setDrawerHeight(clampHeight(EXPANDED_HEIGHT));
    }
  };

  const handleResizeDragStart = (e: React.MouseEvent) => {
    if (typeof window === 'undefined') return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = drawerHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      setDrawerHeight(clampHeight(startHeight + delta));
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      dragCleanupRef.current = null;
    };

    dragCleanupRef.current?.();
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
    dragCleanupRef.current = cleanup;
  };

  if (!isOpen) {
    return null;
  }

  return (
    <section
      aria-label="Terminal Drawer"
      style={{ height: `${drawerHeight}px` }}
      className="flex-shrink-0 flex flex-col w-full border-t border-gray-800 bg-[#0b0f17] select-none"
    >
      {/* Drag Resize Handle */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal drawer"
        onMouseDown={handleResizeDragStart}
        className="h-1.5 w-full cursor-row-resize hover:bg-blue-500/40 transition-colors flex-shrink-0"
      />

      {/* Drawer Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-800 bg-gray-900/90 flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-gray-100">Terminal</span>
          {activeStatus && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 font-mono">
              {activeStatus.label}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {activeTerminalId && (
            <>
              <button
                type="button"
                onClick={() => clearOutput(activeTerminalId)}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                aria-label="Clear terminal"
                title="Clear terminal buffer"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => killTerminal(activeTerminalId)}
                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
                aria-label="Kill terminal"
                title="Kill active terminal"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleToggleExpand}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            aria-label={isExpanded ? 'Collapse terminal drawer' : 'Expand terminal drawer'}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            aria-label="Close terminal drawer"
            title="Close terminal drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Tabs */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-800 bg-gray-900/50 overflow-x-auto flex-shrink-0">
        {terminals.map((terminal) => {
          const parsed = formatTerminalStatus(terminal.status);
          const isSelected = activeTerminalId === terminal.id;
          return (
            <div
              key={terminal.id}
              onClick={() => setActiveTerminal(terminal.id)}
              className={cn(
                'flex items-center gap-2 px-2.5 py-1 rounded-md text-xs transition-colors cursor-pointer flex-shrink-0',
                isSelected
                  ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent'
              )}
            >
              <TerminalTabDot status={parsed} />
              <span className="truncate max-w-[140px] font-mono">{terminal.shell}</span>
              {(parsed.kind === 'exited' || parsed.kind === 'closed') && (
                <span className="text-[10px] px-1 rounded bg-gray-800 text-gray-400">
                  {parsed.label}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  killTerminal(terminal.id);
                }}
                className="p-0.5 text-gray-500 hover:text-red-400 rounded hover:bg-red-500/20"
                aria-label={`Close ${terminal.shell}`}
                title="Kill terminal"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => spawnTerminal(undefined, activeWorkspace || undefined)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors flex-shrink-0"
          aria-label="New terminal"
          title="Spawn new terminal in active workspace"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>
      </div>

      {/* Inline Error Banner */}
      {error && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-red-950/60 border-b border-red-500/30 text-xs text-red-300 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="truncate">{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="p-0.5 text-red-300 hover:text-white rounded"
            aria-label="Dismiss terminal error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Terminal Viewport */}
      <div className="flex-1 min-h-0 overflow-hidden bg-[#0b0f17] relative">
        {terminals.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 text-gray-400">
            <p className="text-xs mb-2">No active terminal session.</p>
            <button
              type="button"
              onClick={() => spawnTerminal(undefined, activeWorkspace || undefined)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Start Terminal
            </button>
          </div>
        ) : headlessFallback ? (
          <HeadlessTerminalFallback
            activeTerminalId={activeTerminalId}
            activeAlive={activeAlive}
            onSend={writeToTerminal}
          />
        ) : (
          terminals.map((terminal) => (
            <XTermViewport
              key={terminal.id}
              terminalId={terminal.id}
              isActive={terminal.id === activeTerminalId}
              alive={isTerminalAlive(terminal.status)}
              onData={writeToTerminal}
              onResize={resizeTerminal}
              onFallback={handleFallback}
            />
          ))
        )}
      </div>
    </section>
  );
}
