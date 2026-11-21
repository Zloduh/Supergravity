import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

// Capture the host user's real home directory at module load time, before any
// isolated test environment mutates process.env.HOME.
const REAL_HOME = os.homedir();

export function getRealConfigPath() {
  return path.join(REAL_HOME, '.config', 'antigravity', 'config.toml');
}

/**
 * Snapshot existence, size, mtimeMs, and SHA-256 of a config file.
 * Defaults to the real user config at ~/.config/antigravity/config.toml.
 */
export async function snapshotRealConfig(configPath = getRealConfigPath()) {
  try {
    const stat = await fs.stat(configPath);
    const content = await fs.readFile(configPath);
    const sha256 = crypto.createHash('sha256').update(content).digest('hex');
    return {
      exists: true,
      path: configPath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256,
    };
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return {
        exists: false,
        path: configPath,
        size: null,
        mtimeMs: null,
        sha256: null,
      };
    }
    throw err;
  }
}

/**
 * Assert that the snapshotted config file has identical existence, size,
 * mtimeMs, and SHA-256 hash.
 */
export async function assertRealConfigUnchanged(before) {
  if (!before || typeof before.path !== 'string') {
    throw new Error('assertRealConfigUnchanged: invalid baseline snapshot');
  }
  const after = await snapshotRealConfig(before.path);
  const mismatches = [];
  if (after.exists !== before.exists) {
    mismatches.push(`exists changed (${before.exists} -> ${after.exists})`);
  }
  if (after.size !== before.size) {
    mismatches.push(`size changed (${before.size} -> ${after.size})`);
  }
  if (after.mtimeMs !== before.mtimeMs) {
    mismatches.push(`mtimeMs changed (${before.mtimeMs} -> ${after.mtimeMs})`);
  }
  if (after.sha256 !== before.sha256) {
    mismatches.push(`sha256 changed (${before.sha256} -> ${after.sha256})`);
  }
  if (mismatches.length > 0) {
    throw new Error(
      `Live config modified at ${before.path}: ${mismatches.join('; ')}`
    );
  }
  return after;
}

export const snapshotConfig = snapshotRealConfig;
export const assertConfigUnchanged = assertRealConfigUnchanged;

/**
 * Create an isolated temporary directory tree and environment map for offline
 * E2E and Rust subprocess runs. Preserves RUSTUP_HOME and CARGO_HOME from the
 * real user home before overriding HOME/XDG/ANTIGRAVITY_* variables.
 */
export async function createIsolatedEnv(prefix = 'ag-e2e-') {
  const realHome = REAL_HOME;
  const rustupHome = process.env.RUSTUP_HOME || path.join(realHome, '.rustup');
  const cargoHome = process.env.CARGO_HOME || path.join(realHome, '.cargo');

  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(rootDir, 'home');
  const xdgConfigDir = path.join(rootDir, 'xdg_config');
  const xdgDataDir = path.join(rootDir, 'xdg_data');
  const brainDir = path.join(rootDir, 'brain');
  const workspaceDir = path.join(rootDir, 'workspace');
  const screenshotsDir = path.join(rootDir, 'screenshots');
  const configPath = path.join(xdgConfigDir, 'antigravity', 'config.toml');

  await Promise.all([
    fs.mkdir(homeDir, { recursive: true }),
    fs.mkdir(path.dirname(configPath), { recursive: true }),
    fs.mkdir(xdgDataDir, { recursive: true }),
    fs.mkdir(brainDir, { recursive: true }),
    fs.mkdir(workspaceDir, { recursive: true }),
    fs.mkdir(screenshotsDir, { recursive: true }),
  ]);

  const env = {
    ...process.env,
    HOME: homeDir,
    XDG_CONFIG_HOME: xdgConfigDir,
    XDG_DATA_HOME: xdgDataDir,
    ANTIGRAVITY_CONFIG_PATH: configPath,
    ANTIGRAVITY_BRAIN_DIR: brainDir,
    ANTIGRAVITY_HOME_DIR: homeDir,
    ANTIGRAVITY_OFFLINE_NO_DISCOVER: '1',
    RUSTUP_HOME: rustupHome,
    CARGO_HOME: cargoHome,
  };

  return {
    rootDir,
    homeDir,
    xdgConfigDir,
    xdgDataDir,
    configPath,
    brainDir,
    workspaceDir,
    screenshotsDir,
    realHome,
    rustupHome,
    cargoHome,
    env,
    async cleanup() {
      await fs.rm(rootDir, { recursive: true, force: true });
    },
  };
}
