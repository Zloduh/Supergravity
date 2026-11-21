import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST_DIR = path.resolve(__dirname, '../dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const PLACEHOLDER_VITE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="6" fill="#3b82f6"/>' +
  '<path d="M9 22L16 9l7 13h-3.2L16 14.8 12.2 22H9z" fill="#ffffff"/>' +
  '</svg>';

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function startViteMode({ appDir, host, port, mode }) {
  const cmd = mode === 'vite-dev' ? 'dev' : 'preview';
  const args = ['vite', cmd, '--host', host, '--port', String(port || 4173), '--strictPort'];
  const proc = spawn('npx', args, {
    cwd: appDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for Vite ${cmd} server. Output:\n${out}`));
    }, 15000);

    const onData = (chunk) => {
      out += chunk.toString('utf8');
      const match = out.match(/https?:\/\/(?:127\.0\.0\.1|localhost):\d+/);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Vite ${cmd} exited early (${code}):\n${out}`));
    });
  });

  const parsed = new URL(url);
  return {
    url,
    host: parsed.hostname,
    port: Number(parsed.port),
    distDir: path.join(appDir, 'dist'),
    async close() {
      if (proc.exitCode !== null) return;
      proc.kill('SIGTERM');
      await new Promise((resolve) => {
        const t = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {
            // ignore
          }
          resolve();
        }, 2000);
        proc.once('exit', () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}

/**
 * Start an ephemeral 127.0.0.1 HTTP SPA static server for app/dist/.
 * Optional mode: 'static' (default) | 'vite-preview' | 'vite-dev'.
 */
export async function startStaticServer(options = {}) {
  const mode = options.mode || 'static';
  const host = options.host || '127.0.0.1';
  const port = options.port ?? 0;
  const distDir = path.resolve(options.distDir || DEFAULT_DIST_DIR);

  if (mode === 'vite-preview' || mode === 'vite-dev') {
    const appDir = path.resolve(options.appDir || path.resolve(__dirname, '..'));
    return startViteMode({ appDir, host, port, mode });
  }

  const indexPath = path.join(distDir, 'index.html');
  try {
    const stat = await fs.stat(indexPath);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${indexPath}`);
    }
  } catch (err) {
    throw new Error(
      `Static server cannot find ${indexPath} (${err.message}). Run "npm run build" in app/ first.`
    );
  }

  const realDistDir = await fs.realpath(distDir);
  const realDistPrefix = realDistDir.endsWith(path.sep)
    ? realDistDir
    : realDistDir + path.sep;
  const isWithinRealDist = (candidateRealPath) =>
    candidateRealPath === realDistDir || candidateRealPath.startsWith(realDistPrefix);

  const sockets = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      const method = (req.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Method Not Allowed');
        return;
      }

      const rawUrl = req.url || '/';
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(rawUrl, 'http://127.0.0.1').pathname);
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad Request');
        return;
      }

      const relPath = pathname.replace(/^\/+/, '');
      const resolved = path.resolve(distDir, relPath);

      // Path traversal guard
      if (resolved !== distDir && !resolved.startsWith(distDir + path.sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      let targetFile = resolved;
      let fileExists = false;

      try {
        const st = await fs.stat(targetFile);
        if (st.isFile()) {
          fileExists = true;
        } else if (st.isDirectory()) {
          const dirIndex = path.join(targetFile, 'index.html');
          const idxStat = await fs.stat(dirIndex).catch(() => null);
          if (idxStat && idxStat.isFile()) {
            targetFile = dirIndex;
            fileExists = true;
          }
        }
      } catch {
        fileExists = false;
      }

      // Clean placeholder SVG for /vite.svg if absent on disk so Chromium logs zero 404s
      if (!fileExists && pathname === '/vite.svg') {
        const svgBuf = Buffer.from(PLACEHOLDER_VITE_SVG, 'utf8');
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Content-Length': svgBuf.length,
          'Cache-Control': 'no-store',
        });
        if (method === 'HEAD') {
          res.end();
        } else {
          res.end(svgBuf);
        }
        return;
      }

      // SPA fallback ONLY for extensionless routes outside /assets/
      if (!fileExists) {
        const hasExt = path.extname(pathname) !== '';
        const isAssetRoute = pathname === '/assets' || pathname.startsWith('/assets/');
        if (!hasExt && !isAssetRoute) {
          targetFile = indexPath;
          fileExists = true;
        }
      }

      if (!fileExists) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const realTarget = await fs.realpath(targetFile);
      if (!isWithinRealDist(realTarget)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }

      const body = await fs.readFile(realTarget);
      res.writeHead(200, {
        'Content-Type': getMimeType(realTarget),
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      });
      if (method === 'HEAD') {
        res.end();
      } else {
        res.end(body);
      }
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(String(err?.message || err));
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    url,
    host,
    port: actualPort,
    distDir,
    async close() {
      for (const socket of sockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      sockets.clear();
      await new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
