import type { LLMProviderType } from './config';

export type ProviderStatus =
  | 'unknown'
  | 'connected'
  | 'disconnected'
  | { error: string };

export interface LLMModel {
  id: string;
  name: string;
  context_length?: number;
  supports_streaming: boolean;
  supports_tools: boolean;
  supports_vision: boolean;
  owned_by?: string;
  meta?: Record<string, unknown> | null;
}

export type ModelInfo = LLMModel;

export interface LLMProvider {
  id: string;
  name: string;
  provider_type: LLMProviderType;
  base_url: string;
  api_key?: string;
  models: LLMModel[];
  enabled: boolean;
  headers?: Record<string, string>;
  status: ProviderStatus;
  last_checked?: string | null;
}

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolFunction {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: string;
  function: ToolFunction;
}

export interface ChatMessage {
  role: MessageRole;
  content: string;
  reasoning_content?: string;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolFunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolDefinition {
  type: string;
  function: ToolFunctionDefinition;
}

export interface ToolFunctionChoice {
  name: string;
}

export type ToolChoice =
  | null
  | { type: string; function: ToolFunctionChoice };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number | null;
  max_tokens?: number | null;
  stream?: boolean | null;
  tools?: ToolDefinition[] | null;
  tool_choice?: ToolChoice | null;
  top_p?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  stop?: string[] | null;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string | null;
}

export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChoice[];
  usage?: Usage | null;
}

export interface ToolFunctionDelta {
  name?: string | null;
  arguments?: string | null;
}

export interface ToolCallDelta {
  index: number;
  id?: string | null;
  type?: string | null;
  function?: ToolFunctionDelta | null;
}

export interface ChatMessageDelta {
  role?: MessageRole | null;
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: ToolCallDelta[] | null;
}

export interface ChatChunkChoice {
  index: number;
  delta: ChatMessageDelta;
  finish_reason?: string | null;
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatChunkChoice[];
}

export interface ModelsResponse {
  object: string;
  data: LLMModel[];
}
