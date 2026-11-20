// The player page: reads the campaign URL, gets the store's data and config live, and plays the promotion.
//
//   pharmacy-screen.html?device=${UniqueDeviceID}&promo=<promo id>&orientation=<portrait|landscape>
//
// Store data comes from the back-end proxy (GET /api/device/{device}/campaign_data, ph-proxy/), config from
// the public config read (GET /api/screens/{store_code}, config-api/), both through js/live-data.js: polled
// every 30 s / 60 s, last good server first, re-rendered only on change, last good result kept in
// localStorage. The servers are the page's <meta name="pharmacy-screen-api"> (empty: this page's origin).
//
// Testing parameters (not used by the PH player):
//   mockapi=1          use the seed fixtures (fixtures/campaign-data.json, fixtures/config.json) instead of the API
//   debug=1            show the debug panel: device, store code, last fetch, server used, test time override
//   scene=<n>          hold on scene n (0-based) instead of playing the loop (an occasion: beat n, held still)
//   now=<day>-<HH:MM>  pretend the store's local time is this, e.g. now=fri-18:45 (the "Open today" bar)
//   date=<YYYY-MM-DD>  pretend the store's date is this, e.g. date=2026-12-20 (which season the Seasonal promotion
//                      plays; MM-DD for this year)

import { storeModel, resolvePromotion, sequence, sceneName, renderScene, renderMessage, renderNotSetUp, ScreenError, OCCASION_IDS } from './render.js';
import { parseTestTime, parseTestDate, storeNow, storeDate, storeState } from './hours.js';
import { auditScene } from './fit-text.js';
import { parseServers, createLiveClient, createMockClient, createScreenData, screenView } from './live-data.js';

const q = new URLSearchParams(location.search);
const flag = (k) => q.has(k) && !/^(0|false|no|off)$/i.test(q.get(k) || '');
const params = {
  device: (q.get('device') || '').trim(),
  promo: (q.get('promo') || '').trim(),
  orientation: q.get('orientation') === 'landscape' ? 'landscape' : 'portrait',
  hold: q.has('scene') ? Math.max(0, parseInt(q.get('scene'), 10) || 0) : null,
  now: q.get('now') || '',
  date: q.get('date') || '',
  mock: flag('mockapi'),
  debug: flag('debug'),
};
// An unswapped ${UniqueDeviceID} is not a device ID.
if (params.device.includes('${')) params.device = '';

// Keep the screen on the device (sw.js): it starts from the device's copy, even with no network, and downloads the
// page, scripts, fonts and icons again only after a deploy changed them. How often the player asks whether one did
// (a request for sw.js, answered 304 while nothing changed); the browser also asks on every page load.
const UPDATE_CHECK_MS = 30 * 60 * 1000;
function keepOnDevice() {
  if (!('serviceWorker' in navigator)) return;
  // Off on a local server unless sw=1 (the tests route requests a service worker would hide); nosw=1 turns it off.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (flag('nosw') || (local && !flag('sw'))) return;
  // A new version takes over the page: reload once so it runs the new code. Not when the first install takes over
  // an uncontrolled page, which already runs the current code.
  let controlled = !!navigator.serviceWorker.controller, reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return; }
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { scope: './pharmacy-screen.html' })
    .then((reg) => setInterval(() => reg.update().catch(() => {}), UPDATE_CHECK_MS))
    .catch(() => {}); // no service worker (an old player, a blocked one): the screen still plays, only uncached
}
keepOnDevice();

const stage = document.getElementById('stage');
const el = document.getElementById('screen');
const meta = document.querySelector('meta[name="pharmacy-screen-api"]');
let config = null, store = null, play = null, data = null, panel = null; // panel: a promise of the debug panel (debug=1)
let scene = 0, playing = params.hold === null, timers = [], lastStateKey = '', last = null;
let testTime = null, started = false, fontsWaited = false, shown = '';

function fit() {
  const W = params.orientation === 'landscape' ? 1920 : 1080, H = params.orientation === 'landscape' ? 1080 : 1920;
  const k = Math.min(innerWidth / W, innerHeight / H);
  stage.style.width = W + 'px';
  stage.style.height = H + 'px';
  stage.style.transform = `translate(${(innerWidth - W * k) / 2}px,${(innerHeight - H * k) / 2}px) scale(${k})`;
}
addEventListener('resize', fit);

