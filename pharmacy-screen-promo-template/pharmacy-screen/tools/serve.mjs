// Minimal static server for running the screen locally (add mockapi=1 to use its fixtures):
//   node tools/serve.mjs [port]   ->  http://localhost:8080/pharmacy-screen.html?mockapi=1&device=TEST&promo=morning
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
// As the deploys publish them (firebase.json, aws/infra/stack.js): a staged copy's fingerprinted assets/ are kept by
// the browser for a year; everything else is fetched every time here.
const IMMUTABLE = 'public, max-age=31536000, immutable';

// `root`: another folder to serve (the offline test serves a staged, stamped copy). `hits` counts requests by path.
export function serve(port = 0, root = ROOT, hits = null) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'pharmacy-screen.html';
    if (hits) hits[rel] = (hits[rel] || 0) + 1;
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': rel.startsWith('assets/') ? IMMUTABLE : 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await serve(+process.argv[2] || 8080);
  console.log(`Serving ${ROOT} at http://localhost:${s.address().port}/pharmacy-screen.html?mockapi=1&device=TEST&promo=morning&orientation=portrait`);
}
