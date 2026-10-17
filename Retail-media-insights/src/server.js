'use strict';
// Read-only HTTP server. Routes are auto-discovered from src/routes/*.js and mounted under
// /insights/v1/retail-media. Only GET is served.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { RAW, SERIALISED } = require('./query');
const { ResponseCache } = require('./cache');
const { dispatch, normalisePrincipal, BASE } = require('./dispatch');
const { handleMessage, MAX_RESPONSE_BYTES } = require('./mcp');
const { createTokenAuthenticator } = require('./auth');
const { READ_SCOPE } = require('./constants');

const MCP_PATH = `${BASE}/mcp`;
const MAX_MCP_BODY = 64 * 1024;
const MAX_BATCH = 5; // MCP 2025-06-18 removed batching; a few messages are still accepted from older clients
const NO_SNIFF = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
// Origin-form only: exactly one leading "/" and then a character that is not "/" or "\\" (so "//host/path", "/\\", absolute-form and "*" are refused).
const ORIGIN_FORM = /^\/(?:[^/\\]|$)/;

function loadRoutes(dir = path.join(__dirname, 'routes')) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => require(path.join(dir, f))).filter((r) => r.path); // helper modules (params.js) export no path
}

// Handlers are synchronous and each can take tens of milliseconds at network scale. Requests run one per event-loop turn from a
// FIFO queue, so I/O (a /health probe, a new connection, a slow client) is serviced between any two handlers instead of waiting
// behind every request that arrived before it. A full queue answers 503 with Retry-After rather than growing without bound.
const DEFAULT_MAX_QUEUE = 512;

const envInt = (name, fallback) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 && process.env[name] !== '' && process.env[name] !== undefined ? n : fallback; };
const envList = (name) => String(process.env[name] || '').split(',').map((x) => x.trim()).filter(Boolean);

/**
 * `authenticate(req)` is required and resolves the caller to {principalType: 'admin'|'advertiser', principalId,
 * scopes}, or null; anything else (null, a malformed principal, a throw) is a 401. There is no default: an
 * unauthenticated caller is never a retailer user (DSP Integration section 9.5).
 *
 * Each route declares who may call it. Only `public: true` skips authentication (/health); every other
 * route also needs the `insights:read` scope (an authenticated caller without it gets 403). A route
 * without `advertiserAccess: true` is retailer (admin) only and an advertiser gets 403. A route that
 * sets `advertiserAccess: true` must read its data through the already-scoped `filters`, never through
 * `params`. `routes` overrides the auto-discovered list (tests).
 *
 * `allowedOrigins` (default env RMI_ALLOWED_ORIGINS, comma separated, empty): the only browser Origins /mcp accepts;
 * a request carrying any other Origin is a 403 (MCP Streamable HTTP, DNS rebinding). `limits` overrides the connection
 * limits, which default to env RMI_HEADERS_TIMEOUT_MS (10 s), RMI_REQUEST_TIMEOUT_MS (30 s), RMI_KEEPALIVE_TIMEOUT_MS
 * (5 s) and RMI_MAX_CONNECTIONS (1000), and `maxQueue` (env RMI_MAX_QUEUE, 512): how many requests may wait for their turn before
 * the server answers 503 with Retry-After. `cache` is the response cache (default a new ResponseCache; false turns it off).
 */
