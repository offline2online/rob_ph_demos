// Download MP4, end to end on the local stack (admin/tools/dev-server.mjs): POST /api/admin/videos renders the real
// screen page (capture=1) for a seeded pharmacy's mock device in headless Chromium, stepped at 25 fps, through
// ffmpeg; the test downloads the file and checks it with ffprobe against the Android 12 signage format
// (config-api/src/video/format.js, README.md → "Download MP4"). Also: the file name, one render at a time, admin
// only, a pharmacy with no device ID, and that the frames are the pharmacy's own (its store name, not the master's).
//
// Needs ffmpeg and ffprobe on the PATH (or FFMPEG_PATH / FFPROBE_PATH) and Playwright's Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startDevServer } from '../../admin/tools/dev-server.mjs';

const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-video-'));
let dev;
before(async () => {
  dev = await startDevServer({ quiet: true });
  const r = await api('PUT', '/api/settings/ph-api', { body: { baseUrls: ['https://ph-primary.example'], token: 'ph-video-test-Zq7W1234' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});
after(async () => {
  if (dev) await dev.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

async function api(method, p, { token = 'dev-admin', body } = {}) {
  const headers = { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const r = await fetch(dev.base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, body: json };
}

async function pharmacy(storeCode) {
  const r = await api('GET', '/api/admin/pharmacies');
  return r.body.find((p) => p.storeCode === storeCode);
}
async function promotion(promoId) {
  const r = await api('GET', '/api/admin/promotions');
  return r.body.find((p) => p.promoId === promoId);
}

/** Start a video, wait for it, download it; returns {job, file}. */
async function makeVideo(body) {
  const start = await api('POST', '/api/admin/videos', { body });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  let job = start.body;
  const until = Date.now() + 240000;
  while ((job.status === 'queued' || job.status === 'rendering') && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 500));
    job = (await api('GET', `/api/admin/videos/${job.id}`)).body;
  }
  assert.equal(job.status, 'done', JSON.stringify(job));
  const res = await fetch(dev.base + job.url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), new RegExp(`attachment; filename="${job.fileName.replace(/\./g, '\\.')}"`));
  const file = path.join(TMP, job.fileName);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { job, file };
}

function probe(file) {
  const out = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]).toString());
  const keys = execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=key_frame', '-of', 'csv=p=0', file]).toString().trim().split('\n').map((x) => x.trim() === '1');
  const bytes = fs.readFileSync(file);
  const top = []; // top-level boxes in order
  for (let at = 0; at + 8 <= bytes.length;) {
    let size = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (size === 1) size = Number(bytes.readBigUInt64BE(at + 8));
    top.push(type);
    if (size < 8) break;
    at += size;
  }
  return { ...out, keys, top };
}

