import { create } from 'zustand';
import type {
  AgentTask,
  Conversation,
  ConversationMessage,
  PendingApproval,
  PendingPlanReview,
  PendingQuestion,
} from '../types/agent';
import type { WorktreeMode } from '../types/config';
import * as agentIpc from '../ipc/agent';
import { formatTauriError, isTauri } from '../utils/tauri';

export type {
  AgentTask,
  Conversation,
  ConversationMessage,
  PendingApproval,
  PendingPlanReview,
  PendingQuestion,
};

interface ConversationState {
  conversations: Conversation[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  activeWorktreeMode: WorktreeMode;
  tasks: AgentTask[];
  activeTaskId: string | null;
  streamingContent: string;
  streamingReasoning: string;
  streamingMessageId: string | null;
  isStreaming: boolean;
  pendingQuestions: PendingQuestion[];
  pendingApprovals: PendingApproval[];
  pendingPlanReviews: PendingPlanReview[];
  loading: boolean;
  error: string | null;

  initListeners: () => Promise<() => void>;
  fetchConversations: () => Promise<void>;
  setActiveWorktreeMode: (mode: WorktreeMode) => void;
  createConversation: (
    title?: string,
    systemPrompt?: string,
    workspacePath?: string,
    projectId?: string | null,
    worktreeMode?: WorktreeMode | null
  ) => Promise<Conversation | null>;
  moveConversationToProject: (
    conversationId: string,
    projectId: string | null,
    workspacePath?: string | null,
    worktreeMode?: WorktreeMode | null
  ) => Promise<Conversation | null>;
  deleteConversation: (conversationId: string) => Promise<void>;
  setActiveConversation: (conversationId: string | null) => void;
  sendMessage: (
    conversationId: string,
    content: string,
    providerId?: string,
    model?: string,
    workspacePath?: string,
    projectId?: string | null,
    worktreeMode?: WorktreeMode | null
  ) => Promise<void>;
  regenerateLastResponse: (
    conversationId?: string,
    providerId?: string,
    model?: string,
    workspacePath?: string
  ) => Promise<void>;
  startAgentTask: (
    prompt: string,
    conversationId?: string,
    systemPrompt?: string,
    providerId?: string,
    model?: string,
    workspacePath?: string,
    projectId?: string | null,
    worktreeMode?: WorktreeMode | null
  ) => Promise<AgentTask | null>;
  cancelAgentTask: (taskId: string) => Promise<void>;
  answerQuestion: (questionId: string, answers: Record<string, string[]>) => Promise<void>;
  approveCommand: (approvalId: string, approved: boolean) => Promise<void>;
  submitPlanReview: (reviewId: string, approved: boolean, feedback?: string) => Promise<void>;
  clearError: () => void;
}

const DEMO_CONVERSATION: Conversation = {
  id: 'welcome-local',
  title: 'Welcome to Supergravity',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  messages: [
    {
      id: 'welcome-msg-1',
      role: 'assistant',
      reasoning_content:
        'Local-first agentic IDE initialized. Checking Strata Local (http://127.0.0.1:47831/v1) and Strata LAN (http://192.168.0.92:47832/v1), plus Ollama/llama.cpp/vLLM/LM Studio, MCP servers, and SKILL.md files.',
      content:
        'Welcome to **Supergravity** — your local-first agentic AI IDE.\n\n- **Strata Defaults**: Pre-configured for **Strata (Local)** (`http://127.0.0.1:47831/v1`, model `coder-iq1_m`) and **Strata (LAN)** (`http://192.168.0.92:47832/v1`), plus Ollama, LM Studio, llama.cpp, and vLLM in **Settings**.\n- **Skills & MCP**: Discovers `SKILL.md` files and `.mcp.json` servers automatically.\n- **Slash Commands**: Type `/plan`, `/compact`, or `/goal` in the chat bar below.',
      created_at: new Date().toISOString(),
    },
  ],
};

function upsertConversation(list: Conversation[], conv: Conversation): Conversation[] {
  const exists = list.some((c) => c.id === conv.id);
  return exists ? list.map((c) => (c.id === conv.id ? conv : c)) : [conv, ...list];
}

function upsertTask(list: AgentTask[], task: AgentTask): AgentTask[] {
  const exists = list.some((t) => t.id === task.id);
  return exists ? list.map((t) => (t.id === task.id ? task : t)) : [task, ...list];
}

function isTerminalTaskStatus(status: AgentTask['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export const useConversationStore = create<ConversationState>((set, get) => {
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
  let pollGeneration = 0;
  let polledConversationId: string | null = null;

  const stopPolling = () => {
    pollGeneration += 1;
    pollInFlight = false;
    polledConversationId = null;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const startPolling = (conversationId: string, taskId?: string) => {
    stopPolling();
    if (!isTauri()) return;
    const gen = ++pollGeneration;
    polledConversationId = conversationId;

    pollTimer = setInterval(async () => {
      if (pollInFlight || gen !== pollGeneration) return;
      pollInFlight = true;
      try {
        const [conv, task] = await Promise.all([
          agentIpc.getConversation(conversationId),
          taskId ? agentIpc.getAgentStatus(taskId).catch(() => null) : Promise.resolve(null),
        ]);

        if (gen !== pollGeneration) return;

        if (conv) {
          set((state) => ({
            conversations: upsertConversation(state.conversations, conv),
            activeConversation:
              state.activeConversationId === conv.id ? conv : state.activeConversation,
          }));
        }

        if (task) {
          set((state) => ({
            tasks: upsertTask(state.tasks, task),
          }));

          if (isTerminalTaskStatus(task.status)) {
            set((state) => ({
              isStreaming: false,
              activeTaskId: state.activeTaskId === task.id ? null : state.activeTaskId,
              streamingContent: '',
              streamingReasoning: '',
              streamingMessageId: null,
              error: task.status === 'failed' ? task.error || 'Agent task failed' : state.error,
            }));
            stopPolling();
          }
        }
      } catch {
        // ignore transient polling failure
      } finally {
        pollInFlight = false;
      }
    }, 200);
  };

  return {
    conversations: isTauri() ? [] : [DEMO_CONVERSATION],
    activeConversationId: isTauri() ? null : DEMO_CONVERSATION.id,
    activeConversation: isTauri() ? null : DEMO_CONVERSATION,
    activeWorktreeMode: 'local',
    tasks: [],
    activeTaskId: null,
    streamingContent: '',
    streamingReasoning: '',
    streamingMessageId: null,
    isStreaming: false,
    pendingQuestions: [],
    pendingApprovals: [],
    pendingPlanReviews: [],
    loading: false,
    error: null,

    initListeners: async () => {
      if (!isTauri()) return () => {};

      const un1 = await agentIpc.onAgentConversationUpdate((conv) => {
        set((state) => {
          const isActive = state.activeConversationId === conv.id;
          return {
            conversations: upsertConversation(state.conversations, conv),
            activeConversation: isActive ? conv : state.activeConversation,
            streamingContent: isActive ? '' : state.streamingContent,
            streamingReasoning: isActive ? '' : state.streamingReasoning,
            streamingMessageId: isActive ? null : state.streamingMessageId,
          };
        });
      });

      const un2 = await agentIpc.onAgentStreamDelta((delta) => {
        if (delta.conversation_id !== get().activeConversationId) return;
        set((state) => {
          const incomingId = delta.message_id || null;
          const isNewMessage = Boolean(
            incomingId && state.streamingMessageId && state.streamingMessageId !== incomingId
          );
          const nextContent =
            (isNewMessage ? '' : state.streamingContent) + (delta.content_delta || '');
          const nextReasoning =
            (isNewMessage ? '' : state.streamingReasoning) + (delta.reasoning_delta || '');
          return {
            isStreaming: true,
            streamingMessageId: incomingId ?? state.streamingMessageId,
            streamingContent: nextContent,
            streamingReasoning: nextReasoning,
          };
        });
      });

      const un3 = await agentIpc.onAgentTaskUpdate((task) => {
        const finished = isTerminalTaskStatus(task.status);
        const matchesActive =
          task.id === get().activeTaskId ||
          task.conversation_id === get().activeConversationId ||
          task.conversation_id === polledConversationId;

        set((state) => ({
          activeTaskId:
            finished && state.activeTaskId === task.id
              ? null
              : !finished && matchesActive
                ? task.id
                : state.activeTaskId,
          isStreaming: finished && matchesActive ? false : state.isStreaming,
          error: task.status === 'failed' ? task.error || 'Agent task failed' : state.error,
          tasks: upsertTask(state.tasks, task),
        }));

        if (finished && matchesActive) {
          stopPolling();
        }

        if (finished && task.conversation_id) {
          agentIpc
            .getConversation(task.conversation_id)
            .then((conv) => {
              if (!conv) return;
              set((state) => {
                const isActive = state.activeConversationId === conv.id;
                return {
                  conversations: upsertConversation(state.conversations, conv),
                  activeConversation: isActive ? conv : state.activeConversation,
                  streamingContent: isActive ? '' : state.streamingContent,
                  streamingReasoning: isActive ? '' : state.streamingReasoning,
                  streamingMessageId: isActive ? null : state.streamingMessageId,
                };
              });
            })
            .catch(() => {});
        }
      });

      const un4 = await agentIpc.onAgentAskQuestion((q) => {
        set((state) => ({
          pendingQuestions: [...state.pendingQuestions, q],
        }));
      });

      const un5 = await agentIpc.onAgentCommandApproval((a) => {
        set((state) => ({
          pendingApprovals: [...state.pendingApprovals, a],
        }));
      });

      const un6 = await agentIpc.onAgentPlanReview((pr) => {
        set((state) => ({
          pendingPlanReviews: [...state.pendingPlanReviews, pr],
        }));
      });

      return () => {
        stopPolling();
        un1();
        un2();
        un3();
        un4();
        un5();
        un6();
      };
    },

    fetchConversations: async () => {
      if (!isTauri()) return;
      set({ loading: true, error: null });
      try {
        const conversations = await agentIpc.listConversations();
        set((state) => {
          const activeId = state.activeConversationId || conversations[0]?.id || null;
          return {
            conversations,
            activeConversationId: activeId,
            activeConversation: conversations.find((c) => c.id === activeId) || null,
            loading: false,
          };
        });
      } catch (error) {
        set({ error: formatTauriError(error), loading: false });
      }
    },

    setActiveWorktreeMode: (mode) => set({ activeWorktreeMode: mode }),

    createConversation: async (title, systemPrompt, workspacePath, projectId, worktreeMode) => {
      const effectiveMode = worktreeMode ?? get().activeWorktreeMode;
      if (!isTauri()) {
        const conv: Conversation = {
          id: `local-${Date.now()}`,
          title: title || 'New Conversation',
          messages: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          workspace_path: workspacePath,
          project_id: projectId ?? null,
          worktree_mode: effectiveMode,
        };
        set((state) => ({
          conversations: [conv, ...state.conversations],
          activeConversationId: conv.id,
          activeConversation: conv,
        }));
        return conv;
      }
      set({ loading: true, error: null });
      try {
        const conversation = await agentIpc.createConversation({
          title: title ?? null,
          system_prompt: systemPrompt ?? null,
          workspace_path: workspacePath ?? null,
          ...(projectId ? { project_id: projectId } : {}),
          ...(worktreeMode ? { worktree_mode: worktreeMode } : {}),
        });
        set((state) => ({
          conversations: upsertConversation(state.conversations, conversation),
          activeConversationId: conversation.id,
          activeConversation: conversation,
          loading: false,
        }));
        return conversation;
      } catch (error) {
        set({ error: formatTauriError(error), loading: false });
        return null;
      }
    },

    moveConversationToProject: async (conversationId, projectId, workspacePath, worktreeMode) => {
      if (!isTauri()) {
        let updatedConv: Conversation | null = null;
        set((state) => {
          const updated = state.conversations.map((c) => {
            if (c.id !== conversationId) return c;
            updatedConv = {
              ...c,
              project_id: projectId || null,
              workspace_path: workspacePath ?? c.workspace_path,
              worktree_mode: worktreeMode ?? c.worktree_mode ?? state.activeWorktreeMode,
              updated_at: new Date().toISOString(),
            };
            return updatedConv;
          });
          return {
            conversations: updated,
            activeConversation:
              state.activeConversationId === conversationId && updatedConv
                ? updatedConv
                : state.activeConversation,
          };
        });
        return updatedConv;
      }
      try {
        const updated = await agentIpc.moveConversationToProject({
          conversation_id: conversationId,
          project_id: projectId ?? '',
          workspace_path: workspacePath ?? null,
          worktree_mode: worktreeMode ?? null,
        });
        set((state) => ({
          conversations: upsertConversation(state.conversations, updated),
          activeConversation:
            state.activeConversationId === updated.id ? updated : state.activeConversation,
        }));
        return updated;
      } catch (error) {
        set({ error: formatTauriError(error) });
        return null;
      }
    },

    deleteConversation: async (conversationId) => {
      if (
        conversationId === get().activeConversationId ||
        conversationId === polledConversationId
      ) {
        stopPolling();
      }
      try {
        if (isTauri()) {
          await agentIpc.deleteConversation(conversationId);
        }
        set((state) => {
          const remaining = state.conversations.filter((c) => c.id !== conversationId);
          const nextActive =
            state.activeConversationId === conversationId
              ? remaining[0] || null
              : state.activeConversation;
          const resetStream = state.activeConversationId === conversationId;
          return {
            conversations: remaining,
            activeConversationId: nextActive?.id || null,
            activeConversation: nextActive,
            ...(resetStream
              ? {
                  isStreaming: false,
                  streamingContent: '',
                  streamingReasoning: '',
                  streamingMessageId: null,
                }
              : {}),
          };
        });
      } catch (error) {
        set({ error: formatTauriError(error) });
      }
    },

    setActiveConversation: (conversationId) => {
      stopPolling();
      set((state) => ({
        activeConversationId: conversationId,
        activeConversation: state.conversations.find((c) => c.id === conversationId) || null,
        streamingContent: '',
        streamingReasoning: '',
        streamingMessageId: null,
        isStreaming: false,
      }));
    },

    sendMessage: async (
      conversationId,
      content,
      providerId,
      model,
      workspacePath,
      projectId,
      worktreeMode
    ) => {
      const effectiveMode = worktreeMode ?? get().activeWorktreeMode;
      const optimisticUserMsg: ConversationMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content,
        created_at: new Date().toISOString(),
      };
      set((state) => {
        const updated = state.conversations.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                project_id: projectId !== undefined ? projectId : c.project_id,
                worktree_mode: effectiveMode || c.worktree_mode,
                messages: [...c.messages, optimisticUserMsg],
              }
            : c
        );
        return {
          error: null,
          isStreaming: true,
          streamingContent: '',
          streamingReasoning: '',
          streamingMessageId: null,
          conversations: updated,
          activeConversation:
            state.activeConversationId === conversationId
              ? updated.find((c) => c.id === conversationId) || state.activeConversation
              : state.activeConversation,
        };
      });

      if (!isTauri()) {
        const assistantMsg: ConversationMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            'Browser preview mode: start the Tauri desktop app and connect Strata Local (`http://127.0.0.1:47831/v1`), Strata LAN (`http://192.168.0.92:47832/v1`), or another OpenAI-compatible server to run the full Rust agent loop.',
          created_at: new Date().toISOString(),
        };
        set((state) => {
          const updated = state.conversations.map((c) =>
            c.id === conversationId ? { ...c, messages: [...c.messages, assistantMsg] } : c
          );
          return {
            conversations: updated,
            activeConversation: updated.find((c) => c.id === conversationId) || null,
            isStreaming: false,
          };
        });
        return;
      }

      try {
        startPolling(conversationId);
        const task = await agentIpc.startAgentTask({
          conversation_id: conversationId,
          prompt: content,
          system_prompt: null,
          provider_id: providerId ?? null,
          model: model ?? null,
          workspace_path: workspacePath ?? null,
          project_id: projectId ?? null,
          worktree_mode: effectiveMode ?? null,
        });
        set((state) => ({
          tasks: upsertTask(state.tasks, task),
          activeTaskId: task.id,
        }));
        startPolling(conversationId, task.id);
      } catch (error) {
        stopPolling();
        set({ error: formatTauriError(error), isStreaming: false });
      }
    },

