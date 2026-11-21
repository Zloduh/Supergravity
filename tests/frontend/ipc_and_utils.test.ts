import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTauriEnv } from './mock_tauri.ts';

const env = createMockTauriEnv();

const tauriUtils = await import('../../src/utils/tauri.ts');
const ipc = await import('../../src/ipc/index.ts');
const { formatTerminalStatus, isTerminalAlive, getTerminalExitCode } = await import(
  '../../src/types/terminal.ts'
);
const { matchesShortcut } = await import('../../src/hooks/useKeyboardShortcuts.ts');
const { isNearBottom } = await import('../../src/hooks/useAutoScroll.ts');

describe('utils/tauri & typed IPC wrappers', () => {
  beforeEach(() => {
    env.reset();
  });

  it('isTauri, safeInvoke, and safeListen respect __TAURI_INTERNALS__ presence', async () => {
    assert.equal(tauriUtils.isTauri(), true);

    env.setHandler('ping_cmd', (args) => ({ ok: true, args }));
    const res = await tauriUtils.safeInvoke<{ ok: boolean }>('ping_cmd', { hello: 'world' });
    assert.equal(res.ok, true);

    let received: unknown = null;
    const unlisten = await tauriUtils.safeListen('test-ev', (p) => {
      received = p;
    });
    assert.equal(env.listenerCount('test-ev'), 1);
    env.emitEvent('test-ev', { count: 42 });
    assert.deepEqual(received, { count: 42 });
    await unlisten();
    assert.equal(env.listenerCount('test-ev'), 0);

    env.uninstallTauri();
    assert.equal(tauriUtils.isTauri(), false);
    await assert.rejects(() => tauriUtils.safeInvoke('ping_cmd'), /Tauri runtime unavailable/);
    const noopUnlisten = await tauriUtils.safeListen('test-ev', () => {});
    assert.equal(typeof noopUnlisten, 'function');
    noopUnlisten();
  });

  it('formatTauriError extracts clean messages from Error, string, and object values', () => {
    assert.equal(tauriUtils.formatTauriError(new Error('boom')), 'boom');
    assert.equal(tauriUtils.formatTauriError('raw error'), 'raw error');
    assert.equal(tauriUtils.formatTauriError({ error: 'backend failed' }), 'backend failed');
    assert.equal(tauriUtils.formatTauriError({ message: 'msg failed' }), 'msg failed');
  });

  it('IPC wrappers send exact snake_case top-level argument keys', async () => {
    const okHandler = () => ({});
    for (const cmd of [
      'get_conversation',
      'delete_conversation',
      'start_agent_task',
      'cancel_agent_task',
      'get_agent_status',
      'create_conversation',
      'answer_question',
      'approve_command',
      'list_artifacts',
      'refresh_provider_models',
      'list_models',
      'kill_terminal',
      'list_tools',
      'list_skills',
      'watch_path',
      'unwatch_path',
      'create_window',
      'close_window',
    ]) {
      env.setHandler(cmd, okHandler);
    }

    await ipc.getConversation('conv-1');
    await ipc.deleteConversation('conv-1');
    await ipc.cancelAgentTask('task-1');
    await ipc.getAgentStatus('task-1');
    await ipc.createConversation({
      title: 'Title',
      system_prompt: 'Prompt',
      workspace_path: '/tmp/ws',
    });
    await ipc.answerQuestion('q-1', { q: ['a'] });
    await ipc.approveCommand('a-1', true);
    await ipc.listArtifacts('conv-1');
    await ipc.refreshProviderModels('strata');
    await ipc.listModels('strata');
    await ipc.killTerminal('term-1');
    await ipc.listTools('mcp-1');
    await ipc.listSkills({ source: 'builtin', skill_type: 'user' });
    await ipc.watchPath('/tmp/ws');
    await ipc.unwatchPath('/tmp/ws');
    await ipc.createWindow({ url: 'http://localhost', label: 'sec' });
    await ipc.closeWindow('sec');

    const byCmd = new Map(env.invocations.map((i) => [i.cmd, i.args]));
    assert.deepEqual(byCmd.get('get_conversation'), { conversation_id: 'conv-1' });
    assert.deepEqual(byCmd.get('delete_conversation'), { conversation_id: 'conv-1' });
    assert.deepEqual(byCmd.get('cancel_agent_task'), { task_id: 'task-1' });
    assert.deepEqual(byCmd.get('get_agent_status'), { task_id: 'task-1' });
    assert.deepEqual(byCmd.get('create_conversation'), {
      title: 'Title',
      system_prompt: 'Prompt',
      workspace_path: '/tmp/ws',
    });
    assert.deepEqual(byCmd.get('answer_question'), { question_id: 'q-1', answers: { q: ['a'] } });
    assert.deepEqual(byCmd.get('approve_command'), { approval_id: 'a-1', approved: true });
    assert.deepEqual(byCmd.get('list_artifacts'), { conversation_id: 'conv-1' });
    assert.deepEqual(byCmd.get('refresh_provider_models'), { provider_id: 'strata' });
    assert.deepEqual(byCmd.get('list_models'), { provider_id: 'strata' });
    assert.deepEqual(byCmd.get('kill_terminal'), { terminal_id: 'term-1' });
    assert.deepEqual(byCmd.get('list_tools'), { server_id: 'mcp-1' });
    assert.deepEqual(byCmd.get('list_skills'), { source: 'builtin', skill_type: 'user' });
    assert.deepEqual(byCmd.get('watch_path'), { path: '/tmp/ws' });
    assert.deepEqual(byCmd.get('unwatch_path'), { path: '/tmp/ws' });
    assert.deepEqual(byCmd.get('create_window'), { url: 'http://localhost', label: 'sec' });
    assert.deepEqual(byCmd.get('close_window'), { label: 'sec' });
  });

  it('TerminalStatus helpers handle starting, running, { exited }, and closed', () => {
    assert.equal(isTerminalAlive('starting'), true);
    assert.equal(isTerminalAlive('running'), true);
    assert.equal(isTerminalAlive({ exited: 0 }), false);
    assert.equal(isTerminalAlive('closed'), false);

    assert.equal(getTerminalExitCode({ exited: 137 }), 137);
    assert.equal(getTerminalExitCode('running'), null);

    assert.deepEqual(formatTerminalStatus('starting'), {
      kind: 'starting',
      label: 'starting',
      exitCode: null,
    });
    assert.deepEqual(formatTerminalStatus('running'), {
      kind: 'running',
      label: 'running',
      exitCode: null,
    });
    assert.deepEqual(formatTerminalStatus({ exited: 2 }), {
      kind: 'exited',
      label: 'exited (2)',
      exitCode: 2,
    });
    assert.deepEqual(formatTerminalStatus('closed'), {
      kind: 'closed',
      label: 'closed',
      exitCode: null,
    });
  });

  it('hooks helpers evaluate keyboard shortcuts and sticky scroll thresholds accurately', () => {
    const fakeEvent = (overrides: Record<string, unknown>) =>
      ({
        key: 'k',
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        altKey: false,
        isComposing: false,
        target: { tagName: 'DIV', isContentEditable: false },
        ...overrides,
      }) as unknown as KeyboardEvent;

    assert.equal(
      matchesShortcut(fakeEvent({ ctrlKey: true, key: 'k' }), {
        key: 'k',
        mod: true,
        handler: () => {},
      }),
      true
    );
    assert.equal(
      matchesShortcut(fakeEvent({ metaKey: true, shiftKey: true, key: 'P' }), {
        key: 'p',
        mod: true,
        shift: true,
        handler: () => {},
      }),
      true
    );
    // Bare key inside INPUT is suppressed unless allowInInput or Escape
    assert.equal(
      matchesShortcut(fakeEvent({ key: 'j', target: { tagName: 'INPUT' } }), {
        key: 'j',
        handler: () => {},
      }),
      false
    );
    assert.equal(
      matchesShortcut(fakeEvent({ key: 'Escape', target: { tagName: 'INPUT' } }), {
        key: 'Escape',
        handler: () => {},
      }),
      true
    );

    assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 260 }, 64), true);
    assert.equal(isNearBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 260 }, 64), false);
  });
});
