// Local run of the admin editor end to end, with no cloud: one server on one origin serving
//   /admin/…, /js/…, /css/…, /seed/fixtures/…   the static files of pharmacy-screen/
//   /api/admin/**, /api/screens/**, /api/health  the config API (config-api/), in memory, loaded with the seed
//   /api/settings/**, /api/device/**              the PH API settings and Location API proxy (ph-proxy/), in memory,
//                                                 with a local key standing in for KMS and a mock Location API
//                                                 answering from fixtures/campaign-data.json
//   /media/…                                      uploaded logos and backgrounds
// Sign-in is a pasted access token: "dev-admin" (admin) or "dev-viewer" (signed in, not an admin).
//
// startDevServer({ phEmbed: true }) (or `node admin/tools/dev-server.mjs 8790 ph`) runs the editor as it runs
// inside Personalisation Hub instead (auth.mode 'ph', docs/PH-EMBED.md), with a stand-in for each outside part:
//   /__ph-host.html?as=hq|store|stranger|silent[&store=CODE]   a page playing HQ Admin / Retail Admin: it frames
//       the editor and posts that user's PH session token when the editor says it is ready. Open it on
//       http://localhost:<port> (the PH origin here); the editor itself is framed from http://127.0.0.1:<port>.
//   a mock PH auth API (the proxy's upstream) that knows the tokens in PH_TOKENS below
//   /__identity   stands in for Identity Toolkit: swaps the server's session token for a bearer token
// Data is lost when it stops.
//
//   node admin/tools/dev-server.mjs [port]     ->  http://localhost:8790/admin/
//
// Also used by the end-to-end tests (admin/test/editor.e2e.mjs, test/e2e/full-stack.test.mjs). For those it returns
//   downHosts  a Set of hosts: a PH API base URL whose host is in it refuses the connection (failover tests)
//   logLines   every line the config API and the proxy logged, as it would reach Cloud Logging (quiet or not)

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
const phConfig = (port, fallback) => `export default { apiBase: '', screenPage: '', auth: { mode: 'ph', firebase: { apiKey: 'dev', projectId: 'dev' }, ph: { parentOrigins: ['http://localhost:${port}'], identityUrl: '/__identity'${fallback ? ", fallback: 'firebase'" : ''} } } };\n`;
// Mock PH sessions (not secrets): token -> what PH's APIs answer for it.
const jwt = (payload) => ['dev', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
export const PH_TOKENS = {
  hq: jwt({ user_id: 1, role: 'ADMIN', exp: 4102444800 }),
  store: jwt({ user_id: 2, store_id: 457, exp: 4102444800 }),
  stranger: jwt({ user_id: 3, role: 'ADMIN', exp: 4102444800, unknown: true }),
};
const PH_HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>PH host (dev)</title>
<body style="margin:0;font:14px Roboto,sans-serif"><div style="padding:8px;background:#169bc2;color:#fff" id="bar">Personalisation Hub (dev stand-in)</div>
<iframe id="f" style="border:0;width:100%;height:calc(100vh - 34px)"></iframe>
<script>
const q = new URLSearchParams(location.search), as = q.get('as') || 'hq';
const TOKENS = __TOKENS__;
const editor = location.protocol + '//127.0.0.1:' + location.port;
const f = document.getElementById('f');
window.phHost = { posts: 0, token: TOKENS[as] || null, host: as === 'store' ? 'retail-admin' : 'hq-admin',
  post() { if (!this.token) return; this.posts++; f.contentWindow.postMessage({ type: 'ph-pharmacy-screen:session', token: this.token, host: this.host }, editor); },
  signOut() { this.token = null; f.contentWindow.postMessage({ type: 'ph-pharmacy-screen:signed-out' }, editor); } };
addEventListener('message', (e) => { if (e.origin !== editor || e.source !== f.contentWindow) return; if (e.data && e.data.type === 'ph-pharmacy-screen:ready') window.phHost.post(); });
f.src = editor + '/admin/' + (q.get('store') ? '?store=' + encodeURIComponent(q.get('store')) : '');
</script>`;

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function startDevServer({ port = 0, seed = true, quiet = false, phEmbed = false, phFallback = false } = {}) {
  const logLines = [];
  const log = (level, msg) => { logLines.push(`[config-api] [${level}] ${msg}`); if (!quiet) console.error(`[${level}] ${msg}`); };
  const store = createMemoryStore();
  const blobs = createMemoryBlobs({ baseUrl: '/media/' });
  // PH embed mode: editor sessions minted by the proxy's /api/auth/ph-session, keyed by the bearer token
  // /__identity hands out for them.
  const pending = new Map(); // session token -> actor
  const sessions = new Map(); // bearer token -> actor
  const staticAuth = createStaticAuth(USERS);
  const bearerOf = (h) => { const m = /^Bearer\s+(.+)$/i.exec(String(h || '')); return m ? m[1].trim() : null; };
  const whoIs = async (header) => sessions.get(bearerOf(header)) || (phEmbed ? null : await staticAuth.identify(header));
  const configApi = createConfigApi({ store, blobs, auth: { kind: 'dev', identify: whoIs }, log });
  if (seed) await seedConfig({ store, blobs, log });

  const devices = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/campaign-data.json'), 'utf8')).devices || {};
  const upstreamCalls = [];
  const downHosts = new Set();
  const fetchImpl = async (url, opts) => {
    if (downHosts.has(new URL(url).host)) {
      upstreamCalls.push({ url, key: opts && opts.headers && opts.headers['x-api-key'], refused: true });
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const phPath = new URL(url).pathname;
    if (phPath === '/auth-api/v1/me' || phPath === '/retail-admin-api/v1/me/store') {
      const t = bearerOf(opts.headers.authorization);
      if (phPath.startsWith('/auth-api') && t === PH_TOKENS.hq) return { status: 200, json: async () => ({ data: { email: 'admin@example.com', id: 1, role: 'ADMIN' } }) };
      if (phPath.startsWith('/retail-admin-api') && t === PH_TOKENS.store) return { status: 200, json: async () => ({ data: { id: 457, dealer_code: 'VIC-MP-003', glb_store_code: 'VIC-MP-003', name: 'Ocean Grove Terrace Pharmacy' } }) };
      return { status: 401, json: async () => ({}) };
    }
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
    auth: { verify: async (h) => whoIs(h && (h.authorization || h.Authorization)) },
    fetchImpl,
    mintSession: phEmbed ? async (uid, claims) => { const t = `session-${crypto.randomBytes(12).toString('hex')}`; pending.set(t, { uid, email: claims.phEmail || null, admin: claims.admin === true, stores: claims.stores || [], ph: true }); return t; } : undefined,
    baseLogger: Object.fromEntries(['info', 'warn', 'error', 'log'].map((lv) => [lv, (line) => { logLines.push(`[ph-proxy] [${lv}] ${line}`); if (!quiet) console.error(line); }])),
  });

  const idTtlSeconds = { value: 3600 }; // tests shorten it to exercise renewal
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const send = (out) => {
        res.statusCode = out.status;
        for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
        res.end(out.body === null || out.body === undefined ? '' : JSON.stringify(out.body));
      };
      if (phEmbed && p === '/__identity' && req.method === 'POST') {
        let body = {};
        try { body = JSON.parse((await readBody(req)).toString('utf8')); } catch {}
        const actor = pending.get(body.token);
        if (!actor) return send({ status: 400, headers: { 'Content-Type': 'application/json' }, body: { error: { message: 'INVALID_CUSTOM_TOKEN' } } });
        pending.delete(body.token);
        const idToken = `id-${crypto.randomBytes(12).toString('hex')}`;
        sessions.set(idToken, actor);
        return send({ status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: { idToken, expiresIn: String(idTtlSeconds.value) } });
      }
      if (phEmbed && p === '/__ph-host.html') {
        res.writeHead(200, { 'Content-Type': TYPES['.html'], 'Cache-Control': 'no-store' });
        return res.end(PH_HOST_PAGE.replace('__TOKENS__', JSON.stringify(PH_TOKENS)));
      }
      if (p.startsWith('/api/settings/') || p.startsWith('/api/device/') || p.startsWith('/api/auth/')) {
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
        return res.end(phEmbed ? phConfig(server.address().port, phFallback) : DEV_CONFIG);
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
  const hostBase = `http://localhost:${server.address().port}`; // the "PH" origin in phEmbed mode
  return { server, base, hostBase, sessions, idTtlSeconds, store, blobs, phSettings, phAudit, upstreamCalls, downHosts, logLines, close: () => new Promise((r) => server.close(r)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = await startDevServer({ port: +process.argv[2] || 8790, phEmbed: process.argv[3] === 'ph' });
  if (process.argv[3] === 'ph') console.log(`As HQ Admin: ${s.hostBase}/__ph-host.html?as=hq   As Retail Admin (VIC-MP-003): ${s.hostBase}/__ph-host.html?as=store&store=VIC-MP-003`);
  else console.log(`Admin editor: ${s.base}/admin/  (access token: dev-admin; dev-viewer is a non-admin)`);
}
