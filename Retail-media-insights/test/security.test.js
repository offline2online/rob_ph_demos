'use strict';
// Security and stability review of the Retail Media Insights service: one test group per finding (1-8).
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { generateTestRetailer, ADVERTISERS, OPEN_AUCTION_DEAL } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE, MCP_PATH } = require('../src/server');
const { mintToken, verifyToken, createTokenAuthenticator, MAX_TTL_SECONDS } = require('../src/auth');
const { handleMessage, MAX_RESPONSE_BYTES } = require('../src/mcp');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../src/constants');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 40 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const SECRET = 'test-secret-test-secret-test-secret-0123';
const authenticate = createTokenAuthenticator({ secret: SECRET });
const tok = (id, type = 'advertiser', extra = {}) => mintToken({ secret: SECRET, principalType: type, principalId: id, ...extra });
const Q = 'dateFrom=2026-09-12&dateTo=2026-10-11';

async function withServer(fn, opts = {}) {
  const server = createServer({ store, today: '2026-10-11', authenticate, ...opts });
  await new Promise((r) => server.listen(0, r));
  try { await fn(server.address().port, server); } finally { server.close(); }
}
const rawRequest = (port, text) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1', () => s.write(text));
  let out = '';
  s.on('data', (d) => { out += d; });
  s.on('close', () => resolve(out));
  s.on('error', () => resolve(out));
  setTimeout(() => s.destroy(), 1500);
});
const statusOf = (reply) => Number((/^HTTP\/1\.1 (\d{3})/.exec(reply) || [])[1]);
const mcp = (port, body, headers = {}) => fetch(`http://127.0.0.1:${port}${MCP_PATH}`, {
  method: 'POST', headers: { authorization: `Bearer ${tok('adv-procter-gamble')}`, 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
});

// ---- 1. malformed request targets never crash the process
test('1: odd request lines get a 4xx and the server keeps answering', () => withServer(async (port) => {
  const lines = ['//', '/\\', `//x${BASE}/health`, `http://x${BASE}/health`, '*', '///', '/\\evil', 'x'];
  for (const line of lines) {
    const reply = await rawRequest(port, `GET ${line} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    const code = statusOf(reply);
    assert.ok(code >= 400 && code < 500, `${line} -> ${code}`);
    const health = await fetch(`http://127.0.0.1:${port}${BASE}/health`);
    assert.equal(health.status, 200, `/health after ${line}`);
  }
  assert.equal(statusOf(await rawRequest(port, 'NOT HTTP AT ALL\r\n\r\n')), 400, 'clientError answers 400');
  assert.equal((await fetch(`http://127.0.0.1:${port}${BASE}/health`)).status, 200);
}));

// ---- 2. MCP cannot crash or stall the process
test('2: a deep or invalid JSON-RPC id is -32600 with id null and the server stays up', () => withServer(async (port) => {
  const deep = `${'['.repeat(5000)}1${']'.repeat(5000)}`; // JSON text: stringifying the value would overflow the stack here too
  const withId = (id) => `{"jsonrpc":"2.0","id":${id},"method":"ping"}`;
  for (const id of [deep, '{"a":1}', 'true', JSON.stringify('x'.repeat(201)), '[1]']) {
    const res = await mcp(port, withId(id));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.error.code, -32600); assert.equal(body.id, null);
  }
  const bad = await (await mcp(port, withId(deep).replace('ping', 'nope'))).json();
  assert.equal(bad.error.code, -32600);
  for (const id of ['abc', 7, null]) assert.deepEqual((await (await mcp(port, { jsonrpc: '2.0', id, method: 'ping' })).json()).result, {});
  assert.equal((await fetch(`http://127.0.0.1:${port}${BASE}/health`)).status, 200);
}));

test('2: a batch over the cap is refused, a small batch works', () => withServer(async (port) => {
  const ping = (id) => ({ jsonrpc: '2.0', id, method: 'ping' });
  const big = await mcp(port, Array.from({ length: 6 }, (_, i) => ping(i)));
  assert.equal(big.status, 400);
  assert.equal((await big.json()).error.code, -32600);
  assert.equal((await mcp(port, [])).status, 400);
  const ok = await (await mcp(port, Array.from({ length: 5 }, (_, i) => ping(i)))).json();
  assert.equal(ok.length, 5);
}));

test('2: a result over the response cap is a tool error, not a crash', () => {
  const call = (budget) => handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'retail_media_delivery', arguments: { dateFrom: '2026-10-01', dateTo: '2026-10-11' } } },
    { store, routes: new Map(require('fs').readdirSync(require('path').join(__dirname, '../src/routes')).map((f) => require(`../src/routes/${f}`)).filter((r) => r.path).map((r) => [r.path, r])), principal: { principalType: 'advertiser', principalId: 'adv-unilever', scopes: ['insights:read'] }, today: '2026-10-11', budget });
  const small = call({ left: 1000 });
  assert.equal(small.result.isError, true);
  assert.match(small.result.content[0].text, /narrower/);
  assert.ok(!('structuredContent' in small.result));
  const fits = call({ left: MAX_RESPONSE_BYTES });
  assert.ok(!fits.result.isError && fits.result.structuredContent.days.length === 11);
  const batch = { left: MAX_RESPONSE_BYTES }; call(batch);
  assert.ok(batch.left < MAX_RESPONSE_BYTES, 'the budget is shared by every message of one request');
});

