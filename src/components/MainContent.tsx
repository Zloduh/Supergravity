import { useState, useRef, useMemo } from 'react';
import {
  useConversationStore,
  type ConversationMessage,
  type PendingQuestion,
  type PendingApproval,
  type PendingPlanReview,
} from '../stores/conversationStore';
import { useAppStore } from '../stores/appStore';
import { useAutoScroll } from '../hooks/useAutoScroll';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  MessageSquare,
  Send,
  Layout,
  Bot,
  User,
  Zap,
  ChevronDown,
  ChevronRight,
  Brain,
  Wrench,
  FolderOpen,
  Layers,
  GitBranch,
  Settings,
  Terminal,
  Square,
  Check,
  ShieldAlert,
  HelpCircle,
  Copy,
  RotateCcw,
  ArrowDown,
  AlertCircle,
  X,
  FileText,
  Paperclip,
  Sparkles,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { isTauri } from '../utils/tauri';

function extractThinkBlocks(
  content: string,
  reasoningContent?: string
): { thinking: string; body: string } {
  let thinking = reasoningContent || '';
  let body = content || '';
  const regex = /<think>([\s\S]*?)<\/think>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    thinking += (thinking ? '\n\n' : '') + match[1].trim();
  }
  body = body.replace(regex, '').trim();
  // Handle unclosed <think> during streaming
  const openIdx = body.toLowerCase().indexOf('<think>');
  if (openIdx !== -1) {
    thinking += (thinking ? '\n\n' : '') + body.slice(openIdx + 7).trim();
    body = body.slice(0, openIdx).trim();
  }
  return { thinking: thinking.trim(), body };
}

function ThinkingBlock({
  content,
  defaultOpen = false,
}: {
  content: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!content) return null;
  return (
    <div className="mb-3 rounded-lg border border-purple-500/30 bg-purple-950/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-purple-300 hover:bg-purple-900/20 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 flex-shrink-0" />
        <span>Thinking / Reasoning</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1.5 text-xs text-purple-200/85 whitespace-pre-wrap border-t border-purple-500/20 font-mono leading-relaxed select-text">
          {content}
        </div>
      )}
    </div>
  );
}

