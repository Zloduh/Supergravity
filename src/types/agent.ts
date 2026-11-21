import type { WorktreeMode } from './config';
import type { MessageRole, ToolCall } from './llm';

export type AgentTaskStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type AgentStatus = AgentTaskStatus;

export interface AgentTask {
  id: string;
  conversation_id: string;
  prompt: string;
  status: AgentTaskStatus;
  created_at: string;
  updated_at: string;
  iterations: number;
  max_iterations: number;
  result?: string;
  error?: string;
}

export interface ConversationMessage {
  id: string;
  role: MessageRole | string;
  content: string;
  reasoning_content?: string;
  created_at: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  tool_name?: string;
}

export type Message = ConversationMessage;

export interface FileChangeEntry {
  path: string;
  change_type: 'created' | 'modified' | 'deleted' | string;
  original_content?: string | null;
  new_content: string;
  updated_at: string;
}

export interface BgTaskSummary {
  task_id: string;
  command: string;
  cwd: string;
  status: string;
  exit_code?: number | null;
  output_preview?: string;
}

export interface PendingPlanReview {
  review_id: string;
  conversation_id: string;
  path: string;
  summary: string;
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ConversationMessage[];
  created_at: string;
  updated_at: string;
  system_prompt?: string;
  provider_id?: string;
  model?: string;
  workspace_path?: string;
  project_id?: string | null;
  worktree_mode?: WorktreeMode | null;
  worktree_paths?: string[];
  files_changed?: FileChangeEntry[];
  subagents?: SubagentInfo[];
  background_tasks?: BgTaskSummary[];
}

export interface StartAgentTaskRequest {
  conversation_id?: string | null;
  prompt: string;
  system_prompt?: string | null;
  provider_id?: string | null;
  model?: string | null;
  workspace_path?: string | null;
  project_id?: string | null;
  worktree_mode?: WorktreeMode | null;
}

export interface SendMessageRequest {
  conversation_id: string;
  content: string;
  provider_id?: string | null;
  model?: string | null;
  workspace_path?: string | null;
  project_id?: string | null;
  worktree_mode?: WorktreeMode | null;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  size: number;
  updated_at: string;
}

export type ArtifactItem = ArtifactInfo;

export interface Question {
  question: string;
  options: string[];
  is_multi_select?: boolean;
}

export interface PendingQuestion {
  question_id: string;
  conversation_id: string;
  questions: Question[];
}

export interface PendingApproval {
  approval_id: string;
  conversation_id: string;
  command: string;
  summary: string;
}

export interface SubagentDefinition {
  name: string;
  description: string;
  system_prompt: string;
  enable_write_tools: boolean;
  enable_mcp_tools: boolean;
}

export interface SubagentInfo {
  conversation_id: string;
  type_name: string;
  role: string;
  status: string;
}
