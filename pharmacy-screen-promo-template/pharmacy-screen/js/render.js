// Render engine for the pharmacy screen: one scene of one promotion for one store, in either orientation.
// Shared by the player page (pharmacy-screen.html) and the admin editor's live preview.
//
//   const store = storeModel(campaignData, config)          // Location API response + per-pharmacy config
//   const play  = resolvePromotion(config, store, 'morning') // promotion + its template + this store's content
//   const seq   = sequence(play)                              // [{k, t}] scenes and their seconds
//   renderScene(screenEl, { store, play, orientation: 'portrait', scene: 0, now, enter: true })

import { DAYS, parseOpeningHours, storeNow, storeState, fmtShort, weeklyRows } from './hours.js';
import { esc, rich, fill, timeTokens, fillTemplate, applyStoreName, cleanTokens, applyTokens, DATA_TOKENS } from './tokens.js';
import { geom, ptsPath, ptsClip, fitText, fitOccasion } from './fit-text.js';
import { OCCASION_DESIGNS, OCCASION_CSS } from './occasions.js';

// ---------- occasions ----------
// The "Occasions" promotion (promo=occasions) plays one of six read-only built-in templates, one per occasion.
// Which one is the promotion's template, picked in the admin editor's Occasion drop-down (no date logic). Each is a
// standalone, full-screen animation (js/occasions.js, the approved designs): no brand panel, logo, brand colours,
// icon tiles or Open today bar. Its copy plays as beats on a 12 s loop (Christmas 2 beats, the others 3); a beat is
// a main line and, where the design has one, a small label line (above it, or for Australia Day's last beat a pill
// below it). The copy is each pharmacy's own (content.occasions[<occasion>] = {beats: [{label?, text}]}), with
// ${Suburb} in all six and ${StoreName} in Christmas and New Year's. Anzac Day is commemorative: fades only.
// design: the template's key in js/occasions.js. fonts: what to load before fitting the copy (document.fonts.load).
const BT = (main, text, label) => ({ main, text, ...label });
const ABOVE = (cls, value, span) => ({ label: { cls, pos: 'above', span: !!span, value } });
const BELOW = (cls, value) => ({ label: { cls, pos: 'below', value } });
export const OCCASIONS = [
  {
    id: 'christmas', name: 'Christmas', design: 'christmas',
    fonts: ['italic 600 1em "Playfair Display"', '500 1em "Playfair Display"', '500 1em "Outfit"'],
    beats: [BT('hl', 'Merry Christmas, ${Suburb}'), BT('sub', 'from the whole ${StoreName} team', ABOVE('kicker', 'With warm wishes'))],
  },
  {
    id: 'new-year', name: "New Year's", design: 'newyear',
    fonts: ['900 1em "Big Shoulders Display"', '800 1em "Big Shoulders Display"', '400 1em "Outfit"'],
    beats: [BT('hl', 'Happy<br>New Year'), BT('sub', 'Thank you for a great year, ${Suburb}'), BT('sub sm', 'from the whole ${StoreName} team', ABOVE('kicker', "Here's to a healthy year ahead"))],
  },
  {
    id: 'australia-day', name: 'Australia Day', design: 'ausday',
    fonts: ['400 1em "Archivo Black"', '700 1em "Archivo"'],
    beats: [BT('hl', 'Happy Australia Day, ${Suburb}', ABOVE('kicker', '26 January', true)), BT('hl', 'Enjoy the sunshine'), BT('hl', 'Slip, slop, slap', BELOW('sub', 'Stay sun safe this summer'))],
  },
  {
    id: 'valentines-day', name: "Valentine's Day", design: 'valentine',
    fonts: ['italic 400 1em "DM Serif Display"', '500 1em "Outfit"'],
    beats: [BT('hl', "Happy Valentine's Day, ${Suburb}", ABOVE('kicker', '14 February')), BT('hl', 'Look after the ones you love'), BT('hl', 'and yourself, too')],
  },
  {
    id: 'easter', name: 'Easter', design: 'easter',
    fonts: ['600 1em "Fredoka"'],
    beats: [BT('hl', 'Happy Easter, ${Suburb}'), BT('hl', 'Wishing you a restful long weekend'), BT('hl', 'Take time to recharge')],
  },
  {
    id: 'anzac-day', name: 'Anzac Day', design: 'anzac', solemn: true,
    fonts: ['500 1em "Cormorant Garamond"', '600 1em "Cormorant Garamond"', 'italic 500 1em "Cormorant Garamond"'],
    beats: [BT('hl', 'Anzac Day', ABOVE('kicker', '25 April')), BT('hl', 'Lest we forget'), BT('sub', 'Remembering together, ${Suburb}')],
  },
];
export const OCCASION_IDS = OCCASIONS.map((o) => o.id);
export const DEFAULT_OCCASION = 'christmas';
/** One loop of an occasion's beats, in seconds (the designs' CSS animations). The playback duration is this + 1. */
export const OCCASION_LOOP = 12;
export const occasionOf = (id) => OCCASIONS.find((o) => o.id === id) || OCCASIONS[0];
/** The editor's name for each line of a beat: the label line by where the design puts it, and the main line. */
export const occasionFieldName = (beat, key) => (key === 'label' ? (beat.label && beat.label.pos === 'below' ? 'Line below' : 'Small line above') : 'Main line');
/** One occasion's default copy: {beats: [{label?, text}]}, a label only on the beats whose design has one. */
export const defaultOccasion = (id) => ({ beats: occasionOf(id).beats.map((b) => (b.label ? { label: b.label.value, text: b.text } : { text: b.text })) });