const tzOf = () => (store && store.tz) || 'Australia/Melbourne';
function testNow() {
  if (testTime) return testTime;
  if (!params.now) return undefined;
  return parseTestTime(params.now, storeNow(tzOf()).day) || undefined;
}
const nowForStore = () => testNow() || storeNow(tzOf());
/** The store's date ({y, m, d}): which season the Seasonal promotion plays. */
const todayForStore = () => { const real = storeDate(tzOf()); return (params.date && parseTestDate(params.date, real.y)) || real; };

function stateKey() {
  const s = storeState(store.sessions, nowForStore());
  return [s.state, s.openTime, s.closeTime].join('|');
}

function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function show(i, enter) {
  const seq = sequence(play);
  scene = ((i % seq.length) + seq.length) % seq.length;
  // An occasion is one continuous animation: while playing, its beats loop in CSS (12 s) with no timers or redraws.
  const loop = playing && play.base === 'occasion';
  if (loop) scene = 0;
  last = renderScene(el, { store, play, orientation: params.orientation, scene, now: testNow(), enter, loop });
  lastStateKey = stateKey();
  shown = 'scene';
  clearTimers();
  if (!playing || loop) return;
  const t = seq[scene].t * 1000;
  timers.push(setTimeout(() => el.classList.add('leaving'), Math.max(0, t - 250)));
  timers.push(setTimeout(() => show(scene + 1, true), t));
}

function message(title, detail, opts) {
  clearTimers();
  play = null;
  shown = 'message';
  renderMessage(el, params.orientation, title, detail, opts);
}

function notSetUp(detail, logo) {
  clearTimers();
  play = null;
  shown = 'not-set-up';
  renderNotSetUp(el, { orientation: params.orientation, title: 'Screen not set up', detail, device: params.device, logo });
}

function fail(e) {
  if (e instanceof ScreenError && e.code === 'not-set-up') notSetUp(e.detail);
  else if (e instanceof ScreenError) message(e.title, e.detail);
  else message('Screen data could not load', String((e && e.message) || e));
}

// Copy is fitted to the panel by measuring it, so wait (up to 3 s) for the fonts before the first scene.
async function fontsReady() {
  if (fontsWaited) return;
  fontsWaited = true;
  const fonts = (document.fonts && document.fonts.ready) || Promise.resolve();
  let fontsIn = false;
  await Promise.race([fonts.then(() => { fontsIn = true; }), new Promise((r) => setTimeout(r, 3000))]);
  if (!fontsIn) fonts.then(() => { if (play) show(scene, false); });
}

/** Render what the data says, called only when it changed. */
async function apply(s) {
  const v = screenView(s);
  if (v.kind === 'invalid') return message('Invalid screen URL', 'This screen’s campaign URL has no valid device ID.');
  if (v.kind === 'not-set-up') {
    const logo = s.campaign && s.campaign.store_info ? s.campaign.store_info.logo_url : null;
    return notSetUp(v.reason === 'store' ? `Store ${v.storeCode} has no screen content yet.` : 'This device is not linked to a store in Personalisation Hub.', logo);
  }
  if (v.kind === 'offline') return message('Screen data could not load', 'No server answered. The screen will keep trying.', { badge: 'Offline · retrying' });
  if (v.kind !== 'ready') return;
  let nextStore, nextPlay;
  try {
    nextStore = storeModel(s.campaign, s.config);
    const promoId = params.promo || ((s.config.promotions || [])[0] || {}).promoId || ((s.config.promotions || [])[0] || {}).id;
    nextPlay = resolvePromotion(s.config, nextStore, promoId, { today: todayForStore() });
  } catch (e) { fail(e); return; }
  const first = !started || shown !== 'scene';
  config = s.config; store = nextStore; play = nextPlay;
  if (first) {
    started = true;
    await fontsReady();
    if (!play) return; // replaced by a message while the fonts loaded
    show(params.hold === null ? 0 : params.hold, true);
  } else {
    // New data for the same screen: redraw the current scene in place, the loop carries on.
    show(scene, false);
  }
}

