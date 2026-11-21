import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_CHROMIUM = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

const MODIFIER_BITS = {
  alt: 1,
  option: 1,
  control: 2,
  ctrl: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  super: 4,
  shift: 8,
};

const SPECIAL_KEYS = {
  escape: { key: 'Escape', code: 'Escape', keyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', keyCode: 27 },
  enter: { key: 'Enter', code: 'Enter', keyCode: 13 },
  return: { key: 'Enter', code: 'Enter', keyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', keyCode: 9 },
  backspace: { key: 'Backspace', code: 'Backspace', keyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', keyCode: 46 },
  space: { key: ' ', code: 'Space', keyCode: 32 },
  ' ': { key: ' ', code: 'Space', keyCode: 32 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  home: { key: 'Home', code: 'Home', keyCode: 36 },
  end: { key: 'End', code: 'End', keyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', keyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 34 },
  backquote: { key: '`', code: 'Backquote', keyCode: 192 },
  '`': { key: '`', code: 'Backquote', keyCode: 192 },
  comma: { key: ',', code: 'Comma', keyCode: 188 },
  ',': { key: ',', code: 'Comma', keyCode: 188 },
  period: { key: '.', code: 'Period', keyCode: 190 },
  '.': { key: '.', code: 'Period', keyCode: 190 },
  slash: { key: '/', code: 'Slash', keyCode: 191 },
  '/': { key: '/', code: 'Slash', keyCode: 191 },
  minus: { key: '-', code: 'Minus', keyCode: 189 },
  '-': { key: '-', code: 'Minus', keyCode: 189 },
  equal: { key: '=', code: 'Equal', keyCode: 187 },
  '=': { key: '=', code: 'Equal', keyCode: 187 },
  bracketleft: { key: '[', code: 'BracketLeft', keyCode: 219 },
  '[': { key: '[', code: 'BracketLeft', keyCode: 219 },
  bracketright: { key: ']', code: 'BracketRight', keyCode: 221 },
  ']': { key: ']', code: 'BracketRight', keyCode: 221 },
  semicolon: { key: ';', code: 'Semicolon', keyCode: 186 },
  ';': { key: ';', code: 'Semicolon', keyCode: 186 },
};

function resolveKeyDescriptor(keyOrCombo, modifiersArg) {
  let modBits = 0;
  let keyToken = String(keyOrCombo || '');

  if (Array.isArray(modifiersArg)) {
    for (const m of modifiersArg) {
      const bit = MODIFIER_BITS[String(m).toLowerCase()];
      if (bit) modBits |= bit;
    }
  } else if (typeof modifiersArg === 'number') {
    modBits |= modifiersArg;
  }

  // Support combo strings like 'Control+Shift+P' or 'Control+`'
  if (keyToken.includes('+') && keyToken.length > 1) {
    const parts = keyToken.split('+');
    keyToken = parts.pop() || '';
    for (const part of parts) {
      const bit = MODIFIER_BITS[part.trim().toLowerCase()];
      if (bit) modBits |= bit;
    }
  }

  const lower = keyToken.toLowerCase();
  if (SPECIAL_KEYS[lower]) {
    const spec = SPECIAL_KEYS[lower];
    return {
      modifiers: modBits,
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.keyCode,
      nativeVirtualKeyCode: spec.keyCode,
    };
  }

  // F1-F12
  const fnMatch = /^f([1-9]|1[0-2])$/i.exec(keyToken);
  if (fnMatch) {
    const num = Number(fnMatch[1]);
    return {
      modifiers: modBits,
      key: `F${num}`,
      code: `F${num}`,
      windowsVirtualKeyCode: 111 + num,
      nativeVirtualKeyCode: 111 + num,
    };
  }

  // Single letter a-z / A-Z
  if (/^[a-z]$/i.test(keyToken)) {
    const upper = keyToken.toUpperCase();
    const hasShift = (modBits & MODIFIER_BITS.shift) !== 0 || keyToken === upper;
    const finalKey = hasShift ? upper : keyToken.toLowerCase();
    const keyCode = upper.charCodeAt(0);
    return {
      modifiers: modBits,
      key: finalKey,
      code: `Key${upper}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
  }

  // Single digit 0-9
  if (/^[0-9]$/.test(keyToken)) {
    const keyCode = keyToken.charCodeAt(0);
    return {
      modifiers: modBits,
      key: keyToken,
      code: `Digit${keyToken}`,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
    };
  }

  return {
    modifiers: modBits,
    key: keyToken,
    code: keyToken,
    windowsVirtualKeyCode: keyToken.charCodeAt(0) || 0,
    nativeVirtualKeyCode: keyToken.charCodeAt(0) || 0,
  };
}

function formatRemoteObject(arg) {
  if (!arg || typeof arg !== 'object') return String(arg);
  if ('value' in arg) {
    return typeof arg.value === 'string' ? arg.value : JSON.stringify(arg.value);
  }
  if (arg.description) return arg.description;
  return `[${arg.type || 'object'}]`;
}

function buildEvalExpression(fnOrExpr, args) {
  if (typeof fnOrExpr === 'function') {
    const serializedArgs = args
      .map((a) => (a === undefined ? 'undefined' : JSON.stringify(a)))
      .join(', ');
    return `(${fnOrExpr.toString()})(${serializedArgs})`;
  }
  return String(fnOrExpr);
}

class CDPConnection {
  constructor(ws) {
    this._ws = ws;
    this._nextId = 1;
    this._pending = new Map();
    this._eventListeners = new Map();
    this._closed = false;

    ws.addEventListener('message', (evt) => {
      let msg;
      try {
        msg = JSON.parse(typeof evt.data === 'string' ? evt.data : String(evt.data));
      } catch {
        return;
      }

      if (typeof msg.id === 'number') {
        const entry = this._pending.get(msg.id);
        if (!entry) return;
        this._pending.delete(msg.id);
        if (msg.error) {
          entry.reject(
            new Error(`CDP error (${entry.method}): ${msg.error.message || JSON.stringify(msg.error)}`)
          );
        } else {
          entry.resolve(msg.result || {});
        }
        return;
      }

      if (msg.method) {
        const key = `${msg.sessionId || '__browser__'}::${msg.method}`;
        const listeners = this._eventListeners.get(key);
        if (listeners) {
          for (const fn of [...listeners]) {
            try {
              fn(msg.params || {});
            } catch {
              // keep dispatching
            }
          }
        }
      }
    });

    const rejectAll = (reason) => {
      if (this._closed) return;
      this._closed = true;
      for (const [, entry] of this._pending) {
        entry.reject(new Error(`CDP connection closed: ${reason}`));
      }
      this._pending.clear();
    };

    ws.addEventListener('close', () => rejectAll('WebSocket closed'));
    ws.addEventListener('error', (err) => rejectAll(err?.message || 'WebSocket error'));
  }

  send(method, params = {}, sessionId = undefined) {
    if (this._closed || this._ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP connection is not open (${method})`));
    }
    const id = this._nextId++;
    const frame = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject, method });
      this._ws.send(JSON.stringify(frame));
    });
  }

  on(method, fn, sessionId = undefined) {
    const key = `${sessionId || '__browser__'}::${method}`;
    let set = this._eventListeners.get(key);
    if (!set) {
      set = new Set();
      this._eventListeners.set(key, set);
    }
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this._eventListeners.delete(key);
    };
  }

  once(method, sessionId = undefined, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const off = this.on(
        method,
        (params) => {
          clearTimeout(timer);
          off();
          resolve(params);
        },
        sessionId
      );
    });
  }

  close() {
    this._closed = true;
    try {
      this._ws.close();
    } catch {
      // ignore
    }
  }
}

