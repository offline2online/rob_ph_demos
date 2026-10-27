'use strict';
// Concurrent-user load test (npm run loadtest). Starts the real HTTP server with token auth in its own process over bench/dataset.js's
// network-scale store (864k aggregate rows, 60 stores, 4 display types, 250 PG deals) and drives it from this one:
//   - each simulated user loads the retailer page's 11 endpoints for 90 days (as a browser does, up to 6 at a time), 3 times;
//   - a /health probe runs the whole time (a liveness probe: how long does it wait behind the users' requests?);
//   - 1, 5, 10 and 20 users, warm (every user asks for the same thing, response cache on and already filled by one page load) and cold (each user has its own
//     store filter, response cache off: every request runs its handler).
// Prints request and page p50/p95/p99, /health p95/max, requests per second and the server's peak RSS, then exits 1 if a target
// is missed:
//   20 users warm: request and page p95 < 2000 ms;  10 users cold: request and page p95 < 2000 ms;
//   /health p95 < 100 ms in both.
// LOADTEST_USERS=1,5 and LOADTEST_MODES=warm limit the run; LOADTEST_LOADS sets the page loads per user (default 3).

const http = require('http');
const os = require('os');
const { fork } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const SECRET = 'loadtest-secret-loadtest-secret-loadtest';
const ENDPOINTS = ['summary', 'revenue', 'deals', 'slot-value', 'slot-allocation', 'missed-revenue', 'display-types', 'advertisers', 'maturity', 'filter-options'];
const BROWSER_CONNECTIONS = 6;
const TARGET_MS = 2000; const HEALTH_MS = 100;
const BASE = '/insights/v1/retail-media';

// ---------------------------------------------------------------------------------------------- the server process
if (!isMainThread) {
  // ------------------------------------------------------------------------------------------ the /health probe (its own thread)
  // Its own event loop, so a busy load generator cannot add its own delay to the probe's timings.
  const stopped = { done: false };
  parentPort.on('message', () => { stopped.done = true; });
  health(workerData.port, stopped).then((times) => parentPort.postMessage(times));
} else if (process.env.LOADTEST_ROLE === 'server') {
  const { buildBenchStore } = require('../bench/dataset');
  const { createServer } = require('../src/server');
  const { createTokenAuthenticator } = require('../src/auth');
  const { store, today } = buildBenchStore();
  const authenticate = createTokenAuthenticator({ secret: SECRET });
  let server = null; let peak = process.memoryUsage().rss;
  setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 100).unref();
  process.on('message', (m) => {
    if (m.cmd === 'start') {
      server = createServer({ store, authenticate, today, cache: m.cache ? undefined : false });
      peak = process.memoryUsage().rss;
      server.listen(0, '127.0.0.1', () => process.send({ port: server.address().port }));
    } else if (m.cmd === 'stop') {
      const rss = Math.max(peak, process.memoryUsage().rss);
      const cache = server.cache ? { hits: server.cache.hits, misses: server.cache.misses, entries: server.cache.size, bytes: server.cache.bytes } : null;
      server.closeAllConnections();
      server.close(() => process.send({ stopped: true, rss, cache }));
    }
  });
  process.send({ ready: true, today });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}

// ---------------------------------------------------------------------------------------------- the load generator
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : NaN);
const sortNum = (xs) => [...xs].sort((a, b) => a - b);
const fmt = (n) => (Number.isFinite(n) ? (n >= 100 ? n.toFixed(0) : n.toFixed(1)).padStart(7) : '      -');

function request(agent, port, urlPath, token) {
  return new Promise((resolve, reject) => {
    const started = process.hrtime.bigint();
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent, headers: token ? { authorization: `Bearer ${token}` } : {} }, (res) => {
      res.resume();
      res.on('end', () => resolve({ ms: Number(process.hrtime.bigint() - started) / 1e6, status: res.statusCode }));
    });
    req.on('error', reject);
  });
}

/** One user: loads the page `loads` times, one load at a time, with the browser's connection limit. Resolves {requests, pages, errors}. */
async function user(port, token, query, loads) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: BROWSER_CONNECTIONS });
  const requests = []; const pages = []; let errors = 0;
  for (let i = 0; i < loads; i += 1) {
    const started = process.hrtime.bigint();
    const results = await Promise.all(ENDPOINTS.map((e) => request(agent, port, `${BASE}/${e}?${query}`, token)));
    pages.push(Number(process.hrtime.bigint() - started) / 1e6);
    for (const r of results) { requests.push(r.ms); if (r.status !== 200) errors += 1; }
  }
  agent.destroy();
  return { requests, pages, errors };
}

async function health(port, stopped) {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const times = [];
  while (!stopped.done) {
    times.push((await request(agent, port, `${BASE}/health`)).ms);
    await new Promise((r) => setTimeout(r, 5));
  }
  agent.destroy();
  return times;
}

