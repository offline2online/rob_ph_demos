'use strict';
// QuickSight datasets and MCP tools: the same figures and the same scoping as the API routes the tab reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const { generateTestRetailer } = require('../src/testdata');
const { buildAggregates } = require('../src/aggregate');
const { AggregateStore } = require('../src/store');
const { createServer, BASE, MCP_PATH } = require('../src/server');
const { DATASETS } = require('../src/datasets');
const { admin, advertiser } = require('./helpers');

const { raw, ctx } = generateTestRetailer({ days: 30 });
const store = new AggregateStore(buildAggregates(raw, ctx));
const Q = 'dateFrom=2026-10-05&dateTo=2026-10-11';
const [ME, OTHER] = Object.keys(ctx.advertisers);
const NAMES = Object.values(ctx.advertisers).map((a) => a.name);

async function withServer(authenticate, fn) {
  const server = createServer({ store, today: '2026-10-11', authenticate });
  await new Promise((r) => server.listen(0, r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try { await fn({ api: (p, init) => fetch(`${origin}${BASE}${p}`, init), json: async (p) => (await fetch(`${origin}${BASE}${p}`)).json() }); } finally { server.close(); }
}
const rpc = (api, method, params, id = 1) => api('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }).then((r) => r.json());
const call = (api, name, args) => rpc(api, 'tools/call', { name, arguments: args });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test('every retailer dataset builds, with typed columns and a row per grain', () => withServer(admin, async ({ json }) => {
  const { datasets } = await json(`/datasets`);
  const adv = new Set(['delivery', 'delivery-deals', 'deals-by-display-type', 'audience', 'my-targeting']);
  assert.deepEqual(datasets.map((d) => d.name).sort(), DATASETS.map((d) => d.name).sort());
  for (const d of DATASETS) {
    const ds = await json(`/dataset?name=${d.name}&${Q}${adv.has(d.name) ? `&advertiserIds=${ME}` : ''}`);
    assert.equal(ds.name, d.name);
    assert.ok(ds.rows.length > 0, d.name);
    for (const r of ds.rows) {
      assert.deepEqual(Object.keys(r), ds.columns.map((c) => c.name), d.name);
      for (const v of Object.values(r)) assert.ok(v === null || typeof v !== 'object', `${d.name}: scalar cells only`);
    }
  }
}));

test('dataset figures match the tab endpoints for the same filters', () => withServer(admin, async ({ json }) => {
  const f = `${Q}&storeIds[]=store-1`;
  const rev = await json(`/revenue?${f}&granularity=week`);
  const ds = await json(`/dataset?name=revenue&${f}&granularity=week`);
  assert.deepEqual(ds.rows, rev.rows);
  assert.equal(ds.columns.find((c) => c.name === 'earned').type, 'DECIMAL');
  const sum1 = await json(`/summary?${f}`);
  const [row] = (await json(`/dataset?name=summary&${f}`)).rows;
  assert.equal(row.earnedRevenue, sum1.earnedRevenue);
  assert.equal(row.inventorySold_slotsSold, sum1.inventorySold.slotsSold);
  const mr = await json(`/missed-revenue?${f}`);
  const mrd = await json(`/dataset?name=missed-revenue&${f}`);
  assert.equal(sum(mrd.rows.map((r) => r.totalMissed)).toFixed(2), sum(mr.rows.map((r) => r.totalMissed)).toFixed(2));
}));

test('dataset csv has a header row, escapes cells and neutralises formulas', () => withServer(admin, async ({ api }) => {
  const res = await api(`/dataset?name=revenue&${Q}&format=csv`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const lines = (await res.text()).split('\n');
  assert.equal(lines[0], 'period,dsp,dealType,earned,estimated');
  assert.ok(lines.length > 1);
  const { toCsv } = require('../src/datasets');
  assert.equal(toCsv({ columns: [{ name: 'a' }, { name: 'b' }], rows: [{ a: '=SUM(A1)', b: 'x,"y"' }] }), 'a,b\n\'=SUM(A1),"x,""y"""');
  assert.equal((await api(`/dataset?name=nope&${Q}`)).status, 400);
  assert.equal((await api(`/dataset?name=revenue&format=xml`)).status, 400);
}));

test('an advertiser reads only its own advertiser datasets, scoped to itself', () => withServer(advertiser(ME), async ({ api, json }) => {
  const { datasets } = await json('/datasets');
  assert.deepEqual(datasets.map((d) => d.name).sort(), ['audience', 'deals-by-display-type', 'delivery', 'delivery-deals', 'display-types', 'my-targeting']);
  for (const retailerOnly of ['summary', 'revenue', 'yield', 'deals', 'advertisers', 'missed-revenue', 'slot-value', 'maturity-ladder']) {
    assert.equal((await api(`/dataset?name=${retailerOnly}&${Q}`)).status, 403, retailerOnly);
  }
  // asking for someone else's data does not widen the scope
  const mine = await json(`/dataset?name=delivery&${Q}`);
  const spoof = await json(`/dataset?name=delivery&${Q}&advertiserIds=${OTHER}`);
  assert.deepEqual(spoof.rows, mine.rows);
  const direct = await json(`/delivery?${Q}`);
  assert.equal(sum(mine.rows.map((r) => r.spend)).toFixed(2), direct.totals.spend.toFixed(2));
  const text = JSON.stringify(await json(`/dataset?name=delivery-deals&${Q}`)) + JSON.stringify(await json(`/dataset?name=deals-by-display-type&${Q}`));
  for (const n of NAMES.filter((n) => n !== ctx.advertisers[ME].name)) assert.ok(!text.includes(n), `other advertiser ${n} must not appear`);
  assert.doesNotMatch(text, /downtime|offline|lost/i);
}));

test('a retailer must name one advertiser for an advertiser dataset', () => withServer(admin, async ({ api }) => {
  assert.equal((await api(`/dataset?name=delivery&${Q}`)).status, 400);
}));

test('MCP: unauthenticated is 401, GET is 405, bad JSON is 400', async () => {
  const server = createServer({ store, today: '2026-10-11', authenticate: () => null });
  await new Promise((r) => server.listen(0, r));
  try {
    const url = `http://127.0.0.1:${server.address().port}${MCP_PATH}`;
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  } finally { server.close(); }
  await withServer(admin, async ({ api }) => {
    assert.equal((await api('/mcp')).status, 405);
    assert.equal((await api('/mcp', { method: 'POST', body: '{nope' })).status, 400);
  });
});

test('MCP: initialize, notifications and tools/list', () => withServer(admin, async ({ api }) => {
  const init = await rpc(api, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.serverInfo.name, 'retail-media-insights');
  assert.ok(init.result.capabilities.tools);
  const note = await api('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(note.status, 202);
  const { result } = await rpc(api, 'tools/list');
  const names = result.tools.map((t) => t.name);
  for (const n of ['retail_media_summary', 'retail_media_revenue', 'retail_media_maturity', 'retail_media_delivery', 'retail_media_dataset']) assert.ok(names.includes(n), n);
  assert.ok(result.tools.every((t) => t.inputSchema.type === 'object' && t.inputSchema.properties.dateFrom));
  assert.equal((await rpc(api, 'nope')).error.code, -32601);
}));

test('MCP tool results equal the tab endpoint for the same filters', () => withServer(admin, async ({ api, json }) => {
  const res = await call(api, 'retail_media_revenue', { dateFrom: '2026-10-05', dateTo: '2026-10-11', storeIds: ['store-1'], granularity: 'week' });
  assert.ok(!res.result.isError);
  assert.deepEqual(res.result.structuredContent, await json(`/revenue?${Q}&storeIds[]=store-1&granularity=week`));
  assert.deepEqual(JSON.parse(res.result.content[0].text), res.result.structuredContent);
  const sm = await call(api, 'retail_media_summary', { dateFrom: '2026-10-05', dateTo: '2026-10-11', dsps: ['DV360'] });
  assert.deepEqual(sm.result.structuredContent, await json(`/summary?${Q}&dsps[]=DV360`));
  const ds = await call(api, 'retail_media_dataset', { name: 'yield', dateFrom: '2026-10-05', dateTo: '2026-10-11' });
  assert.deepEqual(ds.result.structuredContent, await json(`/dataset?name=yield&${Q}`));
  const list = await call(api, 'retail_media_dataset', {});
  assert.equal(list.result.structuredContent.datasets.length, DATASETS.length);
}));

test('MCP: bad arguments are tool errors, not crashes', () => withServer(admin, async ({ api }) => {
  for (const [name, args] of [['retail_media_revenue', { granularity: 'hour' }], ['retail_media_summary', { dateFrom: 'yesterday' }], ['retail_media_summary', { bogus: 1 }],
    ['retail_media_summary', { storeIds: [{}] }], ['retail_media_delivery', {}], ['retail_media_dataset', { name: 'nope' }], ['no_such_tool', {}]]) {
    const r = await call(api, name, args);
    assert.equal(r.result.isError, true, `${name} ${JSON.stringify(args)}`);
  }
}));

test('MCP: an advertiser sees and can call only advertiser tools, pinned to itself', () => withServer(advertiser(ME), async ({ api, json }) => {
  const names = (await rpc(api, 'tools/list')).result.tools.map((t) => t.name);
  assert.ok(names.includes('retail_media_delivery') && names.includes('retail_media_dataset'));
  for (const n of ['retail_media_summary', 'retail_media_revenue', 'retail_media_missed_revenue', 'retail_media_advertisers', 'retail_media_deals', 'retail_media_maturity']) assert.ok(!names.includes(n), n);
  for (const n of ['retail_media_summary', 'retail_media_missed_revenue', 'retail_media_advertisers']) {
    const r = await call(api, n, { dateFrom: '2026-10-05', dateTo: '2026-10-11' });
    assert.equal(r.result.isError, true, n);
    assert.match(r.result.content[0].text, /not available to advertiser/);
  }
  const mine = await call(api, 'retail_media_delivery', { dateFrom: '2026-10-05', dateTo: '2026-10-11' });
  const spoof = await call(api, 'retail_media_delivery', { dateFrom: '2026-10-05', dateTo: '2026-10-11', advertiserIds: [OTHER] });
  assert.deepEqual(spoof.result.structuredContent, mine.result.structuredContent);
  assert.deepEqual(mine.result.structuredContent, await json(`/delivery?${Q}`));
  const blocked = await call(api, 'retail_media_dataset', { name: 'missed-revenue', dateFrom: '2026-10-05', dateTo: '2026-10-11' });
  assert.equal(blocked.result.isError, true);
  const cat = await call(api, 'retail_media_dataset', {});
  assert.equal(cat.result.structuredContent.datasets.length, 6);
}));
