import { safeInvoke, safeListen, type UnlistenFn } from '../utils/tauri';
import type {
  AgentAskQuestionEvent,
  AgentCommandApprovalEvent,
  AgentStreamDeltaEvent,
  AgentTask,
  ArtifactInfo,
  Conversation,
  PendingPlanReview,
  SendMessageRequest,
  StartAgentTaskRequest,
  WorktreeMode,
} from '../types';

export function startAgentTask(request: StartAgentTaskRequest): Promise<AgentTask> {
  return safeInvoke<AgentTask>('start_agent_task', { request });
}

export function cancelAgentTask(taskId: string): Promise<AgentTask> {
  return safeInvoke<AgentTask>('cancel_agent_task', { task_id: taskId });
}

export function getAgentStatus(taskId: string): Promise<AgentTask | null> {
  return safeInvoke<AgentTask | null>('get_agent_status', { task_id: taskId });
}

export function listConversations(): Promise<Conversation[]> {
  return safeInvoke<Conversation[]>('list_conversations');
}

export function createConversation(params?: {
  conversation_id?: string | null;
  title?: string | null;
  system_prompt?: string | null;
  workspace_path?: string | null;
  project_id?: string | null;
  worktree_mode?: WorktreeMode | null;
}): Promise<Conversation> {
  const payload: Record<string, unknown> = {
    title: params?.title ?? null,
    system_prompt: params?.system_prompt ?? null,
    workspace_path: params?.workspace_path ?? null,
  };
  if (params?.conversation_id !== undefined && params.conversation_id !== null) {
    payload.conversation_id = params.conversation_id;
  }
  if (params?.project_id !== undefined && params.project_id !== null) {
    payload.project_id = params.project_id;
  }
  if (params?.worktree_mode !== undefined && params.worktree_mode !== null) {
    payload.worktree_mode = params.worktree_mode;
  }
  return safeInvoke<Conversation>('create_conversation', payload);
}

export function moveConversationToProject(params: {
  conversation_id: string;
  project_id?: string | null;
  workspace_path?: string | null;
  worktree_mode?: WorktreeMode | null;
}): Promise<Conversation> {
  return safeInvoke<Conversation>('create_conversation', {
    conversation_id: params.conversation_id,
    title: null,
    system_prompt: null,
    workspace_path: params.workspace_path ?? null,
    project_id: params.project_id ?? '',
    worktree_mode: params.worktree_mode ?? null,
  });
}

export function deleteConversation(conversationId: string): Promise<void> {
  return safeInvoke<void>('delete_conversation', { conversation_id: conversationId });
}

export function getConversation(conversationId: string): Promise<Conversation | null> {
  return safeInvoke<Conversation | null>('get_conversation', {
    conversation_id: conversationId,
  });
}

export function sendAgentMessage(request: SendMessageRequest): Promise<Conversation> {
  return safeInvoke<Conversation>('send_message', { request });
}

export function answerQuestion(
  questionId: string,
  answers: Record<string, string[]> | unknown
): Promise<void> {
  return safeInvoke<void>('answer_question', {
    question_id: questionId,
    answers,
  });
}

export function approveCommand(approvalId: string, approved: boolean): Promise<void> {
  return safeInvoke<void>('approve_command', {
    approval_id: approvalId,
    approved,
  });
}

export function listArtifacts(conversationId: string): Promise<ArtifactInfo[]> {
  return safeInvoke<ArtifactInfo[]>('list_artifacts', {
    conversation_id: conversationId,
  });
}

export function onAgentStreamDelta(
  handler: (payload: AgentStreamDeltaEvent) => void
): Promise<UnlistenFn> {
  return safeListen<AgentStreamDeltaEvent>('agent-stream-delta', handler);
}

export function onAgentConversationUpdate(
  handler: (payload: Conversation) => void
): Promise<UnlistenFn> {
  return safeListen<Conversation>('agent-conversation-update', handler);
}

export function onAgentTaskUpdate(handler: (payload: AgentTask) => void): Promise<UnlistenFn> {
  return safeListen<AgentTask>('agent-task-update', handler);
}

export function onAgentAskQuestion(
  handler: (payload: AgentAskQuestionEvent) => void
): Promise<UnlistenFn> {
  return safeListen<AgentAskQuestionEvent>('agent-ask-question', handler);
}

export function onAgentCommandApproval(
  handler: (payload: AgentCommandApprovalEvent) => void
): Promise<UnlistenFn> {
  return safeListen<AgentCommandApprovalEvent>('agent-command-approval', handler);
}

export function onAgentPlanReview(
  handler: (payload: PendingPlanReview) => void
): Promise<UnlistenFn> {
  return safeListen<PendingPlanReview>('agent-plan-review', handler);
}

export interface AgentTelemetryEvent {
  conversation_id: string;
  model_state: 'ready' | 'thinking' | 'generating' | 'tooling' | string;
  tokens_generated: number;
  tokens_per_sec: number;
  context_tokens: number;
  context_limit: number;
}

export function onAgentTelemetry(
  handler: (payload: AgentTelemetryEvent) => void
): Promise<UnlistenFn> {
  return safeListen<AgentTelemetryEvent>('agent-telemetry', handler);
}
