// Admin editor data model. No DOM: runs under `node --test` (test/admin-model.test.mjs).
//
// The editor works on the config API's records (config-api/README.md → "Data model"):
//   pharmacy  {id, storeCode, name, colours {primary, accent}, logo {url} | null, content {<promotion record id>: {...}}, version}
//   promotion {id, name, promoId, templateId, version}
//   template  {id, name, kind 'promotion-scenes' | 'opening-hours', builtIn, html, css, backgrounds {portrait, landscape}}
//   service   {id, label, icon, category, headline, accent, line1, line2, offeredBy [store codes]}
// and maps them to the shape the shared render engine (../js/render.js) takes, so the live preview draws
// exactly what a screen draws.

import { defaultContent } from '../../js/render.js';

export const BUILTIN_SCENES = 'builtin-promotion-scenes';
export const BUILTIN_HOURS = 'builtin-opening-hours';
const RENDER_BUILTIN = { [BUILTIN_SCENES]: 't_scenes', [BUILTIN_HOURS]: 't_hours' };

/** 'scenes' or 'hours' for a template kind. */
export const baseOfKind = (kind) => (kind === 'opening-hours' ? 'hours' : 'scenes');
export const kindOfBase = (base) => (base === 'hours' ? 'opening-hours' : 'promotion-scenes');
export const builtInForKind = (kind) => (kind === 'opening-hours' ? BUILTIN_HOURS : BUILTIN_SCENES);

export const findTemplate = (templates, id) => (templates || []).find((t) => t.id === id) || (templates || []).find((t) => t.id === BUILTIN_SCENES) || null;
export const baseOfTemplate = (templates, id) => {
  if (id === BUILTIN_HOURS) return 'hours';
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
};

/** Starting content for one promotion of a new pharmacy. */
export function newContentFor(promotion, base) {
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
  if (base === 'hours') {
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

/** Promotions in the order the editor shows them: the three defaults first, then by creation. */
export function orderPromotions(promotions) {
  const rank = { morning: 0, afternoon: 1, closed: 2 };
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
    promotions: promotions.map((p) => ({ id: p.promoId, promoId: p.promoId, name: p.name, template: RENDER_BUILTIN[p.templateId] || p.templateId })),
    templates: customs.map((t) => ({
      id: t.id, name: t.name, base: baseOfKind(t.kind), html: t.html || '', css: t.css || '',
      bgPortrait: mediaUrl(t.backgrounds && t.backgrounds.portrait), bgLandscape: mediaUrl(t.backgrounds && t.backgrounds.landscape),
    })),
    pharmacies: pharmacies.map((ph) => ({
      storeCode: ph.storeCode, name: ph.name,
      brand: { p: (ph.colours && ph.colours.primary) || '#0f1050', a: (ph.colours && ph.colours.accent) || '#5ee6b0' },
      logo: mediaUrl(ph.logo),
      content: Object.fromEntries(promotions.filter((p) => ph.content && ph.content[p.id]).map((p) => [p.promoId, ph.content[p.id]])),
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

export const slug = (v) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** '' or why this promo ID can't be used (the config API checks the same, and uniqueness, on save). */
export function promoIdError(id, promotions, selfId) {
  if (!id) return 'Add a promo ID.';
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return 'Use lower-case letters, digits and hyphens.';
  const other = (promotions || []).find((p) => p.id !== selfId && p.promoId === id);
  return other ? `Promo ID ${id} is already used by another promotion.` : '';
}

export const normStoreCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');

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

/** Total loop length (seconds) of a scenes promotion's content. */
export const loopSeconds = (d) => (+d.introDur || 3) + (d.slots || []).reduce((a, x) => a + (+x.dur || 2), 0) + (+(d.close && d.close.dur) || 2);

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