class CDPPage {
  constructor({ conn, browserContextId, targetId, sessionId }) {
    this._conn = conn;
    this._browserContextId = browserContextId;
    this._targetId = targetId;
    this._sessionId = sessionId;
    this._closed = false;

    this._consoleErrors = [];
    this._consoleMessages = [];
    this._pageErrors = [];
    this._networkErrors = [];
    this._bindings = new Map();
    this._unsubs = [];

    this._unsubs.push(
      conn.on(
        'Runtime.consoleAPICalled',
        (params) => {
          const text = (params.args || []).map(formatRemoteObject).join(' ');
          const entry = {
            type: params.type,
            text,
            timestamp: params.timestamp,
          };
          this._consoleMessages.push(entry);
          if (params.type === 'error') {
            this._consoleErrors.push(entry);
          }
        },
        sessionId
      ),
      conn.on(
        'Runtime.exceptionThrown',
        (params) => {
          const d = params.exceptionDetails || {};
          const msg =
            d.exception?.description ||
            d.exception?.value ||
            d.text ||
            'Uncaught page exception';
          this._pageErrors.push({
            message: String(msg),
            url: d.url || '',
            lineNumber: d.lineNumber ?? null,
            columnNumber: d.columnNumber ?? null,
            timestamp: params.timestamp,
          });
        },
        sessionId
      ),
      conn.on(
        'Log.entryAdded',
        (params) => {
          const entry = params.entry || {};
          if (entry.source === 'network' && entry.level === 'error') {
            this._networkErrors.push({
              source: entry.source,
              level: entry.level,
              text: entry.text || '',
              url: entry.url || '',
              timestamp: entry.timestamp,
            });
          }
        },
        sessionId
      ),
      conn.on(
        'Page.javascriptDialogOpening',
        () => {
          conn
            .send('Page.handleJavaScriptDialog', { accept: true }, sessionId)
            .catch(() => {});
        },
        sessionId
      ),
      conn.on(
        'Runtime.bindingCalled',
        (params) => {
          const handlers = this._bindings.get(params.name);
          if (!handlers) return;
          for (const fn of [...handlers]) {
            Promise.resolve(fn(params.payload, params.executionContextId)).catch(
              () => {}
            );
          }
        },
        sessionId
      )
    );
  }

