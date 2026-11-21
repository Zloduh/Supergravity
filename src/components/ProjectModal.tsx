import { useEffect, useState } from 'react';
import {
  X,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Server,
  Trash2,
  Shield,
  Layers,
  Check,
  Plus,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useConversationStore } from '../stores/conversationStore';
import type { ProjectPermissionPreset, WorktreeMode } from '../types/config';
import { isTauri } from '../utils/tauri';
import { cn } from '../utils/cn';

interface DraftFolder {
  path: string;
  name?: string;
  createOnDisk: boolean;
  sshHost?: string | null;
}

export function ProjectModal() {
  const {
    projectModalOpen,
    editingProjectId,
    setProjectModalOpen,
    config,
    activeWorkspace,
    createProject,
    updateProject,
    deleteProject,
    addFolderToProject,
    removeFolderFromProject,
  } = useAppStore();

  const { setActiveWorktreeMode } = useConversationStore();

  const projects = config.workspace.projects || [];
  const editingProject = editingProjectId
    ? projects.find((p) => p.id === editingProjectId) || null
    : null;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [folderMode, setFolderMode] = useState<'new_drive' | 'existing' | 'ssh'>('new_drive');
  const [folderPathInput, setFolderPathInput] = useState('');
  const [sshHostInput, setSshHostInput] = useState('');
  const [draftFolders, setDraftFolders] = useState<DraftFolder[]>([]);
  const [permissionPreset, setPermissionPreset] =
    useState<ProjectPermissionPreset>('inherit_global');
  const [defaultWorktreeMode, setDefaultWorktreeMode] = useState<WorktreeMode>('local');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [allowedPathsInput, setAllowedPathsInput] = useState('');
  const [fileAccessPolicy, setFileAccessPolicy] = useState('inherit');
  const [internetAccessPolicy, setInternetAccessPolicy] = useState('inherit');
  const [sandboxOverride, setSandboxOverride] = useState<'inherit' | 'enabled' | 'disabled'>(
    'inherit'
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!projectModalOpen) return;
    setErrorMsg(null);
    if (editingProject) {
      setName(editingProject.name);
      setDescription(editingProject.description || '');
      setDraftFolders(
        editingProject.folders.map((f) => ({
          path: f.path,
          name: f.name,
          createOnDisk: false,
          sshHost: f.ssh_host || null,
        }))
      );
      setPermissionPreset(editingProject.settings.permission_preset || 'inherit_global');
      setDefaultWorktreeMode(editingProject.settings.default_worktree_mode || 'local');
      setSystemPrompt(editingProject.settings.system_prompt || '');
      setAllowedPathsInput((editingProject.settings.allowed_paths || []).join(', '));
      setFileAccessPolicy(editingProject.settings.file_access_policy || 'inherit');
      setInternetAccessPolicy(editingProject.settings.internet_access_policy || 'inherit');
      setSandboxOverride(
        editingProject.settings.sandbox_enabled === true
          ? 'enabled'
          : editingProject.settings.sandbox_enabled === false
            ? 'disabled'
            : 'inherit'
      );
      setFolderPathInput('');
      setSshHostInput('');
    } else {
      setName('');
      setDescription('');
      const initialBase =
        activeWorkspace && activeWorkspace !== '.' ? activeWorkspace : '/workspace/new-project';
      setFolderPathInput(initialBase);
      setSshHostInput('');
      setDraftFolders([]);
      setPermissionPreset('inherit_global');
      setDefaultWorktreeMode('local');
      setSystemPrompt('');
      setAllowedPathsInput('');
      setFileAccessPolicy('inherit');
      setInternetAccessPolicy('inherit');
      setSandboxOverride('inherit');
    }
  }, [projectModalOpen, editingProject, activeWorkspace]);

  if (!projectModalOpen) return null;

  const handleBrowseNativeFolder = async () => {
    if (isTauri()) {
      try {
        const dialog = await import('@tauri-apps/plugin-dialog');
        const selected = await dialog.open({
          directory: true,
          multiple: false,
          defaultPath: activeWorkspace !== '.' ? activeWorkspace : undefined,
        });
        if (typeof selected === 'string' && selected.trim()) {
          setFolderPathInput(selected.trim());
          if (!name.trim()) {
            const guessed = selected.replace(/\/+$/, '').split('/').pop() || 'Project';
            setName(guessed);
          }
        }
      } catch {
        // Fallback to manual input if dialog fails in headless environment
      }
    }
  };

  const handleAddDraftFolder = async () => {
    const clean = folderPathInput.trim();
    if (!clean) {
      setErrorMsg('Enter a folder path first.');
      return;
    }
    if (folderMode === 'ssh' && !sshHostInput.trim()) {
      setErrorMsg('Enter an SSH Host (e.g. user@remote-linux) for remote folders.');
      return;
    }
    setErrorMsg(null);

    const newEntry: DraftFolder = {
      path: clean,
      name: clean.replace(/\/+$/, '').split('/').filter(Boolean).pop() || clean,
      createOnDisk: folderMode === 'new_drive',
      sshHost: folderMode === 'ssh' ? sshHostInput.trim() : null,
    };

    if (!name.trim()) {
      setName(newEntry.name || 'New Project');
    }

    if (editingProject) {
      await addFolderToProject(editingProject.id, newEntry);
    }

    setDraftFolders((prev) => {
      if (prev.some((f) => f.path === newEntry.path && f.sshHost === newEntry.sshHost)) {
        return prev;
      }
      return [...prev, newEntry];
    });
    setFolderPathInput('');
  };

  const handleRemoveDraftFolder = async (pathToRemove: string) => {
    if (editingProject) {
      await removeFolderFromProject(editingProject.id, pathToRemove);
    }
    setDraftFolders((prev) => prev.filter((f) => f.path !== pathToRemove));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    let finalFolders = [...draftFolders];
    if (finalFolders.length === 0 && folderPathInput.trim()) {
      finalFolders.push({
        path: folderPathInput.trim(),
        name:
          folderPathInput.trim().replace(/\/+$/, '').split('/').filter(Boolean).pop() ||
          folderPathInput.trim(),
        createOnDisk: folderMode === 'new_drive',
        sshHost: folderMode === 'ssh' ? sshHostInput.trim() || null : null,
      });
    }

    if (finalFolders.length === 0) {
      setErrorMsg('Add at least one folder (create new on drive, open existing, or SSH host).');
      return;
    }

    const finalName =
      name.trim() ||
      finalFolders[0]?.name ||
      finalFolders[0]?.path.split('/').filter(Boolean).pop() ||
      'New Project';

    const allowedPaths = allowedPathsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    setSubmitting(true);
    try {
      if (editingProject) {
        await updateProject(editingProject.id, {
          name: finalName,
          description: description.trim() || null,
          settings: {
            permission_preset: permissionPreset,
            default_worktree_mode: defaultWorktreeMode,
            system_prompt: systemPrompt.trim() || null,
            require_command_approval:
              permissionPreset === 'always_ask'
                ? true
                : editingProject.settings.require_command_approval ?? null,
            allowed_paths: allowedPaths,
            file_access_policy: fileAccessPolicy === 'inherit' ? null : fileAccessPolicy,
            internet_access_policy:
              internetAccessPolicy === 'inherit' ? null : internetAccessPolicy,
            sandbox_enabled:
              sandboxOverride === 'inherit' ? null : sandboxOverride === 'enabled',
          },
        });
        setActiveWorktreeMode(defaultWorktreeMode);
        setProjectModalOpen(false);
      } else {
        const created = await createProject({
          name: finalName,
          description: description.trim() || undefined,
          folders: finalFolders,
          settings: {
            permission_preset: permissionPreset,
            default_worktree_mode: defaultWorktreeMode,
            system_prompt: systemPrompt.trim() || null,
            require_command_approval: permissionPreset === 'always_ask' ? true : null,
            allowed_paths: allowedPaths,
            file_access_policy: fileAccessPolicy === 'inherit' ? null : fileAccessPolicy,
            internet_access_policy:
              internetAccessPolicy === 'inherit' ? null : internetAccessPolicy,
            sandbox_enabled:
              sandboxOverride === 'inherit' ? null : sandboxOverride === 'enabled',
          },
        });
        if (created) {
          setActiveWorktreeMode(defaultWorktreeMode);
          setProjectModalOpen(false);
        } else {
          setErrorMsg('Could not create project. Check folder permissions and try again.');
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editingProject ? `Configure Project ${editingProject.name}` : 'Create New Project'}
    >
      <div className="w-full max-w-2xl bg-[#0f1522] border border-gray-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 bg-gray-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {editingProject ? `Project Settings: ${editingProject.name}` : 'New Project Workspace'}
              </h2>
              <p className="text-[11px] text-gray-400">
                Multi-folder workspace configurations, isolated agent settings, and worktrees
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setProjectModalOpen(false)}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close project modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-5 space-y-5">
          {errorMsg && (
            <div className="px-3 py-2 rounded-lg bg-red-950/60 border border-red-800/70 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {/* Project Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Project Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Fullstack App"
                aria-label="Project Name"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                Description (Optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Frontend + Rust backend repositories"
                aria-label="Project Description"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Multi-Folder Workspace Configuration */}
          <div className="space-y-3 p-3.5 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                Project Folders ({draftFolders.length})
              </span>
              <span className="text-[11px] text-gray-400">
                Single or multi-folder scope (Local, Git checkout, or SSH Host)
              </span>
            </div>

            {/* Folder Source Mode Selector */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setFolderMode('new_drive')}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors',
                  folderMode === 'new_drive'
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
                    : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                )}
              >
                <FolderPlus className="w-3.5 h-3.5" />
                Create New Folder on Drive
              </button>
              <button
                type="button"
                onClick={() => setFolderMode('existing')}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors',
                  folderMode === 'existing'
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
                    : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                )}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open Existing Folder
              </button>
              <button
                type="button"
                onClick={() => setFolderMode('ssh')}
                className={cn(
                  'flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border transition-colors',
                  folderMode === 'ssh'
                    ? 'bg-blue-600/20 text-blue-300 border-blue-500/50'
                    : 'bg-gray-900 text-gray-400 border-gray-800 hover:text-gray-200'
                )}
              >
                <Server className="w-3.5 h-3.5" />
                SSH Host…
              </button>
            </div>

            {folderMode === 'ssh' && (
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">
                  Remote Linux SSH Host
                </label>
                <input
                  type="text"
                  value={sshHostInput}
                  onChange={(e) => setSshHostInput(e.target.value)}
                  placeholder="user@192.168.0.92"
                  aria-label="SSH Host"
                  className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={folderPathInput}
                onChange={(e) => setFolderPathInput(e.target.value)}
                placeholder={
                  folderMode === 'new_drive'
                    ? '/path/to/new-project-folder (will be created on disk)'
                    : folderMode === 'ssh'
                      ? '/remote/repo/path'
                      : '/path/to/existing/folder-or-git-repo'
                }
                aria-label="Project Folder Path"
                className="flex-1 px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
              {folderMode === 'existing' && (
                <button
                  type="button"
                  onClick={handleBrowseNativeFolder}
                  className="px-2.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg text-xs border border-gray-700 transition-colors"
                >
                  Browse…
                </button>
              )}
              <button
                type="button"
                onClick={handleAddDraftFolder}
                className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Folder
              </button>
            </div>

            {/* Folder List */}
            {draftFolders.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {draftFolders.map((f) => (
                  <div
                    key={`${f.sshHost || 'local'}:${f.path}`}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-950/80 border border-gray-800 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {f.sshHost ? (
                        <Server className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                      ) : f.createOnDisk ? (
                        <FolderPlus className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <GitBranch className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      )}
                      <span className="font-medium text-gray-200">{f.name}</span>
                      <span className="text-gray-500 font-mono truncate">{f.path}</span>
                      {f.createOnDisk && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-950 text-emerald-300 border border-emerald-800/60">
                          Create on drive
                        </span>
                      )}
                      {f.sshHost && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-purple-950 text-purple-300 border border-purple-800/60">
                          SSH: {f.sshHost}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveDraftFolder(f.path)}
                      className="p-1 text-gray-500 hover:text-red-400 rounded"
                      aria-label={`Remove folder ${f.path}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Scoped Settings & Permissions */}
          <div className="space-y-3 p-3.5 rounded-xl bg-gray-900/50 border border-gray-800">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Shield className="w-3.5 h-3.5 text-amber-400" />
              Scoped Project Settings & Permissions
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Permission Preset
                </label>
                <select
                  value={permissionPreset}
                  onChange={(e) =>
                    setPermissionPreset(e.target.value as ProjectPermissionPreset)
                  }
                  aria-label="Permission Preset"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="inherit_global">
                    Inherit Global (Follow global permission settings)
                  </option>
                  <option value="default">
                    Default (Auto inside project sandbox, ask outside)
                  </option>
                  <option value="auto">
                    Auto (Evaluate automatically, pause only on risky actions)
                  </option>
                  <option value="always_ask">
                    Always Ask (Prompt before terminal commands)
                  </option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Default Worktree Mode
                </label>
                <select
                  value={defaultWorktreeMode}
                  onChange={(e) => setDefaultWorktreeMode(e.target.value as WorktreeMode)}
                  aria-label="Default Worktree Mode"
                  className="w-full px-3 py-2 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="local">
                    Local Mode (Work directly in active project folders)
                  </option>
                  <option value="new_worktree">
                    New Worktree Mode (Isolated Git worktree per conversation)
                  </option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  File Access Override
                </label>
                <select
                  aria-label="Project File Access Policy"
                  value={fileAccessPolicy}
                  onChange={(e) => setFileAccessPolicy(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="inherit">Inherit Global</option>
                  <option value="allow">Allow</option>
                  <option value="ask">Ask</option>
                  <option value="deny">Deny</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Internet Access Override
                </label>
                <select
                  aria-label="Project Internet Access Policy"
                  value={internetAccessPolicy}
                  onChange={(e) => setInternetAccessPolicy(e.target.value)}
                  className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="inherit">Inherit Global</option>
                  <option value="allow">Allow</option>
                  <option value="ask">Ask</option>
                  <option value="deny">Deny</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">
                  Sandbox Override
                </label>
                <select
                  aria-label="Project Sandbox Mode"
                  value={sandboxOverride}
                  onChange={(e) =>
                    setSandboxOverride(e.target.value as 'inherit' | 'enabled' | 'disabled')
                  }
                  className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="inherit">Inherit Global</option>
                  <option value="enabled">Enabled</option>
                  <option value="disabled">Disabled</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                Additional Allowed Paths (comma-separated)
              </label>
              <input
                type="text"
                value={allowedPathsInput}
                onChange={(e) => setAllowedPathsInput(e.target.value)}
                placeholder="/shared/libs, /tmp/build-cache"
                aria-label="Additional Allowed Paths"
                className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">
                Project-Scoped System Instructions (Optional)
              </label>
              <textarea
                rows={2}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Custom instructions applied to all agents inside this project..."
                aria-label="Project System Instructions"
                className="w-full px-3 py-1.5 bg-gray-950 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800">
            {editingProject ? (
              <button
                type="button"
                onClick={async () => {
                  await deleteProject(editingProject.id);
                  setProjectModalOpen(false);
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-red-950/60 hover:bg-red-900/70 text-red-300 border border-red-800/60 rounded-lg text-xs font-medium transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete Project
              </button>
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setProjectModalOpen(false)}
                className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                {editingProject ? 'Save Project' : 'Create Project'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