// The copy the occasion templates carried before the standalone designs (three scenes of headline, accent line,
// line 1, line 2): seed/fixtures/occasions-legacy.json holds the same, for the seed's upgrade of seeded pharmacies.
// Copy still equal to it (never edited) plays the new defaults; edited copy is kept and plays beat by beat, each
// scene's headline as the main line and its accent line as the label (where the beat has one).
const OS = (title, sub, line1, line2) => ({ title, sub, line1, line2 });
export const LEGACY_OCCASION_COPY = {
  christmas: [OS('Merry Christmas,<br>${Suburb}', '', "Season's greetings", 'From all of us, to all of you'), OS('Here for you<br>this season', 'Holiday hours may change', 'Please check our hours before you visit', 'Thank you for shopping local'), OS('Thank you,<br>${Suburb}', '', 'Merry Christmas from the whole ${StoreName} team.', '')],
  'new-year': [OS('Happy New Year,<br>${Suburb}', '', 'Wishing you a bright year ahead', 'Here’s to new beginnings'), OS('New year,<br>same friendly faces', 'Here when you need us', 'Please check our hours before you visit', 'Holiday hours may change'), OS('Thank you,<br>${Suburb}', '', 'Happy New Year from the whole ${StoreName} team.', '')],
  'australia-day': [OS('Happy Australia Day,<br>${Suburb}', '', 'Celebrating our local community', 'Everyone is welcome here'), OS('Proud to be part<br>of the community', 'Public holiday hours may change', 'Please check our hours before you visit', 'Have a safe and happy public holiday'), OS('Thank you,<br>${Suburb}', '', 'For making this a great place to be', '')],
  'valentines-day': [OS("Happy Valentine's Day,<br>${Suburb}", '', 'A day to show you care', 'For partners, family and friends'), OS('Share a little<br>kindness today', 'Big or small, it all counts', 'A kind word goes a long way', 'Look out for the people you love'), OS('Thank you,<br>${Suburb}', '', "Wishing you a happy Valentine's Day", '')],
  easter: [OS('Happy Easter,<br>${Suburb}', '', 'Wishing you a happy Easter break', 'From all of us, to all of you'), OS('Here for you<br>over Easter', 'Holiday hours may change', 'Please check our hours before you visit', 'Have a safe long weekend'), OS('Thank you,<br>${Suburb}', '', 'Have a safe and happy Easter', '')],
  'anzac-day': [OS('Anzac Day', '25 April', 'We pause to remember', 'All who served and sacrificed'), OS('We will<br>remember them', '', 'Honouring those who served', 'And those who serve today'), OS('Lest we forget,<br>${Suburb}', '', '', '')],
};
const sameCopy = (a, b) => ['title', 'sub', 'line1', 'line2'].every((k) => String((a && a[k]) || '') === String((b && b[k]) || ''));
const isLegacyDefault = (id, scenes) => Array.isArray(scenes) && scenes.length === 3 && scenes.every((x, i) => sameCopy(x, LEGACY_OCCASION_COPY[id][i]) && !(x && x.dur));