  get consoleErrors() {
    return [...this._consoleErrors];
  }

  get pageErrors() {
    return [...this._pageErrors];
  }

  get networkErrors() {
    return [...this._networkErrors];
  }

  getConsoleErrors() {
    return [...this._consoleErrors];
  }

  getPageErrors() {
    return [...this._pageErrors];
  }

  getNetworkErrors() {
    return [...this._networkErrors];
  }

  getConsoleMessages() {
    return [...this._consoleMessages];
  }

  clearRecordedErrors() {
    this._consoleErrors = [];
    this._pageErrors = [];
    this._networkErrors = [];
  }

  async _send(method, params = {}) {
    if (this._closed) {
      throw new Error(`CDPPage is closed (${method})`);
    }
    return this._conn.send(method, params, this._sessionId);
  }

  async addInitScript(src) {
    const res = await this._send('Page.addScriptToEvaluateOnNewDocument', {
      source: src,
    });
    return res.identifier;
  }

  async addBinding(name, fn) {
    let set = this._bindings.get(name);
    if (!set) {
      set = new Set();
      this._bindings.set(name, set);
      await this._send('Runtime.addBinding', { name });
    }
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  async setViewport(width, height, opts = {}) {
    await this._send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: opts.deviceScaleFactor ?? 1,
      mobile: opts.mobile ?? false,
    });
  }

  async navigate(url, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 15000;
    const loadPromise = this._conn.once(
      'Page.loadEventFired',
      this._sessionId,
      timeoutMs
    );
    const navRes = await this._send('Page.navigate', { url });
    if (navRes.errorText) {
      loadPromise.catch(() => {});
      throw new Error(`Navigation failed for ${url}: ${navRes.errorText}`);
    }
    await loadPromise;
  }

  async reload(opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 15000;
    const loadPromise = this._conn.once(
      'Page.loadEventFired',
      this._sessionId,
      timeoutMs
    );
    await this._send('Page.reload', {
      ignoreCache: opts.ignoreCache ?? false,
    });
    await loadPromise;
  }

  async evaluate(fnOrExpr, ...args) {
    const expression = buildEvalExpression(fnOrExpr, args);
    const res = await this._send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      const d = res.exceptionDetails;
      const msg =
        d.exception?.description ||
        d.exception?.value ||
        d.text ||
        'Evaluation failed';
      throw new Error(`Page evaluate error: ${msg}`);
    }
    return res.result ? res.result.value : undefined;
  }

  async waitForSelector(selector, timeoutOrOpts = 5000) {
    const opts =
      typeof timeoutOrOpts === 'number'
        ? { timeoutMs: timeoutOrOpts }
        : timeoutOrOpts || {};
    const timeoutMs = opts.timeoutMs ?? 5000;
    const intervalMs = opts.intervalMs ?? 50;
    const visible = Boolean(opts.visible);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const found = await this.evaluate(
        (sel, checkVisible) => {
          const el = document.querySelector(sel);
          if (!el) return false;
          if (!checkVisible) return true;
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        },
        selector,
        visible
      );
      if (found) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for selector "${selector}"`);
  }

  async waitForFunction(fnOrExpr, timeoutOrOpts = 5000, ...args) {
    const opts =
      typeof timeoutOrOpts === 'number'
        ? { timeoutMs: timeoutOrOpts }
        : timeoutOrOpts || {};
    const timeoutMs = opts.timeoutMs ?? 5000;
    const intervalMs = opts.intervalMs ?? 50;

    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() <= deadline) {
      try {
        const val = await this.evaluate(fnOrExpr, ...args);
        if (val) return val;
      } catch (err) {
        lastError = err;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for function${lastError ? ` (last error: ${lastError.message})` : ''}`
    );
  }

  async click(selector, opts = {}) {
    if (opts.waitMs !== 0) {
      await this.waitForSelector(selector, opts.waitMs ?? 3000);
    }
    const point = await this.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return { zeroSize: true };
      }
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }, selector);

    if (!point) {
      throw new Error(`click: selector not found: "${selector}"`);
    }
    if (point.zeroSize) {
      throw new Error(`click: element has zero size: "${selector}"`);
    }

    await this._send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: point.x,
      y: point.y,
    });
    await this._send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
    await this._send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: point.x,
      y: point.y,
      button: 'left',
      clickCount: 1,
    });
  }

  async type(selector, text, opts = {}) {
    if (selector) {
      await this.click(selector, { waitMs: opts.waitMs ?? 3000 });
      await this.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el && typeof el.focus === 'function') el.focus();
      }, selector);
    }

    if (opts.clear) {
      await this.pressKey('a', ['Control']);
      await this.pressKey('Backspace');
    }

    if (text && text.length > 0) {
      await this._send('Input.insertText', { text: String(text) });
    }
  }

  async pressKey(key, modifiers) {
    const desc = resolveKeyDescriptor(key, modifiers);
    const keyDownParams = {
      type: 'keyDown',
      modifiers: desc.modifiers,
      key: desc.key,
      code: desc.code,
      windowsVirtualKeyCode: desc.windowsVirtualKeyCode,
      nativeVirtualKeyCode: desc.nativeVirtualKeyCode,
    };
    if (desc.key === 'Enter' && desc.modifiers === 0) {
      keyDownParams.text = '\r';
      keyDownParams.unmodifiedText = '\r';
    }
    await this._send('Input.dispatchKeyEvent', keyDownParams);
    await this._send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      modifiers: desc.modifiers,
      key: desc.key,
      code: desc.code,
      windowsVirtualKeyCode: desc.windowsVirtualKeyCode,
      nativeVirtualKeyCode: desc.nativeVirtualKeyCode,
    });
  }

  async captureScreenshot(outPath) {
    const res = await this._send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(res.data, 'base64');
    if (outPath) {
      await fs.mkdir(path.dirname(outPath), { recursive: true });
      await fs.writeFile(outPath, buf);
    }
    return buf;
  }

  async screenshot(outPath) {
    return this.captureScreenshot(outPath);
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    for (const off of this._unsubs) {
      try {
        off();
      } catch {
        // ignore
      }
    }
    this._unsubs = [];
    this._bindings.clear();

    try {
      await this._conn.send('Target.closeTarget', { targetId: this._targetId });
    } catch {
      // ignore
    }
    try {
      await this._conn.send('Target.disposeBrowserContext', {
        browserContextId: this._browserContextId,
      });
    } catch {
      // ignore
    }
  }
}

