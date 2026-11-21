import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createMockLLMServer } from './mock_llm_server.mjs';
import { createTauriBridge } from './mock_tauri_bridge.mjs';
import { launchBrowser } from './cdp_client.mjs';
import {
  createIsolatedEnv,
  snapshotRealConfig,
  assertRealConfigUnchanged,
} from './isolation.mjs';
import { startStaticServer } from './static_server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '..');
const TIERS_DIR = path.join(__dirname, 'tiers');

function parseArgs(argv) {
  const opts = {
    tier: 'all',
    withRust: false,
    screenshotsDir: null,
    json: false,
    filter: null,
  };
  for (const arg of argv) {
    if (arg.startsWith('--tier=')) {
      opts.tier = arg.slice('--tier='.length).trim().toLowerCase();
    } else if (arg === '--with-rust') {
      opts.withRust = true;
    } else if (arg.startsWith('--screenshots-dir=')) {
      opts.screenshotsDir = arg.slice('--screenshots-dir='.length);
    } else if (arg === '--json') {
      opts.json = true;
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice('--filter='.length);
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    }
  }
  return opts;
}

function readPngDimensions(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) {
    throw new Error('Buffer is too small to be a PNG');
  }
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(pngSig)) {
    throw new Error('Invalid PNG signature');
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function createAssertHelpers() {
  return Object.assign(assert, {
    readPngDimensions,
    assertPngDimensions(buf, expectedWidth, expectedHeight) {
      const dims = readPngDimensions(buf);
      assert.equal(
        dims.width,
        expectedWidth,
        `Expected PNG width ${expectedWidth}, got ${dims.width}`
      );
      assert.equal(
        dims.height,
        expectedHeight,
        `Expected PNG height ${expectedHeight}, got ${dims.height}`
      );
      return dims;
    },
    assertNoPageErrors(appHandle) {
      const consoleErrs = appHandle.page.getConsoleErrors();
      const pageErrs = appHandle.page.getPageErrors();
      assert.equal(
        consoleErrs.length,
        0,
        `Unexpected console errors: ${JSON.stringify(consoleErrs)}`
      );
      assert.equal(
        pageErrs.length,
        0,
        `Unexpected page errors: ${JSON.stringify(pageErrs)}`
      );
    },
  });
}

async function discoverTierModules(tierFilter) {
  let entries = [];
  try {
    entries = await fs.readdir(TIERS_DIR);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }

  const prefixes =
    tierFilter === 'all'
      ? ['tier1', 'tier2', 'tier3', 'tier4']
      : [`tier${tierFilter}`];

  const files = entries
    .filter(
      (f) =>
        f.endsWith('.mjs') && prefixes.some((p) => f.toLowerCase().startsWith(p))
    )
    .sort();

  return files.map((f) => path.join(TIERS_DIR, f));
}

async function loadTestsFromModule(modPath, ctx) {
  const mod = await import(pathToFileURL(modPath).href);
  const collected = [];
  if (typeof mod.getTests === 'function') {
    const res = await mod.getTests(ctx);
    if (Array.isArray(res)) collected.push(...res);
  } else if (typeof mod.registerTests === 'function') {
    const registrar = {
      add(t) {
        collected.push(t);
      },
      register(t) {
        collected.push(t);
      },
      push(t) {
        collected.push(t);
      },
    };
    const res = await mod.registerTests(registrar, ctx);
    if (Array.isArray(res)) collected.push(...res);
  }
  return collected;
}

async function runCargoTests(isoEnv) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const proc = spawn('cargo', ['test'], {
      cwd: APP_DIR,
      env: isoEnv.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (c) => {
      stdout += c.toString('utf8');
    });
    proc.stderr.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    proc.on('close', (code) => {
      resolve({
        ok: code === 0,
        code,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      });
    });
    proc.on('error', (err) => {
      resolve({
        ok: false,
        code: -1,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr: `${stderr}\n${err.message}`,
      });
    });
  });
}

