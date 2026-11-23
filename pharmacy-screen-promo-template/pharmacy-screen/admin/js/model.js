// Admin editor data model. No DOM: runs under `node --test` (test/admin-model.test.mjs).
//
// The editor works on the config API's records (config-api/README.md → "Data model"):
//   pharmacy  {id, storeCode, name, colours {primary, accent}, logo {url} | null, content {<promotion record id>: {...}},
//              detached? {<promotion record id>: [master section id, …]}, tokens? {<token name>: text}, version}
//   promotion {id, name, promoId, templateId, schedule? {type 'annual', from 'MM-DD', to 'MM-DD'}, master? {...}, version}
//   template  {id, name, kind 'promotion-scenes' | 'opening-hours' | 'occasion', occasion?, builtIn, html, css, backgrounds {portrait, landscape}}
//   service   {id, label, icon, category, headline, accent, line1, line2, offeredBy [store codes]}
// and maps them to the shape the shared render engine (../js/render.js) takes, so the live preview draws
// exactly what a screen draws.

import { defaultContent, occasionCopy, OCCASIONS, OCCASION_IDS, DEFAULT_OCCASION, DEFAULT_HTML, footerConfig, beatSeconds, defaultHeadlineSeconds, sceneSeconds, fmtMonthDay, seasonDates, liveOccasion, occasionOf } from '../../js/render.js';
import { storeDate } from '../../js/hours.js';
import { DATA_TOKENS, isSettableToken, tokensIn, cleanTokens } from '../../js/tokens.js';

export const BUILTIN_SCENES = 'builtin-promotion-scenes';
export const BUILTIN_HOURS = 'builtin-opening-hours';
// The six seasonal templates (config-api/src/builtins.js; internally "occasion"), picked by the Seasonal promotion's
// Season drop-down.
export const occasionTemplateId = (occasion) => 'builtin-occasion-' + occasion;
export const BUILTIN_OCCASION = occasionTemplateId(DEFAULT_OCCASION);
export const OCCASION_CHOICES = OCCASIONS.map((o) => ({ id: o.id, name: o.name, templateId: occasionTemplateId(o.id), signOff: o.beats.some((b) => /\$\{StoreName\}/.test(b.text)) }));
/**
 * A season's line in the Season drop-down: its name, then its start and end dates this year in brackets, as in
 * "Christmas (15 Dec – 27 Dec)" (one date when it starts and ends on the same day: "Australia Day (26 Jan)").
 * The dates are the ones the screen uses (seasonDates): those saved on the season's copy in `occasions`
 * (content.occasions), else its defaults; Easter's are worked out for `year`.
 */
export function seasonOptionLabel(id, occasions, year = new Date().getFullYear()) {
  const o = OCCASIONS.find((x) => x.id === id);
  if (!o) return '';
  // The fallback has no dates: it plays whenever no season is on.
  if (o.fallback) return o.name;
  const r = seasonDates(id, occasions && occasions[id], year), from = fmtMonthDay(r.from), to = fmtMonthDay(r.to);
  return from && to ? `${o.name} (${from}${to !== from ? ' – ' + to : ''})` : o.name;
}
const RENDER_BUILTIN = { [BUILTIN_SCENES]: 't_scenes', [BUILTIN_HOURS]: 't_hours', ...Object.fromEntries(OCCASION_IDS.map((id) => [occasionTemplateId(id), 't_occ_' + id])) };

/** 'scenes', 'hours' or 'occasion' for a template kind. */
export const baseOfKind = (kind) => (kind === 'opening-hours' ? 'hours' : kind === 'occasion' ? 'occasion' : 'scenes');
export const kindOfBase = (base) => (base === 'hours' ? 'opening-hours' : base === 'occasion' ? 'occasion' : 'promotion-scenes');
export const builtInForKind = (kind) => (kind === 'opening-hours' ? BUILTIN_HOURS : kind === 'occasion' ? BUILTIN_OCCASION : BUILTIN_SCENES);
/** The occasion an occasion template plays ('christmas', …), or '' for any other template. */
export const occasionOfTemplate = (id) => (OCCASION_IDS.find((o) => occasionTemplateId(o) === id) || '');