export async function launchBrowser(options = {}) {
  const executablePath = options.executablePath || DEFAULT_CHROMIUM;
  const timeoutMs = options.timeoutMs ?? 15000;
  const extraArgs = Array.isArray(options.args) ? options.args : [];

  const userDataDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'ag-e2e-chrome-')
  );

  const launchArgs = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    ...extraArgs,
    'about:blank',
  ];

  const proc = spawn(executablePath, launchArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browserWsUrl;
  try {
    browserWsUrl = await new Promise((resolve, reject) => {
      let stderrBuf = '';
      let settled = false;

      const finish = (err, val) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        proc.stderr.off('data', onStderr);
        proc.off('error', onError);
        proc.off('exit', onExit);
        if (err) reject(err);
        else resolve(val);
      };

      const timer = setTimeout(() => {
        finish(
          new Error(
            `Timed out waiting for Chromium DevTools URL after ${timeoutMs}ms. stderr:\n${stderrBuf}`
          )
        );
      }, timeoutMs);

      const onStderr = (chunk) => {
        stderrBuf += chunk.toString('utf8');
        const match = stderrBuf.match(/DevTools listening on (ws:\/\/[^\s\r\n]+)/);
        if (match) {
          finish(null, match[1]);
        }
      };

      const onError = (err) => {
        finish(new Error(`Failed to spawn ${executablePath}: ${err.message}`));
      };

      const onExit = (code, signal) => {
        finish(
          new Error(
            `Chromium exited prematurely (code=${code}, signal=${signal}). stderr:\n${stderrBuf}`
          )
        );
      };

      proc.stderr.on('data', onStderr);
      proc.on('error', onError);
      proc.on('exit', onExit);
    });
  } catch (err) {
    try {
      proc.kill('SIGKILL');
    } catch {
      // ignore
    }
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const ws = new WebSocket(browserWsUrl);
  await new Promise((resolve, reject) => {
    const onOpen = () => {
      ws.removeEventListener('error', onErr);
      resolve();
    };
    const onErr = (e) => {
      ws.removeEventListener('open', onOpen);
      reject(new Error(`CDP WebSocket connect error: ${e?.message || 'failed'}`));
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onErr, { once: true });
  });

  const conn = new CDPConnection(ws);
  const pages = new Set();
  let closed = false;

  return {
    wsUrl: browserWsUrl,
    userDataDir,
    async newPage(opts = {}) {
      if (closed) throw new Error('Browser is closed');
      const width = opts.width ?? 1440;
      const height = opts.height ?? 900;

      const { browserContextId } = await conn.send('Target.createBrowserContext', {
        disposeOnDetach: true,
      });
      const { targetId } = await conn.send('Target.createTarget', {
        url: 'about:blank',
        browserContextId,
      });
      const { sessionId } = await conn.send('Target.attachToTarget', {
        targetId,
        flatten: true,
      });

      await Promise.all([
        conn.send('Page.enable', {}, sessionId),
        conn.send('Runtime.enable', {}, sessionId),
        conn.send('Log.enable', {}, sessionId),
        conn.send('DOM.enable', {}, sessionId),
      ]);

      const page = new CDPPage({ conn, browserContextId, targetId, sessionId });
      pages.add(page);
      const origClose = page.close.bind(page);
      page.close = async () => {
        pages.delete(page);
        await origClose();
      };

      await page.setViewport(width, height);
      if (opts.initScript) {
        await page.addInitScript(opts.initScript);
      }
      if (opts.url) {
        await page.navigate(opts.url);
      }
      return page;
    },

    async close() {
      if (closed) return;
      closed = true;

      for (const p of [...pages]) {
        await p.close().catch(() => {});
      }
      pages.clear();

      try {
        await Promise.race([
          conn.send('Browser.close'),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
      } catch {
        // fallback to signals
      }

      conn.close();

      if (proc.exitCode === null && proc.signalCode === null) {
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(termTimer);
            clearTimeout(killTimer);
            resolve();
          };
          proc.once('exit', finish);
          const termTimer = setTimeout(() => {
            try {
              proc.kill('SIGTERM');
            } catch {
              finish();
            }
          }, 500);
          const killTimer = setTimeout(() => {
            try {
              proc.kill('SIGKILL');
            } catch {
              // ignore
            }
            finish();
          }, 2500);
        });
      }

      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
