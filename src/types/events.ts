import type { AgentTask, Conversation, Question } from './agent';
import type { ChatCompletionChunk } from './llm';
import type { TerminalStatus } from './terminal';

export interface AgentStreamDeltaEvent {
  conversation_id: string;
  message_id: string;
  content_delta: string;
  reasoning_delta: string;
}

export interface AgentAskQuestionEvent {
  question_id: string;
  conversation_id: string;
  questions: Question[];
}

export interface AgentCommandApprovalEvent {
  approval_id: string;
  conversation_id: string;
  command: string;
  summary: string;
}

export interface TerminalOutputEvent {
  terminal_id: string;
  data: string;
}

export interface TerminalStatusEvent {
  terminal_id: string;
  status: TerminalStatus;
}

export interface FsChangeEvent {
  path: string;
  kind: string;
}

export type GlobalShortcutPayload = 'command-palette' | 'toggle-terminal';

export interface TauriEventMap {
  'agent-stream-delta': AgentStreamDeltaEvent;
  'agent-conversation-update': Conversation;
  'agent-task-update': AgentTask;
  'agent-ask-question': AgentAskQuestionEvent;
  'agent-command-approval': AgentCommandApprovalEvent;
  'terminal-output': TerminalOutputEvent;
  'terminal-status': TerminalStatusEvent;
  'fs-change': FsChangeEvent;
  'global-shortcut': GlobalShortcutPayload;
  'llm-stream-chunk': ChatCompletionChunk;
}

export type TauriEventName = keyof TauriEventMap;
