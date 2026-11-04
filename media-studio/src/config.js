'use strict';
// Configuration comes from the environment, optionally seeded from
// media-studio/.env (gitignored). Real environment variables always win over
// the file, so a CI runner's secrets or a cloud session's environment
// variables are used as-is.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function parseEnvFile(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnvFile(file = path.join(ROOT, '.env')) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const [k, v] of Object.entries(parseEnvFile(text))) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}

function getConfig(env = process.env) {
  const trimSlash = (s) => String(s || '').replace(/\/+$/, '');
  const outputDir = path.resolve(ROOT, env.MEDIA_STUDIO_OUTPUT || 'output');
  return {
    root: ROOT,
    outputDir,
    gemini: {
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
      baseUrl: trimSlash(env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'),
      imageModel: env.NANO_BANANA_MODEL || 'gemini-3-pro-image-preview',
      veoModel: env.VEO_MODEL || 'veo-3.1-generate-preview',
      veoFastModel: env.VEO_FAST_MODEL || 'veo-3.1-fast-generate-preview',
    },
    ltx: {
      apiKey: env.LTX_API_KEY || '',
      baseUrl: trimSlash(env.LTX_BASE_URL || 'https://api.ltx.io'),
      model: env.LTX_MODEL || 'ltx-2-5-pro',
      fastModel: env.LTX_FAST_MODEL || 'ltx-2-5-fast',
    },
    wordpress: {
      siteUrl: trimSlash(env.WP_SITE_URL || ''),
      auth: env.WP_AUTH || '',
    },
    server: {
      host: env.HOST || '127.0.0.1',
      port: Number(env.PORT || 8787),
      token: env.MEDIA_STUDIO_TOKEN || '',
    },
    // Poll cadence for the long-running video jobs; tests shrink these.
    pollIntervalMs: Number(env.MEDIA_STUDIO_POLL_MS || 0) || null,
    maxWaitMs: Number(env.MEDIA_STUDIO_MAX_WAIT_MS || 0) || 20 * 60 * 1000,
  };
}

module.exports = { ROOT, parseEnvFile, loadEnvFile, getConfig };
