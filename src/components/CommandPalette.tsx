import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useConversationStore } from '../stores/conversationStore';
import * as fsIpc from '../ipc/fs';
import * as windowIpc from '../ipc/window';
import { isTauri } from '../utils/tauri';
import {
  Search,
  X,
  ArrowUp,
  ArrowDown,
  CornerDownLeft,
  Plus,
  FileText,
  Save,
  Terminal,
  Settings,
  Zap,
  GitBranch,
  BookOpen,
  Layout,
  Layers,
  PanelLeft,
  RefreshCw,
  Sun,
  Moon,
  Power,
} from 'lucide-react';
import { cn } from '../utils/cn';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  title: string;
  description: string;
  shortcut?: string;
  category: string;
  icon: React.ComponentType<{ className?: string }>;
}

const COMMANDS: CommandItem[] = [
  {
    id: 'new-conversation',
    title: 'New Conversation',
    description: 'Start a fresh chat in the active project or workspace',
    shortcut: 'Ctrl+N',
    category: 'Chat',
    icon: Plus,
  },
  {
    id: 'new-project',
    title: 'New Project Workspace',
    description: 'Create a project from a new folder on drive, existing folder, or SSH host',
    category: 'Projects',
    icon: Layers,
  },
  {
    id: 'toggle-terminal',
    title: 'Toggle Terminal',
    description: 'Show or hide the integrated PTY terminal drawer',
    shortcut: 'Ctrl+`',
    category: 'View',
    icon: Terminal,
  },
  {
    id: 'toggle-artifacts',
    title: 'Toggle Artifacts & Files Pane',
    description: 'Show or hide the artifacts and workspace files inspector',
    shortcut: 'Ctrl+⇧+A',
    category: 'View',
    icon: Layout,
  },
  {
    id: 'toggle-sidebar',
    title: 'Toggle Sidebar',
    description: 'Collapse or expand the left navigation sidebar',
    shortcut: 'Ctrl+B',
    category: 'View',
    icon: PanelLeft,
  },
  {
    id: 'open-file',
    title: 'Open File',
    description: 'Browse and open a file from the active workspace in the Artifact Pane',
    category: 'File',
    icon: FileText,
  },
  {
    id: 'save-file',
    title: 'Save File',
    description: 'Save the currently open artifact or file back to disk',
    category: 'File',
    icon: Save,
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Open application settings and connections',
    shortcut: 'Ctrl+,',
    category: 'Preferences',
    icon: Settings,
  },
  {
    id: 'llm-providers',
    title: 'LLM Providers',
    description: 'Configure Strata, Ollama, LM Studio, llama.cpp, or vLLM',
    category: 'Preferences',
    icon: Zap,
  },
  {
    id: 'mcp-servers',
    title: 'MCP Servers',
    description: 'Manage Model Context Protocol stdio and SSE servers',
    category: 'Preferences',
    icon: GitBranch,
  },
  {
    id: 'skills',
    title: 'Skills',
    description: 'Inspect, load, unload, or reload SKILL.md plugins',
    category: 'Preferences',
    icon: BookOpen,
  },
  {
    id: 'refresh-models',
    title: 'Refresh LLM Models',
    description: 'Re-discover models from the active local LLM provider',
    category: 'Actions',
    icon: RefreshCw,
  },
  {
    id: 'reload-skills',
    title: 'Reload Skills from Disk',
    description: 'Re-scan configured skill directories for SKILL.md files',
    category: 'Actions',
    icon: RefreshCw,
  },
  {
    id: 'theme-dark',
    title: 'Theme: Dark Mode',
    description: 'Switch application appearance to dark theme',
    category: 'Appearance',
    icon: Moon,
  },
  {
    id: 'theme-light',
    title: 'Theme: Light Mode',
    description: 'Switch application appearance to light theme',
    category: 'Appearance',
    icon: Sun,
  },
  {
    id: 'quit',
    title: 'Quit Supergravity',
    description: 'Close the application window',
    category: 'Application',
    icon: Power,
  },
];

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    config,
    activeWorkspace,
    activeProviderId,
    activeArtifact,
    setCommandPaletteOpen,
    setSettingsOpen,
    setProjectModalOpen,
    setArtifactPaneOpen,
    setActiveArtifact,
    toggleTerminal,
    toggleSidebar,
    toggleArtifactPane,
    setTheme,
    saveConfig,
    refreshProviderModels,
    reloadSkills,
    fetchWorkspaceFiles,
    addNotification,
  } = useAppStore();

  const { createConversation, activeConversation } = useConversationStore();

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (cmd) =>
        cmd.title.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q) ||
        cmd.category.toLowerCase().includes(q)
    );
  }, [query]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const itemEl = container.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
    if (itemEl && typeof itemEl.scrollIntoView === 'function') {
      itemEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const closePalette = () => {
    setCommandPaletteOpen(false);
    onClose();
  };

  const executeCommand = async (cmd: CommandItem) => {
    closePalette();

    switch (cmd.id) {
      case 'new-conversation': {
        const activeProjId = config.workspace.active_project_id || null;
        const activeProj = (config.workspace.projects || []).find(
          (p) => p.id === activeProjId
        );
        const wsPath = activeProj?.folders?.[0]?.path || activeWorkspace;
        await createConversation(
          'New Conversation',
          undefined,
          wsPath,
          activeProjId,
          activeProj?.settings?.default_worktree_mode || 'local'
        );
        break;
      }
      case 'new-project':
        setProjectModalOpen(true, null);
        break;
      case 'toggle-terminal':
        toggleTerminal();
        break;
      case 'toggle-artifacts':
        toggleArtifactPane();
        break;
      case 'toggle-sidebar':
        toggleSidebar();
        break;
      case 'open-file': {
        setArtifactPaneOpen(true);
        const activeProj = (config.workspace.projects || []).find(
          (p) => p.id === config.workspace.active_project_id
        );
        const wsPath =
          activeConversation?.workspace_path ||
          activeProj?.folders?.[0]?.path ||
          activeWorkspace;
        const entries = await fetchWorkspaceFiles(wsPath, false);
        const firstFile = entries.find((e) => !e.is_dir);
        if (firstFile && isTauri()) {
          try {
            const res = await fsIpc.readFile({ path: firstFile.path });
            setActiveArtifact({
              title: firstFile.name,
              path: firstFile.path,
              content: res.is_binary ? '[Binary file]' : res.content,
              language: firstFile.name.endsWith('.md') ? 'markdown' : 'text',
            });
          } catch {
            // ignore read error
          }
        }
        break;
      }
      case 'save-file': {
        if (activeArtifact && isTauri()) {
          const targetPath =
            activeArtifact.path ||
            `${activeWorkspace === '.' ? '' : activeWorkspace + '/'}${activeArtifact.title || 'artifact.md'}`;
          try {
            await fsIpc.writeFile({
              path: targetPath,
              content: activeArtifact.content,
              create_dirs: true,
            });
            addNotification('success', `Saved ${targetPath}`);
          } catch {
            addNotification('error', `Failed to save ${targetPath}`);
          }
        } else {
          setArtifactPaneOpen(true);
        }
        break;
      }
      case 'settings':
      case 'llm-providers':
        setSettingsOpen(true, 'providers');
        break;
      case 'mcp-servers':
        setSettingsOpen(true, 'mcp');
        break;
      case 'skills':
        setSettingsOpen(true, 'skills');
        break;
      case 'refresh-models':
        if (activeProviderId) {
          await refreshProviderModels(activeProviderId);
        }
        break;
      case 'reload-skills':
        await reloadSkills();
        break;
      case 'theme-dark':
        setTheme('dark');
        await saveConfig({ ui: { ...useAppStore.getState().config.ui, theme: 'dark' } });
        break;
      case 'theme-light':
        setTheme('light');
        await saveConfig({ ui: { ...useAppStore.getState().config.ui, theme: 'light' } });
        break;
      case 'quit':
        if (isTauri()) {
          await windowIpc.closeWindow('main').catch(() => {});
        }
        break;
      default:
        break;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
      }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filteredCommands.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const cmd = filteredCommands[selectedIndex];
      if (cmd) {
        executeCommand(cmd);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] px-4"
      onClick={closePalette}
    >
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-xl bg-[#111827] border border-gray-700/80 rounded-xl shadow-2xl flex flex-col overflow-hidden z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input */}
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
          <Search className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="command-palette-list"
            aria-label="Type a command"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or search actions..."
            className="flex-1 bg-transparent text-white placeholder-gray-500 outline-none text-sm"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="p-1 text-gray-500 hover:text-gray-300 rounded"
              aria-label="Clear command query"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={closePalette}
            className="p-1 text-gray-400 hover:text-white rounded hover:bg-gray-800"
            aria-label="Close command palette"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Command List */}
        <div
          id="command-palette-list"
          ref={listRef}
          role="listbox"
          className="max-h-80 overflow-y-auto p-1.5 space-y-0.5"
        >
          {filteredCommands.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No matching commands found
            </div>
          ) : (
            filteredCommands.map((cmd, index) => {
              const Icon = cmd.icon;
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  role="option"
                  aria-selected={isSelected}
                  data-cmd-index={index}
                  onClick={() => executeCommand(cmd)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    'px-3 py-2.5 rounded-lg flex items-center justify-between cursor-pointer text-sm transition-colors',
                    isSelected
                      ? 'bg-blue-600/20 text-white border border-blue-500/40'
                      : 'text-gray-300 hover:bg-gray-800/70 hover:text-white border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0',
                        isSelected
                          ? 'bg-blue-600/30 text-blue-300'
                          : 'bg-gray-800 text-gray-400'
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-xs sm:text-sm truncate">{cmd.title}</div>
                      <div className="text-xs text-gray-400 truncate">{cmd.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    {cmd.shortcut && (
                      <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-gray-800 border border-gray-700 rounded text-gray-300">
                        {cmd.shortcut}
                      </kbd>
                    )}
                    <CornerDownLeft
                      className={cn(
                        'w-3.5 h-3.5',
                        isSelected ? 'text-blue-400' : 'text-gray-600'
                      )}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Hint */}
        <div className="px-4 py-2 border-t border-gray-800 bg-gray-900/80 flex items-center justify-between text-[11px] text-gray-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <ArrowUp className="w-3 h-3" />
              <ArrowDown className="w-3 h-3" />
              navigate
            </span>
            <span className="flex items-center gap-1">
              <CornerDownLeft className="w-3 h-3" />
              run
            </span>
            <span>Esc close</span>
          </div>
          <span>{filteredCommands.length} commands</span>
        </div>
      </div>
    </div>
  );
}