function createServer({ store: initialStore, authenticate, today, routes: routeList, allowedOrigins, limits = {}, cache: cacheOption } = {}) {
  if (typeof authenticate !== 'function') throw new TypeError('createServer requires an authenticate(req) function');
  let store = initialStore;
  const cache = cacheOption === false ? null : (cacheOption || new ResponseCache());
  const all = routeList || loadRoutes();
  const byPath = new Map(all.map((r) => [r.path, r])); // for datasets and MCP tools, which address routes by path
  const origins = new Set(allowedOrigins || envList('RMI_ALLOWED_ORIGINS'));

  const send = (res, code, body, headers = {}) => {
    let json;
    if (body && body[SERIALISED] !== undefined) json = body[SERIALISED]; // already JSON text (a cached or just-cached response)
    else try { json = JSON.stringify(body); } catch { code = 500; json = '{"error":"internal error"}'; }
    if (res.headersSent) return res.end();
    res.writeHead(code, { 'content-type': 'application/json', ...NO_SNIFF, ...headers });
    return res.end(json);
  };

  // One request per event-loop turn, oldest first (see DEFAULT_MAX_QUEUE). /health is not queued: it is the probe that must stay prompt.
  const maxQueue = limits.maxQueue ?? envInt('RMI_MAX_QUEUE', DEFAULT_MAX_QUEUE);
  const queue = []; let draining = false;
  function drain() {
    const job = queue.shift();
    try { job(); } catch { /* each job answers for itself */ }
    if (queue.length) setImmediate(drain); else draining = false;
  }
  function enqueue(res, job) {
    if (queue.length >= maxQueue) return send(res, 503, { error: 'server busy, retry shortly' }, { 'retry-after': '1' });
    queue.push(() => { if (!res.destroyed) job(); });
    if (!draining) { draining = true; setImmediate(drain); }
    return undefined;
  }

  // POST /mcp: JSON-RPC 2.0 over HTTP, authenticated like every other route, read-only tools only.
  function serveMcp(req, res) {
    if (req.headers.origin !== undefined && !origins.has(req.headers.origin)) return send(res, 403, { error: 'origin not allowed' });
    let principal = null;
    try { principal = normalisePrincipal(authenticate(req)); } catch { principal = null; }
    if (!principal) return send(res, 401, { error: 'authentication required' }, { 'www-authenticate': 'Bearer' });
    if (!principal.scopes.includes(READ_SCOPE)) return send(res, 403, { error: `the ${READ_SCOPE} scope is required` });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST JSON-RPC to this endpoint' }, { allow: 'POST' });
    const tooBig = () => send(res, 413, { error: `request body is limited to ${MAX_MCP_BODY} bytes` }, { connection: 'close' });
    if (Number(req.headers['content-length']) > MAX_MCP_BODY) { res.once('finish', () => req.destroy()); return tooBig(); }
    let size = 0; let over = false; const chunks = [];
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > MAX_MCP_BODY) { over = true; chunks.length = 0; res.once('finish', () => req.destroy()); tooBig(); } else chunks.push(c);
    });
    req.on('error', () => {});
    const answer = () => {
      try {
        let msg;
        try { msg = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); }
        const batch = Array.isArray(msg);
        if (batch && (msg.length === 0 || msg.length > MAX_BATCH)) return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32600, message: `a batch holds 1 to ${MAX_BATCH} messages` } });
        const ctx = { store, routes: byPath, principal, today, budget: { left: MAX_RESPONSE_BYTES } };
        const out = (batch ? msg : [msg]).map((m) => handleMessage(m, ctx)).filter(Boolean);
        if (!out.length) { res.writeHead(202, NO_SNIFF); return res.end(); }
        return send(res, 200, batch ? out : out[0]);
      } catch {
        return send(res, 500, { error: 'internal error' });
      }
    };
    req.on('end', () => { if (!over) enqueue(res, answer); });
  }

  function handle(req, res) {
    if (typeof req.url !== 'string' || !ORIGIN_FORM.test(req.url)) return send(res, 400, { error: 'bad request' }, { connection: 'close' });
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return send(res, 400, { error: 'bad request' }, { connection: 'close' }); }
    if (pathname === MCP_PATH) return serveMcp(req, res);
    const run = () => {
      const out = dispatch({ store, routes: all, url: req.url, principal: () => authenticate(req), today, method: req.method, cache });
      if (out.body && out.body[RAW]) {
        const raw = out.body[RAW];
        const headers = { 'content-type': raw.contentType, ...NO_SNIFF };
        if (raw.filename) headers['content-disposition'] = `attachment; filename="${raw.filename}"`;
        res.writeHead(200, headers);
        return res.end(raw.body);
      }
      return send(res, out.status, out.body, out.headers);
    };
    if (pathname === `${BASE}/health`) return run();
    return enqueue(res, () => { try { run(); } catch { try { send(res, 500, { error: 'internal error' }); } catch { try { res.destroy(); } catch { /* gone */ } } } });
  }

  // connectionsCheckingInterval: Node only looks for expired headers/request timeouts every 30 s by default, which would make 10 s mean up to 40 s.
  const server = http.createServer({ connectionsCheckingInterval: 1000 }, (req, res) => {
    try { handle(req, res); } catch { try { send(res, 500, { error: 'internal error' }); } catch { try { res.destroy(); } catch { /* nothing left to do */ } } }
  });
  // A malformed request never reaches the listener: answer 400 and drop the socket.
  server.on('clientError', (err, socket) => {
    try { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); } catch { /* the socket is gone */ }
    socket.destroy();
  });
  server.headersTimeout = limits.headersTimeoutMs ?? envInt('RMI_HEADERS_TIMEOUT_MS', 10000);
  server.requestTimeout = limits.requestTimeoutMs ?? envInt('RMI_REQUEST_TIMEOUT_MS', 30000);
  server.keepAliveTimeout = limits.keepAliveTimeoutMs ?? envInt('RMI_KEEPALIVE_TIMEOUT_MS', 5000);
  server.maxConnections = limits.maxConnections ?? envInt('RMI_MAX_CONNECTIONS', 1000);
  server.cache = cache;
  /** Swap in a rebuilt store. Cached responses describe the old one, so they all go. */
  server.replaceStore = (next) => { store = next; if (cache) cache.clear(); };
  return server;
}

if (require.main === module) {
  const { generateTestRetailer } = require('./testdata');
  const { buildAggregates } = require('./aggregate');
  const { AggregateStore } = require('./store');
  const data = generateTestRetailer();
  const store = new AggregateStore(buildAggregates(data.raw, data.ctx));
  // The fixes above are what keep the process up; if something still escapes, exit non-zero so a supervisor restarts it.
  process.on('uncaughtException', (err) => { console.error('uncaughtException', err); process.exit(1); });
  const port = Number(process.env.PORT) || 8080;
  // Fail closed: no secret, no server. Mint tokens with `node src/mint-token.js`.
  const authenticate = createTokenAuthenticator({ secret: process.env.RMI_AUTH_SECRET });
  createServer({ store, authenticate }).listen(port, () => console.log(`Retail Media Insights on :${port}${BASE}/health (test retailer)`));
}

module.exports = { createServer, loadRoutes, BASE, MCP_PATH };