function ToolCallCard({
  toolName,
  argsText,
  output,
  onPreview,
}: {
  toolName: string;
  argsText?: string;
  output?: string;
  onPreview?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2 rounded-lg border border-gray-800 bg-gray-950/80 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800/60 transition-colors"
      >
        <Wrench className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
        <span className="font-mono font-medium text-blue-300 truncate">{toolName}</span>
        {output !== undefined ? (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] flex-shrink-0">
            completed
          </span>
        ) : (
          <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 text-[10px] animate-pulse flex-shrink-0">
            running
          </span>
        )}
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto flex-shrink-0" />
        )}
      </button>
      {open && (
        <div className="border-t border-gray-800 p-3 space-y-2 text-xs font-mono select-text">
          {argsText && (
            <div>
              <div className="text-[10px] uppercase text-gray-500 mb-1">Arguments</div>
              <pre className="p-2 rounded bg-gray-900 text-gray-300 overflow-x-auto max-h-40">
                {argsText}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] uppercase text-gray-500">Output</span>
                {onPreview && (
                  <button
                    type="button"
                    onClick={onPreview}
                    className="text-[11px] text-blue-400 hover:text-blue-300 underline"
                  >
                    Open in Pane
                  </button>
                )}
              </div>
              <pre className="p-2 rounded bg-gray-900 text-gray-200 overflow-x-auto max-h-60 whitespace-pre-wrap">
                {output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AskQuestionWidget({
  item,
  onSubmit,
}: {
  item: PendingQuestion;
  onSubmit: (answers: Record<string, string[]>) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [customText, setCustomText] = useState<Record<string, string>>({});

  const toggle = (qText: string, opt: string, multi?: boolean) => {
    setSelected((prev) => {
      const cur = prev[qText] || [];
      if (multi) {
        return {
          ...prev,
          [qText]: cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt],
        };
      }
      return { ...prev, [qText]: [opt] };
    });
  };

  const handleSubmit = () => {
    const merged: Record<string, string[]> = { ...selected };
    for (const q of item.questions) {
      const custom = (customText[q.question] || '').trim();
      if (custom) {
        merged[q.question] = [...(merged[q.question] || []), custom];
      }
    }
    onSubmit(merged);
  };

  return (
    <div className="my-3 p-4 rounded-xl border border-blue-500/40 bg-blue-950/20 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-blue-300">
        <HelpCircle className="w-4 h-4" />
        <span>Agent Question</span>
      </div>
      {item.questions.map((q) => (
        <div key={q.question} className="space-y-2">
          <p className="text-sm text-white">{q.question}</p>
          <div className="flex flex-wrap gap-2">
            {q.options.map((opt) => {
              const isSel = (selected[q.question] || []).includes(opt);
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(q.question, opt, q.is_multi_select)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs border transition-colors flex items-center gap-1.5',
                    isSel
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-900 border-gray-700 text-gray-300 hover:border-gray-500'
                  )}
                >
                  {isSel && <Check className="w-3 h-3" />}
                  {opt}
                </button>
              );
            })}
          </div>
          <input
            type="text"
            value={customText[q.question] || ''}
            onChange={(e) =>
              setCustomText((prev) => ({ ...prev, [q.question]: e.target.value }))
            }
            placeholder="Or type a custom answer..."
            className="w-full px-3 py-1.5 bg-gray-900/90 border border-gray-800 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
      ))}
      <button
        type="button"
        onClick={handleSubmit}
        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors"
      >
        Submit Answer
      </button>
    </div>
  );
}

function CommandApprovalWidget({
  item,
  onDecision,
}: {
  item: PendingApproval;
  onDecision: (approved: boolean) => void;
}) {
  return (
    <div className="my-3 p-4 rounded-xl border border-amber-500/40 bg-amber-950/20 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
        <ShieldAlert className="w-4 h-4" />
        <span>Approve Command Execution?</span>
      </div>
      <p className="text-xs text-gray-300">{item.summary}</p>
      <pre className="p-2 rounded bg-gray-950 border border-gray-800 text-xs font-mono text-amber-200 overflow-x-auto select-text">
        {item.command}
      </pre>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => onDecision(true)}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => onDecision(false)}
          className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

function PlanReviewWidget({
  item,
  onOpenArtifact,
  onDecision,
}: {
  item: PendingPlanReview;
  onOpenArtifact: () => void;
  onDecision: (approved: boolean, feedback?: string) => void;
}) {
  const [feedback, setFeedback] = useState('');

  return (
    <div className="my-3 p-4 rounded-xl border border-indigo-500/40 bg-indigo-950/25 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
          <FileText className="w-4 h-4" />
          <span>Implementation Plan Ready for Review</span>
        </div>
        <button
          type="button"
          onClick={onOpenArtifact}
          className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-200 text-xs font-medium transition-colors"
        >
          Open Plan in Auxiliary Pane
        </button>
      </div>
      <p className="text-xs text-gray-300">{item.summary}</p>
      <div className="max-h-48 overflow-y-auto p-3 rounded-lg bg-gray-950/80 border border-gray-800 text-xs">
        <MarkdownRenderer content={item.content} />
      </div>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onDecision(true)}
          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5" />
          Proceed with Plan
        </button>
        <input
          type="text"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="Or type requested changes to steer the plan..."
          className="flex-1 px-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={() => onDecision(false, feedback.trim() || 'Please revise the plan.')}
          className="px-3 py-1.5 bg-amber-600/80 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Request Changes
        </button>
      </div>
    </div>
  );
}

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'Create a structured implementation plan with Proceed / Review gate' },
  { cmd: '/compact', desc: 'Summarize and compact the current conversation context' },
  { cmd: '/goal', desc: 'Run an autonomous multi-step goal loop until complete' },
  { cmd: '/grill-me', desc: 'Align on a plan through an interactive design interview' },
  { cmd: '/boost', desc: 'Deep thinking, multi-perspective analysis, and rigorous verification' },
  { cmd: '/teamwork', desc: 'Orchestrate a team of specialist subagents in parallel' },
  { cmd: '/swarm', desc: 'Spawn parallel swarm workers collaborating on a shared board' },
  { cmd: '/learn', desc: 'Persist a correction or setup into project rules or SKILL.md' },
  { cmd: '/schedule', desc: 'Run an instruction on a recurring cron schedule or timer' },
  { cmd: '/browser', desc: 'Delegate web navigation and UI testing to the browser subagent' },
];