export const findTemplate = (templates, id) => (templates || []).find((t) => t.id === id) || (templates || []).find((t) => t.id === BUILTIN_SCENES) || null;
export const baseOfTemplate = (templates, id) => {
  if (id === BUILTIN_HOURS) return 'hours';
  if (occasionOfTemplate(id)) return 'occasion';
  const t = (templates || []).find((x) => x.id === id);
  return t ? baseOfKind(t.kind) : 'scenes';
};

export const clone = (v) => JSON.parse(JSON.stringify(v));
const S = (label, icon, title, sub, line1, line2) => ({ label, icon, title, sub, line1, line2 });
const CLOSE = () => ({ title: 'Walk in today', sub: 'Speak directly with a pharmacist', line1: 'We look forward to seeing you', line2: 'Trusted local care' });

// A new pharmacy's starting content, as the prototype's newStore(): morning / afternoon / closed copy for the
// three default promo IDs, the render engine's defaults for anything else.
const NEW_CONTENT = {
  morning: () => ({ greeting: 'Good morning,<br>${Suburb}', introTitle: 'Three reasons to walk in', introSub: 'No fuss. Just ask in store.', slots: [
    S('Blood pressure', 'monitor_heart', 'Blood pressure checks', 'Free, as often as you like', 'Know your numbers', 'Pop in this morning'),
    S('MedsCheck', 'pill', 'MedsCheck', 'Know your medicines better', 'Sit down with your pharmacist', 'Review your medicines together'),
    S('Medicine packs', 'calendar_month', 'Weekly medicine packs', 'Sorted for you', 'The right dose, every day', 'Ask us to set one up')], close: CLOSE() }),
  afternoon: () => ({ greeting: 'Good afternoon,<br>${Suburb}', introTitle: 'Three reasons to walk in', introSub: 'No fuss. Just ask in store.', slots: [
    S('Vaccinations', 'vaccines', 'Vaccinations', 'No appointment needed', 'Flu and other vaccines', 'Given by our trained pharmacists'),
    S('Scripts', 'prescriptions', 'Script on File', 'Reorder without the paper', 'We keep your scripts safe', 'Ask us how'),
    S('Advice', 'medical_services', 'Ask a pharmacist', 'Free health advice', 'No appointment needed', 'Talk to us on your way home')], close: CLOSE() }),
  closed: () => ({ headlines: ["Sorry, we're closed", 'Serving ${Suburb}', 'Public Holidays:<br><span class="reg">Please call to confirm</span>'], showAddress: false }),
  occasions: () => defaultContent('occasion'),
};

/** Starting content for one promotion of a new pharmacy: the promotion's master template when it has one. */
export function newContentFor(promotion, base) {
  if (promotion && promotion.master && typeof promotion.master === 'object') return ensureContent(promotion.master, base);
  const make = NEW_CONTENT[promotion && promotion.promoId];
  const c = make ? make() : defaultContent(base);
  return ensureContent(c, base);
}

/**
 * Content holding the fields its template needs. A promotion's content keeps the fields of both template
 * kinds once it has had both (scenes: greeting, slots, close, footer; opening hours: headlines, showAddress),
 * so switching a promotion's template and back loses nothing. Returns a new object.
 */
export function ensureContent(content, base) {
  const c = content && typeof content === 'object' ? clone(content) : {};
  const def = defaultContent(base);
  if (base === 'occasion') {
    // Every occasion's copy is kept, so switching occasion and back loses nothing. Each is {beats: [{label?, text}]}:
    // copy saved in the old three-scene shape becomes beats (render.js occasionCopy: unedited, the new defaults).
    if (!c.occasions || typeof c.occasions !== 'object' || Array.isArray(c.occasions)) c.occasions = {};
    for (const id of OCCASION_IDS) c.occasions[id] = occasionCopy(id, c.occasions[id]);
  } else if (base === 'hours') {
    if (!Array.isArray(c.headlines) || !c.headlines.length) c.headlines = def.headlines;
    while (c.headlines.length < 3) c.headlines.push('');
    if (typeof c.showAddress !== 'boolean') c.showAddress = false;
  } else {
    if (!Array.isArray(c.slots)) { c.slots = def.slots; if (c.greeting === undefined) c.greeting = def.greeting; }
    for (const k of ['greeting', 'introTitle', 'introSub']) if (typeof c[k] !== 'string') c[k] = def[k];
    if (!c.close || typeof c.close !== 'object') c.close = def.close;
  }
  return c;
}