    regenerateLastResponse: async (conversationId, providerId, model, workspacePath) => {
      const targetId = conversationId || get().activeConversationId;
      if (!targetId) {
        set({ error: 'No active conversation to regenerate' });
        return;
      }
      const conv = get().conversations.find((c) => c.id === targetId);
      const lastUserMessage = [...(conv?.messages || [])]
        .reverse()
        .find((m) => m.role === 'user');
      if (!lastUserMessage) {
        set({ error: 'No user message found to regenerate' });
        return;
      }
      await get().sendMessage(
        targetId,
        lastUserMessage.content,
        providerId,
        model,
        workspacePath,
        conv?.project_id ?? null,
        conv?.worktree_mode ?? get().activeWorktreeMode
      );
    },

    startAgentTask: async (
      prompt,
      conversationId,
      systemPrompt,
      providerId,
      model,
      workspacePath,
      projectId,
      worktreeMode
    ) => {
      if (!isTauri()) return null;
      const effectiveMode = worktreeMode ?? get().activeWorktreeMode;
      set({
        error: null,
        isStreaming: true,
        streamingContent: '',
        streamingReasoning: '',
        streamingMessageId: null,
      });
      try {
        if (conversationId) {
          startPolling(conversationId);
        }
        const task = await agentIpc.startAgentTask({
          conversation_id: conversationId ?? null,
          prompt,
          system_prompt: systemPrompt ?? null,
          provider_id: providerId ?? null,
          model: model ?? null,
          workspace_path: workspacePath ?? null,
          project_id: projectId ?? null,
          worktree_mode: effectiveMode ?? null,
        });
        set((state) => ({
          tasks: upsertTask(state.tasks, task),
          activeTaskId: task.id,
        }));
        startPolling(task.conversation_id, task.id);
        if (!get().activeConversationId && task.conversation_id) {
          agentIpc
            .getConversation(task.conversation_id)
            .then((conv) => {
              if (!conv) return;
              set((state) => ({
                conversations: upsertConversation(state.conversations, conv),
                activeConversationId: state.activeConversationId ?? conv.id,
                activeConversation: state.activeConversation ?? conv,
              }));
            })
            .catch(() => {});
        }
        return task;
      } catch (error) {
        stopPolling();
        set({ error: formatTauriError(error), isStreaming: false });
        return null;
      }
    },

