import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';

export type { UnlistenFn };

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function formatTauriError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (err && typeof err === 'object') {
    const rec = err as Record<string, unknown>;
    if (typeof rec.message === 'string' && rec.message) return rec.message;
    if (typeof rec.error === 'string' && rec.error) return rec.error;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

export async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error(`Tauri runtime unavailable for command: ${cmd}`);
  }
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    const msg = formatTauriError(err);
    if (err instanceof Error) {
      throw err;
    }
    throw new Error(msg);
  }
}

export async function safeListen<T>(
  event: string,
  handler: (payload: T) => void
): Promise<UnlistenFn> {
  if (isTauri()) {
    return listen<T>(event, (e) => handler(e.payload));
  }
  return () => {};
}