/** Content for every promotion of a new pharmacy, keyed by promotion record id. */
export function newPharmacyContent(promotions, templates) {
  const out = {};
  for (const p of promotions || []) out[p.id] = newContentFor(p, baseOfTemplate(templates, p.templateId));
  return out;
}

// ── master template (requirement 23) ──
// A promotion's `master` is the content every pharmacy inherits; a pharmacy's `detached[promotion id]` lists the
// sections it manages itself. The config API resolves the same way when it publishes a screen
// (config-api/src/inherit.js — keep the two section maps equal; test/admin-model.test.mjs checks they are).

export const MASTER_SECTIONS = {
  greeting: ['greeting', 'introTitle', 'introSub', 'introDur'],
  slots: ['slots'],
  close: ['close'],
  headlines: ['headlines', 'headlineDurs'],
  address: ['showAddress'],
  occasions: ['occasions'],
  footer: ['footer'],
};
const SECTION_OF_KEY = Object.fromEntries(Object.entries(MASTER_SECTIONS).flatMap(([s, keys]) => keys.map((k) => [k, s])));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The editor's name for each section, as its card reads. */
export const SECTION_NAMES = { greeting: 'Greeting', slots: 'Promotion slots', close: 'Walk-in close', headlines: 'Headlines', address: 'Address', occasions: 'Seasonal copy and dates', footer: 'Open today bar' };

/** The master sections a template kind shows, in the order the editor draws them. */
export const sectionsForBase = (base) => (base === 'hours' ? ['headlines', 'address'] : base === 'occasion' ? ['occasions'] : ['greeting', 'slots', 'close', 'footer']);

/** What a pharmacy plays for one promotion: the master's sections, with its own copy of each detached section. */
export function effectiveContent(master, own, detached) {
  const mine = isObj(own) ? own : {};
  if (!isObj(master)) return clone(mine);
  const det = new Set(Array.isArray(detached) ? detached : []);
  const out = clone(master);
  for (const s of det) for (const k of MASTER_SECTIONS[s] || []) delete out[k];
  for (const [k, v] of Object.entries(mine)) { const s = SECTION_OF_KEY[k]; if (!s || det.has(s)) out[k] = clone(v); }
  return out;
}

