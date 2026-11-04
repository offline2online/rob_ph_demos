'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getConfig } = require('../src/config');

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function tmpConfig(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-studio-test-'));
  return getConfig({
    GEMINI_API_KEY: 'g-key', LTX_API_KEY: 'l-key', MEDIA_STUDIO_OUTPUT: dir, MEDIA_STUDIO_POLL_MS: '1',
    GEMINI_BASE_URL: 'https://gemini.test', LTX_BASE_URL: 'https://ltx.test', ...extra,
  });
}

// A scripted fetch: routes are [method, urlRegex, handler(req) -> {status, json|body, headers}].
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    const req = { url: String(url), method, headers: opts.headers || {}, body: opts.body, json: () => JSON.parse(opts.body) };
    calls.push(req);
    const route = routes.find(([m, re]) => m === method && re.test(req.url));
    if (!route) throw new Error(`Unexpected ${method} ${url}`);
    const out = await route[2](req, calls);
    const body = out.json !== undefined ? JSON.stringify(out.json) : out.body ?? '';
    return new Response(body, { status: out.status || 200, headers: { 'content-type': out.json !== undefined ? 'application/json' : 'video/mp4', ...(out.headers || {}) } });
  };
  fn.calls = calls;
  return fn;
}

const imageResponse = (data = PNG_1PX) => ({ json: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { inlineData: { mimeType: 'image/png', data: 'ZHJhZnQ=' }, thought: true }, { text: 'Here you go' }, { inlineData: { mimeType: 'image/png', data } }] } }] } });

module.exports = { PNG_1PX, tmpConfig, fakeFetch, imageResponse };