function assertSignageFormat(p, { w, h }) {
  const v = p.streams.filter((s) => s.codec_type === 'video');
  assert.equal(v.length, 1, 'one video stream');
  assert.equal(p.streams.filter((s) => s.codec_type === 'audio').length, 0, 'no audio stream at all');
  assert.equal(p.streams.length, 1, 'nothing but the video stream');
  const s = v[0];
  assert.equal(s.codec_name, 'h264');
  assert.equal(s.profile, 'Main');
  assert.equal(s.level, 40);
  assert.equal(s.pix_fmt, 'yuv420p');
  assert.equal(s.width, w);
  assert.equal(s.height, h);
  assert.equal(s.sample_aspect_ratio || '1:1', '1:1');
  assert.equal(s.r_frame_rate, '25/1');
  assert.equal(s.avg_frame_rate, '25/1');
  assert.equal(s.time_base, '1/12800');
  assert.equal(s.color_space, 'bt709');
  assert.equal(s.color_range, 'tv');
  assert.equal(p.format.tags.major_brand, 'mp42');
  assert.ok(p.top.indexOf('moov') >= 0 && p.top.indexOf('moov') < p.top.indexOf('mdat'), `moov before mdat (${p.top.join(',')})`);
  // A keyframe exactly every 50 frames (2 s), and nowhere else.
  p.keys.forEach((k, i) => assert.equal(k, i % 50 === 0, `frame ${i} ${k ? 'is' : 'is not'} a keyframe`));
  // No SEI NAL units (type 6) left in the stream.
  const trace = execFileSync(FFMPEG, ['-v', 'error', '-i', p.format.filename, '-c', 'copy', '-bsf:v', 'trace_headers', '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  assert.ok(!/Supplemental Enhancement Information/.test(trace), 'no SEI NAL units');
  // No metadata tags beyond what the container itself needs.
  const tags = Object.keys(p.format.tags || {}).filter((k) => !['major_brand', 'minor_version', 'compatible_brands'].includes(k));
  assert.deepEqual(tags, [], 'no metadata');
}

test('portrait: Beaumaris Pharmacy, Sales Promos, 1080x1920 in the signage format', async () => {
  const ph = await pharmacy('VIC-MP-001');
  const pr = await promotion('sale');
  const { job, file } = await makeVideo({ pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait' });
  assert.match(job.fileName, /^beaumaris-pharmacy-sales-promos-portrait-\d+s_android\.mp4$/);
  const p = probe(file);
  assertSignageFormat(p, { w: 1080, h: 1920 });
  // One whole loop: the promotion's seconds at 25 fps, frame for frame.
  assert.equal(p.keys.length, Math.round(job.seconds * 25));
  assert.equal(job.fileName, `beaumaris-pharmacy-sales-promos-portrait-${Math.round(job.seconds)}s_android.mp4`);
});

test('landscape: Vermont South, Morning, 1920x1080', async () => {
  const rows = (await api('GET', '/api/admin/pharmacies')).body;
  const ph = rows.find((p) => /vermont/i.test(p.name)) || rows[1];
  const pr = await promotion('morning');
  const { job, file } = await makeVideo({ pharmacyId: ph.id, promotionId: pr.id, orientation: 'landscape' });
  assert.match(job.fileName, /-morning-landscape-\d+s_android\.mp4$/);
  const p = probe(file);
  assertSignageFormat(p, { w: 1920, h: 1080 });
  assert.equal(p.keys.length, Math.round(job.seconds * 25));
});

test('a Seasonal occasion plays the season asked for', async () => {
  const ph = await pharmacy('VIC-MP-001');
  const pr = (await api('GET', '/api/admin/promotions')).body.find((p) => p.promoId === 'occasions');
  const { job, file } = await makeVideo({ pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait', occasion: 'christmas' });
  assert.match(job.fileName, /^beaumaris-pharmacy-.*christmas-portrait-\d+s_android\.mp4$/);
  assertSignageFormat(probe(file), { w: 1080, h: 1920 });
});

test('refused: no device ID, a second render at once, a non-admin, a bad body', async () => {
  const ph = await pharmacy('VIC-MP-002');
  const pr = await promotion('morning');
  // No device ID on the pharmacy: 409 with the plain message the editor shows.
  const full = (await api('GET', `/api/admin/pharmacies/${ph.id}`)).body;
  const cleared = await api('PATCH', `/api/admin/pharmacies/${ph.id}`, { body: { device: '' } });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.body.device, undefined);
  const none = await api('POST', '/api/admin/videos', { body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait' } });
  assert.equal(none.status, 409);
  assert.match(none.body.error.message, /screen device ID/);
  await api('PATCH', `/api/admin/pharmacies/${ph.id}`, { body: { device: full.device } });
  // A malformed device ID is refused on save.
  assert.equal((await api('PATCH', `/api/admin/pharmacies/${ph.id}`, { body: { device: '${UniqueDeviceID}' } })).status, 400);
  // Non-admin and anonymous: refused like every other admin route.
  assert.equal((await api('POST', '/api/admin/videos', { token: 'dev-viewer', body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait' } })).status, 403);
  assert.equal((await api('POST', '/api/admin/videos', { token: null, body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait' } })).status, 401);
  assert.equal((await api('POST', '/api/admin/videos', { body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'sideways' } })).status, 400);
  // One at a time: a second request while one renders gets 429.
  const first = await api('POST', '/api/admin/videos', { body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'portrait' } });
  assert.equal(first.status, 201);
  const second = await api('POST', '/api/admin/videos', { body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'landscape' } });
  assert.equal(second.status, 429);
  assert.match(second.body.error.message, /already being made/);
  let job = first.body;
  while (job.status === 'queued' || job.status === 'rendering') { await new Promise((r) => setTimeout(r, 500)); job = (await api('GET', `/api/admin/videos/${job.id}`)).body; }
  assert.equal(job.status, 'done');
  // Free again once it is done.
  const third = await api('POST', '/api/admin/videos', { body: { pharmacyId: ph.id, promotionId: pr.id, orientation: 'landscape' } });
  assert.equal(third.status, 201);
  job = third.body;
  while (job.status === 'queued' || job.status === 'rendering') { await new Promise((r) => setTimeout(r, 500)); job = (await api('GET', `/api/admin/videos/${job.id}`)).body; }
  assert.equal(job.status, 'done');
});