/** Today's date in this browser, as {y, m, d}. */
export const localToday = (now = new Date()) => ({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
/**
 * Today's date at the store, as {y, m, d}: the date the screens go by (js/hours.js storeDate, the store's time zone,
 * Australia/Melbourne when it is not known, as on the screen). The editor uses it for "Activate on display" and for
 * what is on display, so an admin in another time zone, or near midnight, sees and sets what the screens play.
 */
export const storeToday = (tz, now = new Date()) => storeDate(tz, now);
/**
 * What a Seasonal promotion plays on `today` for this content (js/render.js liveOccasion, as the screen works it out):
 * a running "Activate on display" (content.activation), else the season whose dates hold today, else the fallback.
 * The old Season pick (content.season, before 23 Nov 2026) no longer counts. `p` is unused, kept for callers.
 */
export const seasonOf = (p, ownContent, today = storeToday()) => liveOccasion(isObj(ownContent) ? ownContent : {}, today);

/**
 * Seasonal content is each pharmacy's own (config-api/src/seasonal.js, which this mirrors): its season, and every
 * season's copy, dates and timings. A pharmacy that has not got its own yet takes what it plays now (the master's),
 * in place, exactly as the server does on the next write. Returns `ph`.
 */
export function ownSeasonal(ph, promotions) {
  if (!ph || ph.isMaster) return ph;
  for (const p of promotions || []) {
    const fallback = occasionOfTemplate(p.templateId);
    if (!fallback) continue;
    const all = ph.content || (ph.content = {});
    const own = isObj(all[p.id]) ? all[p.id] : (all[p.id] = {});
    const det = detachedOf(ph, p.id);
    const hasCopy = isObj(own.occasions) && (OCCASION_IDS.includes(own.season) || det.includes('occasions'));
    if (!hasCopy) {
      const playing = effectiveContent(p.master, own, det.filter((s) => s !== 'occasions'));
      if (isObj(playing.occasions)) own.occasions = playing.occasions;
    }
    if (!OCCASION_IDS.includes(own.season)) own.season = fallback;
    if (!det.includes('occasions')) ph.detached = setDetached(ph, p.id, 'occasions', true);
  }
  return ph;
}

/** The sections pharmacy `ph` manages itself for promotion `promotionId`. */
export const detachedOf = (ph, promotionId) => ((ph && ph.detached && ph.detached[promotionId]) || []).slice();

/** `ph.detached` with section `sec` of `promotionId` detached (on) or inherited again (off). Returns a new object. */
export function setDetached(ph, promotionId, sec, on) {
  const all = clone((ph && ph.detached) || {});
  const list = new Set(all[promotionId] || []);
  if (on) list.add(sec); else list.delete(sec);
  const clean = Object.keys(MASTER_SECTIONS).filter((s) => list.has(s));
  if (clean.length) all[promotionId] = clean; else delete all[promotionId];
  return all;
}

/**
 * Copy the master's value of every inherited section into `content` (in place), so the editor and its preview
 * show what the screen plays. Detached sections are left alone. Returns `content`.
 */
export function syncInherited(content, master, detached) {
  if (!isObj(master) || !isObj(content)) return content;
  const det = new Set(detached || []);
  for (const [s, keys] of Object.entries(MASTER_SECTIONS)) {
    if (det.has(s)) continue;
    for (const k of keys) { if (k in master) content[k] = clone(master[k]); else delete content[k]; }
  }
  return content;
}

/** The default promotion's name before it was renamed Seasonal (20 Nov 2026), and its name now. */
export const LEGACY_SEASONAL_NAME = 'Occasions';
export const SEASONAL_NAME = 'Seasonal';
/** A seasonal promotion still carrying the old default name shows (and is saved, on its next save) as Seasonal. */
export function renameLegacy(p) {
  if (p && p.name === LEGACY_SEASONAL_NAME && occasionOfTemplate(p.templateId)) p.name = SEASONAL_NAME;
  return p;
}

/** Promotions in the order the editor shows them: the four defaults first, then by creation. */
export function orderPromotions(promotions) {
  const rank = { morning: 0, afternoon: 1, closed: 2, occasions: 3 };
  for (const p of promotions || []) renameLegacy(p);
  return [...(promotions || [])].sort((a, b) => (rank[a.promoId] ?? 9) - (rank[b.promoId] ?? 9) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.name).localeCompare(String(b.name)));
}

const mediaUrl = (m) => (m && typeof m.url === 'string' ? m.url : null);

/**
 * Admin records -> the render engine's config: {promotions, templates, pharmacies}. `contentOf(pharmacy)`
 * may supply a pharmacy's full content (the list endpoint leaves it out).
 */
export function renderConfig({ pharmacies = [], promotions = [], templates = [] }) {
  const customs = templates.filter((t) => !t.builtIn && !RENDER_BUILTIN[t.id]);
  return {
    // A Seasonal promotion plays the pharmacy's own season (seasonOf), where the config is one pharmacy's.
    promotions: promotions.map((p) => {
      const one = pharmacies.length === 1 && occasionOfTemplate(p.templateId) ? pharmacies[0] : null;
      const tid = one ? occasionTemplateId(seasonOf(p, one.content && (one.content[p.id] || one.content[p.promoId]))) : p.templateId;
      return { id: p.promoId, promoId: p.promoId, name: p.name, template: RENDER_BUILTIN[tid] || tid };
    }),
    templates: customs.map((t) => ({
      id: t.id, name: t.name, base: baseOfKind(t.kind), html: t.html || '', css: t.css || '',
      bgPortrait: mediaUrl(t.backgrounds && t.backgrounds.portrait), bgLandscape: mediaUrl(t.backgrounds && t.backgrounds.landscape),
    })),
    pharmacies: pharmacies.map((ph) => ({
      storeCode: ph.storeCode, name: ph.name,
      brand: { p: (ph.colours && ph.colours.primary) || '#0f1050', a: (ph.colours && ph.colours.accent) || '#5ee6b0' },
      logo: mediaUrl(ph.logo),
      content: Object.fromEntries(promotions.filter((p) => ph.content && ph.content[p.id]).map((p) => [p.promoId, ph.content[p.id]])),
      tokens: cleanTokens(ph.tokens),
    })),
  };
}

// Store data for the preview when no device has been looked up for this pharmacy yet: a plain week, no
// suburb (so ${Suburb} blanks, as on a screen whose store has none).
export function sampleCampaign(storeCode, name) {
  const H = (d, o, c) => ({ open_day: d, open_time: o + ':00', close_day: d, close_time: c + ':00', is_active: true });
  return { data: {
    store_location: { store_code: storeCode, store_name: name || '', store_timezone: 'Australia/Melbourne' },
    store_info: {
      opening_hours: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'].map((d) => H(d, '09:00', '17:30')).concat([H('SATURDAY', '09:00', '13:00')]),
      address_info: { suburb: '', address: '', postcode: '', state: '', phone_number: '' },
    },
  } };
}

/** A Location API response re-pointed at this pharmacy's store code, so the render engine finds its config. */
export function campaignForPreview(record, storeCode, name) {
  if (!record) return sampleCampaign(storeCode, name);
  const c = clone(record.data ? record : { data: record });
  c.data.store_location = { ...(c.data.store_location || {}), store_code: storeCode };
  return c;
}

// The master template has no store of its own, so its preview shows the data tokens as written: ${StoreName},
// ${Suburb} and ${Phone} appear in the copy exactly as typed, making clear the master carries them. ${CloseTime} /
// ${OpenTime} keep the sample hours' times (the "Open today bar in the preview" tabs). Preview only: nothing saved.
export const MASTER_PREVIEW_TOKENS = { Suburb: '${Suburb}', Phone: '${Phone}' };

/** The pharmacy record the editor's preview draws: a pharmacy as it is; the master template with its tokens as written. */
export function previewPharmacy(ph) {
  if (!ph || !ph.isMaster) return ph;
  return { ...ph, name: '${StoreName}', tokens: { ...cleanTokens(ph.tokens), ...MASTER_PREVIEW_TOKENS } };
}

/** The read-only store fields Settings shows, with their paths in the Location API response. */
export function storeFields(record) {
  const d = (record && (record.data || record)) || {};
  const loc = d.store_location || {}, info = d.store_info || {}, a = info.address_info || {};
  return [
    { label: 'Store code', path: 'store_location.store_code', value: loc.store_code },
    { label: 'Store name', path: 'store_location.store_name', value: loc.store_name },
    { label: 'Suburb', path: 'store_info.address_info.suburb', value: a.suburb },
    { label: 'Timezone', path: 'store_location.store_timezone', value: loc.store_timezone },
    { label: 'Phone', path: 'store_info.address_info.phone_number', value: a.phone_number },
    { label: 'Address', path: 'store_info.address_info.address', value: [a.address, a.state, a.postcode].filter(Boolean).join(', ') },
  ].map((f) => ({ ...f, value: f.value == null ? '' : String(f.value) }));
}

// A promotion's schedule. "No schedule" is the default (Personalisation Hub Core decides when it plays); "Annual" adds a
// start and an end date (month and day, inclusive) that repeat every year. A record without one has no schedule.
export const SCHEDULE_TYPES = [{ id: 'none', name: 'No schedule' }, { id: 'annual', name: 'Annual' }];
const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function scheduleOf(p) {
  const s = p && p.schedule;
  return s && s.type === 'annual' && MONTH_DAY.test(s.from) && MONTH_DAY.test(s.to) ? { type: 'annual', from: s.from, to: s.to } : { type: 'none' };
}
/** The dates a promotion switched to Annual starts with: today to the last day of the year. */
export function defaultAnnual(now = new Date()) {
  return { type: 'annual', from: String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'), to: '12-31' };
}
export const scheduleText = (s) => {
  const x = scheduleOf({ schedule: s });
  return x.type === 'annual' ? `Every year, ${fmtMonthDay(x.from)}${x.to !== x.from ? ' to ' + fmtMonthDay(x.to) : ''}` : 'No schedule';
};

export const slug = (v) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** '' or why this promo ID can't be used (the config API checks the same, and uniqueness, on save). */
export function promoIdError(id, promotions, selfId) {
  if (!id) return 'Add a promo ID.';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return 'Use lower-case letters, digits and hyphens.';
  const other = (promotions || []).find((p) => p.id !== selfId && p.promoId === id);
  return other ? `Promo ID ${id} is already used by another promotion.` : '';
}

export const normStoreCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');

/** The store code an `admin/?store=<code>` (or `?storeCode=<code>`) link opens the editor locked to (the pharmacy
 *  view), normalised like a typed store code; `store` wins if both are set. Null when the link has neither. */
export function storeFromQuery(search) {
  const q = new URLSearchParams(search || '');
  return normStoreCode(q.get('store') || q.get('storeCode')) || null;
}

/** '' or why this store code can't be used. */
export function storeCodeError(code, pharmacies, selfId) {
  if (!code) return 'Add a store code. The Location API returns it for this pharmacy’s screens.';
  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) return 'Store codes are 2-32 letters, digits and hyphens, e.g. VIC-MP-006.';
  return (pharmacies || []).some((p) => p.id !== selfId && p.storeCode === code) ? `Store code ${code} is already used by another pharmacy.` : '';
}

/** A library service as a new scene slot. */
export const serviceToSlot = (s) => ({ label: s.label, icon: s.icon || 'medical_services', title: s.headline || s.label, sub: s.accent || '', line1: s.line1 || '', line2: s.line2 || '', svc: s.id });
export const blankSlot = () => S('New service', 'medical_services', 'New promotion', 'Accent line', 'Line 1', 'Line 2');

/** The service library filtered by search text and, optionally, to services this store offers. Grouped by category. */
export function filterServices(services, { q = '', storeCode = '', mine = true } = {}) {
  const t = String(q).trim().toLowerCase();
  const list = (services || []).filter((s) => (!mine || (s.offeredBy || []).includes(storeCode)) && (!t || `${s.label} ${s.headline} ${s.category}`.toLowerCase().includes(t)));
  const cats = [...new Set(list.map((s) => s.category || 'Other'))];
  return cats.map((c) => ({ category: c, services: list.filter((s) => (s.category || 'Other') === c) }));
}

/** The campaign URL Personalisation Hub plays. The player swaps ${UniqueDeviceID} for each screen's ID. */
export const templateUrl = (screenPage, promoId, orientation) => `${screenPage}?device=\${UniqueDeviceID}&promo=${promoId}&orientation=${orientation === 'landscape' ? 'landscape' : 'portrait'}`;

/** Seconds each opening-hours headline shows: its own (headlineDurs[i]) or the default (2.7, 2.7, 2.6 for three). */
export const headlineSeconds = (d) => { const n = (d.headlines || []).length || 1, durs = Array.isArray(d.headlineDurs) ? d.headlineDurs : []; return defaultHeadlineSeconds(n).map((t, i) => sceneSeconds(durs[i], t)); };

const sum = (a) => Math.round(a.reduce((x, y) => x + y, 0) * 1000) / 1000;
/**
 * Total loop length (seconds) of a promotion's content: one occasion's copy ({beats}: each beat's seconds, 12 s at
 * the defaults), an opening-hours promotion's headlines (base 'hours'), or a scenes promotion's greeting, slots and
 * close.
 */
export const loopSeconds = (d, base, occasion) => (Array.isArray(d.beats) ? (occasion && occasionOf(occasion).id === occasion && occasionOf(occasion).durs ? sum(occasionOf(occasion).durs) : sum(d.beats.map((b) => beatSeconds(b, d.beats.length))))
  : base === 'hours' ? sum(headlineSeconds(d))
  : (+d.introDur || 3) + (d.slots || []).reduce((a, x) => a + (+x.dur || 2), 0) + (+(d.close && d.close.dur) || 2));

/** Seconds to enter as the campaign's playback duration: the promotion's length plus one second, rounded up, so
 *  the last scene finishes before the player moves on. */
export const playbackSeconds = (total) => Math.ceil(Math.round(((+total || 0) + 1) * 1000) / 1000);
/** The setup tooltip beside "Playback duration". */
export const playbackHelp = (n) => `To run this promotion, open the campaign's Creative tab, turn on Experience URL and paste this URL in. Set the playback duration to ${n} seconds, which is one second longer than the promotion so the last scene finishes. Then save and activate the campaign to put it live.`;
/** Scene durations are 1-60 seconds; anything else falls back to the default. */
export const clampDur = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(60, n)) : undefined; };

