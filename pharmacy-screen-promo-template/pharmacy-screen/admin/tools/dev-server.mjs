// Local run of the admin editor end to end, with no cloud: one server on one origin serving
//   /admin/…, /js/…, /css/…, /seed/fixtures/…   the static files of pharmacy-screen/
//   /api/admin/**, /api/screens/**, /api/health  the config API (config-api/), in memory, loaded with the seed
//   /api/settings/**, /api/device/**              the PH API settings and Location API proxy (ph-proxy/), in memory,
//                                                 with a local key standing in for KMS and a mock Location API
//                                                 answering from fixtures/campaign-data.json
//   /media/…                                      uploaded logos and backgrounds
// Sign-in is a pasted access token: "dev-admin" (admin) or "dev-viewer" (signed in, not an admin).
// Data is lost when it stops.
//
//   node admin/tools/dev-server.mjs [port]     ->  http://localhost:8790/admin/
//
// Also used by the end-to-end test (admin/test/editor.e2e.mjs).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { createConfigApi } = require(path.join(ROOT, 'config-api/src/api.js'));
const { createMemoryStore } = require(path.join(ROOT, 'config-api/src/adapters/memory-store.js'));
const { createMemoryBlobs } = require(path.join(ROOT, 'config-api/src/adapters/blobs.js'));
const { createStaticAuth } = require(path.join(ROOT, 'config-api/src/adapters/auth.js'));
const { seedConfig } = require(path.join(ROOT, 'seed/seed.js'));
const { createApi: createPhApi } = require(path.join(ROOT, 'ph-proxy/src/create-api.js'));
const { memorySettingsStore, memoryAuditLog } = require(path.join(ROOT, 'ph-proxy/src/stores.js'));
const { createEnvelopeSecretStore, localKmsProvider } = require(path.join(ROOT, 'ph-proxy/src/secret-store.js'));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.b64': 'text/plain; charset=utf-8' };
const USERS = {
  'dev-admin': { uid: 'dev-admin', email: 'admin@example.com', admin: true },
  'dev-viewer': { uid: 'dev-viewer', email: 'viewer@example.com', admin: false },
};
const DEV_CONFIG = `export default { apiBase: '', screenPage: '', auth: { mode: 'token' } };\n`;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function startDevServer({ port = 0, seed = true, quiet = false } = {}) {
  const log = quiet ? () => {} : (level, msg) => console.error(`[${level}] ${msg}`);
  const store = createMemoryStore();
  const blobs = createMemoryBlobs({ baseUrl: '/media/' });
  const configApi = createConfigApi({ store, blobs, auth: createStaticAuth(USERS), log });
  if (seed) await seedConfig({ store, blobs, log });

  const devices = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8')).devices || {};
  const upstreamCalls = [];
  const fetchImpl = async (url, opts) => {
    const m = /\/location-api\/device\/([^/]+)\/campaign_data$/.exec(new URL(url).pathname);
    const udid = m && decodeURIComponent(m[1]);
    upstreamCalls.push({ url, key: opts && opts.headers && opts.headers['x-api-key'] });
    const hit = udid && devices[udid];
    return { status: hit ? 200 : 404, json: async () => (hit || { message: 'not found' }) };
  };
  const phSettings = memorySettingsStore();
  const phAudit = memoryAuditLog();
  const phApi = createPhApi({
    env: { PH_PROXY_CACHE_SECONDS: '0' },
    settingsStore: phSettings,
    auditLog: phAudit,
    secretStore: createEnvelopeSecretStore({ kms: localKmsProvider({ keyBase64: crypto.randomBytes(32).toString('base64'), env: {} }) }),
    auth: { verify: async (h) => { const m = /^Bearer\s+(.+)$/i.exec(String((h && (h.authorization || h.Authorization)) || '')); return (m && USERS[m[1].trim()]) || null; } },
    fetchImpl,
    baseLogger: quiet ? { info() {}, warn() {}, error() {}, log() {} } : console,
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const send = (out) => {
        res.statusCode = out.status;
        for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
        res.end(out.body === null || out.body === undefined ? '' : JSON.stringify(out.body));
      };
      if (p.startsWith('/api/settings/') || p.startsWith('/api/device/')) {
        const raw = await readBody(req);
        let body;
        try { body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined; } catch { body = undefined; }
        return send(await phApi.handle({ method: req.method, path: p, headers: req.headers, body, ip: req.socket.remoteAddress }));
      }
      if (p === '/api' || p.startsWith('/api/')) {
        const body = await readBody(req);
        return send(await configApi.handle({ method: req.method, path: p, headers: req.headers, query: Object.fromEntries(url.searchParams), body }));
      }
      if (p.startsWith('/media/')) {
        const obj = blobs.objects.get(decodeURIComponent(p.slice('/media/'.length)));
        if (!obj) { res.statusCode = 404; return res.end(); }
        res.setHeader('Content-Type', obj.contentType);
        return res.end(obj.buffer);
      }
      if (p === '/admin/config.js') {
        res.setHeader('Content-Type', TYPES['.js']);
        res.setHeader('Cache-Control', 'no-store');
        return res.end(DEV_CONFIG);
      }
      if (p === '/' || p === '/admin') { res.statusCode = 302; res.setHeader('Location', '/admin/'); return res.end(); }
      const rel = decodeURIComponent(p).replace(/^\/+/, '') + (p.endsWith('/') ? 'index.html' : '');
      const file = path.resolve(ROOT, rel);
      if (!file.startsWith(ROOT + path.sep) || /(^|[\\/])node_modules[\\/]/.test(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.statusCode = 404; return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      log('error', e && e.stack ? e.stack : String(e));
      res.statusCode = 500; res.end();
    }
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, store, blobs, phSettings, phAudit, upstreamCalls, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startDevServer({ port: +process.argv[2] || 8790 });
  console.log(`Admin editor: ${s.base}/admin/  (access token: dev-admin; dev-viewer is a non-admin)`);
}