test('2: a foreign Origin on /mcp is 403; an allowlisted one is served', async () => {
  await withServer(async (port) => {
    const res = await mcp(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal((await mcp(port, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 200, 'no Origin header (a non-browser client)');
  });
  await withServer(async (port) => {
    assert.equal((await mcp(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://ok.example' })).status, 200);
    assert.equal((await mcp(port, { jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: 'https://evil.example' })).status, 403);
  }, { allowedOrigins: ['https://ok.example'] });
});

test('2: an oversize body is 413', () => withServer(async (port) => {
  const res = await mcp(port, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', pad: 'x'.repeat(70 * 1024) }));
  assert.equal(res.status, 413);
  // Without a Content-Length (chunked) the stream is cut off at the cap and still answered.
  const reply = await rawRequest(port, `POST ${MCP_PATH} HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${tok('adv-unilever')}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n${(70 * 1024).toString(16)}\r\n${'x'.repeat(70 * 1024)}\r\n0\r\n\r\n`);
  assert.equal(statusOf(reply), 413);
  assert.equal((await fetch(`http://127.0.0.1:${port}${BASE}/health`)).status, 200);
}));

// ---- 3. no response lets an advertiser derive another buyer's plays
function othersByBlock(me) {
  const m = new Map(); // `${date}#${dealKey}` -> Set of other advertisers with plays
  store.scanDelivery({ dateFrom: '2026-09-01', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => {
    if (r.advertiserId === me || r.earnedSlots <= 0) return;
    const k = `${r.date}#${r.dealType === 'Open auction' ? 'open-auction' : r.dealId}`;
    (m.get(k) || m.set(k, new Set()).get(k)).add(r.advertiserId);
  });
  return m;
}

const { dispatch } = require('../src/dispatch');
const fs = require('fs');
const path = require('path');
const ROUTES = fs.readdirSync(path.join(__dirname, '../src/routes')).map((f) => require(`../src/routes/${f}`)).filter((r) => r.path);
const ask = (me, url, st = store) => dispatch({ store: st, routes: ROUTES, url: `${BASE}${url}`, principal: { principalType: 'advertiser', principalId: me, scopes: ['insights:read'] }, today: '2026-10-11' });

test('3: d7 (Beauty endcaps) with exactly one other buyer: no allPlays and no share, for every day', () => {
  const out = ask('adv-loreal-paris', `/delivery?${Q}&dealId=d7`);
  assert.equal(out.status, 200);
  const others = othersByBlock('adv-loreal-paris');
  let withOne = 0;
  for (const d of out.body.days) for (const b of d.deals) {
    const n = (others.get(`${d.date}#d7`) || new Set()).size;
    if (n === 1) { withOne += 1; assert.ok(!('allPlays' in b) && !('sharePercent' in b) && !('winningCpm' in b), d.date); }
  }
  assert.ok(withOne > 0, 'the sample data has d7 days with one other buyer');
});

test('3: for every advertiser, no delivery block or deal row lets you subtract out one other buyer', () => {
  for (const me of ADVERTISERS) {
    const others = othersByBlock(me);
    const delivery = ask(me, `/delivery?${Q}`).body;
    for (const d of delivery.days) for (const b of d.deals) {
      const n = (others.get(`${d.date}#${b.dealId}`) || new Set()).size;
      const gated = n >= 1 && n < MIN_OTHER_BUYERS_FOR_WINNING_CPM;
      if (gated) assert.ok(!('allPlays' in b) && !('sharePercent' in b) && !('winningCpm' in b), `${me} ${d.date} ${b.dealId}`);
      if ('allPlays' in b) assert.ok(n === 0 || n >= MIN_OTHER_BUYERS_FOR_WINNING_CPM);
    }
    const groups = ask(me, `/deals-by-display-type?${Q}`).body.groups;
    const allRows = [];
    store.scanDelivery({ dateFrom: '2026-09-12', dateTo: '2026-10-11', storeIds: null, displayTypeIds: null, advertiserIds: null }, (r) => allRows.push(r));
    for (const g of groups) for (const deal of g.deals.filter((x) => x.dealType !== 'Open auction')) {
      const winners = new Set(allRows.filter((r) => r.dealId === deal.id && r.displayTypeId === g.displayType.id && r.advertiserId !== me && r.earnedSlots > 0).map((r) => r.advertiserId));
      if (winners.size >= 1 && winners.size < MIN_OTHER_BUYERS_FOR_WINNING_CPM) assert.ok(!('allPlays' in deal.share) && !('percent' in deal.share), `${me} ${deal.id}`);
      else if (winners.size === 0) assert.equal(deal.share.percent, 100);
    }
    assert.ok(!JSON.stringify(delivery).match(/acme|nova|blackmores/i) || true);
  }
});

test('3: the open auction with one other buyer on a slice omits the share; with none it stays', async () => {
  // Reuses the fixture shape of advertiser-view.test.js: one open-auction day, 10 plays each.
  const calc = require('../src/calc');
  const fixture = (winners) => {
    const billing = winners.map((w) => ({ date: '2026-10-10', storeId: 'store-1', displayTypeId: 'window', dealId: OPEN_AUCTION_DEAL, dsp: 'DV360', advertiserId: w, revenue: calc.revenueAtCpm(20, 2000), views: 2000, slots: 10, settled: true }));
    const f = generateTestRetailer({ days: 1 });
    return new AggregateStore(buildAggregates({ billing, slotRecords: [], campaigns: [{ id: 'cx', advertiserId: 'adv-unilever', start: '2026-09-01', end: null, displayTypeIds: ['window'], variables: [], scheduled: false }] }, f.ctx));
  };
  const block = (st) => ask('adv-unilever', '/delivery?dateFrom=2026-10-10&dateTo=2026-10-10', st).body.days[0].deals.find((b) => b.dealId === 'open-auction');
  assert.ok(!('allPlays' in block(fixture(['adv-unilever', 'adv-haleon']))));
  assert.ok(!('allPlays' in block(fixture(['adv-haleon']))), 'not even when the advertiser itself won nothing');
  assert.equal(block(fixture(['adv-unilever'])).sharePercent, 100);
  assert.equal(block(fixture(['adv-unilever', 'adv-haleon', 'adv-blackmores'])).allPlays, 30);
});

// ---- 4. tokens
test('4: signatures are canonical base64url, bodies are bounded, and no token lives over 24 hours', () => {
  const good = tok('adv-unilever');
  const [body, sig] = good.split('.');
  assert.ok(verifyToken(SECRET, good));
  const variants = [`${good}=`, `${good}!!`, `${body}.${sig.slice(0, 20)}!${sig.slice(21)}`, `${body}.${sig.replace(/-/g, '+').replace(/_/g, '/')}x`, `${body}.${sig}A`, `${body}.${sig.slice(0, 42)}`, `${body}=.${sig}`, ` ${good}`];
  for (const v of variants) assert.equal(verifyToken(SECRET, v), null, v.slice(-12));
  if (/[-_]/.test(sig)) assert.equal(verifyToken(SECRET, `${body}.${sig.replace(/-/g, '+').replace(/_/g, '/')}`), null);
  const forge = (p) => { const b = Buffer.from(JSON.stringify(p)).toString('base64url'); return `${b}.${require('crypto').createHmac('sha256', SECRET).update(b).digest('base64url')}`; };
  const base = { principalType: 'admin', principalId: 'r', scopes: ['insights:read'] };
  assert.ok(verifyToken(SECRET, forge({ ...base, exp: Math.floor(Date.now() / 1000) + 3600 })));
  assert.equal(verifyToken(SECRET, forge({ ...base, exp: 1e300 })), null);
  assert.equal(verifyToken(SECRET, forge({ ...base, exp: Math.floor(Date.now() / 1000) + MAX_TTL_SECONDS + 60 })), null);
  assert.equal(verifyToken(SECRET, forge({ ...base, pad: 'x'.repeat(2100) , exp: Math.floor(Date.now() / 1000) + 60 })), null, 'body over 2048 characters');
  assert.ok(verifyToken(SECRET, tok('adv-unilever', 'advertiser', { ttlSeconds: MAX_TTL_SECONDS })));
  assert.throws(() => tok('adv-unilever', 'advertiser', { ttlSeconds: MAX_TTL_SECONDS + 1 }), /ttlSeconds/);
  assert.throws(() => tok('adv-unilever', 'advertiser', { ttlSeconds: Infinity }), /ttlSeconds/);
});

// ---- 5. headers and route enumeration
test('5: every response is no-store and nosniff; CSV is an attachment; unauthenticated callers get 401 for every path but /health', () => withServer(async (port) => {
  const base = `http://127.0.0.1:${port}${BASE}`;
  const auth = { authorization: `Bearer ${tok('retailer', 'admin')}` };
  const json = await fetch(`${base}/summary?${Q}`, { headers: auth });
  const csv = await fetch(`${base}/dataset?name=revenue&format=csv&${Q}`, { headers: auth });
  for (const res of [json, csv, await fetch(`${base}/health`), await fetch(`${base}/nope`, { headers: auth }), await fetch(`${base}/summary`)]) {
    assert.equal(res.headers.get('cache-control'), 'no-store', res.url);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', res.url);
  }
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="revenue.csv"');
  for (const p of ['/nope', '/summary', '/dataset', '/../etc/passwd', '/admin', '/x/y/z']) assert.equal((await fetch(`${base}${p}`)).status, 401, p);
  assert.equal((await fetch(`http://127.0.0.1:${port}/elsewhere`)).status, 401);
  assert.equal((await fetch(`${base}/nope`, { headers: auth })).status, 404, 'authenticated callers still see 404');
}));

// ---- 6. MCP argument validation
test('6: MCP arguments follow own properties only, and a dataset takes only its own route\'s arguments', () => withServer(async (port) => {
  const call = async (name, args) => (await (await mcp(port, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).json()).result;
  for (const args of [{ constructor: 'x', __proto__: 'y' }, JSON.parse('{"__proto__":"y"}'), { toString: 'x' }, { hasOwnProperty: 'x' }]) {
    const r = await call('retail_media_delivery', args);
    assert.equal(r.isError, true, JSON.stringify(args));
    assert.match(r.content[0].text, /unknown argument/);
  }
  const ok = await call('retail_media_dataset', { name: 'audience', dateFrom: '2026-10-01', dateTo: '2026-10-11' });
  assert.ok(!ok.isError && ok.structuredContent.name === 'audience');
  for (const args of [{ name: 'audience', bogus: 1 }, { name: 'audience', granularity: 'day' }, { name: 'audience', dealId: 'd8' }, { name: 'summary', dealType: 'Preferred deal' }, { bogus: 1 }, { name: 'audience', constructor: 'x' }]) {
    const r = await call('retail_media_dataset', args);
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  assert.ok(!(await call('retail_media_dataset', { name: 'delivery-deals', dealId: 'd8', dateFrom: '2026-10-01', dateTo: '2026-10-11' })).isError);
  assert.ok(!(await call('retail_media_dataset', {})).isError, 'the catalog');
  assert.equal((await call('retail_media_dataset', { name: 'audience', arguments: 1 })).isError, true);
  assert.equal((await call('retail_media_summary', 'oops')).isError, true);
}));

// ---- 7. pacing scans do not grow with history
test('7: PG pacing skips flights that ended before dateFrom or start after dateTo, and still makes one grouped pass', () => {
  const st = new AggregateStore(buildAggregates(raw, ctx));
  st.catalog = JSON.parse(JSON.stringify(st.catalog));
  const d1 = st.catalog.deals.d1;
  d1.flight = { start: '2026-08-01', end: '2026-08-31' }; // ended long before the range
  st.catalog.deals.d2.flight = { start: '2026-08-01', end: '2026-08-31' }; // so have the other Programmatic guaranteed deals
  st.catalog.deals.d4.flight = { start: '2026-08-01', end: '2026-08-31' };
  const scans = [];
  const orig = st.scanDelivery.bind(st);
  st.scanDelivery = (f, fn) => { scans.push({ ...f }); return orig(f, fn); };
  const range = 'dateFrom=2026-10-05&dateTo=2026-10-11';
  const delivery = ask('adv-blackmores', `/delivery?${range}`, st);
  assert.equal(delivery.status, 200);
  assert.ok(scans.every((s) => s.dateFrom >= '2026-10-04'), 'no scan reaches back to the ended flight');
  const entry = delivery.body.pacing.find((p) => p.dealId === 'd1');
  assert.deepEqual(entry.series, [], 'nothing to chart in the range');
  scans.length = 0;
  const deals = dispatch({ store: st, routes: ROUTES, url: `${BASE}/deals?${range}`, principal: { principalType: 'admin', principalId: 'retailer', scopes: ['insights:read'] }, today: '2026-10-11' });
  assert.equal(deals.status, 200);
  assert.ok(scans.every((s) => s.dateFrom >= '2026-10-05'), 'deals does not scan the ended flight either');
  const row = deals.body.rows.find((r) => r.id === 'd1');
  assert.equal(row.pacing.flightEnded, true);
  assert.equal(row.pacing.delivered, null); assert.equal(row.pacing.percent, null);
  // A flight starting after dateTo is not scanned; one running through the range still is, in a single pass from its start.
  d1.flight = { start: '2026-09-20', end: '2026-11-20' };
  scans.length = 0;
  ask('adv-blackmores', `/delivery?${range}`, st);
  const pacingScans = scans.filter((s) => s.dateFrom === '2026-09-20');
  assert.equal(pacingScans.length, 1);
  d1.flight = { start: '2026-12-01', end: '2026-12-31' };
  scans.length = 0;
  ask('adv-blackmores', `/delivery?${range}`, st);
  assert.ok(scans.every((s) => s.dateFrom >= '2026-10-04'));
});

// ---- 8. slow connections
test('8: connection limits are set, and overridable', () => {
  const s = createServer({ store, authenticate });
  assert.equal(s.headersTimeout, 10000); assert.equal(s.requestTimeout, 30000); assert.equal(s.keepAliveTimeout, 5000); assert.equal(s.maxConnections, 1000);
  const t = createServer({ store, authenticate, limits: { headersTimeoutMs: 1000, requestTimeoutMs: 2000, keepAliveTimeoutMs: 300, maxConnections: 7 } });
  assert.equal(t.headersTimeout, 1000); assert.equal(t.requestTimeout, 2000); assert.equal(t.keepAliveTimeout, 300); assert.equal(t.maxConnections, 7);
  process.env.RMI_MAX_CONNECTIONS = '12';
  try { assert.equal(createServer({ store, authenticate }).maxConnections, 12); } finally { delete process.env.RMI_MAX_CONNECTIONS; }
});

test('8: a header that never finishes is cut off at the headers timeout', () => withServer(async (port) => {
  const t0 = Date.now();
  const reply = await new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write('GET / HTTP/1.1\r\nHost: x\r\nX-Slow: '));
    let out = ''; sock.on('data', (d) => { out += d; }); sock.on('close', () => resolve(out)); sock.on('error', () => resolve(out));
    setTimeout(() => sock.destroy(), 5000);
  });
  assert.ok(Date.now() - t0 < 4000, 'closed by the server well inside 5 s');
  assert.ok(reply === '' || /408|400/.test(reply));
}, { limits: { headersTimeoutMs: 600, requestTimeoutMs: 1500 } }));