/**
 * What changed on pharmacy `ph` since `sent` (the body posted to create it) was taken: whether its details
 * (name, store code, colours) differ, and the ids of the promotions whose content differs.
 */
export function editsSince(sent, ph) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const details = !same(sent.name, ph.name) || !same(sent.storeCode, ph.storeCode) || !same(sent.colours, ph.colours);
  const was = sent.content || {}, now = ph.content || {};
  const content = Object.keys(now).filter((id) => !same(was[id], now[id]));
  return { details, content };
}

// ── tokens set by hand (Settings → Tokens) ──

/** What each data token shows when it is not set by hand (the Tokens card's placeholders). */
export const TOKEN_SOURCES = {
  Suburb: 'Suburb from store details',
  Phone: 'Phone number from store details',
  State: 'State from store details',
  StoreCode: 'Store code from store details',
};

// The Open today bar's messages, unless the bar is hidden.
const footerOf = (c) => { const f = footerConfig(c); return f.show === false ? [] : [f.open, f.closing, f.before, f.closed]; };
const strings = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
};

/**
 * The tokens pharmacy `ph` can set by hand: every settable ${Token} its screens use, in the copy each promotion
 * plays for it (the master template's sections it inherits and its own) and in each promotion's template HTML,
 * plus any token it has a value for that nothing uses any more (so it can be cleared). Data tokens first, in
 * DATA_TOKENS order, then the others by name. Returns [{name, data, value, promotions: [promotion name, …]}].
 */
