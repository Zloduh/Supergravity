import { useState } from 'react';
import { useConversationStore } from '../stores/conversationStore';
import { useAppStore } from '../stores/appStore';
import {
  MessageSquare,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Search,
  Settings,
  FolderOpen,
  FolderInput,
  Layers,
  GitBranch,
  Server,
  Terminal,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Command,
  Clock,
  X,
  AlertCircle,
} from 'lucide-react';
import { cn } from '../utils/cn';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const {
    conversations,
    activeConversationId,
    activeWorktreeMode,
    setActiveConversation,
    createConversation,
    moveConversationToProject,
    deleteConversation,
  } = useConversationStore();

  const {
    config,
    saveConfig,
    activeWorkspace,
    artifactPaneOpen,
    terminalOpen,
    setSettingsOpen,
    setProjectModalOpen,
    setActiveProject,
    setCommandPaletteOpen,
    toggleTerminal,
    toggleArtifactPane,
    providers,
    activeProviderId,
    skills,
    mcpServers,
  } = useAppStore();

  const [search, setSearch] = useState('');
  const [movingConversationId, setMovingConversationId] = useState<string | null>(null);
  const [addingSchedule, setAddingSchedule] = useState(false);
  const [schedPrompt, setSchedPrompt] = useState('');
  const [schedCron, setSchedCron] = useState('0 9 * * *');
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 288;
    const saved = Number(window.localStorage.getItem('supergravity.sidebarWidth'));
    return Number.isFinite(saved) && saved >= 220 ? saved : 288;
  });

  const clampSidebarWidth = (w: number) => {
    const maxW =
      typeof window !== 'undefined' ? Math.max(260, Math.min(520, Math.floor(window.innerWidth * 0.45))) : 520;
    return Math.max(220, Math.min(maxW, w));
  };

  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = clampSidebarWidth(sidebarWidth);
    const onMove = (ev: MouseEvent) => {
      const next = clampSidebarWidth(startW + (ev.clientX - startX));
      setSidebarWidth(next);
      try {
        window.localStorage.setItem('supergravity.sidebarWidth', String(next));
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    projects: true,
    conversations: true,
    schedules: true,
    tools: true,
    settings: true,
  });

  const projects = config.workspace.projects || [];
  const scheduledTasks = config.workspace.scheduled_tasks || [];
  const activeProjectId = config.workspace.active_project_id || null;

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleNewConversation = (targetProjectId: string | null = null) => {
    const targetProj = targetProjectId
      ? projects.find((p) => p.id === targetProjectId) || null
      : null;
    const wsPath = targetProj?.folders?.[0]?.path || activeWorkspace;
    const wtMode =
      activeWorktreeMode || targetProj?.settings?.default_worktree_mode || 'local';
    void createConversation('New Conversation', undefined, wsPath, targetProjectId, wtMode);
  };

  const searchLower = search.trim().toLowerCase();
  const matchesSearch = (c: (typeof conversations)[number]) =>
    !searchLower || c.title.toLowerCase().includes(searchLower);

  const projectIds = new Set(projects.map((p) => p.id));
  const standaloneConversations = conversations.filter(
    (c) => (!c.project_id || !projectIds.has(c.project_id)) && matchesSearch(c)
  );

  const renderConversationItem = (
    conversation: (typeof conversations)[number],
    nested = false
  ) => {
    const isActive = activeConversationId === conversation.id;
    const isMovingThis = movingConversationId === conversation.id;
    return (
      <div key={conversation.id} className="relative group space-y-1">
        <button
          type="button"
          onClick={() => setActiveConversation(conversation.id)}
          className={cn(
            'w-full flex items-center gap-2 text-xs rounded-lg transition-colors text-left pr-14',
            nested ? 'px-2 py-1.5' : 'px-2.5 py-2',
            isActive
              ? 'bg-blue-600/15 text-white border border-blue-500/40 font-medium'
              : 'text-gray-400 hover:text-gray-100 hover:bg-gray-800/60 border border-transparent'
          )}
        >
          <MessageSquare
            className={cn(
              'w-3.5 h-3.5 flex-shrink-0',
              isActive ? 'text-blue-400' : 'text-gray-500'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate">{conversation.title}</div>
            {conversation.worktree_mode === 'new_worktree' && (
              <div className="text-[10px] text-indigo-400 truncate">worktree</div>
            )}
          </div>
        </button>

        <div
          className={cn(
            'absolute right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
            nested ? 'top-1' : 'top-2'
          )}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMovingConversationId(isMovingThis ? null : conversation.id);
            }}
            className="p-1 text-gray-400 hover:text-indigo-300 rounded hover:bg-gray-800"
            aria-label={`Move conversation ${conversation.title} to project`}
            title="Move conversation to project / workspace"
          >
            <FolderInput className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              deleteConversation(conversation.id);
            }}
            className="p-1 text-gray-500 hover:text-red-400 rounded hover:bg-gray-800"
            aria-label={`Delete conversation ${conversation.title}`}
            title="Delete conversation"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>

        {isMovingThis && (
          <div className="mx-1 p-2 rounded-lg bg-gray-900 border border-gray-700 space-y-1.5 z-10">
            <div className="flex items-center justify-between text-[11px] text-gray-300 font-medium">
              <span>Move to Project / Workspace</span>
              <button
                type="button"
                onClick={() => setMovingConversationId(null)}
                className="text-gray-500 hover:text-white"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
            {projects.length === 0 ? (
              <button
                type="button"
                onClick={() => {
                  setMovingConversationId(null);
                  setProjectModalOpen(true, null);
                }}
                className="w-full text-left px-2 py-1 text-[11px] text-indigo-300 hover:bg-indigo-600/20 rounded"
              >
                + Create a Project first…
              </button>
            ) : (
              <div className="space-y-1">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={async () => {
                      await moveConversationToProject(
                        conversation.id,
                        p.id,
                        p.folders?.[0]?.path || conversation.workspace_path || null
                      );
                      setMovingConversationId(null);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between px-2 py-1 text-[11px] rounded text-left',
                      conversation.project_id === p.id
                        ? 'bg-indigo-600/30 text-white font-medium'
                        : 'text-gray-300 hover:bg-gray-800'
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-[10px] text-gray-500">{p.folders.length}f</span>
                  </button>
                ))}
                {conversation.project_id && (
                  <button
                    type="button"
                    onClick={async () => {
                      await moveConversationToProject(conversation.id, null);
                      setMovingConversationId(null);
                    }}
                    className="w-full text-left px-2 py-1 text-[11px] text-gray-400 hover:text-red-300 hover:bg-gray-800 rounded"
                  >
                    Remove from project (Unassigned)
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const activeProvider =
    providers.find((p) => p.id === activeProviderId) || providers[0] || null;
  const providerStatus = activeProvider?.status;
  const isConnected = providerStatus === 'connected';
  const errorText =
    providerStatus && typeof providerStatus === 'object' && 'error' in providerStatus
      ? providerStatus.error
      : null;

  if (!isOpen) {
    return (
      <aside
        aria-label="Collapsed sidebar"
        className="w-12 flex-shrink-0 h-full bg-[#0d121c] border-r border-gray-800/80 flex flex-col items-center py-3 justify-between z-20"
      >
        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800/80 rounded-lg transition-colors"
            aria-label="Open sidebar"
            title="Expand sidebar (Ctrl+B)"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => handleNewConversation(activeProjectId)}
            className="p-2 text-blue-400 hover:text-white hover:bg-blue-600/20 rounded-lg transition-colors"
            aria-label="New Conversation"
            title="New Conversation (Ctrl+N)"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setProjectModalOpen(true, null)}
            className="p-2 text-indigo-400 hover:text-white hover:bg-indigo-600/20 rounded-lg transition-colors"
            aria-label="New Project"
            title="New Project Workspace"
          >
            <Layers className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={toggleArtifactPane}
            className={cn(
              'p-2 rounded-lg transition-colors',
              artifactPaneOpen
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/80'
            )}
            aria-label="Artifacts & Files"
            title="Toggle Artifacts & Files (Ctrl+Shift+A)"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleTerminal}
            className={cn(
              'p-2 rounded-lg transition-colors',
              terminalOpen
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-gray-400 hover:text-white hover:bg-gray-800/80'
            )}
            aria-label="Terminal"
            title="Toggle Terminal (Ctrl+`)"
          >
            <Terminal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true, 'providers')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800/80 rounded-lg transition-colors"
            aria-label="Settings"
            title="Open Settings (Ctrl+,)"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Sidebar"
      style={{ width: `${clampSidebarWidth(sidebarWidth)}px` }}
      className="relative flex-shrink-0 h-full bg-[#0d121c] border-r border-gray-800/80 flex flex-col z-20"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Sidebar"
        title="Drag to resize (double-click to reset)"
        onMouseDown={startSidebarResize}
        onDoubleClick={() => {
          setSidebarWidth(288);
          try {
            window.localStorage.setItem('supergravity.sidebarWidth', '288');
          } catch {
            // ignore
          }
        }}
        className="absolute right-0 top-0 bottom-0 w-1.5 -mr-0.5 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500/70 transition-colors z-30"
      />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/80">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm shadow-blue-950 flex-shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold text-base text-white tracking-tight truncate">
            Supergravity
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleNewConversation(activeProjectId)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Quick new conversation"
            title="New Conversation (Ctrl+N)"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close sidebar"
            title="Collapse sidebar (Ctrl+B)"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="p-3 border-b border-gray-800/80">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            aria-label="Search conversations"
            className="w-full pl-8 pr-7 py-1.5 bg-gray-900/90 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-500 hover:text-gray-300 rounded"
              aria-label="Clear conversation search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Sections */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {/* Projects Section */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              onClick={() => toggleSection('projects')}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              Projects ({projects.length})
              {expandedSections.projects ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setProjectModalOpen(true, null)}
              className="p-1 text-indigo-400 hover:text-white hover:bg-indigo-500/20 rounded transition-colors"
              aria-label="Create new project"
              title="New Project (Create Folder on Drive, Open Existing Folder, or SSH Host…)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {expandedSections.projects && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setProjectModalOpen(true, null)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 border border-indigo-500/25 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Project Workspace
              </button>

              {projects.length === 0 ? (
                <p className="px-2.5 py-1.5 text-[11px] text-gray-500">
                  Create a project to group multi-folder workspaces, isolated settings, and
                  conversations.
                </p>
              ) : (
                projects.map((proj) => {
                  const isProjActive = activeProjectId === proj.id;
                  const allProjConvs = conversations.filter((c) => c.project_id === proj.id);
                  const visibleProjConvs = allProjConvs.filter(matchesSearch);
                  return (
                    <div
                      key={proj.id}
                      className={cn(
                        'rounded-lg border transition-colors',
                        isProjActive
                          ? 'bg-indigo-600/15 border-indigo-500/40'
                          : 'bg-gray-900/40 border-gray-800/70 hover:bg-gray-800/60'
                      )}
                    >
                      <div className="flex items-center justify-between px-2.5 py-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveProject(isProjActive ? null : proj.id)}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left"
                          aria-label={`Select project ${proj.name}`}
                        >
                          <Layers
                            className={cn(
                              'w-3.5 h-3.5 flex-shrink-0',
                              isProjActive ? 'text-indigo-400' : 'text-gray-500'
                            )}
                          />
                          <span
                            className={cn(
                              'text-xs truncate',
                              isProjActive ? 'text-white font-semibold' : 'text-gray-300'
                            )}
                          >
                            {proj.name}
                          </span>
                        </button>
                        <div className="flex items-center gap-1">
                          <span
                            className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-gray-400"
                            title={`${proj.folders.length} folder(s), ${allProjConvs.length} conversation(s)`}
                          >
                            {proj.folders.length}f · {allProjConvs.length}c
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleNewConversation(proj.id);
                            }}
                            className="p-1 text-gray-400 hover:text-blue-300 rounded hover:bg-gray-800"
                            aria-label={`New conversation in ${proj.name}`}
                            title={`New conversation in ${proj.name}`}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setProjectModalOpen(true, proj.id)}
                            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800"
                            aria-label={`Configure project ${proj.name}`}
                            title="Project Folders & Settings"
                          >
                            <Settings className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      {isProjActive && proj.folders.length > 0 && (
                        <div className="px-2.5 pb-1.5 pt-1 space-y-1 border-t border-indigo-500/20">
                          {proj.folders.map((f) => (
                            <div
                              key={`${f.ssh_host || 'local'}:${f.path}`}
                              className="flex items-center gap-1.5 text-[11px] text-gray-400 truncate"
                              title={f.path}
                            >
                              {f.ssh_host ? (
                                <Server className="w-3 h-3 text-purple-400 flex-shrink-0" />
                              ) : f.is_git ? (
                                <GitBranch className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                              ) : (
                                <FolderOpen className="w-3 h-3 text-blue-400 flex-shrink-0" />
                              )}
                              <span className="truncate text-gray-300">{f.name}</span>
                              {f.git_branch && (
                                <span className="text-[10px] text-emerald-400 font-mono">
                                  ({f.git_branch})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="px-1.5 pb-1.5 pt-1 space-y-0.5 border-t border-gray-800/60">
                        {visibleProjConvs.length === 0 ? (
                          <p className="px-2 py-1 text-[11px] text-gray-500">
                            {searchLower ? 'No matching conversations' : 'No conversations yet'}
                          </p>
                        ) : (
                          visibleProjConvs.map((c) => renderConversationItem(c, true))
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Conversations Section (standalone conversations not belonging to a project) */}
        <div className="space-y-1.5 border-t border-gray-800/80 pt-3">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              onClick={() => toggleSection('conversations')}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Conversations ({standaloneConversations.length})
              {expandedSections.conversations ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => handleNewConversation(null)}
              className="p-1 text-blue-400 hover:text-white hover:bg-blue-500/20 rounded transition-colors"
              aria-label="New standalone conversation"
              title="New standalone conversation"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {expandedSections.conversations && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => handleNewConversation(null)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 border border-blue-500/20 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                New Conversation
              </button>

              {standaloneConversations.length === 0 ? (
                <p className="px-2.5 py-2 text-xs text-gray-500">
                  {searchLower ? 'No matching conversations' : 'No standalone conversations'}
                </p>
              ) : (
                standaloneConversations.map((c) => renderConversationItem(c, false))
              )}
            </div>
          )}
        </div>

        {/* Scheduled Tasks Section */}
        <div className="space-y-1.5 border-t border-gray-800/80 pt-3">
          <div className="flex items-center justify-between px-2 py-1">
            <button
              type="button"
              onClick={() => toggleSection('schedules')}
              className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              Scheduled Tasks ({scheduledTasks.length})
              {expandedSections.schedules ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setAddingSchedule((prev) => !prev)}
              className="p-1 text-amber-400 hover:text-white hover:bg-amber-500/20 rounded transition-colors"
              aria-label="Add scheduled task"
              title="Add recurring cron task or timer"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {expandedSections.schedules && (
            <div className="space-y-1.5">
              {addingSchedule && (
                <div className="p-2 rounded-lg bg-gray-900 border border-gray-800 space-y-1.5">
                  <input
                    type="text"
                    value={schedPrompt}
                    onChange={(e) => setSchedPrompt(e.target.value)}
                    placeholder="Task prompt (e.g. Run tests & report)"
                    aria-label="Scheduled task prompt"
                    className="w-full px-2 py-1 bg-gray-950 border border-gray-700 rounded text-xs text-white"
                  />
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={schedCron}
                      onChange={(e) => setSchedCron(e.target.value)}
                      placeholder="Cron (0 9 * * *)"
                      aria-label="Scheduled task cron"
                      className="flex-1 px-2 py-1 bg-gray-950 border border-gray-700 rounded text-xs text-white font-mono"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!schedPrompt.trim()) return;
                        const nextTask = {
                          id: `sched-${Date.now()}`,
                          name: schedPrompt.trim().slice(0, 32),
                          prompt: schedPrompt.trim(),
                          cron_expression: schedCron.trim() || '0 9 * * *',
                          duration_seconds: null,
                          project_id: activeProjectId,
                          enabled: true,
                          created_at: new Date().toISOString(),
                        };
                        await saveConfig({
                          workspace: {
                            ...config.workspace,
                            scheduled_tasks: [...scheduledTasks, nextTask],
                          },
                        });
                        setSchedPrompt('');
                        setAddingSchedule(false);
                      }}
                      className="px-2.5 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs rounded font-medium"
                    >
                      Save
                    </button>
                  </div>
                </div>
              )}

              {scheduledTasks.length === 0 && !addingSchedule ? (
                <p className="px-2.5 py-1 text-[11px] text-gray-500">
                  No active schedules. Click + or use <code>/schedule</code>.
                </p>
              ) : (
                scheduledTasks.map((st) => (
                  <div
                    key={st.id}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-gray-900/50 border border-gray-800/80 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-gray-200 truncate">{st.name}</div>
                      <div className="text-[10px] text-amber-400 font-mono truncate">
                        {st.cron_expression || `${st.duration_seconds || 60}s`}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await saveConfig({
                          workspace: {
                            ...config.workspace,
                            scheduled_tasks: scheduledTasks.filter((x) => x.id !== st.id),
                          },
                        });
                      }}
                      className="p-1 text-gray-500 hover:text-red-400 rounded"
                      aria-label={`Delete schedule ${st.name}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Tools Section */}
        <div className="space-y-1.5 border-t border-gray-800/80 pt-3">
          <button
            type="button"
            onClick={() => toggleSection('tools')}
            className="flex items-center justify-between w-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              Tools
            </span>
            {expandedSections.tools ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {expandedSections.tools && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={toggleArtifactPane}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                  artifactPaneOpen
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                )}
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                  Artifacts & Files
                </span>
                <span className="text-[10px] text-gray-500 font-mono">Ctrl+⇧+A</span>
              </button>
              <button
                type="button"
                onClick={toggleTerminal}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-1.5 text-xs rounded-lg transition-colors',
                  terminalOpen
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
                )}
              >
                <span className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-emerald-400" />
                  Terminal
                </span>
                <span className="text-[10px] text-gray-500 font-mono">Ctrl+`</span>
              </button>
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(true)}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Command className="w-3.5 h-3.5 text-purple-400" />
                  Command Palette
                </span>
                <span className="text-[10px] text-gray-500 font-mono">Ctrl+K</span>
              </button>
            </div>
          )}
        </div>

        {/* Settings Section */}
        <div className="space-y-1.5 border-t border-gray-800/80 pt-3">
          <button
            type="button"
            onClick={() => toggleSection('settings')}
            className="flex items-center justify-between w-full px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-200 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <Settings className="w-3.5 h-3.5" />
              Settings
            </span>
            {expandedSections.settings ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>

          {expandedSections.settings && (
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setSettingsOpen(true, 'providers')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Zap className="w-3.5 h-3.5 text-amber-400" />
                  LLM Providers ({providers.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true, 'mcp')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                  MCP Servers ({mcpServers.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setSettingsOpen(true, 'skills')}
                className="w-full flex items-center justify-between px-2.5 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-800/60 rounded-lg transition-colors"
              >
                <span className="flex items-center gap-2">
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-400" />
                  Skills ({skills.length})
                </span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer Status */}
      <div className="p-3 border-t border-gray-800/80 bg-gray-950/40">
        <button
          type="button"
          onClick={() => setSettingsOpen(true, 'providers')}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg hover:bg-gray-800/70 transition-colors text-left"
          title={
            errorText
              ? `Provider error: ${errorText} (click to configure)`
              : 'Click to configure local LLM provider'
          }
        >
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'w-2 h-2 rounded-full flex-shrink-0',
                isConnected
                  ? 'bg-emerald-400'
                  : errorText
                    ? 'bg-red-400'
                    : 'bg-amber-400'
              )}
            />
            <span className="text-xs text-gray-300 truncate">
              {activeProvider
                ? `${activeProvider.name}: ${
                    isConnected ? 'Connected' : errorText ? 'Offline' : 'Ready'
                  }`
                : 'No Provider Selected'}
            </span>
          </div>
          {errorText && <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
        </button>
      </div>
    </aside>
  );
}
