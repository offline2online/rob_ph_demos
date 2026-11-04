'use strict';
// Fetch the provider keys an admin saved in the PH Agent Console (Settings →
// Integrations & MCP → Media Studio API keys). They are stored encrypted
// there; functions/media-keys.js decrypts them only for a caller holding the
// board automation key (BOARD_API_KEY — a GitHub secret, and in every
// Routine-fired session's payload).
//
// A value already in the environment (or media-studio/.env) always wins, so
// a developer can still override one key locally. Set MEDIA_STUDIO_CONSOLE=off
// to skip the console entirely.

const NAMES = ['GEMINI_API_KEY', 'LTX_API_KEY', 'WP_AUTH', 'WP_SITE_URL'];
const DEFAULT_URL = 'https://backlog-tracker-e4ed2.web.app';

async function loadConsoleKeys({ env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  const boardKey = env.BOARD_API_KEY || '';
  if (!boardKey || boardKey === 'unset' || /^(off|false|0)$/i.test(env.MEDIA_STUDIO_CONSOLE || '')) return { used: false, loaded: [], problems: [] };
  if (NAMES.slice(0, 2).every((n) => env[n])) return { used: false, loaded: [], problems: [] }; // nothing to fetch
  const url = `${String(env.MEDIA_STUDIO_CONSOLE_URL || DEFAULT_URL).replace(/\/+$/, '')}/mediaKeys/v1/runtime`;
  let resp;
  try {
    resp = await fetchImpl(url, { headers: { 'X-Board-Key': boardKey, 'User-Agent': 'media-studio' } });
  } catch (err) {
    return { used: true, loaded: [], problems: [`couldn't reach the console (${err.message})`] };
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) return { used: true, loaded: [], problems: [`console answered HTTP ${resp.status}: ${data.error || ''}`.trim()] };
  const loaded = [];
  for (const name of NAMES) {
    const v = data.env && data.env[name];
    if (v && !env[name]) { env[name] = v; loaded.push(name); }
  }
  return { used: true, loaded, problems: data.problems || [] };
}

module.exports = { loadConsoleKeys, NAMES };