export function usedTokens(ph, promotions, templates) {
  const uses = new Map();
  const add = (name, promoName) => {
    if (!isSettableToken(name)) return;
    if (!uses.has(name)) uses.set(name, []);
    if (promoName && !uses.get(name).includes(promoName)) uses.get(name).push(promoName);
  };
  for (const p of orderPromotions(promotions)) {
    const base = baseOfTemplate(templates, p.templateId);
    // What the screen plays (js/render.js resolvePromotion): the effective content, or the template's defaults
    // where it does not fit the template.
    let c = effectiveContent(p.master, ph && ph.content && ph.content[p.id], detachedOf(ph, p.id));
    if (base === 'hours' ? !Array.isArray(c.headlines) : base === 'scenes' && !Array.isArray(c.slots)) c = defaultContent(base);
    let copy;
    if (base === 'occasion') {
      const occ = seasonOf(p, ph && ph.content && ph.content[p.id]), o = c.occasions && c.occasions[occ];
      copy = [occasionCopy(occ, o)]; // an occasion has no Open today bar
    } else if (base === 'hours') copy = [c.headlines];
    else copy = [c.greeting, c.introTitle, c.introSub, c.slots, c.close, footerOf(c)];
    const t = (templates || []).find((x) => x.id === p.templateId);
    const html = (t && !t.builtIn && t.html) || DEFAULT_HTML[base] || '';
    for (const s of [...strings(copy), html]) for (const name of tokensIn(s)) add(name, p.name);
  }
  const values = cleanTokens(ph && ph.tokens);
  for (const name of Object.keys(values)) add(name);
  const rank = (n) => (DATA_TOKENS.includes(n) ? DATA_TOKENS.indexOf(n) : DATA_TOKENS.length);
  return [...uses.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((name) => ({ name, data: DATA_TOKENS.includes(name), value: values[name] || '', promotions: uses.get(name) }));
}

/** `ph.tokens` with `name` set to `value` (blank removes it, so the store's data shows again). Returns a new object. */
export function setToken(ph, name, value) {
  const all = { ...((ph && ph.tokens) || {}) };
  const v = String(value ?? '');
  if (v.trim()) all[name] = v; else delete all[name];
  return all;
}
