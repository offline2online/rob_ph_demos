'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer, listen } = require('../src/server');
const { tmpConfig, fakeFetch, imageResponse, PNG_1PX } = require('./helpers');

async function start(config, fetch) {
  const server = createServer({ config, fetch });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base, close: () => new Promise((r) => server.close(r)) };
}

test('POST /v1/images?wait=1 generates, lists in the library, serves the file', async () => {
  const providerFetch = fakeFetch([['POST', /generateContent$/, () => imageResponse()]]);
  const { base, close } = await start(tmpConfig(), providerFetch);
  try {
    const health = await (await fetch(`${base}/v1/health`)).json();
    assert.equal(health.providers.find((p) => p.id === 'nano-banana').configured, true);

    const r = await fetch(`${base}/v1/images?wait=1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'Hero for a blog post', preset: 'blog-hero' }) });
    assert.equal(r.status, 200);
    const { job } = await r.json();
    assert.equal(job.status, 'succeeded');
    const file = job.result.files[0].path;

    const media = await fetch(`${base}/media/${file}`);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from(PNG_1PX, 'base64'));

    const lib = await (await fetch(`${base}/v1/library?kind=image`)).json();
    assert.equal(lib.items[0].id, job.result.id);
    assert.equal((await fetch(`${base}/v1/library/${job.result.id}`)).status, 200);

    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Media Studio/);
  } finally { await close(); }
});

test('async video job: 202 then poll to completion', async () => {
  const providerFetch = fakeFetch([
    ['POST', /predictLongRunning$/, () => ({ json: { name: 'op', done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: 'https://gemini.test/v.mp4' } }] } } } })],
    ['GET', /v\.mp4$/, () => ({ body: 'V' })],
  ]);
  const { base, close } = await start(tmpConfig(), providerFetch);
  try {
    const r = await fetch(`${base}/v1/videos`, { method: 'POST', body: JSON.stringify({ prompt: 'clip' }) });
    assert.equal(r.status, 202);
    const { job } = await r.json();
    let state;
    for (let i = 0; i < 50; i += 1) {
      state = (await (await fetch(`${base}/v1/jobs/${job.id}`)).json()).job;
      if (state.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 10));
    }
    assert.equal(state.status, 'succeeded');
    assert.equal(state.result.kind, 'video');
    assert.ok(state.progress.length > 0);
  } finally { await close(); }
});

test('bad requests fail fast with 400; path traversal is refused', async () => {
  const { base, close } = await start(tmpConfig(), fakeFetch([]));
  try {
    const r = await fetch(`${base}/v1/images`, { method: 'POST', body: JSON.stringify({ prompt: 'x', aspectRatio: '9:9' }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /aspectRatio/);
    assert.equal((await fetch(`${base}/v1/images`, { method: 'POST', body: '{nope' })).status, 400);
    assert.equal((await fetch(`${base}/media/..%2F..%2Fetc%2Fpasswd`)).status, 404);
    assert.equal((await fetch(`${base}/assets/..%2Fsrc%2Fconfig.js`)).status, 404);
  } finally { await close(); }
});

test('bearer token is enforced when set; non-loopback host requires one', async () => {
  const { base, close } = await start(tmpConfig({ MEDIA_STUDIO_TOKEN: 's3cret' }), fakeFetch([]));
  try {
    assert.equal((await fetch(`${base}/v1/health`)).status, 401);
    assert.equal((await fetch(`${base}/v1/health`, { headers: { authorization: 'Bearer s3cret' } })).status, 200);
  } finally { await close(); }
  assert.throws(() => listen(tmpConfig({ HOST: '0.0.0.0' })), /Refusing to listen/);
});
