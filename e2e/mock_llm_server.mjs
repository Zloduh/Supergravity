import http from 'node:http';
import crypto from 'node:crypto';

export const DEFAULT_STRATA_MODELS = [
  {
    id: 'coder-iq1_m',
    object: 'model',
    created: 1700000000,
    owned_by: 'strata',
    name: '',
    meta: { label: 'Qwen3.8-Flash-Next Coder IQ1_M' },
  },
];

export const RICH_MARKDOWN_SAMPLE = [
  '## Analysis & Implementation',
  '',
  'Here is a summary table:',
  '',
  '| Subsystem | Status | Notes |',
  '|---|---|---|',
  '| IPC Bridge | Ready | `snake_case` validated |',
  '| Streaming | Active | SSE chunks |',
  '',
  '```typescript',
  'export async function ping(id: string): Promise<boolean> {',
  '  return id.length > 0;',
  '}',
  '```',
  '',
  '```mermaid',
  'graph TD',
  '  UI[React UI] --> Bridge[Tauri Bridge]',
  '  Bridge --> LLM[Mock LLM Server]',
  '```',
  '',
  'Inline math $E = mc^2$ and block math:',
  '',
  '$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$',
].join('\n');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function splitChunks(str, size = 24) {
  if (!str) return [];
  const out = [];
  for (let i = 0; i < str.length; i += size) {
    out.push(str.slice(i, i + size));
  }
  return out;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      if (!rawBody) {
        resolve({ rawBody, body: null });
        return;
      }
      try {
        resolve({ rawBody, body: JSON.parse(rawBody) });
      } catch {
        resolve({ rawBody, body: null });
      }
    });
    req.on('error', reject);
  });
}

export class MockLLMServer {
  constructor(options = {}) {
    this._host = options.host || '127.0.0.1';
    this._requestedPort = options.port ?? 0;
    this._server = null;
    this._port = null;
    this._sockets = new Set();
    this._timers = new Set();
    this._pendingResponses = new Set();

    this._models = clone(options.models || DEFAULT_STRATA_MODELS);
    this._mode = 'normal';
    this._modeOpts = {};
    this._customChunks = null;
    this._customResponse = null;
    this._requests = [];
    this._seq = 0;
  }

  get port() {
    return this._port;
  }

  get url() {
    if (!this._port) throw new Error('MockLLMServer has not been started');
    return `http://${this._host}:${this._port}`;
  }

  get baseUrl() {
    return `${this.url}/v1`;
  }

  setModels(models) {
    this._models = clone(models || []);
  }

  setMode(mode, opts = {}) {
    this._mode = mode || 'normal';
    this._modeOpts = opts ? { ...opts } : {};
  }

  setStreamChunks(chunks) {
    this._customChunks = clone(chunks);
  }

  setResponse(resp) {
    this._customResponse = clone(resp);
  }

  getRequests() {
    return clone(this._requests);
  }

  reset() {
    this._models = clone(DEFAULT_STRATA_MODELS);
    this._mode = 'normal';
    this._modeOpts = {};
    this._customChunks = null;
    this._customResponse = null;
    this._requests = [];
  }

