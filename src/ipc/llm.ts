import { safeInvoke, safeListen, type UnlistenFn } from '../utils/tauri';
import type {
  ChatCompletionChunk,
  ChatCompletionRequest,
  ChatCompletionResponse,
  LLMModel,
  LLMProvider,
  LLMProviderConfig,
} from '../types';

export function listProviders(): Promise<LLMProvider[]> {
  return safeInvoke<LLMProvider[]>('list_providers');
}

export function addProvider(config: LLMProviderConfig): Promise<LLMProvider> {
  return safeInvoke<LLMProvider>('add_provider', { config });
}

export function removeProvider(id: string): Promise<void> {
  return safeInvoke<void>('remove_provider', { id });
}

export function setActiveProvider(id: string): Promise<void> {
  return safeInvoke<void>('set_active_provider', { id });
}

export function chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
  return safeInvoke<ChatCompletionResponse>('chat_completion', { request });
}

export function streamChatCompletion(request: ChatCompletionRequest): Promise<void> {
  return safeInvoke<void>('stream_chat_completion', { request });
}

export function listModels(providerId?: string | null): Promise<LLMModel[]> {
  return safeInvoke<LLMModel[]>('list_models', {
    provider_id: providerId ?? null,
  });
}

export function refreshProviderModels(providerId: string): Promise<LLMModel[]> {
  return safeInvoke<LLMModel[]>('refresh_provider_models', {
    provider_id: providerId,
  });
}

export function onLlmStreamChunk(
  handler: (payload: ChatCompletionChunk) => void
): Promise<UnlistenFn> {
  return safeListen<ChatCompletionChunk>('llm-stream-chunk', handler);
}
