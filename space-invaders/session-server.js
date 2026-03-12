/**
 * ═══════════════════════════════════════════════════════════════
 *  PERSONALISATION HUB — Space Invaders Session Server
 *  Version: 1.0.0
 * ───────────────────────────────────────────────────────────────
 *  Provides:
 *    REST   POST /api/sessions/create   → Session Creation URL
 *    WS          /ws                   → WebSocket relay
 *
 *  Requires: Node.js ≥ 18, ws package
 *    npm install ws
 *    node session-server.js
 * ═══════════════════════════════════════════════════════════════
 */

'use strict';

const http      = require('http');
const WebSocket = require('ws');
const url       = require('url');
const crypto    = require('crypto');

// ── CONFIG ────────────────────────────────────────────────────
const PORT          = parseInt(process.env.PORT || '8080', 10);
const HOST          = process.env.HOST          || '0.0.0.0';
const DISPLAY_BASE  = process.env.DISPLAY_BASE  || `http://localhost:${PORT}/space-invaders-display.html`;
const MOBILE_BASE   = process.env.MOBILE_BASE   || `http://localhost:${PORT}/space-invaders-mobile.html`;
const ENDED_BASE    = process.env.ENDED_BASE    || `http://localhost:${PORT}/space-invaders-ended.html`;
const SESSION_TTL   = parseInt(process.env.SESSION_TTL || '3600000', 10); // 1 hour ms
const ALLOWED_ORIGIN= process.env.ALLOWED_ORIGIN|| '*';

// ── SESSION STORE ─────────────────────────────────────────────
/**
 * sessions: Map<sessionId, {
 *   sessionId: string,
 *   storeCode: string,
 *   deviceUid: string,
 *   created: number,
 *   display: WebSocket | null,
 *   mobile:  WebSocket | null,
 *   state: 'waiting' | 'active' | 'ended',
 * }>
 */
const sessions = new Map();

// ── SESSION ID GENERATOR ──────────────────────────────────────
function generateSessionId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase(); // e.g. "A3F7C21B"
}

// ── CLEANUP EXPIRED SESSIONS ──────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [id, sess] of sessions.entries()) {
    if (now - sess.created > SESSION_TTL) {
      console.log(`[Session] Expiring session ${id}`);
      if (sess.display) sess.display.terminate();
      if (sess.mobile)  sess.mobile.terminate();
      sessions.delete(id);
    }
  }
}, 60_000);

// ── HTTP SERVER ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsed  = url.parse(req.url, true);
  const path    = parsed.pathname;
  const method  = req.method;

  // CORS
  res.setHeader('Access-Control-Allow-Origin',  ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // ── POST /api/sessions/create ─────────────────────────────
  // Session Creation URL — called by the PH Platform when a
  // new display boots or a new game round is triggered.
  //
  // Request body (JSON, optional):
  //   { storeCode, deviceUid }
  //
  // Response (JSON):
  //   { sessionId, wsUrl, displayUrl, mobileUrl, endedUrl, created }
  if (method === 'POST' && path === '/api/sessions/create') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}

      const sessionId = generateSessionId();
      const storeCode = payload.storeCode || 'DEMO';
      const deviceUid = payload.deviceUid || 'DISPLAY-001';

      const wsUrl = buildWsUrl(req);
      const displayUrl = buildUrl(DISPLAY_BASE, { session: sessionId, ws: wsUrl, store: storeCode, device: deviceUid, endedUrl: buildUrl(ENDED_BASE, { store: storeCode }) });
      const mobileUrl  = buildUrl(MOBILE_BASE,  { session: sessionId, ws: wsUrl, store: storeCode, endedUrl: buildUrl(ENDED_BASE, { store: storeCode }) });

      sessions.set(sessionId, {
        sessionId, storeCode, deviceUid,
        created: Date.now(),
        display: null,
        mobile:  null,
        state:   'waiting',
      });

      const resp = {
        sessionId,
        wsUrl,
        displayUrl,
        mobileUrl,
        endedUrl: buildUrl(ENDED_BASE, { store: storeCode }),
        created:  new Date().toISOString(),
      };

      console.log(`[Session] Created: ${sessionId}  store=${storeCode}  device=${deviceUid}`);
      respond(res, 201, resp);
    });
    return;
  }

  // ── GET /api/sessions/:id ─────────────────────────────────
  // Optional: health check / status for a session
  const sessionMatch = path.match(/^\/api\/sessions\/([A-Z0-9]+)$/i);
  if (method === 'GET' && sessionMatch) {
    const id = sessionMatch[1].toUpperCase();
    const sess = sessions.get(id);
    if (!sess) { respond(res, 404, { error: 'Session not found' }); return; }
    respond(res, 200, {
      sessionId: sess.sessionId,
      state:     sess.state,
      storeCode: sess.storeCode,
      created:   new Date(sess.created).toISOString(),
      displayConnected: !!sess.display,
      mobileConnected:  !!sess.mobile,
    });
    return;
  }

  // ── GET /health ───────────────────────────────────────────
  if (method === 'GET' && path === '/health') {
    respond(res, 200, { status: 'ok', sessions: sessions.size, uptime: process.uptime() });
    return;
  }

  respond(res, 404, { error: 'Not found' });
});

