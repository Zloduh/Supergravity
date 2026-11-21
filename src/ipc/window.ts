import { safeInvoke, safeListen, type UnlistenFn } from '../utils/tauri';
import type { GlobalShortcutPayload } from '../types';

export function createWindow(params?: {
  url?: string | null;
  label?: string | null;
}): Promise<void> {
  return safeInvoke<void>('create_window', {
    url: params?.url ?? null,
    label: params?.label ?? null,
  });
}

export function closeWindow(label: string): Promise<void> {
  return safeInvoke<void>('close_window', { label });
}

export function minimizeWindow(): Promise<void> {
  return safeInvoke<void>('minimize_window');
}

export function maximizeWindow(): Promise<void> {
  return safeInvoke<void>('maximize_window');
}

export function listWindows(): Promise<string[]> {
  return safeInvoke<string[]>('list_windows');
}

export function onGlobalShortcut(
  handler: (payload: GlobalShortcutPayload) => void
): Promise<UnlistenFn> {
  return safeListen<GlobalShortcutPayload>('global-shortcut', handler);
}
