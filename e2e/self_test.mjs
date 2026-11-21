import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';

import { createMockLLMServer, RICH_MARKDOWN_SAMPLE } from './mock_llm_server.mjs';
import {
  ALL_56_COMMANDS,
  createTauriBridge,
} from './mock_tauri_bridge.mjs';
import {
  createIsolatedEnv,
  snapshotRealConfig,
  assertRealConfigUnchanged,
} from './isolation.mjs';
import { startStaticServer } from './static_server.mjs';

async function parseSSE(resp) {
  const text = await resp.text();
  const blocks = text.split('\n\n').filter(Boolean);
  const chunks = [];
  let sawDone = false;
  for (const b of blocks) {
    for (const line of b.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') {
        sawDone = true;
      } else {
        chunks.push(JSON.parse(dataStr));
      }
    }
  }
  return { chunks, sawDone, raw: text };
}

export function getTests() {
  return [
    {
      id: 'SELF-01',
      tier: 'self',
      feature: 'E1.1',
      name: 'mock_llm_server: /v1/models, setModels, request recording & reset',
      async run({ llm, assert }) {
        const r1 = await fetch(`${llm.baseUrl}/models`, {
          headers: { Authorization: 'Bearer strata' },
        });
        assert.equal(r1.status, 200);
        const json1 = await r1.json();
        assert.equal(json1.object, 'list');
        assert.equal(json1.data[0].id, 'coder-iq1_m');
        assert.equal(
          json1.data[0].meta.label,
          'Qwen3.8-Flash-Next Coder IQ1_M'
        );

        llm.setModels([
          {
            id: 'custom-model-v2',
            object: 'model',
            owned_by: 'test',
            name: 'Custom Model V2',
          },
        ]);
        const r2 = await fetch(`${llm.baseUrl}/models`);
        const json2 = await r2.json();
        assert.equal(json2.data.length, 1);
        assert.equal(json2.data[0].id, 'custom-model-v2');

        const reqs = llm.getRequests();
        assert.equal(reqs.length, 2);
        assert.equal(reqs[0].headers.authorization, 'Bearer strata');

        llm.reset();
        assert.equal(llm.getRequests().length, 0);
        const r3 = await fetch(`${llm.baseUrl}/models`);
        const json3 = await r3.json();
        assert.equal(json3.data[0].id, 'coder-iq1_m');
      },
    },

    {
      id: 'SELF-02',
      tier: 'self',
      feature: 'E1.1',
      name: 'mock_llm_server: SSE streaming (<think>, reasoning_content, GFM/code/mermaid/KaTeX, native tool_calls, <tool_call>) & non-streaming',
      async run({ llm, assert }) {
        llm.setMode('normal', {
          reasoningContent: 'Chain of thought reasoning.',
          think: 'Internal think tag content.',
          richMarkdown: true,
          toolCalls: [
            {
              id: 'call_read_1',
              name: 'read_file',
              arguments: { path: '/workspace/README.md' },
            },
          ],
          fallbackToolCall: {
            name: 'list_dir',
            arguments: { path: '/workspace' },
          },
        });

        const streamResp = await fetch(`${llm.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer strata',
          },
          body: JSON.stringify({
            model: 'coder-iq1_m',
            stream: true,
            messages: [{ role: 'user', content: 'Test rich output' }],
          }),
        });
        assert.equal(streamResp.status, 200);
        assert.match(
          streamResp.headers.get('content-type') || '',
          /text\/event-stream/
        );

        const { chunks, sawDone } = await parseSSE(streamResp);
        assert.equal(sawDone, true);
        assert.ok(chunks.length > 5);

        let accContent = '';
        let accReasoning = '';
        let sawToolCallDelta = false;
        for (const c of chunks) {
          assert.ok(typeof c.id === 'string' && c.id.length > 0);
          assert.equal(c.object, 'chat.completion.chunk');
          assert.equal(typeof c.created, 'number');
          assert.equal(c.model, 'coder-iq1_m');
          assert.ok(Array.isArray(c.choices) && c.choices.length === 1);
          assert.equal(c.choices[0].index, 0);
          assert.ok('finish_reason' in c.choices[0]);

          const delta = c.choices[0].delta;
          if (delta.content) accContent += delta.content;
          if (delta.reasoning_content) accReasoning += delta.reasoning_content;
          if (Array.isArray(delta.tool_calls)) {
            sawToolCallDelta = true;
            assert.equal(typeof delta.tool_calls[0].index, 'number');
          }
        }

        assert.equal(accReasoning, 'Chain of thought reasoning.');
        assert.ok(accContent.includes('<think>Internal think tag content.</think>'));
        assert.ok(accContent.includes('| Subsystem | Status | Notes |'));
        assert.ok(accContent.includes('```mermaid'));
        assert.ok(accContent.includes('$$\\sum_{i=1}^{n}'));
        assert.ok(accContent.includes('<tool_call>'));
        assert.equal(sawToolCallDelta, true);

        // Non-streaming mode
        const nonStreamResp = await fetch(`${llm.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'coder-iq1_m',
            stream: false,
            messages: [{ role: 'user', content: 'Non-stream test' }],
          }),
        });
        assert.equal(nonStreamResp.status, 200);
        const nonJson = await nonStreamResp.json();
        assert.equal(nonJson.object, 'chat.completion');
        assert.equal(nonJson.choices[0].message.role, 'assistant');
        assert.ok(nonJson.choices[0].message.content.includes(RICH_MARKDOWN_SAMPLE));
        assert.equal(nonJson.choices[0].finish_reason, 'tool_calls');
      },
    },

    {
      id: 'SELF-03',
      tier: 'self',
      feature: 'E1.1',
      name: 'mock_llm_server: fault modes (401, 500, drop_connection, hang, malformed_mermaid, custom)',
      async run({ assert }) {
        const srv = await createMockLLMServer();
        try {
          // 401
          srv.setMode('401');
          const r401 = await fetch(`${srv.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'coder-iq1_m', messages: [] }),
          });
          assert.equal(r401.status, 401);

          // 500
          srv.setMode('500');
          const r500 = await fetch(`${srv.baseUrl}/models`);
          assert.equal(r500.status, 500);

          // malformed_mermaid
          srv.setMode('malformed_mermaid');
          const rMer = await fetch(`${srv.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'coder-iq1_m', stream: false, messages: [] }),
          });
          const jMer = await rMer.json();
          assert.ok(jMer.choices[0].message.content.includes('A --> --> B'));

          // custom stream & response
          srv.setMode('custom');
          srv.setStreamChunks([
            { delta: { role: 'assistant', content: 'CustomChunk1 ' } },
            { delta: { content: 'CustomChunk2' }, finish_reason: 'stop' },
          ]);
          const rCustom = await fetch(`${srv.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'coder-iq1_m', stream: true, messages: [] }),
          });
          const parsedCustom = await parseSSE(rCustom);
          assert.equal(parsedCustom.chunks.length, 2);
          assert.equal(parsedCustom.chunks[0].object, 'chat.completion.chunk');
          assert.equal(parsedCustom.chunks[1].choices[0].finish_reason, 'stop');

          srv.setResponse({
            id: 'custom-1',
            object: 'chat.completion',
            created: 1700000001,
            model: 'coder-iq1_m',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Custom JSON response' },
                finish_reason: 'stop',
              },
            ],
          });
          const rCustomNon = await fetch(`${srv.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'coder-iq1_m', stream: false, messages: [] }),
          });
          const jCustomNon = await rCustomNon.json();
          assert.equal(jCustomNon.id, 'custom-1');

          // drop_connection raw TCP helper
          const rawTcpRequest = (port, rawReq) =>
            new Promise((resolve, reject) => {
              const sock = net.connect(port, '127.0.0.1', () => {
                sock.write(rawReq);
              });
              const chunks = [];
              sock.on('data', (c) => chunks.push(c));
              sock.on('error', () => {
                // RST / ECONNRESET expected on abrupt destroy
              });
              sock.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
              setTimeout(() => {
                sock.destroy();
                reject(new Error('rawTcpRequest timed out'));
              }, 5000).unref();
            });

          // drop_connection {} drops immediately (0 bytes)
          srv.setMode('drop_connection', {});
          const streamBody = JSON.stringify({ model: 'coder-iq1_m', stream: true, messages: [] });
          const rawDropImmediate = await rawTcpRequest(
            srv.port,
            `POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(streamBody)}\r\nConnection: close\r\n\r\n${streamBody}`
          );
          assert.equal(rawDropImmediate.length, 0);

          // drop_connection { afterChunks: 1 } delivers HTTP 200 OK + chunk 1 before drop (no [DONE])
          srv.setMode('drop_connection', { afterChunks: 1 });
          const rawDropAfter1 = await rawTcpRequest(
            srv.port,
            `POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(streamBody)}\r\nConnection: close\r\n\r\n${streamBody}`
          );
          assert.ok(rawDropAfter1.startsWith('HTTP/1.1 200 OK'), `Expected 200 OK headers, got: ${rawDropAfter1.slice(0, 80)}`);
          assert.ok(rawDropAfter1.includes('data: {'), `Expected SSE chunk 1 data, got: ${rawDropAfter1}`);
          assert.ok(!rawDropAfter1.includes('[DONE]'), 'Expected no [DONE] before abrupt drop');

          // drop_connection { afterChunks: 1 } still drops immediately on GET /v1/models and stream: false
          const rawDropModels = await rawTcpRequest(
            srv.port,
            `GET /v1/models HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nConnection: close\r\n\r\n`
          );
          assert.equal(rawDropModels.length, 0);
          const nonStreamBody = JSON.stringify({ model: 'coder-iq1_m', stream: false, messages: [] });
          const rawDropNonStream = await rawTcpRequest(
            srv.port,
            `POST /v1/chat/completions HTTP/1.1\r\nHost: 127.0.0.1:${srv.port}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(nonStreamBody)}\r\nConnection: close\r\n\r\n${nonStreamBody}`
          );
          assert.equal(rawDropNonStream.length, 0);

          // Also verify fetch() rejects mid-stream under drop_connection { afterChunks: 1 }
          await assert.rejects(async () => {
            const rDrop = await fetch(`${srv.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ model: 'coder-iq1_m', stream: true, messages: [] }),
            });
            await rDrop.text();
          });

          // hang cleanly aborted on close
          srv.setMode('hang');
          const ac = new AbortController();
          const hangPromise = fetch(`${srv.baseUrl}/models`, { signal: ac.signal });
          setTimeout(() => ac.abort(), 50);
          await assert.rejects(() => hangPromise);

          // Also test server.close() while a hang request is in-flight
          const inFlight = fetch(`${srv.baseUrl}/models`).catch((e) => e);
          await new Promise((r) => setTimeout(r, 30));
          await srv.close();
          const err = await inFlight;
          assert.ok(err instanceof Error);
        } finally {
          await srv.close();
        }
      },
    },

    {
      id: 'SELF-04',
      tier: 'self',
      feature: 'E1.2',
      name: 'mock_tauri_bridge: all 56 IPC commands, Rust serde shapes & Strata defaults',
      async run({ llm, bridge, assert }) {
        assert.equal(ALL_56_COMMANDS.length, 56);

        // Config (3)
        const cfg = await bridge.invoke('get_config');
        assert.equal(cfg.llm.active_provider, 'strata');
        assert.equal(cfg.llm.providers[0].base_url, 'http://127.0.0.1:47831/v1');
        assert.equal(cfg.llm.providers[0].api_key, 'strata');
        assert.equal(cfg.llm.providers[1].base_url, 'http://192.168.0.92:47832/v1');
        assert.equal(cfg.llm.providers[1].api_key, 'strata');
        await bridge.invoke('set_config', {
          config: { ...cfg, ui: { ...cfg.ui, theme: 'light' } },
        });
        assert.equal((await bridge.invoke('get_config')).ui.theme, 'light');
        await bridge.invoke('reset_config');
        assert.equal((await bridge.invoke('get_config')).ui.theme, 'system');

        // FS (12)
        await bridge.invoke('watch_path', { path: '/workspace' });
        await bridge.invoke('create_dir', {
          request: { path: '/workspace/sub', recursive: true },
        });
        await bridge.invoke('write_file', {
          request: {
            path: '/workspace/sub/hello.ts',
            content: 'line1\nconst x = 1;\nline3\n',
            create_dirs: true,
          },
        });
        const rf = await bridge.invoke('read_file', {
          request: { path: '/workspace/sub/hello.ts' },
        });
        assert.equal(rf.is_binary, false);
        assert.ok(rf.content.includes('const x = 1;'));
        await bridge.invoke('edit_file', {
          request: {
            path: '/workspace/sub/hello.ts',
            old_text: 'const x = 1;',
            new_text: 'const x = 42;',
            replace_all: false,
          },
        });
        const rfr = await bridge.invoke('read_file_range', {
          request: { path: '/workspace/sub/hello.ts', start_line: 2, end_line: 2 },
        });
        assert.deepEqual(rfr.lines, ['const x = 42;']);
        const ld = await bridge.invoke('list_dir', {
          request: { path: '/workspace/sub', recursive: false },
        });
        assert.equal(ld.entries.length, 1);
        const sr = await bridge.invoke('search_files', {
          request: { path: '/workspace/sub', pattern: '42', file_pattern: '*.ts' },
        });
        assert.equal(sr.length, 1);
        assert.equal(sr[0].matches[0].line_number, 2);
        await bridge.invoke('copy_path', {
          request: {
            source: '/workspace/sub/hello.ts',
            destination: '/workspace/sub/hello_copy.ts',
          },
        });
        await bridge.invoke('move_path', {
          request: {
            source: '/workspace/sub/hello_copy.ts',
            destination: '/workspace/sub/hello_moved.ts',
          },
        });
        await bridge.invoke('delete_path', {
          request: { path: '/workspace/sub/hello_moved.ts', recursive: false },
        });
        await bridge.invoke('unwatch_path', { path: '/workspace' });

        // Terminal (5)
        const term = await bridge.invoke('spawn_terminal', {
          request: { cwd: '/workspace', cols: 100, rows: 25 },
        });
        assert.equal(typeof term.pid, 'number');
        assert.equal(term.status, 'running');
        assert.ok('created_at' in term && 'last_activity' in term);
        await bridge.invoke('write_terminal', {
          request: { terminal_id: term.id, data: 'echo hi\n' },
        });
        await bridge.invoke('resize_terminal', {
          request: { terminal_id: term.id, cols: 132, rows: 40 },
        });
        const terms = await bridge.invoke('list_terminals');
        assert.equal(terms[0].cols, 132);
        await bridge.invoke('kill_terminal', { terminal_id: term.id });
        assert.equal((await bridge.invoke('list_terminals')).length, 0);

        // LLM (8)
        const provs = await bridge.invoke('list_providers');
        assert.equal(provs[0].id, 'strata');
        const models = await bridge.invoke('refresh_provider_models', {
          provider_id: 'strata',
        });
        assert.equal(models[0].id, 'coder-iq1_m');
        assert.equal(models[0].name, 'Qwen3.8-Flash-Next Coder IQ1_M (coder-iq1_m)');
        const listedModels = await bridge.invoke('list_models', {
          provider_id: 'strata',
        });
        assert.equal(listedModels.length, 1);
        const addedP = await bridge.invoke('add_provider', {
          config: {
            id: 'local-llama',
            name: 'llama.cpp',
            provider_type: 'llamacpp',
            base_url: 'http://127.0.0.1:9999/v1',
            api_key: null,
            models: [],
            enabled: true,
          },
        });
        assert.equal(addedP.provider_type, 'llamacpp');
        await bridge.invoke('set_active_provider', { id: 'strata' });
        const cc = await bridge.invoke('chat_completion', {
          request: {
            model: 'coder-iq1_m',
            messages: [{ role: 'user', content: 'hi' }],
          },
        });
        assert.equal(cc.object, 'chat.completion');
        await bridge.invoke('stream_chat_completion', {
          request: {
            model: 'coder-iq1_m',
            messages: [{ role: 'user', content: 'hi' }],
          },
        });
        await bridge.invoke('remove_provider', { id: 'local-llama' });

        // Verify 401 propagates into ProviderStatus { error }
        llm.setMode('401');
        await bridge.invoke('refresh_provider_models', { provider_id: 'strata' });
        const after401 = await bridge.invoke('list_providers');
        assert.deepEqual(after401.find((p) => p.id === 'strata').status, {
          error: 'HTTP 401',
        });
        llm.setMode('normal');

        // Verify null args coercion & non-loopback provider guard
        const nullArgsModels = await bridge.invoke('list_models', null);
        assert.ok(Array.isArray(nullArgsModels));
        await bridge.invoke('refresh_provider_models', { provider_id: 'strata-lan' });
        const afterLan = await bridge.invoke('list_providers');
        assert.match(
          afterLan.find((p) => p.id === 'strata-lan').status?.error || '',
          /Offline E2E harness blocked non-loopback provider URL/
        );

        // Verify add_server without cfg.id populates id in _config.mcp.servers
        const anonSrv = await bridge.invoke('add_server', {
          config: {
            name: 'Anon MCP',
            transport: { type: 'sse', url: 'http://127.0.0.1:9001/sse', headers: null },
            enabled: true,
            auto_start: false,
          },
        });
        assert.ok(typeof anonSrv.id === 'string' && anonSrv.id.length > 0);
        const cfgAfterAnon = await bridge.invoke('get_config');
        assert.ok(cfgAfterAnon.mcp.servers.some((s) => s.id === anonSrv.id));
        await bridge.invoke('remove_server', { id: anonSrv.id });

        // MCP (7)
        const srv = await bridge.invoke('add_server', {
          config: {
            id: 'test-mcp',
            name: 'Test MCP',
            transport: { type: 'sse', url: 'http://127.0.0.1:9000/sse', headers: null },
            enabled: true,
            auto_start: false,
          },
        });
        assert.equal(srv.status, 'disconnected');
        const connSrv = await bridge.invoke('connect_server', { id: 'test-mcp' });
        assert.equal(connSrv.status, 'connected');
        const tools = await bridge.invoke('list_tools', { server_id: 'test-mcp' });
        assert.ok(tools.length >= 1);
        const toolRes = await bridge.invoke('call_tool', {
          request: {
            server_id: 'test-mcp',
            tool_name: tools[0].name,
            arguments: {},
          },
        });
        assert.equal(toolRes.success, true);
        await bridge.invoke('disconnect_server', { id: 'test-mcp' });
        assert.equal((await bridge.invoke('list_servers')).length, 1);
        await bridge.invoke('remove_server', { id: 'test-mcp' });

        // Agent (11)
        const conv = await bridge.invoke('create_conversation', {
          title: 'Self Test Conv',
          workspace_path: '/workspace',
        });
        await bridge.invoke('send_message', {
          request: { conversation_id: conv.id, content: 'hello' },
        });
        const task = await bridge.invoke('start_agent_task', {
          request: { conversation_id: conv.id, prompt: 'run check' },
        });
        assert.equal(task.status, 'running');
        await new Promise((r) => setTimeout(r, 40));
        const st = await bridge.invoke('get_agent_status', { task_id: task.id });
        assert.equal(st.status, 'completed');
        const gotConv = await bridge.invoke('get_conversation', {
          conversation_id: conv.id,
        });
        assert.ok(gotConv.messages.length >= 3);
        const convList = await bridge.invoke('list_conversations');
        assert.equal(convList[0].id, conv.id);
        await bridge.invoke('answer_question', {
          question_id: 'q1',
          answers: { q: ['yes'] },
        });
        await bridge.invoke('approve_command', {
          approval_id: 'a1',
          approved: true,
        });
        const arts = await bridge.invoke('list_artifacts', {
          conversation_id: conv.id,
        });
        assert.deepEqual(arts, []);
        const cTask = await bridge.invoke('start_agent_task', {
          request: { conversation_id: conv.id, prompt: 'cancel me' },
        });
        const cancelled = await bridge.invoke('cancel_agent_task', {
          task_id: cTask.id,
        });
        assert.equal(cancelled.status, 'cancelled');
        await bridge.invoke('delete_conversation', { conversation_id: conv.id });

        // Skills (5)
        const skList = await bridge.invoke('list_skills', { source: 'builtinskills' });
        assert.equal(skList.length, 1);
        const loaded = await bridge.invoke('load_skill', { id: 'code-review' });
        assert.equal(loaded.loaded, true);
        const schema = await bridge.invoke('get_skill_schema', { id: 'code-review' });
        assert.equal(schema.name, 'code-review');
        await bridge.invoke('unload_skill', { id: 'code-review' });
        await bridge.invoke('reload_skills');

        // Window (5)
        await bridge.invoke('create_window', { url: '/', label: 'inspector' });
        const wins = await bridge.invoke('list_windows');
        assert.deepEqual(wins, ['main', 'inspector']);
        await bridge.invoke('minimize_window');
        await bridge.invoke('maximize_window');
        await bridge.invoke('close_window', { label: 'inspector' });
        assert.deepEqual(await bridge.invoke('list_windows'), ['main']);

        // Confirm every single one of the 56 commands was invoked & recorded
        const invokedNames = new Set(bridge.getInvocations().map((i) => i.cmd));
        for (const name of ALL_56_COMMANDS) {
          assert.ok(
            invokedNames.has(name),
            `Expected command "${name}" to be exercised and recorded`
          );
        }
      },
    },

    {
      id: 'SELF-05',
      tier: 'self',
      feature: 'E1.2',
      name: 'mock_tauri_bridge: strict snake_case rejection (recorded BEFORE throwing) & plugin:* exemption',
      async run({ bridge, assert }) {
        bridge.clearInvocations();

        // camelCase app argument MUST throw AND still be recorded with casingOk: false
        await assert.rejects(
          () =>
            bridge.invoke('get_conversation', {
              conversationId: 'conv-123',
            }),
          /snake_case/
        );
        const invs = bridge.getInvocations();
        assert.equal(invs.length, 1);
        assert.equal(invs[0].cmd, 'get_conversation');
        assert.equal(invs[0].casingOk, false);
        assert.deepEqual(invs[0].casingErrors, ['conversationId']);

        // plugin:* commands with camelCase args MUST NOT throw
        await bridge.invoke('plugin:event|unlisten', {
          event: 'test-evt',
          eventId: 7,
        });
        const invs2 = bridge.getInvocations();
        assert.equal(invs2.length, 2);
        assert.equal(invs2[1].casingOk, true);
      },
    },

    {
      id: 'SELF-06',
      tier: 'self',
      feature: 'E1.2',
      name: 'mock_tauri_bridge: live Chromium event round-trip, Channel delivery & waitForInvocation across Page.reload',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({ url: 'about:blank' });

        // Test Channel delivery + plugin:event|listen/emit + waitForInvocation across reload
        await app.page.evaluate(async () => {
          window.__receivedEvents = [];
          window.__channelMsgs = [];

          const cbId = window.__TAURI_INTERNALS__.transformCallback((evt) => {
            window.__receivedEvents.push(evt);
          });
          await window.__TAURI_INTERNALS__.invoke('plugin:event|listen', {
            event: 'agent-stream-delta',
            target: { kind: 'Any' },
            handler: cbId,
          });

          const chCb = window.__TAURI_INTERNALS__.transformCallback((msg) => {
            window.__channelMsgs.push(msg);
          });
          window.__testChannel = `__CHANNEL__:${chCb}`;
        });

        await app.bridge.emitEvent('agent-stream-delta', {
          conversation_id: 'c1',
          message_id: 'm1',
          content_delta: 'hello',
          reasoning_delta: '',
        });

        await app.page.evaluate(() => {
          window.__e2eSendChannelMessage(window.__testChannel, 0, { chunk: 'a' });
          window.__e2eEndChannel(window.__testChannel, 1);
        });

        const state1 = await app.page.evaluate(() => ({
          events: window.__receivedEvents,
          ch: window.__channelMsgs,
        }));
        assert.equal(state1.events.length, 1);
        assert.equal(state1.events[0].payload.content_delta, 'hello');
        assert.equal(state1.ch.length, 2);
        assert.equal(state1.ch[1].end, true);

        // Invoke across reload and verify host waitForInvocation resolves
        const waitPromise = app.bridge.waitForInvocation(
          'create_conversation',
          (inv) => inv.args.title === 'AfterReload',
          5000
        );
        await app.page.reload();
        const created = await app.page.evaluate(async () => {
          return window.__TAURI_INTERNALS__.invoke('create_conversation', {
            title: 'AfterReload',
          });
        });
        const inv = await waitPromise;
        assert.equal(created.title, 'AfterReload');
        assert.equal(inv.args.title, 'AfterReload');
      },
    },

    {
      id: 'SELF-07',
      tier: 'self',
      feature: 'E1.3',
      name: 'cdp_client: DOM click, type (Input.insertText), pressKey combos, viewports 1440x900 & 820x640 PNG IHDR, console/pageError capture',
      async run(env) {
        const { assert } = env;
        const app = await env.openApp({
          url: 'about:blank',
          width: 1440,
          height: 900,
          allowConsoleErrors: true,
        });

        await app.page.evaluate(() => {
          document.body.innerHTML = `
            <div style="padding:20px;background:#111;color:#fff;font-family:sans-serif">
              <button id="btn">Click Me</button>
              <form id="frm">
                <input id="inp" type="text" />
              </form>
              <textarea id="ta">line1</textarea>
              <div id="log"></div>
            </div>
          `;
          window.__clicks = 0;
          window.__submits = 0;
          window.__keys = [];
          document.getElementById('btn').addEventListener('click', () => {
            window.__clicks++;
          });
          document.getElementById('frm').addEventListener('submit', (e) => {
            e.preventDefault();
            window.__submits++;
          });
          window.addEventListener('keydown', (e) => {
            window.__keys.push({
              key: e.key,
              code: e.code,
              ctrlKey: e.ctrlKey,
              shiftKey: e.shiftKey,
            });
          });
        });

        await app.page.click('#btn');
        await app.page.type('#inp', 'Hello Antigravity');
        await app.page.pressKey('Enter');
        await app.page.click('#ta');
        await app.page.evaluate(() => {
          const ta = document.getElementById('ta');
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        });
        await app.page.pressKey('Enter');
        await app.page.pressKey('Control+Shift+P');
        await app.page.pressKey('k', ['Control']);
        await app.page.pressKey('Backquote', ['Control']);
        await app.page.pressKey('Comma', ['Control']);
        await app.page.pressKey('Escape');

        const domRes = await app.page.evaluate(() => ({
          clicks: window.__clicks,
          submits: window.__submits,
          value: document.getElementById('inp').value,
          taValue: document.getElementById('ta').value,
          keys: window.__keys,
        }));
        assert.equal(domRes.clicks, 1);
        assert.equal(domRes.submits, 1);
        assert.equal(domRes.value, 'Hello Antigravity');
        assert.equal(domRes.taValue, 'line1\n');
        assert.equal(domRes.keys[0].key, 'Enter');
        assert.equal(domRes.keys[0].code, 'Enter');
        assert.equal(domRes.keys[1].key, 'Enter');
        assert.equal(domRes.keys[2].ctrlKey, true);
        assert.equal(domRes.keys[2].shiftKey, true);
        assert.equal(domRes.keys[2].code, 'KeyP');
        assert.equal(domRes.keys[3].code, 'KeyK');
        assert.equal(domRes.keys[4].code, 'Backquote');
        assert.equal(domRes.keys[5].code, 'Comma');
        assert.equal(domRes.keys[6].key, 'Escape');

        // Desktop screenshot 1440x900
        const desktopPath = path.join(env.screenshotsDir, 'self_desktop.png');
        const desktopPng = await app.page.captureScreenshot(desktopPath);
        env.assert.assertPngDimensions(desktopPng, 1440, 900);
        const st = await fs.stat(desktopPath);
        assert.ok(st.size > 500);

        // Narrow screenshot 820x640
        await app.page.setViewport(820, 640);
        const narrowPng = await app.page.captureScreenshot();
        env.assert.assertPngDimensions(narrowPng, 820, 640);

        // Console error & page error capture
        await app.page.evaluate(() => {
          console.error('self-test-console-error');
          setTimeout(() => {
            throw new Error('self-test-uncaught');
          }, 10);
        });
        await app.page.waitForFunction(
          () => true,
          500
        );
        await new Promise((r) => setTimeout(r, 80));
        assert.ok(
          app.page.getConsoleErrors().some((e) => e.text.includes('self-test-console-error'))
        );
        assert.ok(
          app.page.getPageErrors().some((e) => e.message.includes('self-test-uncaught'))
        );
      },
    },

    {
      id: 'SELF-08',
      tier: 'self',
      feature: 'E1.5',
      name: 'static_server: MIME types, path traversal guard, SPA fallback, /vite.svg 200, and live app/dist/ render in Chromium with zero errors',
      async run(env) {
        const { assert } = env;
        const srv = await startStaticServer({
          distDir: path.join(env.appDir, 'dist'),
        });
        try {
          const rHtml = await fetch(`${srv.url}/`);
          assert.equal(rHtml.status, 200);
          assert.match(rHtml.headers.get('content-type') || '', /text\/html/);

          const rSpa = await fetch(`${srv.url}/conversations/abc`);
          assert.equal(rSpa.status, 200);
          assert.match(rSpa.headers.get('content-type') || '', /text\/html/);

          const rMissingAsset = await fetch(`${srv.url}/assets/does-not-exist.js`);
          assert.equal(rMissingAsset.status, 404);

          const rSvg = await fetch(`${srv.url}/vite.svg`);
          assert.equal(rSvg.status, 200);
          assert.match(rSvg.headers.get('content-type') || '', /image\/svg\+xml/);

          const rTrav = await fetch(`${srv.url}/../package.json`);
          assert.ok(rTrav.status === 403 || rTrav.status === 404);

          // Verify symlink escape guard returns 403 Forbidden
          const symTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-sym-test-'));
          try {
            const symDist = path.join(symTmp, 'dist');
            await fs.mkdir(symDist, { recursive: true });
            await fs.writeFile(path.join(symDist, 'index.html'), '<html>ok</html>', 'utf8');
            await fs.writeFile(path.join(symTmp, 'secret.txt'), 'TOP_SECRET', 'utf8');
            await fs.symlink(path.join(symTmp, 'secret.txt'), path.join(symDist, 'evil_link.txt'));
            const symSrv = await startStaticServer({ distDir: symDist });
            try {
              const rSym = await fetch(`${symSrv.url}/evil_link.txt`);
              assert.equal(rSym.status, 403);
            } finally {
              await symSrv.close();
            }
          } finally {
            await fs.rm(symTmp, { recursive: true, force: true });
          }

          // Load actual app/dist/ in headless Chromium with mock_tauri_bridge
          const app = await env.openApp({ url: srv.url });
          await app.page.waitForFunction(
            () =>
              document.title === 'Antigravity' &&
              (document.getElementById('root')?.innerText || '').includes('Antigravity'),
            10000
          );
          const title = await app.page.evaluate(() => document.title);
          const rootLen = await app.page.evaluate(
            () => document.getElementById('root')?.innerHTML.length || 0
          );
          assert.equal(title, 'Antigravity');
          assert.ok(rootLen > 200, `Expected rendered #root HTML, got len=${rootLen}`);
          env.assert.assertNoPageErrors(app);
          assert.equal(
            app.networkErrors.length,
            0,
            `Unexpected network errors: ${JSON.stringify(app.networkErrors)}`
          );

          // Confirm boot IPC calls were recorded on the host bridge
          const cmds = app.bridge.getInvocations().map((i) => i.cmd);
          assert.ok(cmds.includes('list_conversations'));
          assert.ok(cmds.includes('list_providers'));
          assert.ok(cmds.includes('get_config'));
          assert.ok(cmds.includes('list_skills'));
          assert.ok(cmds.includes('list_servers'));
        } finally {
          await srv.close();
        }
      },
    },

    {
      id: 'SELF-09',
      tier: 'self',
      feature: 'E1.4',
      name: 'isolation: temp env vars, RUSTUP_HOME/CARGO_HOME preservation, and config invariance detection',
      async run({ assert, isolation }) {
        const realSnap = await snapshotRealConfig();
        assert.equal(typeof isolation.assertConfigUnchanged, 'function');
        await isolation.assertConfigUnchanged();
        const iso = await createIsolatedEnv('ag-self-iso-');
        try {
          assert.ok(iso.env.HOME.startsWith(iso.rootDir));
          assert.ok(iso.env.ANTIGRAVITY_CONFIG_PATH.startsWith(iso.rootDir));
          assert.ok(iso.env.ANTIGRAVITY_BRAIN_DIR.startsWith(iso.rootDir));
          assert.ok(iso.env.ANTIGRAVITY_HOME_DIR.startsWith(iso.rootDir));
          assert.equal(iso.env.ANTIGRAVITY_OFFLINE_NO_DISCOVER, '1');
          assert.equal(
            iso.env.RUSTUP_HOME,
            process.env.RUSTUP_HOME || path.join(iso.realHome, '.rustup')
          );
          assert.equal(
            iso.env.CARGO_HOME,
            process.env.CARGO_HOME || path.join(iso.realHome, '.cargo')
          );

          // Verify assertRealConfigUnchanged detects mutation on a temp config file
          const tempCfg = path.join(iso.rootDir, 'test_config.toml');
          await fs.writeFile(tempCfg, 'key = "before"\n', 'utf8');
          const snapBefore = await snapshotRealConfig(tempCfg);
          await assertRealConfigUnchanged(snapBefore);

          await fs.writeFile(tempCfg, 'key = "after"\n', 'utf8');
          await assert.rejects(
            () => assertRealConfigUnchanged(snapBefore),
            /Live config modified/
          );
        } finally {
          await iso.cleanup();
        }
        await assertRealConfigUnchanged(realSnap);
      },
    },
  ];
}
