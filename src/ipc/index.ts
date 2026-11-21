import { safeListen, type UnlistenFn } from '../utils/tauri';
import type { TauriEventMap, TauriEventName } from '../types';

export * from './fs';
export * from './terminal';
export * from './llm';
export * from './mcp';
export * from './agent';
export * from './skills';
export * from './config';
export * from './window';

export function onTauriEvent<K extends TauriEventName>(
  event: K,
  handler: (payload: TauriEventMap[K]) => void
): Promise<UnlistenFn> {
  return safeListen<TauriEventMap[K]>(event, handler);
}
