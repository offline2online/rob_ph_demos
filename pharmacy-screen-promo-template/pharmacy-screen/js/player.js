// The player page: reads the campaign URL, loads the store's data and the config, and plays the promotion.
//
//   pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
//
// For this build the store data and config come from local fixtures (fixtures/campaign-data.json holds mock
// Location API campaign_data responses keyed by device ID; fixtures/config.json holds the pharmacies,
// promotions and templates). Live data replaces loadData() in a later ticket; nothing else here changes.
//
// Testing parameters (not used by the PH player):
//   scene=<n>        hold on scene n (0-based) instead of playing the loop
//   now=<day>-<HH:MM>  pretend the store's local time is this, e.g. now=fri-18:45 (the "Open today" bar)

import { storeModel, resolvePromotion, sequence, sceneName, renderScene, renderMessage, ScreenError } from './render.js';
import { parseTestTime, storeNow, storeState } from './hours.js';
import { auditScene } from './fit-text.js';

const q = new URLSearchParams(location.search);
const params = {
  device: (q.get('device') || '').trim(),
  promo: (q.get('promo') || '').trim(),
  orientation: q.get('orientation') === 'landscape' ? 'landscape' : 'portrait',
  hold: q.has('scene') ? Math.max(0, parseInt(q.get('scene'), 10) || 0) : null,
  now: q.get('now') || '',
};

const stage = document.getElementById('stage');
const el = document.getElementById('screen');
let config = null, campaign = null, store = null, play = null;
let scene = 0, playing = params.hold === null, timers = [], lastStateKey = '', last = null;

function fit() {
  const W = params.orientation === 'landscape' ? 1920 : 1080, H = params.orientation === 'landscape' ? 1080 : 1920;
  const k = Math.min(innerWidth / W, innerHeight / H);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.transform = `translate(${(innerWidth - W * k) / 2}px,${(innerHeight - H * k) / 2}px) scale(${k})`;
}
addEventListener('resize', fit);

function testNow() {
  if (!params.now || !store) return undefined;
  return parseTestTime(params.now, storeNow(store.tz).day) || undefined;
}

function stateKey() {
  const s = storeState(store.sessions, testNow() || storeNow(store.tz));
  return [s.state, s.openTime, s.closeTime].join('|');
}

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function show(i, enter) {
  const seq = sequence(play);
  scene = ((i % seq.length) + seq.length) % seq.length;
  last = renderScene(el, { store, play, orientation: params.orientation, scene, now: testNow(), enter });
  lastStateKey = stateKey();
  clearTimers();
  if (!playing) return;
  const t = seq[scene].t * 1000;
  timers.push(setTimeout(() => el.classList.add('leaving'), Math.max(0, t - 250)));
  timers.push(setTimeout(() => show(scene + 1, true), t));
}

function fail(e) {
  clearTimers();
  if (e instanceof ScreenError) {
    renderMessage(el, params.orientation, e.title, e.code === 'not-set-up' && params.device ? `${e.detail} Device ${params.device}` : e.detail);
  } else {
    renderMessage(el, params.orientation, 'Screen data could not load', String((e && e.message) || e));
  }
}

async function loadData() {
  const get = async (p) => { const r = await fetch(p, { cache: 'no-store' }); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
  const [c, d] = await Promise.all([get('fixtures/config.json'), get('fixtures/campaign-data.json')]);
  return { config: c, campaign: (d.devices || {})[params.device] || null };
}

async function start() {
  fit();
  if (!params.device) { renderMessage(el, params.orientation, 'Invalid screen URL', 'This screen’s campaign URL has no device ID.'); return; }
  try {
    ({ config, campaign } = await loadData());
    if (!campaign) throw new ScreenError('not-set-up', 'Screen not set up', 'This device is not linked to a store.');
    store = storeModel(campaign, config);
    const promoId = params.promo || ((config.promotions || [])[0] || {}).id;
    play = resolvePromotion(config, store, promoId);
  } catch (e) { fail(e); return; }
  // Copy is fitted to the panel by measuring it, so wait (up to 3s) for the web fonts before the first scene.
  let fontsIn = false;
  const fonts = (document.fonts && document.fonts.ready) || Promise.resolve();
  await Promise.race([fonts.then(() => { fontsIn = true; }), new Promise((r) => setTimeout(r, 3000))]);
  show(params.hold === null ? 0 : params.hold, true);
  // The "Open today" bar follows the store's clock: re-render when the store's state changes.
  setInterval(() => { if (play && stateKey() !== lastStateKey) show(scene, false); }, 15000);
  // Fonts that arrived after that: fit the copy again with the real glyph widths.
  if (!fontsIn) fonts.then(() => { if (play) show(scene, false); });
}

// Hook for the overflow audit and the admin editor's tests.
window.pharmacyScreen = {
  get ready() { return !!play || !!el.querySelector('.s-msg'); },
  get info() { return play ? { store: store.code, promo: play.promoId, base: play.base, scene, scenes: sequence(play).map((s, i) => sceneName(play, i)), fit: last && last.fit, state: last && last.state.state } : null; },
  promotions: () => (config ? config.promotions.map((p) => p.promoId || p.token || p.id) : []),
  /** Stop playback and show one promotion's scene, exactly as it renders after its entrance. */
  show(promoId, i) {
    playing = false;
    clearTimers();
    play = resolvePromotion(config, store, promoId);
    show(i, false);
    return this.info;
  },
  audit() { return last ? auditScene(el, last.G) : ['nothing rendered']; },
};

start();
