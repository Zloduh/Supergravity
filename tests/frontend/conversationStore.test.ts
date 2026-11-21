import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMockTauriEnv } from './mock_tauri.ts';

const env = createMockTauriEnv();
const { useConversationStore } = await import('../../src/stores/conversationStore.ts');

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('conversationStore', () => {
  beforeEach(() => {
    env.reset();
    useConversationStore.setState({
      conversations: [],
      activeConversationId: null,
      activeConversation: null,
      tasks: [],
      activeTaskId: null,
      streamingContent: '',
      streamingReasoning: '',
      streamingMessageId: null,
      isStreaming: false,
      pendingQuestions: [],
      pendingApprovals: [],
      loading: false,
      error: null,
    });
  });

  it('routes agent-stream-delta by message_id and ignores non-active conversations', async () => {
    const convA = {
      id: 'conv-a',
      title: 'A',
      messages: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const convB = { ...convA, id: 'conv-b', title: 'B' };
    useConversationStore.setState({
      conversations: [convA, convB],
      activeConversationId: 'conv-a',
      activeConversation: convA,
    });

    const cleanup = await useConversationStore.getState().initListeners();

    env.emitEvent('agent-stream-delta', {
      conversation_id: 'conv-b',
      message_id: 'msg-b1',
      content_delta: 'wrong conv',
      reasoning_delta: '',
    });
    assert.equal(useConversationStore.getState().streamingContent, '');

    env.emitEvent('agent-stream-delta', {
      conversation_id: 'conv-a',
      message_id: 'msg-1',
      content_delta: 'Hello ',
      reasoning_delta: 'Think 1',
    });
    env.emitEvent('agent-stream-delta', {
      conversation_id: 'conv-a',
      message_id: 'msg-1',
      content_delta: 'world',
      reasoning_delta: '...',
    });
    assert.equal(useConversationStore.getState().streamingContent, 'Hello world');
    assert.equal(useConversationStore.getState().streamingReasoning, 'Think 1...');
    assert.equal(useConversationStore.getState().streamingMessageId, 'msg-1');

    // New message_id resets stream buffer instead of bleeding across turns
    env.emitEvent('agent-stream-delta', {
      conversation_id: 'conv-a',
      message_id: 'msg-2',
      content_delta: 'Next turn',
      reasoning_delta: 'Think 2',
    });
    assert.equal(useConversationStore.getState().streamingContent, 'Next turn');
    assert.equal(useConversationStore.getState().streamingReasoning, 'Think 2');
    assert.equal(useConversationStore.getState().streamingMessageId, 'msg-2');

    // Background conversation update does not clear active stream
    env.emitEvent('agent-conversation-update', convB);
    assert.equal(useConversationStore.getState().streamingContent, 'Next turn');

    cleanup();
  });

  it('guards 200ms polling with inFlight and stops cleanly on completion or cancel', async () => {
    const conv = {
      id: 'conv-poll',
      title: 'Poll',
      messages: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    useConversationStore.setState({
      conversations: [conv],
      activeConversationId: 'conv-poll',
      activeConversation: conv,
    });

    let getConvCalls = 0;
    let taskStatus: 'running' | 'completed' = 'running';

    env.setHandler('start_agent_task', () => ({
      id: 'task-1',
      conversation_id: 'conv-poll',
      prompt: 'hi',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 0,
      max_iterations: 10,
    }));

    env.setHandler('get_conversation', async () => {
      getConvCalls += 1;
      await delay(320); // slower than 200ms interval -> inFlight guard must skip overlaps
      return {
        ...conv,
        messages: [
          {
            id: 'm-user',
            role: 'user',
            content: 'hi',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      };
    });

    env.setHandler('get_agent_status', () => ({
      id: 'task-1',
      conversation_id: 'conv-poll',
      prompt: 'hi',
      status: taskStatus,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 1,
      max_iterations: 10,
    }));

    await useConversationStore.getState().sendMessage('conv-poll', 'hi');
    await delay(500);
    // At 500ms with a 320ms slow response, at most 2 polls can have started (not 3+)
    assert.ok(getConvCalls <= 2, `Expected <= 2 guarded polls, got ${getConvCalls}`);

    taskStatus = 'completed';
    await delay(450);
    assert.equal(useConversationStore.getState().isStreaming, false);
    assert.equal(useConversationStore.getState().activeTaskId, null);

    const callsAfterComplete = getConvCalls;
    await delay(300);
    assert.equal(getConvCalls, callsAfterComplete, 'Polling must stop after completion');
  });

  it('startAgentTask starts polling and cancelAgentTask stops polling', async () => {
    let pollCount = 0;
    env.setHandler('start_agent_task', () => ({
      id: 'task-2',
      conversation_id: 'conv-2',
      prompt: 'run',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 0,
      max_iterations: 5,
    }));
    env.setHandler('get_conversation', () => {
      pollCount += 1;
      return {
        id: 'conv-2',
        title: 'Task 2',
        messages: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      };
    });
    env.setHandler('get_agent_status', () => ({
      id: 'task-2',
      conversation_id: 'conv-2',
      prompt: 'run',
      status: 'running',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 0,
      max_iterations: 5,
    }));
    env.setHandler('cancel_agent_task', () => ({
      id: 'task-2',
      conversation_id: 'conv-2',
      prompt: 'run',
      status: 'cancelled',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 0,
      max_iterations: 5,
    }));

    const task = await useConversationStore.getState().startAgentTask('run');
    assert.equal(task?.id, 'task-2');
    await delay(260);
    assert.ok(pollCount >= 1, 'startAgentTask must trigger polling');

    await useConversationStore.getState().cancelAgentTask('task-2');
    assert.equal(useConversationStore.getState().isStreaming, false);
    const snapshot = pollCount;
    await delay(300);
    assert.equal(pollCount, snapshot, 'cancelAgentTask must stop polling');
  });

  it('surfaces IPC errors on answerQuestion/approveCommand and supports clearError + regenerateLastResponse', async () => {
    const conv = {
      id: 'conv-regen',
      title: 'Regen',
      messages: [
        {
          id: 'u-1',
          role: 'user',
          content: 'Explain Rust lifetimes',
          created_at: '2026-01-01T00:00:00Z',
        },
        {
          id: 'a-1',
          role: 'assistant',
          content: 'Old response',
          created_at: '2026-01-01T00:00:00Z',
        },
      ],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    useConversationStore.setState({
      conversations: [conv],
      activeConversationId: 'conv-regen',
      activeConversation: conv,
    });

    env.setReject('answer_question', 'question timeout');
    await useConversationStore.getState().answerQuestion('q-9', { q: ['opt'] });
    assert.match(useConversationStore.getState().error || '', /question timeout/);

    useConversationStore.getState().clearError();
    assert.equal(useConversationStore.getState().error, null);

    env.setReject('approve_command', 'approval failed');
    await useConversationStore.getState().approveCommand('app-9', true);
    assert.match(useConversationStore.getState().error || '', /approval failed/);
    useConversationStore.getState().clearError();

    env.setHandler('start_agent_task', () => ({
      id: 'task-regen',
      conversation_id: 'conv-regen',
      prompt: 'Explain Rust lifetimes',
      status: 'completed',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 1,
      max_iterations: 5,
    }));
    env.setHandler('get_conversation', () => conv);
    env.setHandler('get_agent_status', () => ({
      id: 'task-regen',
      conversation_id: 'conv-regen',
      prompt: 'Explain Rust lifetimes',
      status: 'completed',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      iterations: 1,
      max_iterations: 5,
    }));

    await useConversationStore.getState().regenerateLastResponse();
    const startCall = env.invocations.find((i) => i.cmd === 'start_agent_task');
    assert.equal((startCall?.args as { request: { prompt: string } })?.request.prompt, 'Explain Rust lifetimes');
    // Stop any remaining poll timer via setActiveConversation
    useConversationStore.getState().setActiveConversation(null);
  });

  it('moves existing conversations into a Project and updates worktree_mode', async () => {
    const conv = {
      id: 'conv-move-1',
      title: 'Existing Conversation',
      messages: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      project_id: null,
      worktree_mode: 'local' as const,
    };
    useConversationStore.setState({
      conversations: [conv],
      activeConversationId: 'conv-move-1',
      activeConversation: conv,
    });

    env.setHandler('create_conversation', (args) => ({
      ...conv,
      project_id: args.project_id || null,
      workspace_path: args.workspace_path || '/workspace/proj-alpha',
      worktree_mode: args.worktree_mode || 'new_worktree',
    }));

    const moved = await useConversationStore
      .getState()
      .moveConversationToProject(
        'conv-move-1',
        'proj-alpha',
        '/workspace/proj-alpha',
        'new_worktree'
      );
    assert.equal(moved?.project_id, 'proj-alpha');
    assert.equal(moved?.workspace_path, '/workspace/proj-alpha');
    assert.equal(moved?.worktree_mode, 'new_worktree');
    assert.equal(useConversationStore.getState().activeConversation?.project_id, 'proj-alpha');
  });
});