export async function runE2E(cliOpts = {}) {
  const validTiers = new Set(['1', '2', '3', '4', 'all', 'self']);
  if (!validTiers.has(cliOpts.tier)) {
    throw new Error(
      `Invalid --tier="${cliOpts.tier}". Expected 1|2|3|4|all|self.`
    );
  }

  const beforeConfig = await snapshotRealConfig();
  const iso = await createIsolatedEnv('ag-e2e-');
  iso.assertConfigUnchanged = () => assertRealConfigUnchanged(beforeConfig);
  const screenshotsDir = cliOpts.screenshotsDir
    ? path.resolve(cliOpts.screenshotsDir)
    : iso.screenshotsDir;
  await fs.mkdir(screenshotsDir, { recursive: true });

  const assertHelpers = createAssertHelpers();
  let browser = null;
  let staticServer = null;

  const ensureBrowser = async () => {
    if (!browser) {
      browser = await launchBrowser();
    }
    return browser;
  };

  const ensureStaticServer = async () => {
    if (!staticServer) {
      staticServer = await startStaticServer({
        distDir: path.join(APP_DIR, 'dist'),
      });
    }
    return staticServer;
  };

  const results = [];
  let rustResult = null;
  let configInvarianceError = null;

  try {
    const ctx = {
      appDir: APP_DIR,
      e2eDir: __dirname,
      screenshotsDir,
      isolation: iso,
      assert: assertHelpers,
    };

    let tests = [];
    if (cliOpts.tier === 'self') {
      const selfPath = path.join(__dirname, 'self_test.mjs');
      tests = await loadTestsFromModule(selfPath, ctx);
    } else {
      const modPaths = await discoverTierModules(cliOpts.tier);
      for (const p of modPaths) {
        const modTests = await loadTestsFromModule(p, ctx);
        tests.push(...modTests);
      }
    }

    if (cliOpts.filter) {
      const q = cliOpts.filter.toLowerCase();
      tests = tests.filter(
        (t) =>
          (t.id && t.id.toLowerCase().includes(q)) ||
          (t.name && t.name.toLowerCase().includes(q)) ||
          (t.feature && t.feature.toLowerCase().includes(q))
      );
    }

    for (const testCase of tests) {
      const startedAt = Date.now();
      const testLlmServers = [];
      const testApps = [];

      const defaultLlm = await createMockLLMServer();
      testLlmServers.push(defaultLlm);

      const defaultBridge = createTauriBridge({
        llm: defaultLlm,
        redirectStrata: true,
      });

      const env = {
        llm: defaultLlm,
        bridge: defaultBridge,
        isolation: iso,
        assert: assertHelpers,
        screenshotsDir,
        appDir: APP_DIR,
        async getStaticServer() {
          return ensureStaticServer();
        },
        async getBrowser() {
          return ensureBrowser();
        },
        async openApp(options = {}) {
          const b = await ensureBrowser();
          const srv = options.url ? null : await ensureStaticServer();
          const targetUrl = options.url || srv.url;

          let appLlm = options.llm || defaultLlm;
          if (options.dedicatedLlm) {
            appLlm = await createMockLLMServer(options.llmOptions || {});
            testLlmServers.push(appLlm);
          }

          const appBridge =
            options.bridge ||
            (options.initialState ||
            options.initialConfig ||
            options.dedicatedLlm ||
            options.redirectStrata !== undefined
              ? createTauriBridge({
                  llm: appLlm,
                  initialState: options.initialState,
                  initialConfig: options.initialConfig,
                  redirectStrata: options.redirectStrata ?? true,
                })
              : defaultBridge);

          const page = await b.newPage({
            width: options.width ?? 1440,
            height: options.height ?? 900,
          });

          await appBridge.attachToPage(page);
          await page.addInitScript(
            appBridge.getInitScript(options.initialState || {})
          );
          if (options.extraInitScript) {
            await page.addInitScript(options.extraInitScript);
          }

          await page.navigate(targetUrl);
          if (options.waitForSelector) {
            await page.waitForSelector(
              options.waitForSelector,
              options.waitForTimeoutMs ?? 5000
            );
          }

          const allowErrors = Boolean(
            options.allowConsoleErrors || options.expectErrors
          );
          let closed = false;

          const appHandle = {
            page,
            bridge: appBridge,
            llm: appLlm,
            staticUrl: targetUrl,
            get consoleErrors() {
              return page.getConsoleErrors();
            },
            get pageErrors() {
              return page.getPageErrors();
            },
            get networkErrors() {
              return page.getNetworkErrors();
            },
            async close() {
              if (closed) return;
              closed = true;
              const cErrs = page.getConsoleErrors();
              const pErrs = page.getPageErrors();
              await page.close().catch(() => {});
              if (!allowErrors && (cErrs.length > 0 || pErrs.length > 0)) {
                throw new Error(
                  `Browser errors detected: consoleErrors=${JSON.stringify(cErrs)} pageErrors=${JSON.stringify(pErrs)}`
                );
              }
            },
          };

          testApps.push({ appHandle, allowErrors });
          return appHandle;
        },
      };

      let testError = null;
      try {
        await testCase.run(env);
      } catch (err) {
        testError = err;
      }

      // Always close open pages & per-test LLM servers
      for (const { appHandle } of testApps.reverse()) {
        try {
          await appHandle.close();
        } catch (closeErr) {
          if (!testError) testError = closeErr;
        }
      }
      for (const srv of testLlmServers.reverse()) {
        await srv.close().catch(() => {});
      }

      results.push({
        id: testCase.id,
        tier: testCase.tier,
        feature: testCase.feature,
        name: testCase.name,
        passed: !testError,
        durationMs: Date.now() - startedAt,
        error: testError
          ? {
              message: String(testError.message || testError),
              stack: testError.stack || '',
            }
          : null,
      });
    }

    if (cliOpts.withRust) {
      rustResult = await runCargoTests(iso);
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (staticServer) {
      await staticServer.close().catch(() => {});
    }
    await iso.cleanup().catch(() => {});
    try {
      await assertRealConfigUnchanged(beforeConfig);
    } catch (err) {
      configInvarianceError = String(err?.message || err);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  const byTier = {};
  const byFeature = {};
  for (const r of results) {
    const tk = String(r.tier);
    byTier[tk] = byTier[tk] || { total: 0, passed: 0, failed: 0 };
    byTier[tk].total++;
    if (r.passed) byTier[tk].passed++;
    else byTier[tk].failed++;

    const fk = String(r.feature || 'general');
    byFeature[fk] = byFeature[fk] || { total: 0, passed: 0, failed: 0 };
    byFeature[fk].total++;
    if (r.passed) byFeature[fk].passed++;
    else byFeature[fk].failed++;
  }

  const ok =
    failedCount === 0 &&
    !configInvarianceError &&
    (!rustResult || rustResult.ok);

  return {
    ok,
    tier: cliOpts.tier,
    total: results.length,
    passed: passedCount,
    failed: failedCount,
    byTier,
    byFeature,
    results,
    rust: rustResult,
    configInvariance: {
      ok: !configInvarianceError,
      path: beforeConfig.path,
      error: configInvarianceError,
    },
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      'Usage: node app/e2e/run_e2e.mjs --tier=1|2|3|4|all|self [--with-rust] [--screenshots-dir=<dir>] [--json] [--filter=<text>]'
    );
    process.exit(0);
  }

  const summary = await runE2E(opts);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `\n=== Antigravity E2E Runner (tier=${summary.tier}) ===`
    );
    for (const r of summary.results) {
      const tag = r.passed ? 'PASS' : 'FAIL';
      console.log(
        `[${tag}] ${r.id} (${r.feature} | T${r.tier}) - ${r.name} (${r.durationMs}ms)`
      );
      if (!r.passed && r.error) {
        console.log(`       Error: ${r.error.message}`);
      }
    }
    console.log('\n--- Summary ---');
    console.log(
      `Total: ${summary.total} | Passed: ${summary.passed} | Failed: ${summary.failed}`
    );
    console.log(
      `Config invariance (${summary.configInvariance.path}): ${summary.configInvariance.ok ? 'OK' : `FAILED (${summary.configInvariance.error})`}`
    );
    if (summary.rust) {
      console.log(
        `Rust cargo test: ${summary.rust.ok ? 'PASS' : `FAIL (exit ${summary.rust.code})`} (${summary.rust.durationMs}ms)`
      );
    }
  }

  process.exit(summary.ok ? 0 : 1);
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