    cancelAgentTask: async (taskId) => {
      stopPolling();
      set({
        isStreaming: false,
        activeTaskId: null,
        streamingContent: '',
        streamingReasoning: '',
        streamingMessageId: null,
      });
      if (!isTauri()) return;
      try {
        await agentIpc.cancelAgentTask(taskId);
      } catch (error) {
        set({ error: formatTauriError(error) });
      }
    },

    answerQuestion: async (questionId, answers) => {
      set((state) => ({
        pendingQuestions: state.pendingQuestions.filter((q) => q.question_id !== questionId),
      }));
      if (isTauri()) {
        try {
          await agentIpc.answerQuestion(questionId, answers);
        } catch (error) {
          set({ error: formatTauriError(error) });
        }
      }
    },

    approveCommand: async (approvalId, approved) => {
      set((state) => ({
        pendingApprovals: state.pendingApprovals.filter((a) => a.approval_id !== approvalId),
      }));
      if (isTauri()) {
        try {
          await agentIpc.approveCommand(approvalId, approved);
        } catch (error) {
          set({ error: formatTauriError(error) });
        }
      }
    },

    submitPlanReview: async (reviewId, approved, feedback) => {
      set((state) => ({
        pendingPlanReviews: state.pendingPlanReviews.filter((r) => r.review_id !== reviewId),
      }));
      if (isTauri()) {
        try {
          await agentIpc.answerQuestion(reviewId, {
            approved,
            feedback: feedback || '',
          });
        } catch (error) {
          set({ error: formatTauriError(error) });
        }
      }
    },

    clearError: () => set({ error: null }),
  };
});