/**
 * A pharmacy's saved copy for one occasion as {beats}, whatever shape it was saved in: the current shape with any
 * missing line filled from the defaults, the old three-scene shape (unedited: the new defaults; edited: kept, beat by
 * beat), or the defaults when there is none.
 */
export function occasionCopy(id, saved) {
  const occ = occasionOf(id), def = defaultOccasion(occ.id);
  const str = (v, d) => (typeof v === 'string' ? v : d);
  if (saved && Array.isArray(saved.beats)) {
    return { beats: def.beats.map((d, i) => { const v = saved.beats[i] && typeof saved.beats[i] === 'object' ? saved.beats[i] : {}; return 'label' in d ? { label: str(v.label, d.label), text: str(v.text, d.text) } : { text: str(v.text, d.text) }; }) };
  }
  if (saved && Array.isArray(saved.scenes) && !isLegacyDefault(occ.id, saved.scenes)) {
    return { beats: def.beats.map((d, i) => { const v = saved.scenes[i] && typeof saved.scenes[i] === 'object' ? saved.scenes[i] : {}; return 'label' in d ? { label: str(v.sub, d.label), text: str(v.title, d.text) } : { text: str(v.title, d.text) }; }) };
  }
  return def;
}

// ---------- built-in templates ----------
export const BUILTIN_TEMPLATES = [
  { id: 't_scenes', name: 'Promotion scenes', base: 'scenes', builtin: true },
  { id: 't_hours', name: 'Opening hours', base: 'hours', builtin: true },
  ...OCCASIONS.map((o) => ({ id: 't_occ_' + o.id, name: o.name, base: 'occasion', occasion: o.id, builtin: true })), // drawn by renderOccasion()
];

export const DEFAULT_HTML = {
  scenes: `<div class="s-top"></div>
<svg class="s-edge" viewBox="\${ViewBox}"><path d="\${EdgePath}"/></svg>
<div class="s-logo">\${Logo}</div>
<div class="s-head">\${Headline}\${AccentLine}</div>
\${Chevron}
<div class="s-body">\${Content}</div>
\${Footer}`,
  hours: `<div class="s-top"></div>
<svg class="s-edge" viewBox="\${ViewBox}"><path d="\${EdgePath}"/></svg>
<div class="s-logo">\${Logo}</div>
<div class="s-head">\${Headline}</div>
\${Chevron}
\${HoursCard}
<div class="s-note">\${HolidayNote}\${ContactLine}</div>`,
};

// The "Open today" bar: one message per store state, each may use ${CloseTime} / ${OpenTime}.
export const FOOTER_DEFAULT = {
  show: true,
  open: 'Open today until <span class="acc">${CloseTime}</span>',
  closing: 'Closing soon · <span class="acc">${CloseTime}</span>',
  before: 'Opens today at <span class="acc">${OpenTime}</span>',
  closed: 'Closed now',
};
export const footerConfig = (content) => Object.assign({}, FOOTER_DEFAULT, (content && content.footer) || {});

export const HOLIDAY_NOTE = 'Public Holidays: Please call to confirm';

// Content a promotion falls back to when a pharmacy has none for it yet (as the prototype does).
const S = (label, icon, title, sub, line1, line2) => ({ label, icon, title, sub, line1, line2 });
export function defaultContent(base) {
  if (base === 'occasion') return { occasions: Object.fromEntries(OCCASION_IDS.map((id) => [id, defaultOccasion(id)])) };
  if (base === 'hours') {
    return { headlines: ["Sorry, we're closed", 'Serving ${Suburb}', 'Public Holidays:<br><span class="reg">Please call to confirm</span>'], showAddress: false };
  }
  return {
    greeting: 'Hello,<br>${Suburb}', introTitle: 'Three reasons to walk in', introSub: 'No fuss. Just ask in store.',
    slots: [
      S('Blood pressure', 'monitor_heart', 'Blood pressure checks', 'Free, as often as you like', 'Know your numbers', 'Pop in this morning'),
      S('MedsCheck', 'pill', 'MedsCheck', 'Know your medicines better', 'Sit down with your pharmacist', 'Review your medicines together'),
      S('Medicine packs', 'calendar_month', 'Weekly medicine packs', 'Sorted for you', 'The right dose, every day', 'Ask us to set one up'),
    ],
    close: { title: 'Walk in today', sub: 'Speak directly with a pharmacist', line1: 'We look forward to seeing you', line2: 'Trusted local care' },
  };
}