// ── WEBSOCKET SERVER ──────────────────────────────────────────
const wss = new WebSocket.Server({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  ws._sessionId = null;
  ws._role      = null;
  ws._alive     = true;

  // Heartbeat pong
  ws.on('pong', () => { ws._alive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    // ── REGISTER ──────────────────────────────────────────
    // First message from any client must be:
    //   { type: 'register', role: 'display'|'mobile', sessionId, storeCode?, deviceUid? }
    if (msg.type === 'register') {
      const sid  = (msg.sessionId || '').toUpperCase();
      const role = msg.role;

      if (!sid || !['display', 'mobile'].includes(role)) {
        safeSend(ws, { type: 'error', message: 'Invalid registration' });
        ws.close();
        return;
      }

      // Auto-create session if display registers first (display drives session lifecycle)
      if (!sessions.has(sid)) {
        sessions.set(sid, {
          sessionId: sid,
          storeCode: msg.storeCode || 'DEMO',
          deviceUid: msg.deviceUid || 'DISPLAY-001',
          created:   Date.now(),
          display:   null,
          mobile:    null,
          state:     'waiting',
        });
        console.log(`[Session] Auto-created: ${sid}`);
      }

      const sess = sessions.get(sid);

      // Disconnect any previous client of same role
      if (sess[role] && sess[role] !== ws) {
        safeSend(sess[role], { type: 'superseded', message: 'Another client registered as ' + role });
        sess[role].close();
      }

      sess[role] = ws;
      ws._sessionId = sid;
      ws._role      = role;

      safeSend(ws, { type: 'registered', role, sessionId: sid });
      console.log(`[Session ${sid}] ${role} registered`);

      // Both parties connected → notify
      if (sess.display && sess.mobile) {
        sess.state = 'active';
        safeSend(sess.display, { type: 'player_connected', sessionId: sid });
        safeSend(sess.mobile,  { type: 'game_ready',       sessionId: sid });
        console.log(`[Session ${sid}] Both connected — game active`);
      }
      return;
    }

    // ── RELAY ──────────────────────────────────────────────
    // All subsequent messages are relayed to the peer
    const sid  = ws._sessionId;
    const role = ws._role;
    if (!sid || !role) { return; }

    const sess = sessions.get(sid);
    if (!sess) { return; }

    const peer = role === 'display' ? sess.mobile : sess.display;

    if (msg.type === 'gameOver') {
      sess.state = 'ended';
      console.log(`[Session ${sid}] Game over — score ${msg.score}`);
    }

    if (peer) {
      safeSend(peer, msg);
    } else {
      // Peer not yet connected — queue for display or just drop
      console.log(`[Session ${sid}] No peer for ${role} — message dropped: ${msg.type}`);
    }
  });

  ws.on('close', () => {
    const sid  = ws._sessionId;
    const role = ws._role;
    if (!sid || !role) { return; }

    const sess = sessions.get(sid);
    if (!sess) { return; }

    if (sess[role] === ws) {
      sess[role] = null;
      console.log(`[Session ${sid}] ${role} disconnected`);

      // Notify peer
      const peer = role === 'display' ? sess.mobile : sess.display;
      if (peer) {
        safeSend(peer, { type: 'peer_disconnected', role, sessionId: sid });
      }

      // If both gone, clean up
      if (!sess.display && !sess.mobile) {
        sessions.delete(sid);
        console.log(`[Session ${sid}] Session cleaned up`);
      }
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS] Error for session ${ws._sessionId}:`, err.message);
  });
});

// ── HEARTBEAT ─────────────────────────────────────────────────
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws._alive) { ws.terminate(); continue; }
    ws._alive = false;
    ws.ping();
  }
}, 30_000);

// ── HELPERS ───────────────────────────────────────────────────
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function respond(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function buildWsUrl(req) {
  const host   = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  const proto  = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  return `${proto}://${host}/ws`;
}

function buildUrl(base, params) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) u.searchParams.set(k, v);
  }
  return u.toString();
}

// ── START ─────────────────────────────────────────────────────
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔═════════════════════════════════════════════════════╗');
  console.log('  ║   PERSONALISATION HUB — Space Invaders Session Srv  ║');
  console.log('  ╚═════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  ✅  Server running on  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('');
  console.log('  ── PH PLATFORM URLs ──────────────────────────────────');
  console.log(`  📲  Mobile Site URL       ${MOBILE_BASE}`);
  console.log(`  📺  PWA Player URL        ${DISPLAY_BASE}`);
  console.log(`  🔗  Session Creation URL  http://localhost:${PORT}/api/sessions/create`);
  console.log(`  🏁  Disconnect/Ended URL  ${ENDED_BASE}`);
  console.log('');
  console.log('  ── QUICK TEST ────────────────────────────────────────');
  console.log(`  curl -X POST http://localhost:${PORT}/api/sessions/create \\`);
  console.log(`       -H 'Content-Type: application/json' \\`);
  console.log(`       -d '{"storeCode":"STORE001","deviceUid":"DISP-001"}'`);
  console.log('');
});

server.on('error', (err) => {
  console.error('[Server] Error:', err.message);
  process.exit(1);
});

process.on('SIGINT',  () => { console.log('\n[Server] Shutting down…'); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { console.log('\n[Server] Shutting down…'); server.close(() => process.exit(0)); });
