import { useEffect, useState } from 'react';
import {
  X,
  FileText,
  Code,
  RefreshCw,
  Copy,
  Check,
  Save,
  Folder,
  Eye,
  FileCode,
  AlertCircle,
  GitCompare,
  Bot,
  Terminal,
  ExternalLink,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useConversationStore } from '../stores/conversationStore';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DiffViewer } from './DiffViewer';
import * as fsIpc from '../ipc/fs';
import { formatTauriError, isTauri } from '../utils/tauri';
import { cn } from '../utils/cn';

type AuxTab = 'artifacts' | 'changes' | 'subagents' | 'tasks' | 'files';

export function ArtifactPane() {
  const {
    artifactPaneOpen,
    setArtifactPaneOpen,
    activeArtifact,
    setActiveArtifact,
    artifacts,
    fetchArtifacts,
    activeWorkspace,
    config,
    workspaceFiles,
    workspaceFilesLoading,
    fetchWorkspaceFiles,
    setTerminalOpen,
  } = useAppStore();
  const { activeConversationId, activeConversation, setActiveConversation } =
    useConversationStore();

  const projects = config.workspace?.projects || [];
  const convProject =
    projects.find((p) => p.id === activeConversation?.project_id) ||
    projects.find((p) => p.id === config.workspace?.active_project_id) ||
    null;
  const effectiveWorkspace =
    activeConversation?.workspace_path ||
    convProject?.folders?.[0]?.path ||
    activeWorkspace;

  const [tab, setTab] = useState<AuxTab>('artifacts');
  const [browsingDir, setBrowsingDir] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'rendered' | 'source'>('rendered');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paneError, setPaneError] = useState<string | null>(null);
  const [paneWidth, setPaneWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 420;
    const saved = Number(window.localStorage.getItem('supergravity.artifactPaneWidth'));
    return Number.isFinite(saved) && saved >= 280 ? saved : 420;
  });

  const clampPaneWidth = (w: number) => {
    const maxW =
      typeof window !== 'undefined' ? Math.max(320, Math.min(980, window.innerWidth - 360)) : 980;
    return Math.max(280, Math.min(maxW, w));
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = clampPaneWidth(paneWidth);
    const onMove = (ev: MouseEvent) => {
      const next = clampPaneWidth(startW + (startX - ev.clientX));
      setPaneWidth(next);
      try {
        window.localStorage.setItem('supergravity.artifactPaneWidth', String(next));
      } catch {
        // ignore storage errors
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  useEffect(() => {
    setBrowsingDir(null);
  }, [effectiveWorkspace, activeConversationId]);

  useEffect(() => {
    if (!artifactPaneOpen) return;
    if (activeConversationId) {
      fetchArtifacts(activeConversationId);
    }
    fetchWorkspaceFiles(browsingDir || effectiveWorkspace, false);
  }, [
    artifactPaneOpen,
    activeConversationId,
    effectiveWorkspace,
    browsingDir,
    activeConversation?.messages.length,
    activeConversation?.files_changed?.length,
    fetchArtifacts,
    fetchWorkspaceFiles,
  ]);

  // Auto-select the first artifact when artifacts populate and nothing is currently selected
  useEffect(() => {
    if (!artifactPaneOpen || tab !== 'artifacts') return;
    if (!activeArtifact && artifacts.length > 0) {
      const first = artifacts[0];
      void openFile(first.path, first.name);
    }
  }, [artifactPaneOpen, tab, artifacts, activeArtifact]);

  if (!artifactPaneOpen) return null;

  const filesChanged = activeConversation?.files_changed || [];
  const subagents = activeConversation?.subagents || [];
  const bgTasks = activeConversation?.background_tasks || [];

  const openFile = async (path: string, name: string) => {
    setPaneError(null);
    if (!isTauri()) {
      setActiveArtifact({
        title: name,
        path,
        content: `# ${name}\n\nPreviewing \`${path}\``,
        language: name.endsWith('.md') ? 'markdown' : 'text',
      });
      return;
    }
    try {
      const res = await fsIpc.readFile({ path });
      setActiveArtifact({
        title: name,
        path,
        content: res.is_binary ? `[Binary file (${res.size} bytes)]` : res.content,
        language: name.endsWith('.md') ? 'markdown' : 'text',
      });
    } catch (e) {
      setPaneError(formatTauriError(e));
    }
  };

  const handleCopy = () => {
    if (!activeArtifact) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(activeArtifact.content).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSave = async () => {
    if (!activeArtifact) return;
    setPaneError(null);
    setSaving(true);
    try {
      const targetPath =
        activeArtifact.path ||
        `${activeWorkspace === '.' ? '' : activeWorkspace + '/'}${activeArtifact.title || 'artifact.md'}`;
      if (isTauri()) {
        await fsIpc.writeFile({
          path: targetPath,
          content: activeArtifact.content,
          create_dirs: true,
        });
      }
      if (activeConversationId) {
        await fetchArtifacts(activeConversationId);
      }
    } catch (e) {
      setPaneError(formatTauriError(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRefresh = () => {
    setPaneError(null);
    if (activeConversationId) {
      fetchArtifacts(activeConversationId);
    }
    fetchWorkspaceFiles(browsingDir || effectiveWorkspace, false);
  };

  const isMarkdown =
    activeArtifact?.title.toLowerCase().endsWith('.md') ||
    activeArtifact?.language === 'markdown';
  const isHtmlWidget =
    activeArtifact?.title.toLowerCase().endsWith('.html') ||
    activeArtifact?.language === 'html-widget';

  const effectiveWidth = clampPaneWidth(paneWidth);

  return (
    <aside
      aria-label="Artifact and Files Pane"
      style={{ width: `${effectiveWidth}px` }}
      className="relative flex-shrink-0 border-l border-gray-800/80 bg-[#0d121c] flex flex-col h-full min-w-[280px] max-w-[75vw]"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Auxiliary Pane"
        title="Drag to resize (double-click to reset)"
        onMouseDown={startResize}
        onDoubleClick={() => {
          setPaneWidth(420);
          try {
            window.localStorage.setItem('supergravity.artifactPaneWidth', '420');
          } catch {
            // ignore
          }
        }}
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors z-30"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-gray-800/80 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-xs font-semibold text-white truncate">
            {activeArtifact ? activeArtifact.title : 'Auxiliary Pane'}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {activeArtifact && (tab === 'artifacts' || tab === 'files') && (
            <>
              <button
                type="button"
                onClick={() => setViewMode(viewMode === 'rendered' ? 'source' : 'rendered')}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                aria-label={viewMode === 'rendered' ? 'View raw source' : 'View rendered preview'}
                title={viewMode === 'rendered' ? 'View source' : 'View rendered'}
              >
                {viewMode === 'rendered' ? (
                  <FileCode className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                aria-label="Copy artifact content"
                title="Copy content"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
                aria-label="Save artifact"
                title="Save to disk"
              >
                <Save className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => {
              const next = effectiveWidth >= 600 ? 420 : clampPaneWidth(720);
              setPaneWidth(next);
              try {
                window.localStorage.setItem('supergravity.artifactPaneWidth', String(next));
              } catch {
                // ignore
              }
            }}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            aria-label={effectiveWidth >= 600 ? 'Restore pane width' : 'Widen pane'}
            title={effectiveWidth >= 600 ? 'Restore width' : 'Widen pane'}
          >
            {effectiveWidth >= 600 ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            aria-label="Refresh artifacts"
            title="Refresh artifacts & files"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setArtifactPaneOpen(false)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            aria-label="Close pane"
            title="Close pane"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 5-Tab Auxiliary Navigation */}
      <div className="flex items-center border-b border-gray-800/80 px-2 bg-gray-950/40 text-[11px] overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('artifacts')}
          className={cn(
            'py-2 px-2 font-medium border-b-2 whitespace-nowrap transition-colors',
            tab === 'artifacts'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          )}
        >
          Artifacts ({artifacts.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('changes')}
          className={cn(
            'py-2 px-2 font-medium border-b-2 whitespace-nowrap transition-colors',
            tab === 'changes'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          )}
        >
          Diffs ({filesChanged.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('subagents')}
          className={cn(
            'py-2 px-2 font-medium border-b-2 whitespace-nowrap transition-colors',
            tab === 'subagents'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          )}
        >
          Subagents ({subagents.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={cn(
            'py-2 px-2 font-medium border-b-2 whitespace-nowrap transition-colors',
            tab === 'tasks'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          )}
        >
          Tasks ({bgTasks.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('files')}
          className={cn(
            'py-2 px-2 font-medium border-b-2 whitespace-nowrap transition-colors',
            tab === 'files'
              ? 'border-blue-500 text-white'
              : 'border-transparent text-gray-400 hover:text-gray-200'
          )}
        >
          Workspace Files ({workspaceFiles.length})
        </button>
      </div>

      {/* Error Banner */}
      {paneError && (
        <div className="px-3 py-2 bg-red-950/50 border-b border-red-500/30 flex items-center justify-between gap-2 text-xs text-red-300">
          <span className="flex items-center gap-1.5 truncate">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="truncate">{paneError}</span>
          </span>
          <button
            type="button"
            onClick={() => setPaneError(null)}
            className="text-red-300 hover:text-white"
            aria-label="Dismiss artifact error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Horizontal pill list for quick switching in Artifacts tab */}
      {tab === 'artifacts' && artifacts.length > 0 && (
        <div className="px-3 py-2 border-b border-gray-800/80 flex gap-1.5 overflow-x-auto bg-gray-950/30 flex-shrink-0">
          {artifacts.map((a) => (
            <button
              key={a.path}
              type="button"
              onClick={() => openFile(a.path, a.name)}
              className={cn(
                'px-2.5 py-1 rounded-md text-xs whitespace-nowrap transition-colors',
                activeArtifact?.path === a.path
                  ? 'bg-blue-600 text-white font-medium'
                  : 'bg-gray-800/80 text-gray-300 hover:bg-gray-700'
              )}
            >
              {a.name}
            </button>
          ))}
        </div>
      )}

      {tab === 'files' && (
        <div className="max-h-44 overflow-y-auto border-b border-gray-800/80 bg-gray-950/30 p-2 space-y-0.5 flex-shrink-0">
          <div className="flex items-center justify-between px-2 py-0.5 text-[10px] text-gray-500">
            <span className="truncate font-mono" title={browsingDir || effectiveWorkspace}>
              {browsingDir || effectiveWorkspace}
            </span>
            {browsingDir && (
              <button
                type="button"
                onClick={() => setBrowsingDir(null)}
                className="text-blue-400 hover:text-blue-300 ml-2 flex-shrink-0"
              >
                Root
              </button>
            )}
          </div>
          {workspaceFilesLoading ? (
            <p className="text-xs text-gray-500 px-2 py-1">Loading workspace files…</p>
          ) : workspaceFiles.length === 0 ? (
            <p className="text-xs text-gray-500 px-2 py-1">
              No files listed in {browsingDir || effectiveWorkspace}
            </p>
          ) : (
            workspaceFiles.map((entry) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => {
                  if (entry.is_dir) {
                    setBrowsingDir(entry.path);
                  } else {
                    openFile(entry.path, entry.name);
                  }
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1 rounded text-xs text-left transition-colors',
                  activeArtifact?.path === entry.path
                    ? 'bg-blue-600/20 text-blue-300'
                    : 'text-gray-300 hover:bg-gray-800/70'
                )}
              >
                {entry.is_dir ? (
                  <Folder className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                ) : (
                  <FileText className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                )}
                <span className="truncate flex-1">{entry.name}</span>
              </button>
            ))
          )}
        </div>
      )}

      {/* Main Content Area by Tab */}
      <div className="flex-1 overflow-y-auto p-3.5 min-h-0 select-text space-y-3">
        {tab === 'changes' &&
          (filesChanged.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 px-4">
              <GitCompare className="w-9 h-9 mb-2.5 opacity-40" />
              <p className="text-sm font-medium text-gray-400">No files modified yet</p>
              <p className="text-xs mt-1">
                Every file written or edited by the agent is snapshotted here with red/green diffs
                and one-click revert.
              </p>
            </div>
          ) : (
            filesChanged.map((change) => <DiffViewer key={change.path} change={change} />)
          ))}

        {tab === 'subagents' &&
          (subagents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 px-4">
              <Bot className="w-9 h-9 mb-2.5 opacity-40" />
              <p className="text-sm font-medium text-gray-400">No subagents spawned</p>
              <p className="text-xs mt-1">
                Child agents invoked via <code>invoke_subagent</code> or <code>/teamwork</code>{' '}
                appear here with live status and transcript links.
              </p>
            </div>
          ) : (
            subagents.map((sa) => (
              <div
                key={sa.conversation_id}
                className="p-3 rounded-xl border border-gray-800 bg-gray-900/60 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Bot className="w-4 h-4 text-purple-400 flex-shrink-0" />
                    <span className="font-semibold text-white truncate">{sa.role}</span>
                  </div>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-medium uppercase',
                      sa.status === 'running'
                        ? 'bg-blue-500/20 text-blue-300'
                        : 'bg-emerald-500/20 text-emerald-300'
                    )}
                  >
                    {sa.status}
                  </span>
                </div>
                <div className="text-[11px] text-gray-400 flex items-center justify-between">
                  <span>Type: {sa.type_name}</span>
                  <button
                    type="button"
                    onClick={() => setActiveConversation(sa.conversation_id)}
                    className="flex items-center gap-1 text-blue-400 hover:text-blue-300"
                  >
                    <span>Inspect Transcript</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          ))}

        {tab === 'tasks' &&
          (bgTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 px-4">
              <Terminal className="w-9 h-9 mb-2.5 opacity-40" />
              <p className="text-sm font-medium text-gray-400">No background tasks</p>
              <p className="text-xs mt-1">
                Long-running shell commands, daemons, and dev servers started by the agent appear
                here.
              </p>
              <button
                type="button"
                onClick={() => setTerminalOpen(true)}
                className="mt-3 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-200"
              >
                Open Interactive Terminal Drawer
              </button>
            </div>
          ) : (
            bgTasks.map((t) => (
              <div
                key={t.task_id}
                className="p-3 rounded-xl border border-gray-800 bg-gray-900/60 space-y-2 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-gray-200 truncate">{t.command}</span>
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-[10px] font-medium uppercase',
                      t.status === 'running'
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-gray-800 text-gray-300'
                    )}
                  >
                    {t.status}
                    {t.exit_code !== undefined && t.exit_code !== null ? ` (${t.exit_code})` : ''}
                  </span>
                </div>
                <div className="text-[11px] text-gray-500 font-mono truncate">cwd: {t.cwd}</div>
                {t.output_preview && (
                  <pre className="p-2 rounded bg-gray-950 border border-gray-800 text-[11px] font-mono text-gray-300 max-h-32 overflow-auto whitespace-pre-wrap">
                    {t.output_preview}
                  </pre>
                )}
              </div>
            ))
          ))}

        {(tab === 'artifacts' || tab === 'files') &&
          (activeArtifact ? (
            viewMode === 'rendered' && isHtmlWidget ? (
              <iframe
                title={activeArtifact.title}
                sandbox="allow-scripts"
                srcDoc={activeArtifact.content}
                className="w-full h-96 rounded-xl border border-gray-800 bg-white"
              />
            ) : viewMode === 'rendered' && isMarkdown ? (
              <MarkdownRenderer content={activeArtifact.content} />
            ) : (
              <pre className="text-xs font-mono text-gray-200 whitespace-pre-wrap bg-gray-950 p-3 rounded-lg border border-gray-800 overflow-x-auto">
                {activeArtifact.content}
              </pre>
            )
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 px-4">
              <Code className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm font-medium text-gray-400">No artifact selected</p>
              <p className="text-xs mt-1">
                Plans, tool outputs, diffs, and workspace files for the active conversation appear
                here.
              </p>
            </div>
          ))}
      </div>
    </aside>
  );
}