// ---------- data ----------
export class ScreenError extends Error {
  constructor(code, title, detail) { super(title); this.code = code; this.title = title; this.detail = detail || ''; }
}

const promoIdOf = (p) => String(p.promoId || p.token || p.id || '');

/** Location API campaign_data response + config -> the store the screen renders. */
export function storeModel(campaignData, config) {
  const data = (campaignData && campaignData.data) || campaignData || {};
  const loc = data.store_location || {};
  const info = data.store_info || {};
  const addr = info.address_info || {};
  const code = String(loc.store_code || '').trim();
  const ph = ((config && config.pharmacies) || []).find((x) => String(x.storeCode || '').trim().toUpperCase() === code.toUpperCase());
  if (!code || !ph) throw new ScreenError('not-set-up', 'Screen not set up', code ? `Store ${code} has no screen content yet.` : 'No store is linked to this screen.');
  // Token values set by hand on the pharmacy (Admin → Settings → Tokens) win over the store's data.
  const tokens = cleanTokens(ph.tokens);
  return {
    code,
    name: tokens.StoreName || ph.name || loc.store_name || '',
    suburb: tokens.Suburb || String(addr.suburb || '').trim(),
    tz: loc.store_timezone || 'Australia/Melbourne',
    phone: tokens.Phone || addr.phone_number || '',
    address: addr.address || '',
    sessions: parseOpeningHours(info.opening_hours),
    brand: { p: (ph.brand && ph.brand.p) || '#0f1050', a: (ph.brand && ph.brand.a) || '#5ee6b0' },
    // The store logo from the Location API (PH-181; the proxy returns it at store_info.logo_url) wins over the config logo.
    logo: safeUrl(info.logo_url) || safeUrl(data.logo_url) || ph.logo || null,
    content: ph.content || {},
    tokens,
  };
}

/**
 * A promotion by its promo ID, with its template (custom or built-in) and this store's content for it.
 * opts.occasion: play that occasion instead of the one the promotion is set to (an occasion promotion only; the
 * copy-fit audit uses it to check every occasion).
 */
export function resolvePromotion(config, store, promoId, opts = {}) {
  const promos = (config && config.promotions) || [];
  const promo = promos.find((p) => promoIdOf(p) === String(promoId || ''));
  if (!promo) throw new ScreenError('unknown-promo', 'Promotion not found', `No promotion has the promo ID "${promoId || ''}".`);
  const templates = BUILTIN_TEMPLATES.concat(((config && config.templates) || []).filter((t) => !t.builtin));
  const tid = promo.template || promo.tpl;
  let template = templates.find((t) => t.id === tid);
  if (!template) template = BUILTIN_TEMPLATES[promo.type === 'hours' ? 1 : 0];
  if (template.base === 'occasion' && opts.occasion && OCCASION_IDS.includes(opts.occasion)) template = BUILTIN_TEMPLATES.find((t) => t.occasion === opts.occasion);
  let content = store.content[promoIdOf(promo)] || store.content[promo.id];
  if (template.base === 'occasion') {
    // Content keeps every occasion's copy (content.occasions[<occasion>]), so switching occasion and back loses nothing.
    const occasion = occasionOf(template.occasion).id;
    const copy = occasionCopy(occasion, content && content.occasions && content.occasions[occasion]);
    return { promo, promoId: promoIdOf(promo), template, base: 'occasion', occasion, content: { beats: copy.beats } };
  }
  const base = template.base === 'hours' ? 'hours' : 'scenes';
  const fits = base === 'hours' ? content && Array.isArray(content.headlines) : content && Array.isArray(content.slots);
  if (!fits) content = defaultContent(base);
  return { promo, promoId: promoIdOf(promo), template, base, content };
}