function debugInfo(s) {
  const f = [s.lastStore, s.lastConfig].filter(Boolean);
  const failing = f.some((x) => x.kind === 'down');
  const health = !f.length ? 'wait' : failing ? (s.campaign ? 'warn' : 'bad') : s.lastStore && s.lastStore.kind !== 'ok' ? 'bad' : 'ok';
  const latest = [s.lastStore, s.lastConfig].filter((x) => x && x.server !== null && x.server !== undefined).sort((a, b) => b.at - a.at)[0];
  const t = store || s.campaign ? nowForStore() : null;
  return {
    device: params.device,
    storeCode: s.storeCode,
    source: s.mock ? 'Mock fixtures (mockapi=1)' : s.fromCache ? 'Last good data (cached)' : 'Live',
    lastStore: s.lastStore,
    lastConfig: s.lastConfig,
    server: latest ? latest.server : null,
    health,
    storeTime: t,
    barState: store ? storeState(store.sessions, nowForStore()).state : null,
    testTime: testNow() || null,
  };
}

// The "Open today" bar follows the store's clock (store_timezone): re-check at the turn of every minute.
function minuteTick() {
  // (A season shows nothing that depends on the store's hours: no redraw, so its loop carries on, until its dates
  // end or another season's begin: then the season for the new date starts, with nobody needing to change anything.)
  if (play && store && play.base === 'occasion' && playing) {
    let next = null;
    try { next = resolvePromotion(config, store, play.promoId, { today: todayForStore() }); } catch (e) { next = null; }
    if (next && next.occasion !== play.occasion) { play = next; show(0, true); }
  } else if (play && store && play.base !== 'occasion' && stateKey() !== lastStateKey) show(scene, false);
  if (panel && data) panel.then((p) => p && p.update(debugInfo(data.state)));
  setTimeout(minuteTick, 60000 - (Date.now() % 60000) + 50);
}

function start() {
  fit();
  if (params.debug) {
    panel = createDebugPanelLazy();
  }
  if (!params.device) {
    message('Invalid screen URL', 'This screen’s campaign URL has no device ID.');
    if (panel) panel.then((p) => p && p.update(debugInfo({ mock: params.mock })));
    return;
  }
  const client = params.mock ? createMockClient() : createLiveClient({ servers: parseServers(meta && meta.content) });
  let storage = null;
  try { storage = window.localStorage; } catch (e) { storage = null; }
  data = createScreenData({
    client,
    device: params.device,
    storage,
    onUpdate: (s, changed) => {
      if (changed) apply(s);
      if (panel) panel.then((p) => p && p.update(debugInfo(s)));
    },
  });
  data.start();
  setTimeout(minuteTick, 60000 - (Date.now() % 60000) + 50);
}

// The debug panel is loaded only with debug=1, so the PH player never fetches it.
function createDebugPanelLazy() {
  return import('./debug-panel.js').then(({ createDebugPanel }) => createDebugPanel(document, {
    onTestTime(t) {
      testTime = t;
      if (play && play.base !== 'occasion') show(scene, false);
      if (data) panel.then((p) => p && p.update(debugInfo(data.state)));
    },
  })).catch(() => null);
}

// Hook for the overflow audit, the screen tests and the admin editor's tests.
window.pharmacyScreen = {
  get ready() { return !!play || !!el.querySelector('.s-msg,.s-setup-body'); },
  get info() { return play ? { store: store.code, promo: play.promoId, base: play.base, occasion: play.occasion || null, auto: !!play.auto, scene, scenes: sequence(play).map((s, i) => sceneName(play, i)), fit: last && last.fit, state: last && last.state.state } : null; },
  get data() { return data ? JSON.parse(JSON.stringify({ storeCode: data.state.storeCode, deviceStatus: data.state.deviceStatus, configStatus: data.state.configStatus, fromCache: data.state.fromCache, lastStore: data.state.lastStore, lastConfig: data.state.lastConfig, view: screenView(data.state).kind })) : null; },
  promotions: () => (config ? config.promotions.map((p) => p.promoId || p.token || p.id) : []),
  occasions: () => OCCASION_IDS.slice(),
  /** Stop playback and show one promotion's scene, exactly as it renders after its entrance (an occasion: beat i,
   *  held still). `occasion`: play that occasion on an occasion promotion (the copy-fit audit checks every one). */
  show(promoId, i, occasion) {
    playing = false;
    clearTimers();
    play = resolvePromotion(config, store, promoId, { occasion });
    show(i, false);
    return this.info;
  },
  /** Resolves once what is on screen is final (an occasion: its fonts are in and its copy refitted). */
  settled() { return last && last.ready ? last.ready.then(() => true) : Promise.resolve(true); },
  audit() { return last ? auditScene(el, last.G) : ['nothing rendered']; },
};

start();
