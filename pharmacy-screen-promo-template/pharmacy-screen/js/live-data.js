// Live data for the pharmacy screen: the one shared Location API client (requirement 8) and the config
// read, with server failover, polling, change detection and the last good result kept for network drops.
// No DOM: the player page (js/player.js) and the admin editor's preview use it, and the tests run it in Node.
//
//   Store data  GET {server}/api/device/{UniqueDeviceID}/campaign_data   the back-end proxy (ph-proxy/), which
//               holds the PH API token; the screen never calls the PH API directly and never holds a token.
//   Config      GET {server}/api/screens/{store_code}                    the public config read (config-api/),
//               looked up by the store code the proxy returned, never by anything in the URL.
//
// Servers: a list of base URLs, each serving both paths ('' is the page's own origin, the default). The last
// server that answered is tried first, then the others in order, one request at a time.
// `?mockapi=1` swaps in createMockClient(), which reads the seed fixtures (fixtures/*.json) instead.

export const STORE_POLL_MS = 30000;
export const CONFIG_POLL_MS = 60000;
export const REQUEST_TIMEOUT_MS = 8000;
export const CACHE_PREFIX = 'pharmacy-screen:last:';

/** "https://a.example, https://b.example" -> ['https://a.example', 'https://b.example']; nothing -> [''] (same origin). */
export function parseServers(list) {
  const out = [];
  for (const raw of String(list ?? '').split(/[\s,]+/)) {
    const s = raw.trim().replace(/\/+$/, '');
    if (!s) continue;
    if (/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i.test(s) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s?#]*)?$/i.test(s) || /^\/[^\s?#]*$/.test(s)) {
      if (!out.includes(s)) out.push(s);
    }
  }
  return out.length ? out : [''];
}

/** One GET with a timeout. Never throws: {status, json} or {status: 0, error: 'timeout' | 'network'}. */
export async function getJson(fetchImpl, url, timeoutMs = REQUEST_TIMEOUT_MS) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    let json = null;
    try { json = await res.json(); } catch (e) { json = null; }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, error: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Server order for one endpoint: the last server that answered first, then the rest in saved order. */
export function createFailover(servers) {
  let lastGood = null;
  return {
    order: () => (lastGood !== null && servers.includes(lastGood) ? [lastGood, ...servers.filter((s) => s !== lastGood)] : servers.slice()),
    good(server) { lastGood = server; },
    get last() { return lastGood; },
  };
}

// Try each server in turn until one gives an answer `classify` accepts (a result, or a definitive "no").
async function tryServers(pool, fetchImpl, timeoutMs, path, classify) {
  const tried = [];
  for (const server of pool.order()) {
    const r = await getJson(fetchImpl, server + path, timeoutMs);
    const answer = classify(r);
    if (answer) {
      pool.good(server);
      return { ...answer, server, tried };
    }
    tried.push({ server, status: r.status || r.error });
  }
  return { kind: 'down', server: null, tried };
}

const errCode = (json) => (json && json.error && typeof json.error === 'object' ? json.error.code : null);

/** Proxy response -> {kind: 'ok', data} | {kind: 'not-found'} | {kind: 'invalid'} | null (try the next server). */
export function classifyCampaign(r) {
  const json = r.json;
  if (r.status === 200 && json && json.ok !== false && json.data && typeof json.data === 'object' && json.data.store_location) {
    return { kind: 'ok', data: json.data, stale: !!(json.meta && json.meta.stale) };
  }
  // Only the proxy's own answers are definitive: a bare 404 (a static host, a missing rewrite) is a server failure.
  if (r.status === 404 && errCode(json) === 'DEVICE_NOT_FOUND') return { kind: 'not-found' };
  if (r.status === 400 && errCode(json) === 'INVALID_DEVICE_ID') return { kind: 'invalid' };
  return null;
}

/** Config API response -> {kind: 'ok', published} | {kind: 'not-found'} | null (try the next server). */
export function classifyConfig(r) {
  const json = r.json;
  if (r.status === 200 && json && typeof json === 'object' && typeof json.storeCode === 'string' && json.promotions && typeof json.promotions === 'object') {
    return { kind: 'ok', published: json };
  }
  if (r.status === 404 && errCode(json) === 'not-found') return { kind: 'not-found' };
  return null;
}

// Built-in templates in the published config -> the render engine's built-in ids (js/render.js BUILTIN_TEMPLATES).
const BUILTIN_BY_KIND = { 'promotion-scenes': 't_scenes', 'opening-hours': 't_hours' };

/**
 * The published screen config (config-api/src/publish.js) -> the render engine's config shape
 * ({pharmacies, promotions, templates}, as in fixtures/config.json): `colours` is `brand`, `logo` is a URL,
 * a template's `kind` is its `base`, and `promotions` (keyed by promo ID) carry this pharmacy's content.
 */
