'use strict';
// Handlers are synchronous, so the server runs one per event-loop turn and answers 503 when too many are waiting. The server runs in
// its own process: in this one, the client would share the event loop with the handlers and the timings would mean nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { BASE } = require('../src/server');

const SERVER = `
  const { createServer } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'server'))});
  const { AggregateStore } = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'store'))});
  const busy = (ms) => { const end = Date.now() + ms; while (Date.now() < end); };
  const slow = { path: '/slow', advertiserAccess: true, handler: () => { busy(Number(process.env.SLOW_MS)); return { ok: true }; } };
  const health = require(${JSON.stringify(path.join(__dirname, '..', 'src', 'routes', 'health'))});
  const server = createServer({ store: new AggregateStore({ delivery: [], inventory: [] }), routes: [slow, health],
    authenticate: () => ({ principalType: 'admin', principalId: 'r', scopes: ['insights:read'] }), limits: { maxQueue: Number(process.env.MAX_QUEUE) } });
  server.listen(0, '127.0.0.1', () => console.log(server.address().port));
`;

async function withServer(fn, maxQueue = 512, slowMs = 40) {
  const child = spawn(process.execPath, ['-e', SERVER], { env: { ...process.env, MAX_QUEUE: String(maxQueue), SLOW_MS: String(slowMs) }, stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => { child.stdout.once('data', (d) => resolve(Number(d.toString().trim()))); child.once('exit', reject); });
  try { await fn(port); } finally { child.kill(); }
}

/** n requests (distinct queries, so the response cache does not answer for them) on n sockets, written in one tick once all are accepted. */
async function burst(port, n) {
  const sockets = await Promise.all(Array.from({ length: n }, () => new Promise((resolve) => { const s = net.connect(port, '127.0.0.1', () => resolve(s)); })));
  await new Promise((r) => setTimeout(r, 100)); // the server accepts connections a few per turn: give it time, so the requests land together
  const replies = sockets.map((s) => new Promise((resolve) => { let text = ''; s.on('data', (c) => { text += c; }); s.on('end', () => resolve(text)); }));
  sockets.forEach((s, i) => s.write(`GET ${BASE}/slow?n=${i} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`));
  return Promise.all(replies);
}
const status = (text) => Number(/^HTTP\/1\.1 (\d+)/.exec(text)[1]);

// 10 x 150 ms of queued work, and /health must answer in under 600 ms: well before the queue drains (1.5 s) and far above scheduling noise
// from other suites running in parallel. The ordering check does not depend on timing at all.
test('/health is answered between queued handlers, not after all of them', () => withServer(async (port) => {
  const queued = burst(port, 10).then((replies) => ({ replies, drainedAt: Date.now() }));
  await new Promise((r) => setTimeout(r, 160)); // the burst is written at about 100 ms
  const started = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}${BASE}/health`);
  const answeredAt = Date.now();
  const waited = answeredAt - started;
  assert.equal(res.status, 200);
  assert.ok(waited < 600, `/health waited ${waited} ms behind 10 x 150 ms of handlers`);
  const { replies, drainedAt } = await queued;
  assert.ok(answeredAt < drainedAt, '/health answered only after the queue drained');
  assert.deepEqual(replies.map(status), Array(10).fill(200));
}, 512, 150));

test('a full queue answers 503 with Retry-After and the rest are still served', () => withServer(async (port) => {
  const texts = await burst(port, 8);
  const codes = texts.map(status);
  assert.ok(codes.includes(503), codes.join());
  assert.ok(codes.filter((c) => c === 200).length >= 3, codes.join());
  const refused = texts.find((t) => t.startsWith('HTTP/1.1 503'));
  assert.match(refused, /retry-after: 1/i);
  assert.match(refused, /server busy, retry shortly/);
  assert.equal((await fetch(`http://127.0.0.1:${port}${BASE}/slow?n=again`)).status, 200); // drained: served again
}, 3));
