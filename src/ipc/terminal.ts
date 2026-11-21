import { safeInvoke, safeListen, type UnlistenFn } from '../utils/tauri';
import type {
  ResizeTerminalRequest,
  SpawnTerminalRequest,
  Terminal,
  TerminalOutputEvent,
  TerminalStatusEvent,
  WriteTerminalRequest,
} from '../types';

export function spawnTerminal(request: SpawnTerminalRequest = {}): Promise<Terminal> {
  return safeInvoke<Terminal>('spawn_terminal', { request });
}

export function writeTerminal(request: WriteTerminalRequest): Promise<void> {
  return safeInvoke<void>('write_terminal', { request });
}

export function resizeTerminal(request: ResizeTerminalRequest): Promise<void> {
  return safeInvoke<void>('resize_terminal', { request });
}

export function killTerminal(terminalId: string): Promise<void> {
  return safeInvoke<void>('kill_terminal', { terminal_id: terminalId });
}

export function listTerminals(): Promise<Terminal[]> {
  return safeInvoke<Terminal[]>('list_terminals');
}

export function onTerminalOutput(
  handler: (payload: TerminalOutputEvent) => void
): Promise<UnlistenFn> {
  return safeListen<TerminalOutputEvent>('terminal-output', handler);
}

export function onTerminalStatus(
  handler: (payload: TerminalStatusEvent) => void
): Promise<UnlistenFn> {
  return safeListen<TerminalStatusEvent>('terminal-status', handler);
}