/** The scenes of a promotion and their durations in seconds. */
export function sequence(play) {
  const d = play.content;
  if (play.base === 'hours') {
    const n = (d.headlines || []).length || 1;
    return n === 3 ? [{ k: 0, t: 2.7 }, { k: 1, t: 2.7 }, { k: 2, t: 2.6 }] : Array.from({ length: n }, (_, i) => ({ k: i, t: +(8 / n).toFixed(2) }));
  }
  // An occasion's beats share its CSS loop equally (Christmas 6 s + 6 s, the others 4 s each).
  if (play.base === 'occasion') return d.beats.map((x, i) => ({ k: i, t: OCCASION_LOOP / d.beats.length }));
  return [{ k: 'intro', t: +d.introDur || 3 }, ...d.slots.map((x, i) => ({ k: i, t: +x.dur || 2 })), { k: 'close', t: +(d.close && d.close.dur) || 2 }];
}

export function sceneName(play, i) {
  const s = sequence(play)[i];
  if (!s) return '';
  if (play.base === 'hours') return 'Headline ' + (i + 1);
  if (play.base === 'occasion') return 'Beat ' + (i + 1);
  return s.k === 'intro' ? 'Greeting' : s.k === 'close' ? 'Walk in' : play.content.slots[s.k].label;
}

// ---------- colours (icon tiles use a brighter version of the primary) ----------
const rgb = (hex) => { let c = String(hex).replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); const n = parseInt(c, 16) || 0; return [n >> 16, (n >> 8) & 255, n & 255]; };
const toHex = (v) => '#' + v.map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');
export function boost(hex, k) {
  const v = rgb(hex), mx = Math.max(...v) || 1;
  k = Math.max(1, Math.min(k, Math.max(160, mx * 1.15) / mx));
  return toHex(v.map((x) => Math.min(255, x * k)));
}
export function tileTop(hex) {
  const v = rgb(hex), mx = Math.max(...v) || 1, k = Math.max(1, 180 / mx);
  return toHex(v.map((x) => Math.min(255, Math.round(x * k))).map((x) => Math.round(x + (255 - x) * 0.1)));
}

// ---------- scoped template CSS ----------
/** Scope a template's CSS to the screen element so it can't restyle anything else on the page. */
export function scopeCss(css, scope = '#screen') {
  const src = String(css || '').replace(/<\/style/gi, '');
  if (!src.trim()) return '';
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(src);
    const walk = (rules) => [...rules].map((r) => {
      if (r.selectorText !== undefined && r.style) {
        const sel = r.selectorText.split(',').map((s) => s.trim()).map((s) => (/^(:root|html|body)$/.test(s) ? scope : `${scope} ${s}`)).join(', ');
        return `${sel}{${r.style.cssText}}`;
      }
      if (r.cssRules && r.conditionText !== undefined) return `@${r.constructor.name === 'CSSSupportsRule' ? 'supports' : 'media'} ${r.conditionText}{${walk(r.cssRules)}}`;
      if (r.cssRules && r.media) return `@media ${r.media.mediaText}{${walk(r.cssRules)}}`;
      return r.cssText; // @keyframes, @font-face: global by nature
    }).join('\n');
    return walk(sheet.cssRules);
  } catch (e) {
    return `${scope}{${src}}`; // CSS nesting, as the prototype does
  }
}

const safeUrl = (u) => (/^(data:image\/(png|webp|jpeg|gif|svg\+xml);base64,|https:\/\/|\.{0,2}\/)/i.test(String(u || '')) ? String(u) : '');

// ---------- render ----------
const ico = (n, big) => `<div class="s-ico${big ? ' big' : ''}"><span class="ms">${esc(n)}</span></div>`;
function logoHtml(store) {
  const src = safeUrl(store.logo);
  return src ? `<img src="${esc(src)}" alt="${esc(store.name)}">` : '<div class="s-mark">Pharmacy logo</div>';
}

/** The store's "Open today" bar message for its current state. */
export function footerMessage(store, content, state) {
  const F = footerConfig(content);
  const key = state.state === 'open' ? 'open' : state.state === 'closing' ? 'closing' : state.state === 'before' ? 'before' : 'closed';
  const tok = store.tokens || {};
  return timeTokens(rich(F[key], store.suburb), tok.CloseTime || fmtShort(state.closeTime, true), tok.OpenTime || fmtShort(state.openTime, true));
}

