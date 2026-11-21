import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTauriEnv } from './mock_tauri.ts';

const env = createMockTauriEnv();
const { useTerminalStore, formatTerminalStatus } = await import(
  '../../src/stores/terminalStore.ts'
);

describe('terminalStore', () => {
  beforeEach(() => {
    env.reset();
    useTerminalStore.setState({
      terminals: [],
      activeTerminalId: null,
      output: new Map(),
      loading: false,
      error: null,
    });
  });

  it('spawns, writes, resizes, kills terminals with snake_case IPC args', async () => {
    env.setHandler('spawn_terminal', (args) => {
      const req = (args as { request: Record<string, unknown> }).request;
      return {
        id: 'term-1',
        pid: 1234,
        shell: (req.shell as string) || '/bin/bash',
        args: [],
        cwd: (req.cwd as string) || '/workspace',
        cols: (req.cols as number) || 80,
        rows: (req.rows as number) || 24,
        status: 'starting',
        created_at: '2026-01-01T00:00:00Z',
        last_activity: '2026-01-01T00:00:00Z',
      };
    });
    env.setHandler('write_terminal', () => null);
    env.setHandler('resize_terminal', () => null);
    env.setHandler('kill_terminal', () => null);

    const term = await useTerminalStore.getState().spawnTerminal(undefined, '/workspace', 100, 30);
    assert.equal(term?.id, 'term-1');
    assert.equal(useTerminalStore.getState().activeTerminalId, 'term-1');

    const spawnCall = env.invocations.find((i) => i.cmd === 'spawn_terminal');
    assert.deepEqual(spawnCall?.args, {
      request: { shell: null, cwd: '/workspace', cols: 100, rows: 30 },
    });

    await useTerminalStore.getState().writeToTerminal('term-1', 'ls -la\n');
    const writeCall = env.invocations.find((i) => i.cmd === 'write_terminal');
    assert.deepEqual(writeCall?.args, {
      request: { terminal_id: 'term-1', data: 'ls -la\n' },
    });

    await useTerminalStore.getState().resizeTerminal('term-1', 120, 40);
    const resizeCall = env.invocations.find((i) => i.cmd === 'resize_terminal');
    assert.deepEqual(resizeCall?.args, {
      request: { terminal_id: 'term-1', cols: 120, rows: 40 },
    });
    assert.equal(useTerminalStore.getState().terminals[0].cols, 120);

    await useTerminalStore.getState().killTerminal('term-1');
    const killCall = env.invocations.find((i) => i.cmd === 'kill_terminal');
    assert.deepEqual(killCall?.args, { terminal_id: 'term-1' });
    assert.equal(useTerminalStore.getState().terminals.length, 0);
    assert.equal(useTerminalStore.getState().activeTerminalId, null);
  });

  it('handles terminal-output, terminal-status transitions, chunk subscriptions, and clearOutput', async () => {
    useTerminalStore.setState({
      terminals: [
        {
          id: 'term-2',
          shell: '/bin/bash',
          args: [],
          cwd: '/tmp',
          cols: 80,
          rows: 24,
          status: 'starting',
          created_at: '2026-01-01T00:00:00Z',
          last_activity: '2026-01-01T00:00:00Z',
        },
      ],
      activeTerminalId: 'term-2',
    });

    const cleanup = await useTerminalStore.getState().initListeners();
    assert.equal(env.listenerCount('terminal-output'), 1);
    assert.equal(env.listenerCount('terminal-status'), 1);

    const chunks: string[] = [];
    let clearedCount = 0;
    const unsubChunk = useTerminalStore.getState().subscribeOutput('term-2', (c) => chunks.push(c));
    const unsubClear = useTerminalStore.getState().subscribeClear('term-2', () => {
      clearedCount += 1;
    });

    env.emitEvent('terminal-status', { terminal_id: 'term-2', status: 'running' });
    assert.equal(useTerminalStore.getState().terminals[0].status, 'running');

    env.emitEvent('terminal-output', { terminal_id: 'term-2', data: 'hello ' });
    env.emitEvent('terminal-output', { terminal_id: 'term-2', data: 'pty\r\n' });
    assert.equal(useTerminalStore.getState().output.get('term-2'), 'hello pty\r\n');
    assert.deepEqual(chunks, ['hello ', 'pty\r\n']);

    env.emitEvent('terminal-status', { terminal_id: 'term-2', status: { exited: 1 } });
    assert.deepEqual(useTerminalStore.getState().terminals[0].status, { exited: 1 });
    assert.equal(
      formatTerminalStatus(useTerminalStore.getState().terminals[0].status).label,
      'exited (1)'
    );

    useTerminalStore.getState().clearOutput('term-2');
    assert.equal(useTerminalStore.getState().output.get('term-2'), '');
    assert.equal(clearedCount, 1);

    unsubChunk();
    unsubClear();
    cleanup();
    assert.equal(env.listenerCount('terminal-output'), 0);
    assert.equal(env.listenerCount('terminal-status'), 0);
  });

  it('surfaces IPC errors and supports browser demo mode when !isTauri()', async () => {
    env.setReject('spawn_terminal', 'pty allocation failed');
    const failed = await useTerminalStore.getState().spawnTerminal();
    assert.equal(failed, null);
    assert.match(useTerminalStore.getState().error || '', /pty allocation failed/);
    useTerminalStore.getState().clearError();
    assert.equal(useTerminalStore.getState().error, null);

    env.uninstallTauri();
    const demo = await useTerminalStore.getState().spawnTerminal(undefined, '/demo');
    assert.ok(demo && demo.id.startsWith('demo-term-'));
    await useTerminalStore.getState().writeToTerminal(demo.id, 'echo hi\r');
    assert.match(useTerminalStore.getState().output.get(demo.id) || '', /Antigravity Demo Terminal/);
  });
});
