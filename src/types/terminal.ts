export type TerminalStatus =
  | 'starting'
  | 'running'
  | { exited: number }
  | 'closed';

export interface Terminal {
  id: string;
  pid?: number | null;
  shell: string;
  args: string[];
  cwd?: string | null;
  cols: number;
  rows: number;
  status: TerminalStatus;
  created_at: string;
  last_activity: string;
}

export interface SpawnTerminalRequest {
  shell?: string | null;
  args?: string[] | null;
  cwd?: string | null;
  cols?: number | null;
  rows?: number | null;
}

export interface WriteTerminalRequest {
  terminal_id: string;
  data: string;
}

export interface ResizeTerminalRequest {
  terminal_id: string;
  cols: number;
  rows: number;
}

export interface TerminalOutput {
  terminal_id: string;
  data: string;
  exit_code?: number | null;
}

export interface ParsedTerminalStatus {
  kind: 'starting' | 'running' | 'exited' | 'closed';
  label: string;
  exitCode: number | null;
}

export function isTerminalAlive(status: TerminalStatus | undefined | null): boolean {
  return status === 'starting' || status === 'running';
}

export function getTerminalExitCode(status: TerminalStatus | undefined | null): number | null {
  if (status && typeof status === 'object' && 'exited' in status) {
    return status.exited;
  }
  return null;
}

export function formatTerminalStatus(status: TerminalStatus | undefined | null): ParsedTerminalStatus {
  if (status === 'starting') {
    return { kind: 'starting', label: 'starting', exitCode: null };
  }
  if (status === 'running') {
    return { kind: 'running', label: 'running', exitCode: null };
  }
  if (status && typeof status === 'object' && 'exited' in status) {
    return {
      kind: 'exited',
      label: `exited (${status.exited})`,
      exitCode: status.exited,
    };
  }
  return { kind: 'closed', label: 'closed', exitCode: null };
}