/**
 * Render one scene into `el` (the 1080x1920 / 1920x1080 .screen element, id "screen").
 * opts: { store, play, orientation, scene, now: {day, min} | undefined, enter: boolean, loop: boolean }
 * An occasion promotion draws its whole animation (renderOccasion): with opts.loop its beats play on their CSS loop,
 * otherwise beat `scene` is held still.
 * Returns { G, fit, state, ready } (ready: a promise, settled once an occasion's fonts are in and its copy refitted).
 */
export function renderScene(el, opts) {
  const { store, play } = opts;
  if (play.base === 'occasion') return renderOccasion(el, opts);
  const land = opts.orientation === 'landscape';
  const hours = play.base === 'hours';
  const seq = sequence(play);
  const scene = Math.max(0, Math.min(seq.length - 1, opts.scene | 0));
  const now = opts.now || storeNow(store.tz);
  const state = storeState(store.sessions, now);
  const s = store, d = play.content, sub = s.suburb;

  el.style.setProperty('--s-p', s.brand.p);
  el.style.setProperty('--s-p2', boost(s.brand.p, 1.8));
  el.style.setProperty('--s-p3', tileTop(s.brand.p));
  el.style.setProperty('--s-p4', boost(s.brand.p, 1.15));
  el.style.setProperty('--s-a', s.brand.a);
  el.style.setProperty('--s-bg', '#f1f3f8');
  el.style.setProperty('--s-bg2', '#e6eaf3');
  el.style.setProperty('--s-ink', s.brand.p);

  let hl = '', acc = '', body = '';
  const T = {};
  if (hours) {
    hl = `<h2>${rich((d.headlines || [])[seq[scene].k], sub)}</h2>`;
    const rows = weeklyRows(s.sessions).map((r) => `<div class="s-row"><span>${r.name}</span>${r.text ? `<span>${esc(r.text)}</span>` : '<span class="closed">Closed</span>'}</div>`).join('');
    T.HoursCard = `<div class="s-card"><div class="ch"><h3>Opening hours</h3><span class="s-badge">CLOSED NOW</span></div>${rows}</div>`;
    const bits = [s.phone ? `Phone ${esc(s.phone)}` : '', d.showAddress && s.address ? esc(s.address) : ''].filter(Boolean).join(' · ');
    T.HolidayNote = `<span class="n1">${HOLIDAY_NOTE}</span>`;
    T.ContactLine = bits ? `<span class="n2">${bits}</span>` : '';
  } else {
    const sc = seq[scene].k;
    const n = d.slots.length, tz = n <= 3 ? 1 : n === 4 ? 0.8 : n === 5 ? 0.66 : 0.56;
    const tiles = `<div class="s-tiles" style="--tz:${tz}">${d.slots.map((x, i) => `<div class="s-tile d${i + 1}">${ico(x.icon)}<span class="lbl">${esc(x.label)}</span></div>`).join('')}</div>`;
    T.Tiles = tiles;
    if (sc === 'intro') {
      hl = `<h2>${rich(d.greeting, sub)}</h2>`;
      T.Line1 = fill(d.introTitle, sub); T.Line2 = fill(d.introSub, sub);
      body = `${tiles}<h3 class="s-title d3">${T.Line1}</h3><p class="s-sub d3">${T.Line2}</p>`;
    } else if (sc === 'close') {
      hl = `<h2>${rich(d.close.title, sub)}</h2>`; acc = `<p>${fill(d.close.sub, sub)}</p>`;
      T.Line1 = fill(d.close.line1, sub); T.Line2 = fill(d.close.line2, sub);
      body = `${tiles}<h3 class="s-title d3">${T.Line1}</h3><p class="s-sub d3">${T.Line2}</p>`;
    } else {
      const x = d.slots[sc];
      hl = `<h2>${rich(x.title, sub)}</h2>`; acc = `<p>${fill(x.sub, sub)}</p>`;
      T.Icon = ico(x.icon, true); T.ServiceLabel = esc(x.label); T.Line1 = fill(x.line1, sub); T.Line2 = fill(x.line2, sub);
      body = `<div class="bigwrap">${T.Icon}</div><h3 class="s-title d1">${T.Line1}</h3><p class="s-sub d1">${T.Line2}</p>`;
    }
    const f1 = footerMessage(s, d, state);
    T.OpenToday = f1;
    T.Footer = footerConfig(d).show === false ? '' : `<div class="s-foot"><span class="f1">${f1}</span></div>`;
    T.Content = body;
  }

  const G = geom(land, hours);
  el.className = 'screen' + (land ? ' land' : '') + (hours ? ' closed' : '') + (opts.enter ? ' enter' : '');
  Object.assign(T, {
    ViewBox: `0 0 ${G.W} ${G.H}`, EdgePath: ptsPath(G.edge), Logo: logoHtml(s), Headline: hl, AccentLine: acc,
    Chevron: `<svg class="s-chev" viewBox="0 0 90 50" style="${G.chev}"><path d="M8 8 L45 42 L82 8"/></svg>`,
    Suburb: esc(sub), StoreName: esc(s.name), Phone: esc(s.phone || ''),
  });
  // Any other token the pharmacy has set by hand: in template HTML as a slot, and in copy (with ${StoreName} and
  // ${Phone}, which copy otherwise leaves as written outside occasions).
  const custom = Object.fromEntries(Object.entries(s.tokens || {}).filter(([k]) => !DATA_TOKENS.includes(k) && !(k in T)));
  for (const [k, v] of Object.entries(custom)) T[k] = esc(v);
  const P = play.template;
  const html = applyTokens(fillTemplate(P.html || DEFAULT_HTML[play.base], T), { ...custom, StoreName: s.name, Phone: s.phone || '' });
  const css = P.css ? scopeCss(P.css, '#' + (el.id || 'screen')) : '';
  el.innerHTML = (css ? `<style>${css}</style>` : '') + html;
  const top = el.querySelector('.s-top');
  if (top) top.style.clipPath = ptsClip(G.pts);
  const ep = el.querySelector('.s-edge path');
  if (ep) ep.style.d = `path('${ptsPath(G.edge)}')`;
  const bgP = safeUrl(P.bgPortrait || P.bgP), bgL = safeUrl(P.bgLandscape || P.bgL);
  const bg = land ? bgL || bgP : bgP || bgL;
  el.style.backgroundImage = bg ? `url("${bg}")` : '';
  el.style.backgroundSize = bg ? 'cover' : '';
  el.style.backgroundPosition = bg ? 'center' : '';
  const fit = fitText(el, G);
  return { G, fit, state, ready: Promise.resolve() };
}

