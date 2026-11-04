'use strict';
// HTTP API + the Media Studio web page. No dependencies beyond Node itself.
//
//   GET  /v1/health                    providers configured, models in use
//   GET  /v1/presets                   formats and styles
//   POST /v1/images      {prompt,...}  -> 202 {job}   (?wait=1 -> 200 {job} when done)
//   POST /v1/videos      {prompt,...}  -> 202 {job}
//   GET  /v1/jobs | /v1/jobs/:id       progress and result
//   GET  /v1/library[?kind=image|video&limit=]  and /v1/library/:id
//   POST /v1/library/:id/publish {altText?,caption?,title?}  -> WordPress
//   GET  /media/<path>                 the saved files
//   GET  /                             the web UI
//
// Listens on 127.0.0.1 by default. To listen anywhere else, MEDIA_STUDIO_TOKEN
// must be set, and every /v1 call then needs "Authorization: Bearer <token>".

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStudio } = require('./studio');
const { FORMATS, STYLES } = require('./presets');
const { CAMERA_MOTIONS } = require('./providers/ltx');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const MAX_BODY = 60 * 1024 * 1024; // room for several base64 reference images
const STATIC_TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.json': 'application/json' };
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

function createJobs(studio) {
  const jobs = new Map();
  const publicJob = (j) => ({ id: j.id, kind: j.kind, prompt: j.prompt, provider: j.provider, status: j.status, progress: j.progress, result: j.result, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt });

  function start(kind, body) {
    const job = { id: crypto.randomBytes(6).toString('hex'), kind, prompt: String(body.prompt || '').trim(), provider: body.provider || (kind === 'image' ? 'nano-banana' : 'veo'), status: 'running', progress: [], createdAt: new Date().toISOString() };
    jobs.set(job.id, job);
    if (jobs.size > 200) jobs.delete(jobs.keys().next().value);
    const onProgress = (message) => job.progress.push({ at: new Date().toISOString(), message });
    job.done = studio.generate(kind, body, { onProgress })
      .then((item) => { job.status = 'succeeded'; job.result = item; })
      .catch((err) => { job.status = 'failed'; job.error = { message: err.message, status: err.status || 500 }; })
      .finally(() => { job.finishedAt = new Date().toISOString(); });
    return job;
  }

  return { start, get: (id) => jobs.get(id), list: () => [...jobs.values()].reverse().map(publicJob), publicJob };
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(Object.assign(new Error('Body must be JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file, types, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

function tokenMatches(header, token) {
  const given = Buffer.from(String(header || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(token);
  return given.length === want.length && crypto.timingSafeEqual(given, want);
}

function createServer({ config, fetch: fetchImpl, studio = createStudio({ config, fetch: fetchImpl }) } = {}) {
  const jobs = createJobs(studio);
  const { token } = config.server;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (req.method === 'GET' && (p === '/' || p === '/index.html')) return serveFile(res, path.join(PUBLIC_DIR, 'index.html'), STATIC_TYPES, 'no-cache');
    if (req.method === 'GET' && p.startsWith('/assets/')) {
      const file = path.resolve(PUBLIC_DIR, p.slice('/assets/'.length));
      if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, { error: 'Not found' });
      return serveFile(res, file, STATIC_TYPES, 'no-cache');
    }
    if (req.method === 'GET' && p.startsWith('/media/')) {
      const file = studio.library.resolveFile(decodeURIComponent(p.slice('/media/'.length)));
      if (!file) return send(res, 404, { error: 'Not found' });
      return serveFile(res, file, MEDIA_TYPES, 'public, max-age=31536000, immutable');
    }

    if (!p.startsWith('/v1/')) return send(res, 404, { error: 'Not found' });
    if (token && !tokenMatches(req.headers.authorization, token)) return send(res, 401, { error: 'Missing or wrong bearer token' });

    if (req.method === 'GET' && p === '/v1/health') return send(res, 200, { ok: true, ...studio.status() });
    if (req.method === 'GET' && p === '/v1/presets') return send(res, 200, { formats: FORMATS, styles: STYLES, cameraMotions: CAMERA_MOTIONS });

    const gen = /^\/v1\/(images|videos)$/.exec(p);
    if (req.method === 'POST' && gen) {
      const body = await readBody(req);
      const kind = gen[1] === 'images' ? 'image' : 'video';
      await studio.prepare(kind, body); // fail fast on a bad request, before a job exists
      const job = jobs.start(kind, body);
      if (url.searchParams.get('wait')) {
        await job.done;
        return send(res, job.status === 'succeeded' ? 200 : job.error.status || 500, { job: jobs.publicJob(job) });
      }
      return send(res, 202, { job: jobs.publicJob(job) }, { Location: `/v1/jobs/${job.id}` });
    }

    if (req.method === 'GET' && p === '/v1/jobs') return send(res, 200, { jobs: jobs.list() });
    const jobMatch = /^\/v1\/jobs\/([0-9a-f]+)$/.exec(p);
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job ? send(res, 200, { job: jobs.publicJob(job) }) : send(res, 404, { error: 'No such job' });
    }

    if (req.method === 'GET' && p === '/v1/library') {
      const kind = url.searchParams.get('kind') || undefined;
      const limit = Math.min(500, parseInt(url.searchParams.get('limit'), 10) || 100);
      return send(res, 200, { items: studio.library.list({ kind, limit }) });
    }
    const libMatch = /^\/v1\/library\/([0-9a-f]{8})(\/publish)?$/.exec(p);
    if (libMatch && req.method === 'GET' && !libMatch[2]) {
      const item = studio.library.get(libMatch[1]);
      return item ? send(res, 200, { item }) : send(res, 404, { error: 'No such item' });
    }
    if (libMatch && req.method === 'POST' && libMatch[2]) {
      const body = await readBody(req);
      return send(res, 200, { item: await studio.publish(libMatch[1], body) });
    }

    return send(res, 404, { error: 'Not found' });
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) send(res, err.status && err.status < 600 ? err.status : 500, { error: err.message });
    });
  });
}

function listen(config, opts = {}) {
  const { host, port, token } = config.server;
  if (!LOOPBACK.has(host) && !token) {
    throw new Error(`Refusing to listen on ${host} without MEDIA_STUDIO_TOKEN — anyone who can reach it could spend your API credit.`);
  }
  const server = createServer({ config, ...opts });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

module.exports = { createServer, listen };