  _schedule(fn, delayMs) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._timers.delete(timer);
        fn();
        resolve();
      }, delayMs);
      this._timers.add(timer);
    });
  }

  _buildChunk({ id, created, model, delta, finishReason = null }) {
    return {
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [
        {
          index: 0,
          delta: delta || {},
          finish_reason: finishReason,
        },
      ],
    };
  }

  _buildStreamFrames(reqBody) {
    const model = reqBody?.model || this._models[0]?.id || 'coder-iq1_m';
    const id = `chatcmpl-${++this._seq}-${crypto.randomBytes(4).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);

    if (this._mode === 'custom' && Array.isArray(this._customChunks)) {
      return this._customChunks.map((raw) => {
        if (
          raw &&
          typeof raw === 'object' &&
          raw.id &&
          raw.object === 'chat.completion.chunk' &&
          typeof raw.created === 'number' &&
          raw.model &&
          Array.isArray(raw.choices)
        ) {
          return raw;
        }
        return this._buildChunk({
          id: raw?.id || id,
          created: raw?.created ?? created,
          model: raw?.model || model,
          delta: raw?.delta ?? raw ?? {},
          finishReason: raw?.finish_reason ?? null,
        });
      });
    }

    if (this._mode === 'malformed_mermaid') {
      const content =
        'Here is a broken diagram:\n\n```mermaid\ngraph TD\n  A --> --> B\n  C -.- ???\n```\n';
      return [
        this._buildChunk({ id, created, model, delta: { role: 'assistant', content: '' } }),
        ...splitChunks(content, 20).map((piece) =>
          this._buildChunk({ id, created, model, delta: { content: piece } })
        ),
        this._buildChunk({ id, created, model, delta: {}, finishReason: 'stop' }),
      ];
    }

    const opts = this._modeOpts || {};
    const frames = [
      this._buildChunk({ id, created, model, delta: { role: 'assistant' } }),
    ];

    if (opts.reasoningContent) {
      for (const piece of splitChunks(opts.reasoningContent, opts.chunkSize || 24)) {
        frames.push(
          this._buildChunk({ id, created, model, delta: { reasoning_content: piece } })
        );
      }
    }

    let content = opts.content;
    if (content === undefined && opts.richMarkdown) {
      content = RICH_MARKDOWN_SAMPLE;
    } else if (content === undefined && !opts.toolCalls && !opts.fallbackToolCall) {
      const lastUser = Array.isArray(reqBody?.messages)
        ? [...reqBody.messages].reverse().find((m) => m.role === 'user')?.content || ''
        : '';
      content = lastUser
        ? `Mock response to: ${lastUser}`
        : 'Mock assistant response ready.';
    }

    if (opts.think) {
      const thinkBlock = `<think>${opts.think}</think>\n\n`;
      for (const piece of splitChunks(thinkBlock, opts.chunkSize || 24)) {
        frames.push(this._buildChunk({ id, created, model, delta: { content: piece } }));
      }
    }

    if (content) {
      for (const piece of splitChunks(content, opts.chunkSize || 24)) {
        frames.push(this._buildChunk({ id, created, model, delta: { content: piece } }));
      }
    }

    if (opts.fallbackToolCall) {
      const payload = JSON.stringify(opts.fallbackToolCall);
      const tcBlock = `\n<tool_call>${payload}</tool_call>\n`;
      for (const piece of splitChunks(tcBlock, opts.chunkSize || 24)) {
        frames.push(this._buildChunk({ id, created, model, delta: { content: piece } }));
      }
    }

    if (Array.isArray(opts.toolCalls) && opts.toolCalls.length > 0) {
      opts.toolCalls.forEach((tc, index) => {
        const callId = tc.id || `call_${index + 1}_${crypto.randomBytes(3).toString('hex')}`;
        const name = tc.name || tc.function?.name || 'read_file';
        const rawArgs =
          typeof tc.arguments === 'string'
            ? tc.arguments
            : JSON.stringify(tc.arguments ?? tc.function?.arguments ?? {});
        frames.push(
          this._buildChunk({
            id,
            created,
            model,
            delta: {
              tool_calls: [
                {
                  index,
                  id: callId,
                  type: 'function',
                  function: { name, arguments: '' },
                },
              ],
            },
          })
        );
        for (const piece of splitChunks(rawArgs, opts.chunkSize || 16)) {
          frames.push(
            this._buildChunk({
              id,
              created,
              model,
              delta: {
                tool_calls: [
                  {
                    index,
                    function: { arguments: piece },
                  },
                ],
              },
            })
          );
        }
      });
      frames.push(
        this._buildChunk({ id, created, model, delta: {}, finishReason: 'tool_calls' })
      );
    } else {
      frames.push(
        this._buildChunk({ id, created, model, delta: {}, finishReason: 'stop' })
      );
    }

    return frames;
  }

  _buildNonStreamResponse(reqBody) {
    if (this._mode === 'custom' && this._customResponse) {
      return clone(this._customResponse);
    }
    const model = reqBody?.model || this._models[0]?.id || 'coder-iq1_m';
    const id = `chatcmpl-${++this._seq}-${crypto.randomBytes(4).toString('hex')}`;
    const created = Math.floor(Date.now() / 1000);
    const opts = this._modeOpts || {};

    if (this._mode === 'malformed_mermaid') {
      return {
        id,
        object: 'chat.completion',
        created,
        model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content:
                'Here is a broken diagram:\n\n```mermaid\ngraph TD\n  A --> --> B\n```\n',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 },
      };
    }

    const lastUser = Array.isArray(reqBody?.messages)
      ? [...reqBody.messages].reverse().find((m) => m.role === 'user')?.content || ''
      : '';

    let content = opts.content;
    if (content === undefined && opts.richMarkdown) {
      content = RICH_MARKDOWN_SAMPLE;
    } else if (content === undefined && !opts.toolCalls && !opts.fallbackToolCall) {
      content = lastUser
        ? `Mock response to: ${lastUser}`
        : 'Mock assistant response ready.';
    }
    if (opts.think) {
      content = `<think>${opts.think}</think>\n\n${content || ''}`;
    }
    if (opts.fallbackToolCall) {
      content = `${content || ''}\n<tool_call>${JSON.stringify(opts.fallbackToolCall)}</tool_call>`;
    }

    const message = {
      role: 'assistant',
      content: content ?? '',
    };
    if (opts.reasoningContent) {
      message.reasoning_content = opts.reasoningContent;
    }
    let finishReason = 'stop';
    if (Array.isArray(opts.toolCalls) && opts.toolCalls.length > 0) {
      message.tool_calls = opts.toolCalls.map((tc, idx) => ({
        id: tc.id || `call_${idx + 1}`,
        type: 'function',
        function: {
          name: tc.name || tc.function?.name || 'read_file',
          arguments:
            typeof tc.arguments === 'string'
              ? tc.arguments
              : JSON.stringify(tc.arguments ?? tc.function?.arguments ?? {}),
        },
      }));
      finishReason = 'tool_calls';
    }

    return {
      id,
      object: 'chat.completion',
      created,
      model,
      choices: [
        {
          index: 0,
          message,
          finish_reason: finishReason,
        },
      ],
      usage: opts.usage || { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 },
    };
  }

  async _handleRequest(req, res) {
    const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
    const pathname = parsedUrl.pathname;
    const method = (req.method || 'GET').toUpperCase();

    const { rawBody, body } = await readJsonBody(req);
    this._requests.push({
      method,
      url: req.url || '/',
      pathname,
      headers: { ...req.headers },
      body: clone(body),
      rawBody,
      timestamp: Date.now(),
    });

    // CORS headers in case browser fetches directly
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (this._mode === '401') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Invalid API key provided',
            type: 'authentication_error',
            code: 'invalid_api_key',
          },
        })
      );
      return;
    }

    if (this._mode === '500') {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'Mock internal server error',
            type: 'server_error',
            code: 'internal_error',
          },
        })
      );
      return;
    }

    if (this._mode === 'hang') {
      const delayMs = this._modeOpts?.delayMs;
      if (typeof delayMs === 'number' && delayMs > 0) {
        let closed = false;
        req.on('close', () => {
          closed = true;
        });
        await this._schedule(() => {}, delayMs);
        if (closed || res.destroyed || !this._server) return;
      } else {
        // Hold indefinitely until client aborts or server closes
        this._pendingResponses.add(res);
        res.on('close', () => this._pendingResponses.delete(res));
        return;
      }
    }

    if (this._mode === 'drop_connection') {
      const dropAfter = Number(this._modeOpts?.afterChunks || 0);
      const isStreamingChat =
        method === 'POST' &&
        (pathname === '/v1/chat/completions' || pathname === '/chat/completions') &&
        Boolean(body?.stream);
      if (!(dropAfter > 0 && isStreamingChat)) {
        req.socket.destroy();
        return;
      }
    }

    if (method === 'GET' && (pathname === '/v1/models' || pathname === '/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: clone(this._models),
        })
      );
      return;
    }

    if (
      method === 'POST' &&
      (pathname === '/v1/chat/completions' || pathname === '/chat/completions')
    ) {
      const isStream = Boolean(body?.stream);
      if (!isStream) {
        const respObj = this._buildNonStreamResponse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(respObj));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.flushHeaders?.();

      const frames = this._buildStreamFrames(body);
      const chunkDelayMs = this._modeOpts?.chunkDelayMs ?? 0;
      const dropAfter =
        this._mode === 'drop_connection' ? Number(this._modeOpts?.afterChunks || 0) : 0;

      for (let i = 0; i < frames.length; i++) {
        if (res.destroyed || !this._server) return;
        const chunkLine = `data: ${JSON.stringify(frames[i])}\n\n`;
        if (dropAfter > 0 && i + 1 >= dropAfter) {
          await new Promise((resolve) => {
            const onClose = () => setImmediate(resolve);
            res.once('close', onClose);
            res.write(chunkLine, () => {
              res.off('close', onClose);
              setImmediate(resolve);
            });
          });
          if (!res.destroyed) {
            req.socket.destroy();
          }
          return;
        }
        res.write(chunkLine);
        if (chunkDelayMs > 0 && i + 1 < frames.length) {
          await this._schedule(() => {}, chunkDelayMs);
        }
      }

      if (dropAfter > 0) {
        if (!res.destroyed) {
          req.socket.destroy();
        }
        return;
      }

      if (!res.destroyed && this._server) {
        res.write('data: [DONE]\n\n');
        res.end();
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: `Unknown route: ${method} ${pathname}`,
          type: 'invalid_request_error',
        },
      })
    );
  }

  async start() {
    if (this._server) return this;
    const server = http.createServer((req, res) => {
      this._handleRequest(req, res).catch((err) => {
        if (!res.headersSent && !res.destroyed) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: String(err?.message || err) } }));
        } else {
          try {
            res.destroy();
          } catch {
            // ignore
          }
        }
      });
    });

    server.on('connection', (socket) => {
      this._sockets.add(socket);
      socket.on('close', () => this._sockets.delete(socket));
    });

    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this._requestedPort, this._host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });

    this._server = server;
    const addr = server.address();
    this._port = typeof addr === 'object' && addr ? addr.port : this._requestedPort;
    return this;
  }

  async close() {
    for (const timer of this._timers) {
      clearTimeout(timer);
    }
    this._timers.clear();

    for (const res of this._pendingResponses) {
      try {
        res.destroy();
      } catch {
        // ignore
      }
    }
    this._pendingResponses.clear();

    for (const socket of this._sockets) {
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    }
    this._sockets.clear();

    if (this._server) {
      const s = this._server;
      this._server = null;
      await new Promise((resolve) => {
        s.close(() => resolve());
      });
    }
    this._port = null;
  }
}

export async function createMockLLMServer(options = {}) {
  const srv = new MockLLMServer(options);
  await srv.start();
  return srv;
}
