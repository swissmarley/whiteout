// WHITEOUT server: static file host + WebSocket game server in one process. No build step.
//
//   node server/index.js            (PORT=7070 by default; --debug enables test-only commands)
//
// exFAT note: this project lives on a volume where macOS drops an AppleDouble "._name" twin
// next to every file. Nothing here ever lists a directory, and any request path containing a
// dot-prefixed segment is refused, so those twins can never be served or loaded as code.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';
import { TICK_HZ } from '../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MOUNTS = [
  ['/shared/', path.join(ROOT, 'shared')],
  ['/', path.join(ROOT, 'public')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname === '/') pathname = '/index.html';
  // refuse dotfiles (covers ._AppleDouble sidecars, .DS_Store) and traversal
  if (pathname.split('/').some((seg) => seg.startsWith('.')) || pathname.includes('\0')) { res.writeHead(404).end('Not found'); return; }
  for (const [prefix, dir] of MOUNTS) {
    if (!pathname.startsWith(prefix)) continue;
    const file = path.join(dir, pathname.slice(prefix.length));
    if (!file.startsWith(dir + path.sep)) break;
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
      });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404).end('Not found');
}

export function startServer({ port = 7070, host = '0.0.0.0', debug = false, autoStart = true, quiet = false } = {}) {
  const game = new Game({ debug, autoStart });
  const server = http.createServer(serveStatic);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048, perMessageDeflate: false });

  wss.on('connection', (ws) => {
    const p = game.addConnection(ws);
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(data.toString()); } catch { return; }
      try { game.onMessage(p, m); } catch (err) { console.error('[game] message error:', err); }
    });
    ws.on('close', () => game.removeConnection(p));
    ws.on('error', () => {});
  });

  const timer = setInterval(() => {
    try { game.tick(); } catch (err) { console.error('[game] tick error:', err); }
  }, 1000 / TICK_HZ);

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const actual = server.address().port;
      if (!quiet) {
        console.log(`\n  WHITEOUT server up.\n\n    local:   http://localhost:${actual}`);
        for (const list of Object.values(os.networkInterfaces())) {
          for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) console.log(`    network: http://${ni.address}:${actual}   <- friends on your LAN join here`);
        }
        console.log('');
      }
      resolve({
        game, server, port: actual,
        close: () => new Promise((done) => {
          clearInterval(timer);
          for (const c of wss.clients) c.terminate();
          wss.close(() => server.close(() => done()));
        }),
      });
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer({ port: Number(process.env.PORT) || 7070, debug: process.env.WHITEOUT_DEBUG === '1' || process.argv.includes('--debug') }).catch((err) => {
    console.error(err.code === 'EADDRINUSE' ? `Port ${err.port} is in use. Try: PORT=7071 npm start` : err);
    process.exit(1);
  });
}