/** The occasion templates' CSS (js/occasions.js), added to the document once. */
function occasionStyles(doc) {
  if (doc.getElementById('occasion-styles')) return;
  const st = doc.createElement('style');
  st.id = 'occasion-styles';
  st.textContent = OCCASION_CSS;
  doc.head.appendChild(st);
}

/** One beat of an occasion: its label line (above or below, where the design has one) and its main line. */
function beatHtml(layout, copy, i, on, R, P) {
  const text = R(copy.text), lab = layout.label ? P(copy.label) : '';
  const label = lab ? `<div class="${layout.label.cls}">${layout.label.span ? `<span>${lab}</span>` : lab}</div>` : '';
  const main = text ? `<div class="${layout.main}">${text}</div>` : '';
  const pos = layout.label && layout.label.pos;
  return `<div class="b b${i + 1}${on ? ' on' : ''}">${pos === 'above' ? label : ''}${main}${pos === 'below' ? label : ''}</div>`;
}

/**
 * An occasion template, drawn whole: the design's decorations and the pharmacy's copy as beats, filling the screen.
 * ${Suburb} (blanked with its comma when the store has none) and ${StoreName} in every line; the main lines are rich
 * text (line breaks, bold, italic), the label lines plain. Each beat's copy is shrunk to fit the text box if it must
 * (fitOccasion), again once the occasion's fonts have loaded.
 */