export function fromPublishedConfig(pub) {
  const promotions = [], templates = [], content = {};
  for (const [key, p] of Object.entries((pub && pub.promotions) || {})) {
    if (!p || typeof p !== 'object') continue;
    const promoId = String(p.promoId || key);
    const t = p.template || {};
    let templateId;
    if (t.builtIn) {
      templateId = BUILTIN_BY_KIND[t.kind] || 't_scenes';
    } else {
      templateId = 'custom:' + String(t.id || promoId);
      if (!templates.some((x) => x.id === templateId)) {
        const bg = t.backgrounds || {};
        templates.push({ id: templateId, name: t.name || '', base: t.kind === 'opening-hours' ? 'hours' : 'scenes', html: t.html || '', css: t.css || '', bgPortrait: bg.portrait || '', bgLandscape: bg.landscape || '' });
      }
    }
    promotions.push({ id: promoId, promoId, name: p.name || promoId, template: templateId });
    content[promoId] = p.content && typeof p.content === 'object' ? p.content : {};
  }
  const colours = (pub && pub.colours) || {};
  return {
    pharmacies: [{ storeCode: String((pub && pub.storeCode) || ''), name: (pub && pub.name) || '', brand: { p: colours.primary || '#0f1050', a: colours.accent || '#5ee6b0' }, logo: (pub && pub.logo) || null, content }],
    promotions,
    templates,
  };
}