export function MainContent() {
  const {
    conversations,
    activeConversationId,
    activeConversation,
    activeWorktreeMode,
    setActiveWorktreeMode,
    moveConversationToProject,
    activeTaskId,
    isStreaming,
    streamingContent,
    streamingReasoning,
    pendingQuestions,
    pendingApprovals,
    pendingPlanReviews,
    sendMessage,
    regenerateLastResponse,
    cancelAgentTask,
    createConversation,
    answerQuestion,
    approveCommand,
    submitPlanReview,
    clearError,
    loading,
    error,
  } = useConversationStore();

  const {
    config,
    activeWorkspace,
    setActiveWorkspace,
    setActiveProject,
    setProjectModalOpen,
    workspaceFiles,
    fetchWorkspaceFiles,
    providers,
    models,
    selectedModel,
    setSelectedModel,
    activeProviderId,
    setActiveProvider,
    skills,
    mcpServers,
    artifactPaneOpen,
    terminalOpen,
    toggleArtifactPane,
    setActiveArtifact,
    toggleTerminal,
    setSettingsOpen,
  } = useAppStore();

  const projects = config.workspace.projects || [];
  const activeProjectId =
    activeConversation?.project_id || config.workspace.active_project_id || null;
  const activeProject = projects.find((p) => p.id === activeProjectId) || null;
  const isKnowledgeWorkLayout = config.workspace.interface_layout === 'knowledge_work';
  const currentWorktreeMode =
    activeConversation?.worktree_mode ||
    activeWorktreeMode ||
    activeProject?.settings?.default_worktree_mode ||
    'local';

  const [input, setInput] = useState('');
  const [showSlashPicker, setShowSlashPicker] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [fileFilter, setFileFilter] = useState('');
  const [attachments, setAttachments] = useState<
    Array<{ name: string; type: string; content: string; isImage: boolean }>
  >([]);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { containerRef, bottomRef, showScrollButton, scrollToBottom, handleScroll } =
    useAutoScroll([
      activeConversation?.messages.length,
      streamingContent,
      streamingReasoning,
      pendingQuestions.length,
      pendingApprovals.length,
    ]);

  const activeProvider =
    providers.find((p) => p.id === activeProviderId) || providers[0] || null;
  const providerError =
    activeProvider &&
    typeof activeProvider.status === 'object' &&
    'error' in activeProvider.status
      ? activeProvider.status.error
      : null;

  const slashItems = useMemo(() => {
    const query = input.startsWith('/') ? input.slice(1).toLowerCase() : '';
    const base = SLASH_COMMANDS.map((c) => ({ cmd: c.cmd, desc: c.desc }));
    const skillCmds = skills.slice(0, 10).map((s) => ({
      cmd: `/${s.name}`,
      desc: s.description.slice(0, 75),
    }));
    return [...base, ...skillCmds].filter(
      (item) => !query || item.cmd.toLowerCase().includes(query)
    );
  }, [input, skills]);

  const matchingMentions = useMemo(() => {
    const q = fileFilter.toLowerCase();
    const items: Array<{ category: string; label: string; value: string; sub: string }> = [];

    // 1. Files & Folders
    for (const f of workspaceFiles) {
      if (!q || f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)) {
        items.push({
          category: f.is_dir ? 'Folder' : 'File',
          label: f.name,
          value: f.path,
          sub: f.path,
        });
      }
      if (items.length >= 6) break;
    }

    // 2. Project Folders
    for (const pf of activeProject?.folders || []) {
      if (!q || pf.name.toLowerCase().includes(q) || pf.path.toLowerCase().includes(q)) {
        items.push({
          category: 'Project Folder',
          label: pf.name,
          value: pf.path,
          sub: pf.git_branch ? `${pf.path} (${pf.git_branch})` : pf.path,
        });
      }
    }

    // 3. Previous Conversations
    for (const c of conversations.slice(0, 5)) {
      if (c.id === activeConversationId) continue;
      if (!q || c.title.toLowerCase().includes(q)) {
        items.push({
          category: 'Conversation',
          label: c.title,
          value: `conversation:${c.title}`,
          sub: `${c.messages.length} msgs`,
        });
      }
    }

    // 4. Rules & Skills
    for (const ruleName of ['GEMINI.md', 'AGENTS.md']) {
      if (!q || ruleName.toLowerCase().includes(q) || 'rule'.includes(q)) {
        items.push({
          category: 'Rule',
          label: ruleName,
          value: `rule:${ruleName}`,
          sub: 'Workspace Rule',
        });
      }
    }

    // 5. MCP Servers & Tools
    for (const srv of mcpServers) {
      if (!q || srv.name.toLowerCase().includes(q) || 'mcp'.includes(q)) {
        items.push({
          category: 'MCP',
          label: srv.name,
          value: `mcp:${srv.name}`,
          sub: `${srv.tools?.length || 0} tools`,
        });
      }
    }

    return items.slice(0, 10);
  }, [
    workspaceFiles,
    fileFilter,
    activeProject?.folders,
    conversations,
    activeConversationId,
    mcpServers,
  ]);

  const adjustTextareaHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, Math.max(48, el.scrollHeight))}px`;
  };

  const handleInputChange = (val: string) => {
    setInput(val);
    const isSlash = val.startsWith('/') && !val.includes(' ');
    setShowSlashPicker(isSlash);
    if (isSlash) {
      setSlashIndex(0);
    }

    const atMatch = /(?:^|\s)@([^\s]*)$/.exec(val);
    if (atMatch) {
      setFileFilter(atMatch[1] || '');
      setShowFilePicker(true);
      if (workspaceFiles.length === 0) {
        const effectiveWs =
          activeConversation?.workspace_path ||
          activeProject?.folders?.[0]?.path ||
          activeWorkspace;
        fetchWorkspaceFiles(effectiveWs, false);
      }
    } else {
      setShowFilePicker(false);
    }

    setTimeout(adjustTextareaHeight, 0);
  };

  const insertFileMention = (filePath: string) => {
    const replaced = input.replace(/(?:^|\s)@([^\s]*)$/, (m) => {
      const prefix = m.startsWith(' ') ? ' ' : '';
      return `${prefix}@${filePath} `;
    });
    setInput(replaced);
    setShowFilePicker(false);
    textareaRef.current?.focus();
  };

  const handleFilesAttached = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    Array.from(fileList).forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === 'string' ? reader.result : '';
        setAttachments((prev) => [
          ...prev,
          { name: file.name, type: file.type || 'text/plain', content: res, isImage },
        ]);
      };
      if (isImage) {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const handleSelectWorkspace = async () => {
    if (isTauri()) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const dir = await open({ directory: true, multiple: false });
        if (typeof dir === 'string') {
          setActiveWorkspace(dir);
          fetchWorkspaceFiles(dir, false);
        }
      } catch (e) {
        console.error('Folder dialog error:', e);
      }
    }
  };

  const submitPromptText = async (rawPrompt: string) => {
    if (!rawPrompt.trim() && attachments.length === 0) return;

    const effectiveWs = activeProject?.folders?.[0]?.path || activeWorkspace;
    const effectiveMode = isKnowledgeWorkLayout ? 'local' : currentWorktreeMode;

    let convId = activeConversationId;
    if (!convId) {
      const created = await createConversation(
        (rawPrompt || attachments[0]?.name || 'New Conversation').slice(0, 40),
        undefined,
        effectiveWs,
        activeProjectId,
        effectiveMode
      );
      if (!created) return;
      convId = created.id;
    }

    let prompt = rawPrompt;
    if (attachments.length > 0) {
      const blocks = attachments.map((att) =>
        att.isImage
          ? `<attached_image name="${att.name}" mime="${att.type}" data_url="${att.content.slice(0, 128)}..." />`
          : `<attached_file name="${att.name}" mime="${att.type}">\n${att.content}\n</attached_file>`
      );
      prompt = `${prompt}\n\n${blocks.join('\n')}`.trim();
    }
    if (prompt.startsWith('/plan ')) {
      prompt = `Create a detailed step-by-step implementation plan and save it as a plan.md artifact using write_file with ArtifactMetadata: { "Summary": "Implementation Plan", "UserFacing": true, "RequestFeedback": true } so the user can click Proceed before you edit code:\n\n${prompt.slice(6)}`;
    } else if (prompt === '/compact') {
      prompt =
        'Summarize our conversation so far into key decisions, current state, and next steps.';
    } else if (prompt.startsWith('/goal ')) {
      prompt = `Autonomous Goal Mode: Work step-by-step using your tools until this goal is completely achieved and verified:\n\n${prompt.slice(6)}`;
    } else if (prompt.startsWith('/grill-me')) {
      prompt = `Interactive Design Interview (/grill-me): Ask me targeted multiple-choice questions using the ask_question tool to clarify architecture, edge cases, and design decisions before writing code:\n\n${prompt.slice(9).trim()}`;
    } else if (prompt.startsWith('/boost ')) {
      prompt = `Boost Mode (/boost): Analyze this problem from multiple architectural perspectives, create a verification plan, implement the solution, and verify all edge cases:\n\n${prompt.slice(7)}`;
    } else if (prompt.startsWith('/teamwork ') || prompt.startsWith('/swarm ')) {
      const rest = prompt.replace(/^\/(teamwork|swarm)\s+/, '');
      prompt = `Multi-Agent Swarm Mode: Break this objective into parallel workstreams, invoke specialist subagents via invoke_subagent, and synthesize their verified results:\n\n${rest}`;
    } else if (prompt.startsWith('/learn ')) {
      prompt = `Learn Mode (/learn): Persist the following rule, workflow, or setup instruction into .agents/rules/ or a SKILL.md file so future sessions remember it:\n\n${prompt.slice(7)}`;
    } else if (prompt.startsWith('/schedule ')) {
      prompt = `Schedule Mode (/schedule): Use the schedule tool to register this recurring cron job or one-shot timer:\n\n${prompt.slice(10)}`;
    } else if (prompt.startsWith('/browser ')) {
      prompt = `Browser Subagent Mode (/browser): Delegate this web/UI task to the browser subagent via invoke_subagent(TypeName="browser"):\n\n${prompt.slice(9)}`;
    }

    setInput('');
    setAttachments([]);
    setShowSlashPicker(false);
    setShowFilePicker(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    await sendMessage(
      convId,
      prompt,
      activeProviderId || undefined,
      selectedModel || undefined,
      effectiveWs,
      activeProjectId,
      effectiveMode
    );
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitPromptText(input);
  };

  const handleCopyMessage = (id: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 1500);
  };

  // Pair assistant tool_calls with subsequent tool messages
  const toolResultsMap = useMemo(() => {
    const map = new Map<string, ConversationMessage>();
    for (const m of activeConversation?.messages || []) {
      if (m.role === 'tool' && m.tool_call_id) {
        map.set(m.tool_call_id, m);
      }
    }
    return map;
  }, [activeConversation?.messages]);

  const visibleMessages = useMemo(
    () =>
      (activeConversation?.messages || []).filter(
        (m) => m.role !== 'tool' && m.role !== 'system'
      ),
    [activeConversation?.messages]
  );

  return (
    <main className="flex flex-1 h-full flex-col bg-[#0b0f17] relative min-w-0">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/80 bg-[#0d121c]/90 backdrop-blur z-10 gap-2 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
            <Bot className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-white text-xs sm:text-sm truncate">
              {activeConversation?.title || 'Supergravity Local'}
            </h2>
            <p className="text-[11px] text-gray-400 truncate">
              {activeConversation?.messages.length || 0} messages
              {activeProvider ? ` • ${activeProvider.name}` : ''}
            </p>
          </div>
        </div>

        {/* Project & Workspace Selector */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center gap-1.5 bg-gray-900/90 border border-gray-800 rounded-lg px-2 py-1">
            <Layers className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
            <select
              aria-label="Conversation Project"
              value={activeConversation?.project_id || activeProjectId || ''}
              onChange={async (e) => {
                const nextProjId = e.target.value || null;
                await setActiveProject(nextProjId);
                if (activeConversationId) {
                  const targetProj = projects.find((p) => p.id === nextProjId);
                  await moveConversationToProject(
                    activeConversationId,
                    nextProjId,
                    targetProj?.folders?.[0]?.path || activeWorkspace
                  );
                }
              }}
              style={{ colorScheme: 'dark' }}
              className="appearance-none bg-transparent text-xs text-gray-200 focus:outline-none max-w-[140px] truncate"
              title="Assign or switch Project for this conversation"
            >
              <option value="">No Project (Single Workspace)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.folders.length}f)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setProjectModalOpen(true, activeProjectId)}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 px-1 font-medium flex-shrink-0"
              title={activeProject ? `Configure Project ${activeProject.name}` : 'Create New Project'}
            >
              {activeProject ? 'Edit' : '+Project'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 bg-gray-900/90 border border-gray-800 rounded-lg px-2.5 py-1 max-w-[220px] sm:max-w-xs min-w-0">
            <FolderOpen className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
            <input
              value={activeWorkspace}
              onChange={(e) => setActiveWorkspace(e.target.value)}
              aria-label="Active Workspace Path"
              className="bg-transparent text-xs text-gray-200 focus:outline-none w-20 sm:w-32 truncate font-mono"
              title="Active Workspace Path"
            />
            <button
              type="button"
              onClick={handleSelectWorkspace}
              className="text-[11px] text-blue-400 hover:text-blue-300 px-1 font-medium flex-shrink-0"
              title="Browse folder"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Quick View Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={toggleArtifactPane}
            className={cn(
              'p-2 rounded-lg transition-colors',
              artifactPaneOpen
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            )}
            aria-label="Toggle Artifact & File Pane"
            title="Toggle Artifact & File Pane (Ctrl+Shift+A)"
          >
            <Layout className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={toggleTerminal}
            className={cn(
              'p-2 rounded-lg transition-colors',
              terminalOpen
                ? 'bg-blue-600/20 text-blue-400'
                : 'text-gray-400 hover:text-white hover:bg-gray-800'
            )}
            aria-label="Toggle Terminal Drawer"
            title="Toggle Terminal Drawer (Ctrl+`)"
          >
            <Terminal className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true, 'providers')}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Local LLM, MCP & Skills Settings"
            title="Settings (Ctrl+,)"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Inline Provider / Task Error Banners */}
      {(error || providerError) && (
        <div
          role="alert"
          className="px-4 py-2 bg-red-950/60 border-b border-red-500/30 flex items-center justify-between gap-3 text-xs text-red-200 z-10"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <span className="truncate">
              {error || `Provider ${activeProvider?.name}: ${providerError}`}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => setSettingsOpen(true, 'providers')}
              className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 font-medium"
            >
              Configure Provider
            </button>
            {error && (
              <button
                type="button"
                onClick={clearError}
                className="p-0.5 text-red-300 hover:text-white rounded"
                aria-label="Dismiss error"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5 min-h-0"
      >
        {visibleMessages.length === 0 && !isStreaming && !loading && (
          <div className="flex flex-col items-center justify-center h-full max-w-xl mx-auto text-center px-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 flex items-center justify-center text-blue-400 mb-4">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-white mb-1">
              Ready to build with {activeProvider?.name || 'your Local LLM'}
            </h3>
            <p className="text-xs text-gray-400 mb-6">
              Ask questions, edit files, run terminal commands, or use slash commands like{' '}
              <code className="text-blue-400 font-mono">/plan</code> and{' '}
              <code className="text-blue-400 font-mono">/goal</code>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full text-left">
              {[
                {
                  title: 'Plan a feature',
                  prompt: '/plan Audit the current workspace structure and propose improvements',
                },
                {
                  title: 'Autonomous Goal',
                  prompt: '/goal Run the test suite and summarize any warnings or issues',
                },
              ].map((sample) => (
                <button
                  key={sample.title}
                  type="button"
                  onClick={() => submitPromptText(sample.prompt)}
                  className="p-3 rounded-xl border border-gray-800/90 bg-gray-900/50 hover:bg-gray-800/70 hover:border-gray-700 transition-all group"
                >
                  <div className="text-xs font-medium text-gray-200 group-hover:text-white flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-400" />
                    {sample.title}
                  </div>
                  <div className="text-[11px] text-gray-400 mt-1 truncate font-mono">
                    {sample.prompt}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleMessages.map((message, idx) => {
          const isUser = message.role === 'user';
          const isLastAssistant = !isUser && idx === visibleMessages.length - 1;
          const { thinking, body } = extractThinkBlocks(
            message.content,
            message.reasoning_content
          );

          return (
            <div
              key={message.id}
              className={cn(
                'flex gap-3 max-w-4xl mx-auto group',
                isUser ? 'justify-end' : 'justify-start'
              )}
            >
              {!isUser && (
                <div className="w-7 h-7 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={cn(
                  'rounded-2xl px-4 py-3 text-sm min-w-0 select-text',
                  isUser
                    ? 'bg-blue-600 text-white max-w-[85%] shadow-sm'
                    : 'bg-gray-900/80 border border-gray-800/90 text-gray-100 w-full max-w-[90%]'
                )}
              >
                {!isUser && thinking && <ThinkingBlock content={thinking} />}
                {body &&
                  (isUser ? (
                    <p className="whitespace-pre-wrap break-words leading-relaxed">{body}</p>
                  ) : (
                    <MarkdownRenderer content={body} />
                  ))}

                {message.tool_calls &&
                  message.tool_calls.map((tc: any, tcIdx: number) => {
                    const toolName = tc.function?.name || tc.name || 'tool';
                    const argsText =
                      tc.function?.arguments ||
                      JSON.stringify(tc.arguments || {}, null, 2);
                    const toolRes = tc.id ? toolResultsMap.get(tc.id) : undefined;
                    return (
                      <ToolCallCard
                        key={tc.id || tcIdx}
                        toolName={toolName}
                        argsText={argsText}
                        output={toolRes?.content}
                        onPreview={
                          toolRes?.content
                            ? () =>
                                setActiveArtifact({
                                  title: `Tool: ${toolName}`,
                                  content: toolRes.content,
                                })
                            : undefined
                        }
                      />
                    );
                  })}

                {/* Message Action Toolbar */}
                <div
                  className={cn(
                    'flex items-center gap-2 mt-2 pt-1.5 border-t text-[11px] opacity-80 group-hover:opacity-100 transition-opacity',
                    isUser
                      ? 'border-blue-500/40 text-blue-100 justify-end'
                      : 'border-gray-800/80 text-gray-400 justify-end'
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(message.id, body || message.content)}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-black/20 hover:text-white transition-colors"
                    aria-label="Copy message"
                    title="Copy message"
                  >
                    {copiedMsgId === message.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    <span>{copiedMsgId === message.id ? 'Copied' : 'Copy'}</span>
                  </button>
                  {isLastAssistant && !isStreaming && (
                    <button
                      type="button"
                      onClick={() =>
                        regenerateLastResponse(
                          activeConversationId || undefined,
                          activeProviderId || undefined,
                          selectedModel || undefined,
                          activeWorkspace
                        )
                      }
                      className="flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-gray-800 hover:text-white transition-colors"
                      aria-label="Regenerate response"
                      title="Regenerate response"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  )}
                </div>
              </div>

              {isUser && (
                <div className="w-7 h-7 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-gray-300 flex-shrink-0 mt-1">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          );
        })}

        {/* Live streaming assistant preview (when not already in activeConversation.messages) */}
        {isStreaming &&
          (streamingContent || streamingReasoning) &&
          activeConversation?.messages[activeConversation.messages.length - 1]?.role !==
            'assistant' && (
            <div className="flex gap-3 max-w-4xl mx-auto justify-start">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400 flex-shrink-0 mt-1 animate-pulse">
                <Bot className="w-4 h-4" />
              </div>
              <div className="rounded-2xl px-4 py-3 text-sm bg-gray-900/80 border border-gray-800 text-gray-100 w-full max-w-[90%] select-text">
                {(() => {
                  const { thinking, body } = extractThinkBlocks(
                    streamingContent,
                    streamingReasoning
                  );
                  return (
                    <>
                      {thinking && <ThinkingBlock content={thinking} defaultOpen />}
                      {body && <MarkdownRenderer content={body} />}
                    </>
                  );
                })()}
              </div>
            </div>
          )}

        {/* Pending Interactive Questions */}
        {pendingQuestions.map((q) => (
          <div key={q.question_id} className="max-w-4xl mx-auto">
            <AskQuestionWidget
              item={q}
              onSubmit={(answers) => answerQuestion(q.question_id, answers)}
            />
          </div>
        ))}

        {/* Pending Command Approvals */}
        {pendingApprovals.map((a) => (
          <div key={a.approval_id} className="max-w-4xl mx-auto">
            <CommandApprovalWidget
              item={a}
              onDecision={(ok) => approveCommand(a.approval_id, ok)}
            />
          </div>
        ))}

        {/* Pending Implementation Plan Reviews */}
        {pendingPlanReviews.map((pr) => (
          <div key={pr.review_id} className="max-w-4xl mx-auto">
            <PlanReviewWidget
              item={pr}
              onOpenArtifact={() =>
                setActiveArtifact({
                  title: pr.path.split('/').pop() || 'plan.md',
                  path: pr.path,
                  content: pr.content,
                  language: 'markdown',
                })
              }
              onDecision={(approved, fb) => submitPlanReview(pr.review_id, approved, fb)}
            />
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Floating Scroll-to-Bottom Button */}
      {showScrollButton && (
        <button
          type="button"
          onClick={() => scrollToBottom('smooth')}
          className="absolute bottom-28 right-6 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-800/95 hover:bg-gray-700 border border-gray-700 text-xs text-gray-200 shadow-lg transition-all"
          aria-label="Scroll to bottom"
        >
          <ArrowDown className="w-3.5 h-3.5 text-blue-400" />
          <span>Jump to bottom</span>
        </button>
      )}

      {/* Composer Input Area */}
      <div className="border-t border-gray-800/80 bg-[#0d121c] p-3 sm:p-4">
        <div className="max-w-4xl mx-auto relative">
          {/* Slash Command Picker */}
          {showSlashPicker && slashItems.length > 0 && (
            <div
              role="listbox"
              aria-label="Slash commands"
              className="absolute bottom-full left-0 mb-2 w-80 sm:w-96 max-h-60 overflow-y-auto bg-[#111827] border border-gray-700/80 rounded-xl shadow-2xl p-1.5 z-30"
            >
              {slashItems.map((item, idx) => (
                <button
                  key={item.cmd}
                  type="button"
                  role="option"
                  aria-selected={idx === slashIndex}
                  onClick={() => {
                    setInput(`${item.cmd} `);
                    setShowSlashPicker(false);
                    textareaRef.current?.focus();
                  }}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 transition-colors',
                    idx === slashIndex ? 'bg-blue-600/20 text-white' : 'hover:bg-gray-800'
                  )}
                >
                  <span className="font-mono text-xs text-blue-400 font-medium">
                    {item.cmd}
                  </span>
                  <span className="text-xs text-gray-400 truncate">{item.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* @ Categorized Context Mention Picker */}
          {showFilePicker && matchingMentions.length > 0 && (
            <div
              role="listbox"
              aria-label="Workspace files"
              className="absolute bottom-full left-0 mb-2 w-80 sm:w-[420px] max-h-60 overflow-y-auto bg-[#111827] border border-gray-700/80 rounded-xl shadow-2xl p-1.5 z-30"
            >
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Attach @ Context (Files, Folders, Conversations, Rules, MCP)
              </div>
              {matchingMentions.map((item) => (
                <button
                  key={`${item.category}:${item.value}`}
                  type="button"
                  onClick={() => insertFileMention(item.value)}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-800 flex items-center gap-2 text-xs text-gray-200"
                >
                  <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-800 text-indigo-300 border border-gray-700 flex-shrink-0">
                    {item.category}
                  </span>
                  <span className="truncate font-mono">{item.label}</span>
                  <span className="text-[11px] text-gray-500 truncate ml-auto">
                    {item.sub}
                  </span>
                </button>
              ))}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Upload files or images"
            onChange={(e) => handleFilesAttached(e.target.files)}
          />

          <form
            onSubmit={handleSendMessage}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesAttached(e.dataTransfer?.files || null);
            }}
            className="flex flex-col gap-2 bg-gray-950/90 border border-gray-800 rounded-xl p-3 focus-within:border-blue-500/70 transition-colors shadow-inner"
          >
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {attachments.map((att, idx) => (
                  <div
                    key={`${att.name}-${idx}`}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-gray-900 border border-gray-700 text-xs text-gray-200"
                  >
                    <Paperclip className="w-3 h-3 text-blue-400" />
                    <span className="truncate max-w-[160px]">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="text-gray-500 hover:text-red-400"
                      aria-label={`Remove attachment ${att.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onPaste={(e) => {
                if (e.clipboardData?.files && e.clipboardData.files.length > 0) {
                  handleFilesAttached(e.clipboardData.files);
                }
              }}
              onKeyDown={(e) => {
                if (showSlashPicker && slashItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((prev) => (prev + 1) % slashItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex(
                      (prev) => (prev - 1 + slashItems.length) % slashItems.length
                    );
                    return;
                  }
                  if (e.key === 'Tab') {
                    e.preventDefault();
                    const picked = slashItems[slashIndex];
                    if (picked) {
                      setInput(`${picked.cmd} `);
                      setShowSlashPicker(false);
                    }
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setShowSlashPicker(false);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              rows={2}
              placeholder="Ask anything, type / for /plan, /compact, /goal, or @ to reference files..."
              className="w-full bg-transparent text-sm text-white placeholder-gray-500 resize-none focus:outline-none leading-relaxed"
            />
            <div className="flex items-center justify-between pt-1.5 border-t border-gray-800/80 gap-2 flex-wrap">
              {/* Provider & Model Selectors */}
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0" />
                {providers.length > 1 && (
                  <select
                    aria-label="Active LLM Provider"
                    value={activeProviderId || ''}
                    onChange={(e) => setActiveProvider(e.target.value)}
                    style={{ colorScheme: 'dark' }}
                    className="appearance-none bg-gray-900 border border-gray-800 rounded-md px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-blue-500 truncate max-w-[140px]"
                  >
                    {providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  aria-label="Active LLM Model"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  style={{ colorScheme: 'dark' }}
                  className="appearance-none bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1 text-xs text-gray-200 focus:outline-none focus:border-blue-500 truncate max-w-[240px]"
                >
                  {models.length === 0 ? (
                    <option value="">Default Local Model (coder-iq1_m)</option>
                  ) : (
                    models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))
                  )}
                </select>

                {/* Worktree Mode Selector (Local vs New Worktree, hidden in Knowledge Work layout) */}
                {activeProject && !isKnowledgeWorkLayout && (
                  <div className="flex items-center gap-1 bg-gray-900 border border-indigo-500/30 rounded-md px-2 py-1">
                    <GitBranch className="w-3 h-3 text-indigo-400 flex-shrink-0" />
                    <select
                      aria-label="Worktree Mode"
                      value={currentWorktreeMode}
                      onChange={async (e) => {
                        const nextMode = e.target.value as 'local' | 'new_worktree';
                        setActiveWorktreeMode(nextMode);
                        if (activeConversationId) {
                          await moveConversationToProject(
                            activeConversationId,
                            activeProject.id,
                            activeConversation?.workspace_path ||
                              activeProject.folders?.[0]?.path ||
                              activeWorkspace,
                            nextMode
                          );
                        }
                      }}
                      style={{ colorScheme: 'dark' }}
                      className="appearance-none bg-transparent text-xs text-indigo-200 focus:outline-none"
                      title="Worktree selector: Local mode vs New worktree mode"
                    >
                      <option value="local">Local Mode ({activeProject.folders.length}f)</option>
                      <option value="new_worktree">New Worktree Mode (Isolated)</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                  aria-label="Attach File or Image"
                  title="Attach file or image (or drag-and-drop / paste)"
                >
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                {isStreaming && activeTaskId ? (
                  <button
                    type="button"
                    onClick={() => cancelAgentTask(activeTaskId)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600/85 hover:bg-red-500 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!input.trim() && attachments.length === 0}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Send
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