export function renderOccasion(el, opts) {
  const { store, play } = opts;
  const land = opts.orientation === 'landscape';
  const occ = occasionOf(play.occasion), design = OCCASION_DESIGNS[occ.design];
  const beats = play.content.beats;
  const scene = Math.max(0, Math.min(beats.length - 1, opts.scene | 0));
  const state = storeState(store.sessions, opts.now || storeNow(store.tz));
  const doc = el.ownerDocument;
  occasionStyles(doc);
  // Tokens the pharmacy set by hand (Settings → Tokens) beyond the store's data, as in the other templates' copy.
  const custom = Object.fromEntries(Object.entries(store.tokens || {}).filter(([k]) => !DATA_TOKENS.includes(k)));
  const T = (h) => applyTokens(applyStoreName(h, store.name), { ...custom, Phone: store.phone || '' });
  const R = (t) => T(rich(t, store.suburb)), P = (t) => T(fill(t, store.suburb));
  el.removeAttribute('style');
  el.className = 'screen occasion' + (land ? ' land' : '');
  const copy = occ.beats.map((layout, i) => beatHtml(layout, beats[i] || {}, i, !opts.loop && i === scene, R, P)).join('');
  el.innerHTML = `<div class="occ occ-${occ.design}${opts.loop ? '' : ' hold'}">${design.fx}<div class="txt">${copy}</div></div>`;
  const G = { W: land ? 1920 : 1080, H: land ? 1080 : 1920, inside: () => true };
  const fit = fitOccasion(el, G);
  const root = el.firstElementChild;
  const fonts = doc.fonts && doc.fonts.load ? Promise.all(occ.fonts.map((f) => doc.fonts.load(f).catch(() => null))) : Promise.resolve();
  // Measured again once the fonts are in, unless the screen has been redrawn since.
  const ready = fonts.then(() => { if (el.firstElementChild === root) Object.assign(fit, fitOccasion(el, G)); });
  return { G, fit, state, ready };
}

/**
 * A plain message in place of the screen (invalid URL, promotion not found, data could not load).
 * opts.badge: a red status badge under the message (every server failing with nothing cached).
 */
export function renderMessage(el, orientation, title, detail, opts = {}) {
  el.className = 'screen msg' + (orientation === 'landscape' ? ' land' : '');
  el.removeAttribute('style');
  const badge = opts.badge ? `<span class="s-errbadge" role="status"><i></i>${esc(opts.badge)}</span>` : '';
  el.innerHTML = `<div class="s-msg"><span class="ms">tv_off</span><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}${badge}</div>`;
}

export const DEFAULT_BRAND = { p: '#0f1050', a: '#5ee6b0' };

/**
 * "Screen not set up", drawn in the screen's own brand panel (default colours, or the store's logo when the
 * Location API returned one) with the device ID small at the bottom, so whoever installs the screen can
 * register it. opts: { orientation, title, detail, device, logo, brand }
 */
export function renderNotSetUp(el, opts) {
  const land = opts.orientation === 'landscape';
  const brand = opts.brand || DEFAULT_BRAND;
  const G = geom(land, true);
  el.className = 'screen setup closed' + (land ? ' land' : '');
  el.removeAttribute('style');
  el.style.setProperty('--s-p', brand.p);
  el.style.setProperty('--s-p2', boost(brand.p, 1.8));
  el.style.setProperty('--s-a', brand.a);
  el.style.setProperty('--s-bg', '#f1f3f8');
  el.style.setProperty('--s-bg2', '#e6eaf3');
  el.style.setProperty('--s-ink', brand.p);
  const logo = safeUrl(opts.logo);
  el.innerHTML = `<div class="s-top" style="clip-path:${ptsClip(G.pts)}"></div>`
    + `<svg class="s-edge" viewBox="0 0 ${G.W} ${G.H}"><path d="${ptsPath(G.edge)}"/></svg>`
    + (logo ? `<div class="s-logo"><img src="${esc(logo)}" alt=""></div>` : '<div class="s-setup-mark"><span class="ms">tv_off</span></div>')
    + `<div class="s-setup-body"><h2>${esc(opts.title || 'Screen not set up')}</h2>${opts.detail ? `<p>${esc(opts.detail)}</p>` : ''}</div>`
    + (opts.device ? `<div class="s-devid">Device ID <b>${esc(opts.device)}</b></div>` : '');
}

export { DAYS };