/** The live client: proxy for store data, public config read for config, each with its own failover order. */
export function createLiveClient({ servers = [''], fetchImpl = globalThis.fetch && globalThis.fetch.bind(globalThis), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const storePool = createFailover(servers), configPool = createFailover(servers);
  return {
    mock: false,
    servers,
    async getCampaign(device) {
      return tryServers(storePool, fetchImpl, timeoutMs, `/api/device/${encodeURIComponent(device)}/campaign_data`, classifyCampaign);
    },
    async getConfig(storeCode) {
      const r = await tryServers(configPool, fetchImpl, timeoutMs, `/api/screens/${encodeURIComponent(storeCode)}`, classifyConfig);
      return r.kind === 'ok' ? { kind: 'ok', config: fromPublishedConfig(r.published), server: r.server, tried: r.tried } : r;
    },
  };
}

/** `?mockapi=1`: the seed fixtures, read the same way (polled, failover of one "server"). */
export function createMockClient({ base = 'fixtures/', fetchImpl = globalThis.fetch && globalThis.fetch.bind(globalThis), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const server = 'mock fixtures';
  const load = async (file) => {
    const r = await getJson(fetchImpl, base + file, timeoutMs);
    return r.status === 200 && r.json ? r.json : null;
  };
  return {
    mock: true,
    servers: [server],
    async getCampaign(device) {
      const d = await load('campaign-data.json');
      if (!d) return { kind: 'down', server: null, tried: [{ server, status: 'unreadable' }] };
      const hit = (d.devices || {})[device];
      if (!hit) return { kind: 'not-found', server, tried: [] };
      return { kind: 'ok', data: hit.data || hit, server, tried: [] };
    },
    async getConfig(storeCode) {
      const c = await load('config.json');
      if (!c) return { kind: 'down', server: null, tried: [{ server, status: 'unreadable' }] };
      const ph = (c.pharmacies || []).find((p) => String(p.storeCode || '').trim().toUpperCase() === String(storeCode).trim().toUpperCase());
      if (!ph) return { kind: 'not-found', server, tried: [] };
      return { kind: 'ok', config: { pharmacies: [ph], promotions: c.promotions || [], templates: c.templates || [] }, server, tried: [] };
    },
  };
}

const storeCodeOf = (data) => String((data && data.store_location && data.store_location.store_code) || '').trim();

/**
 * What the screen should show for the current state:
 *   invalid     the proxy refused the device ID ("Invalid screen URL")
 *   not-set-up  the device is unknown to PH (reason 'device') or its store has no screen config (reason 'store')
 *   ready       store data and config are both in hand (live or last good)
 *   offline     every server failed and there is nothing cached
 *   loading     the first answers are still on their way
 */
export function screenView(s) {
  if (s.deviceStatus === 'invalid') return { kind: 'invalid' };
  if (s.deviceStatus === 'not-found') return { kind: 'not-set-up', reason: 'device' };
  if (s.campaign && s.configStatus === 'not-found') return { kind: 'not-set-up', reason: 'store', storeCode: s.storeCode };
  if (s.campaign && s.config) return { kind: 'ready' };
  if (s.deviceStatus === 'down' || s.configStatus === 'down') return { kind: 'offline' };
  return { kind: 'loading' };
}

/**
 * Poll store data (every 30 s) and config (every 60 s) for one device, one request in flight per endpoint,
 * keeping the last good result in memory and in `storage` (localStorage) so a screen survives network drops
 * and restarts. Calls onUpdate(state, changed) after every poll; `changed` is true only when what the screen
 * renders would change, so the player re-renders only then.
 */
export function createScreenData({ client, device, storage = null, onUpdate = () => {}, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = (t) => clearTimeout(t), storePollMs = STORE_POLL_MS, configPollMs = CONFIG_POLL_MS }) {
  const key = CACHE_PREFIX + (client.mock ? 'mock:' : '') + device;
  const s = {
    device, mock: !!client.mock,
    campaign: null, config: null, storeCode: null,
    deviceStatus: null, configStatus: null, fromCache: false,
    lastStore: null, lastConfig: null, // {at, kind, server, tried, stale?}
  };
  let lastSig = null, stopped = false;

  const persist = () => {
    if (!storage) return;
    try {
      if (s.campaign) storage.setItem(key, JSON.stringify({ campaign: s.campaign, config: s.config, storeCode: s.storeCode, savedAt: new Date(now()).toISOString() }));
      else storage.removeItem(key);
    } catch (e) { /* storage full or blocked: the in-memory copy still carries the screen */ }
  };
  const restore = () => {
    if (!storage) return;
    try {
      const c = JSON.parse(storage.getItem(key) || 'null');
      if (c && c.campaign && storeCodeOf(c.campaign)) {
        s.campaign = c.campaign;
        s.storeCode = storeCodeOf(c.campaign);
        s.config = c.config && Array.isArray(c.config.pharmacies) ? c.config : null;
        s.fromCache = true;
      }
    } catch (e) { /* unreadable cache: start fresh */ }
  };
  const emit = () => {
    const view = screenView(s);
    const sig = JSON.stringify([view.kind, view.reason || '', s.campaign, s.config]);
    const changed = sig !== lastSig;
    lastSig = sig;
    onUpdate(s, changed);
  };

  // One task at a time per endpoint; a run asked for while one is in flight happens right after it.
  function loop(task, ms) {
    let timer = null, busy = false, again = false;
    const run = async () => {
      if (stopped) return;
      if (busy) { again = true; return; }
      busy = true;
      clearTimer(timer);
      try { await task(); } catch (e) { /* a task never throws on purpose; keep polling regardless */ }
      busy = false;
      if (stopped) return;
      if (again) { again = false; run(); return; }
      timer = setTimer(run, ms);
    };
    return { run, stop: () => { clearTimer(timer); }, get busy() { return busy; } };
  }

  const configLoop = loop(async () => {
    const code = s.storeCode;
    if (!code) return;
    const r = await client.getConfig(code);
    s.lastConfig = { at: now(), kind: r.kind, server: r.server, tried: r.tried || [] };
    if (s.storeCode !== code) { configLoop.run(); return; } // the store changed while this was in flight
    if (r.kind === 'ok') { s.config = r.config; s.configStatus = 'ok'; s.fromCache = false; }
    else if (r.kind === 'not-found') { s.config = null; s.configStatus = 'not-found'; }
    else s.configStatus = 'down'; // keep the last good config
    persist();
    emit();
  }, configPollMs);

  const storeLoop = loop(async () => {
    const r = await client.getCampaign(device);
    s.lastStore = { at: now(), kind: r.kind, server: r.server, tried: r.tried || [], stale: !!r.stale };
    if (r.kind === 'ok') {
      const code = storeCodeOf(r.data);
      const moved = code !== s.storeCode;
      s.deviceStatus = 'ok';
      s.campaign = r.data;
      s.storeCode = code;
      s.fromCache = false;
      if (moved) { s.config = null; s.configStatus = null; }
      persist();
      emit();
      if (moved) configLoop.run();
      return;
    }
    if (r.kind === 'not-found' || r.kind === 'invalid') {
      s.deviceStatus = r.kind;
      s.campaign = null; s.config = null; s.storeCode = null; s.configStatus = null;
    } else {
      s.deviceStatus = 'down'; // keep the last good store data
    }
    persist();
    emit();
  }, storePollMs);

  return {
    state: s,
    start() {
      restore();
      if (s.campaign) emit();
      storeLoop.run();
      if (s.storeCode) configLoop.run();
    },
    /** Poll both now (debug panel), still one request in flight per endpoint. */
    refresh() { storeLoop.run(); configLoop.run(); },
    stop() { stopped = true; storeLoop.stop(); configLoop.stop(); },
  };
}
