import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { TerminalDrawer } from './components/TerminalDrawer';
import { CommandPalette } from './components/CommandPalette';
import { ArtifactPane } from './components/ArtifactPane';
import { SettingsModal } from './components/SettingsModal';
import { ProjectModal } from './components/ProjectModal';
import { useAppStore } from './stores/appStore';
import { useConversationStore } from './stores/conversationStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { safeListen } from './utils/tauri';

function App() {
  const [initialized, setInitialized] = useState(false);
  const {
    sidebarOpen,
    terminalOpen,
    commandPaletteOpen,
    theme,
    config,
    activeWorkspace,
    setSidebarOpen,
    setTerminalOpen,
    setCommandPaletteOpen,
    setSettingsOpen,
    toggleSidebar,
    toggleTerminal,
    toggleCommandPalette,
    toggleArtifactPane,
    fetchConfig,
    fetchProviders,
    fetchSkills,
    fetchMCPServers,
  } = useAppStore();

  const { initListeners, fetchConversations, createConversation } = useConversationStore();

  useKeyboardShortcuts([
    {
      key: 'p',
      mod: true,
      shift: true,
      allowInInput: true,
      handler: () => toggleCommandPalette(),
    },
    {
      key: 'k',
      mod: true,
      allowInInput: true,
      handler: () => toggleCommandPalette(),
    },
    {
      key: '`',
      mod: true,
      allowInInput: true,
      handler: () => toggleTerminal(),
    },
    {
      key: ',',
      mod: true,
      allowInInput: true,
      handler: () => setSettingsOpen(true, 'providers'),
    },
    {
      key: 'b',
      mod: true,
      allowInInput: true,
      handler: () => toggleSidebar(),
    },
    {
      key: 'n',
      mod: true,
      allowInInput: true,
      handler: () => {
        const activeProjId = config.workspace?.active_project_id || null;
        const activeProj = (config.workspace?.projects || []).find(
          (p) => p.id === activeProjId
        );
        const wsPath = activeProj?.folders?.[0]?.path || activeWorkspace;
        createConversation(
          'New Conversation',
          undefined,
          wsPath,
          activeProjId,
          activeProj?.settings?.default_worktree_mode || 'local'
        );
      },
    },
    {
      key: 'a',
      mod: true,
      shift: true,
      allowInInput: true,
      handler: () => toggleArtifactPane(),
    },
  ]);

  useEffect(() => {
    let cleanupListeners: (() => void) | undefined;

    async function init() {
      try {
        cleanupListeners = await initListeners();
        await Promise.all([
          fetchConfig(),
          fetchConversations(),
          fetchProviders(),
          fetchSkills(),
          fetchMCPServers(),
        ]);
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setInitialized(true);
      }
    }

    init();

    const unlistenPromise = safeListen<string>('global-shortcut', (payload) => {
      if (payload === 'command-palette') {
        setCommandPaletteOpen(true);
      } else if (payload === 'toggle-terminal') {
        setTerminalOpen(!useAppStore.getState().terminalOpen);
      }
    });

    return () => {
      cleanupListeners?.();
      unlistenPromise.then((fn) => fn());
    };
  }, [
    initListeners,
    fetchConfig,
    fetchConversations,
    fetchProviders,
    fetchSkills,
    fetchMCPServers,
    setCommandPaletteOpen,
    setTerminalOpen,
  ]);

  if (!initialized) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0b0f17]">
        <div className="flex flex-col items-center gap-4 text-white">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-gray-300 tracking-wide">Loading Antigravity…</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-theme={theme}
      style={{
        fontFamily: config.ui?.font_family || 'Inter, system-ui, sans-serif',
        fontSize: config.ui?.font_size ? `${config.ui.font_size}px` : undefined,
      }}
      className="flex h-screen w-screen bg-[#0b0f17] text-gray-100 overflow-hidden select-none"
    >
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(!sidebarOpen)} />
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 flex overflow-hidden min-h-0">
          <MainContent />
          <ArtifactPane />
        </div>
        <TerminalDrawer isOpen={terminalOpen} onClose={() => setTerminalOpen(false)} />
      </div>
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
      <SettingsModal />
      <ProjectModal />
    </div>
  );
}

export default App;