async function scenario(child, { mode, users, loads, today, token }) {
  const warm = mode === 'warm';
  const port = await new Promise((resolve) => { child.once('message', (m) => resolve(m.port)); child.send({ cmd: 'start', cache: warm }); });
  const to = today; const from = new Date(Date.parse(`${to}T00:00:00Z`) - 89 * 86400000).toISOString().slice(0, 10);
  const base = `dateFrom=${from}&dateTo=${to}`;
  // Warm means the response cache already holds the page: one unmeasured load fills it (its time is printed).
  const fill = warm ? (await user(port, token, base, 1)).pages[0] : null;
  const probeThread = new Worker(__filename, { workerData: { port } });
  const probe = new Promise((resolve, reject) => { probeThread.once('message', resolve); probeThread.once('error', reject); });
  await new Promise((r) => setTimeout(r, 200));
  const started = process.hrtime.bigint();
  const all = await Promise.all(Array.from({ length: users }, (_, i) => user(port, token, warm ? base : `${base}&storeIds=store-${i + 1}`, loads)));
  const seconds = Number(process.hrtime.bigint() - started) / 1e9;
  probeThread.postMessage('stop');
  const healthTimes = await probe;
  await probeThread.terminate();
  const server = await new Promise((resolve) => { child.once('message', resolve); child.send({ cmd: 'stop' }); });
  const requests = sortNum(all.flatMap((u) => u.requests)); const pages = sortNum(all.flatMap((u) => u.pages)); const hs = sortNum(healthTimes);
  return {
    mode, users, fill, errors: all.reduce((n, u) => n + u.errors, 0),
    request: { p50: pct(requests, 0.5), p95: pct(requests, 0.95), p99: pct(requests, 0.99) },
    page: { p50: pct(pages, 0.5), p95: pct(pages, 0.95), p99: pct(pages, 0.99) },
    health: { p95: pct(hs, 0.95), max: hs[hs.length - 1], n: hs.length },
    rps: requests.length / seconds, rssMb: server.rss / 1048576, cache: server.cache,
  };
}

async function main() {
  const { mintToken } = require('../src/auth');
  const users = (process.env.LOADTEST_USERS || '1,5,10,20').split(',').map(Number);
  const modes = (process.env.LOADTEST_MODES || 'warm,cold').split(',');
  const loads = Number(process.env.LOADTEST_LOADS || 3);
  const token = mintToken({ secret: SECRET, principalType: 'admin', principalId: 'retailer', ttlSeconds: 3600 });
  // The server is a separate process, so the generator's own work never delays it; node flags are inherited.
  const child = fork(__filename, [], { env: { ...process.env, LOADTEST_ROLE: 'server' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  const ready = await new Promise((resolve, reject) => { child.once('message', resolve); child.once('exit', (c) => reject(new Error(`server exited (${c})`))); });
  console.log(`CPUs: ${os.cpus().length} (${os.cpus()[0].model.trim()}), node ${process.version}; ${ENDPOINTS.length} endpoints x ${loads} page loads per user, 90 days to ${ready.today}`);
  console.log('mode  users |  request p50   p95   p99 |    page p50   p95   p99 | /health p95   max | req/s | RSS MB | errors');
  const results = [];
  for (const mode of modes) {
    for (const n of users) {
      const r = await scenario(child, { mode, users: n, loads, today: ready.today, token });
      results.push(r);
      console.log(`${mode.padEnd(5)} ${String(n).padStart(5)} | ${fmt(r.request.p50)} ${fmt(r.request.p95)} ${fmt(r.request.p99)} | ${fmt(r.page.p50)} ${fmt(r.page.p95)} ${fmt(r.page.p99)} | ${fmt(r.health.p95)} ${fmt(r.health.max)} | ${r.rps.toFixed(1).padStart(5)} | ${r.rssMb.toFixed(0).padStart(6)} | ${r.errors}`
        + (r.cache ? `  (cache ${r.cache.hits} hits / ${r.cache.misses} misses, ${(r.cache.bytes / 1048576).toFixed(1)} MB; the page that filled it took ${r.fill.toFixed(0)} ms)` : ''));
    }
  }
  child.kill();

  const failures = [];
  const check = (mode, n) => {
    const r = results.find((x) => x.mode === mode && x.users === n);
    if (!r) return;
    const label = `${n} users ${mode}`;
    if (!(r.request.p95 < TARGET_MS)) failures.push(`${label}: request p95 ${r.request.p95.toFixed(0)} ms >= ${TARGET_MS} ms`);
    if (!(r.page.p95 < TARGET_MS)) failures.push(`${label}: page p95 ${r.page.p95.toFixed(0)} ms >= ${TARGET_MS} ms`);
    if (!(r.health.p95 < HEALTH_MS)) failures.push(`${label}: /health p95 ${r.health.p95.toFixed(1)} ms >= ${HEALTH_MS} ms`);
  };
  check('warm', 20); check('cold', 10);
  for (const r of results) if (r.errors) failures.push(`${r.users} users ${r.mode}: ${r.errors} non-200 responses`);
  if (failures.length) { console.log(`FAIL\n  ${failures.join('\n  ')}`); process.exit(1); }
  console.log('OK: 20 users warm and 10 users cold are under 2 s at p95, and /health stays under 100 ms');
  process.exit(0);
}

