// Render engine for the pharmacy screen: one scene of one promotion for one store, in either orientation.
// Shared by the player page (pharmacy-screen.html) and the admin editor's live preview.
//
//   const store = storeModel(campaignData, config)          // Location API response + per-pharmacy config
//   const play  = resolvePromotion(config, store, 'morning') // promotion + its template + this store's content
//   const seq   = sequence(play)                              // [{k, t}] scenes and their seconds
//   renderScene(screenEl, { store, play, orientation: 'portrait', scene: 0, now, enter: true })

import { DAYS, parseOpeningHours, storeNow, storeState, fmtShort, weeklyRows } from './hours.js';
import { esc, rich, fill, timeTokens, fillTemplate, applyStoreName } from './tokens.js';
import { geom, ptsPath, ptsClip, fitText } from './fit-text.js';

// ---------- occasions ----------
// The "Occasions" promotion (promo=occasions) plays one of six read-only built-in templates, one per occasion.
// Which one is the promotion's template, picked in the admin editor's Occasion drop-down (no date logic). Each
// occasion has three scenes: a greeting over themed icon tiles, a message, and a sign-off. Christmas and New
// Year's sign off with ${StoreName}; the others use ${Suburb} only. Visuals are neutral seasonal symbols (Anzac
// Day is commemorative: a remembrance poppy, dawn, no decoration and calmer motion); copy makes no product or
// health claim. Icons are Material Symbols names, except 'poppy', drawn as an inline SVG.
const OS = (title, sub, line1, line2) => ({ title, sub, line1, line2 });
export const OCCASIONS = [
  {
    id: 'christmas', name: 'Christmas', tiles: ['park', 'featured_seasonal_and_gifts', 'star'], icons: ['ac_unit', 'volunteer_activism'], decor: 'ac_unit',
    scenes: [
      OS('Merry Christmas,<br>${Suburb}', '', "Season's greetings", 'From all of us, to all of you'),
      OS('Here for you<br>this season', 'Holiday hours may change', 'Please check our hours before you visit', 'Thank you for shopping local'),
      OS('Thank you,<br>${Suburb}', '', 'Merry Christmas from the whole ${StoreName} team.', ''),
    ],
  },
  {
    id: 'new-year', name: "New Year's", tiles: ['celebration', 'flare', 'hourglass_bottom'], icons: ['calendar_month', 'volunteer_activism'], decor: 'flare',
    scenes: [
      OS('Happy New Year,<br>${Suburb}', '', 'Wishing you a bright year ahead', 'Here’s to new beginnings'),
      OS('New year,<br>same friendly faces', 'Here when you need us', 'Please check our hours before you visit', 'Holiday hours may change'),
      OS('Thank you,<br>${Suburb}', '', 'Happy New Year from the whole ${StoreName} team.', ''),
    ],
  },
  {
    id: 'australia-day', name: 'Australia Day', tiles: ['wb_sunny', 'diversity_3', 'beach_access'], icons: ['groups', 'handshake'], decor: 'wb_sunny',
    scenes: [
      OS('Happy Australia Day,<br>${Suburb}', '', 'Celebrating our local community', 'Everyone is welcome here'),
      OS('Proud to be part<br>of the community', 'Public holiday hours may change', 'Please check our hours before you visit', 'Have a safe and happy public holiday'),
      OS('Thank you,<br>${Suburb}', '', 'For making this a great place to be', ''),
    ],
  },
  {
    id: 'valentines-day', name: "Valentine's Day", tiles: ['favorite', 'local_florist', 'mail'], icons: ['volunteer_activism', 'favorite'], decor: 'favorite',
    scenes: [
      OS("Happy Valentine's Day,<br>${Suburb}", '', 'A day to show you care', 'For partners, family and friends'),
      OS('Share a little<br>kindness today', 'Big or small, it all counts', 'A kind word goes a long way', 'Look out for the people you love'),
      OS('Thank you,<br>${Suburb}', '', "Wishing you a happy Valentine's Day", ''),
    ],
  },
  {
    id: 'easter', name: 'Easter', tiles: ['egg', 'cruelty_free', 'local_florist'], icons: ['calendar_month', 'egg_alt'], decor: 'local_florist',
    scenes: [
      OS('Happy Easter,<br>${Suburb}', '', 'Wishing you a happy Easter break', 'From all of us, to all of you'),
      OS('Here for you<br>over Easter', 'Holiday hours may change', 'Please check our hours before you visit', 'Have a safe long weekend'),
      OS('Thank you,<br>${Suburb}', '', 'Have a safe and happy Easter', ''),
    ],
  },
  {
    id: 'anzac-day', name: 'Anzac Day', tiles: ['poppy', 'wb_twilight', 'military_tech'], icons: ['wb_twilight', 'poppy'], decor: '', solemn: true,
    scenes: [
      OS('Anzac Day', '25 April', 'We pause to remember', 'All who served and sacrificed'),
      OS('We will<br>remember them', '', 'Honouring those who served', 'And those who serve today'),
      OS('Lest we forget,<br>${Suburb}', '', '', ''),
    ],
  },
];
export const OCCASION_IDS = OCCASIONS.map((o) => o.id);
export const DEFAULT_OCCASION = 'christmas';
export const OCCASION_SCENES = ['Greeting', 'Message', 'Sign-off'];
const OCCASION_DUR = [3, 3, 4];
export const occasionOf = (id) => OCCASIONS.find((o) => o.id === id) || OCCASIONS[0];
/** One occasion's default copy: {scenes: [greeting, message, sign-off]}, each {title, sub, line1, line2}. */
export const defaultOccasion = (id) => ({ scenes: occasionOf(id).scenes.map((x) => ({ ...x })) });

// ---------- built-in templates ----------
export const BUILTIN_TEMPLATES = [
  { id: 't_scenes', name: 'Promotion scenes', base: 'scenes', builtin: true },
  { id: 't_hours', name: 'Opening hours', base: 'hours', builtin: true },
  ...OCCASIONS.map((o) => ({ id: 't_occ_' + o.id, name: o.name, base: 'occasion', occasion: o.id, builtin: true })),
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
  occasion: `<div class="s-top"></div>
\${Decor}
<svg class="s-edge" viewBox="\${ViewBox}"><path d="\${EdgePath}"/></svg>
<div class="s-logo">\${Logo}</div>
<div class="s-head">\${Headline}\${AccentLine}</div>
\${Chevron}
<div class="s-body">\${Content}</div>
\${Footer}`,
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
  return {
    code,
    name: ph.name || loc.store_name || '',
    suburb: String(addr.suburb || '').trim(),
    tz: loc.store_timezone || 'Australia/Melbourne',
    phone: addr.phone_number || '',
    address: addr.address || '',
    sessions: parseOpeningHours(info.opening_hours),
    brand: { p: (ph.brand && ph.brand.p) || '#0f1050', a: (ph.brand && ph.brand.a) || '#5ee6b0' },
    // The store logo from the Location API (PH-181; the proxy returns it at store_info.logo_url) wins over the config logo.
    logo: safeUrl(info.logo_url) || safeUrl(data.logo_url) || ph.logo || null,
    content: ph.content || {},
  };
}

const isOccasionCopy = (o) => !!o && Array.isArray(o.scenes) && o.scenes.length === 3 && o.scenes.every((x) => x && typeof x === 'object');

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
    const saved = content && content.occasions && content.occasions[occasion];
    const copy = isOccasionCopy(saved) ? saved : defaultOccasion(occasion);
    return { promo, promoId: promoIdOf(promo), template, base: 'occasion', occasion, content: { scenes: copy.scenes, footer: content && content.footer } };
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
  if (play.base === 'occasion') return d.scenes.map((x, i) => ({ k: i, t: +x.dur || OCCASION_DUR[i] || 3 }));
  return [{ k: 'intro', t: +d.introDur || 3 }, ...d.slots.map((x, i) => ({ k: i, t: +x.dur || 2 })), { k: 'close', t: +(d.close && d.close.dur) || 2 }];
}

export function sceneName(play, i) {
  const s = sequence(play)[i];
  if (!s) return '';
  if (play.base === 'hours') return 'Headline ' + (i + 1);
  if (play.base === 'occasion') return OCCASION_SCENES[i] || 'Scene ' + (i + 1);
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
// The remembrance poppy (Anzac Day): four red petals, black centre.
const POPPY = '<svg class="o-poppy" viewBox="0 0 100 100" aria-hidden="true"><g fill="#d3242f"><circle cx="50" cy="29" r="23"/><circle cx="29" cy="51" r="23"/><circle cx="71" cy="51" r="23"/><circle cx="50" cy="71" r="23"/></g><g fill="#a51a24" opacity=".55"><circle cx="50" cy="50" r="19"/></g><circle cx="50" cy="50" r="11" fill="#1b1b1b"/></svg>';
const glyph = (n) => (n === 'poppy' ? POPPY : `<span class="ms">${esc(n)}</span>`);
function ico(n, big) { return `<div class="s-ico${big ? ' big' : ''}">${glyph(n)}</div>`; }
// Themed decoration in the brand panel's free corners: small seasonal symbols that twinkle (none on Anzac Day).
const DECOR = { portrait: [[70, 150, 54], [170, 250, 34], [120, 345, 26], [1010, 150, 54], [910, 250, 34], [960, 345, 26]], landscape: [[700, 70, 52], [790, 175, 32], [660, 215, 24]] };
function decorHtml(occ, land) {
  if (!occ.decor) return '';
  return `<div class="o-decor" aria-hidden="true">${DECOR[land ? 'landscape' : 'portrait'].map(([x, y, s], i) => `<span class="ms d${i + 1}" style="left:${x}px;top:${y}px;font-size:${s}px">${esc(occ.decor)}</span>`).join('')}</div>`;
}
function logoHtml(store) {
  const src = safeUrl(store.logo);
  return src ? `<img src="${esc(src)}" alt="${esc(store.name)}">` : '<div class="s-mark">Pharmacy logo</div>';
}

/** The store's "Open today" bar message for its current state. */
export function footerMessage(store, content, state) {
  const F = footerConfig(content);
  const key = state.state === 'open' ? 'open' : state.state === 'closing' ? 'closing' : state.state === 'before' ? 'before' : 'closed';
  return timeTokens(rich(F[key], store.suburb), fmtShort(state.closeTime, true), fmtShort(state.openTime, true));
}

/**
 * Render one scene into `el` (the 1080x1920 / 1920x1080 .screen element, id "screen").
 * opts: { store, play, orientation, scene, now: {day, min} | undefined, enter: boolean }
 * Returns { G, fit, state }.
 */
export function renderScene(el, opts) {
  const { store, play } = opts;
  const land = opts.orientation === 'landscape';
  const hours = play.base === 'hours';
  const occ = play.base === 'occasion' ? occasionOf(play.occasion) : null;
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
  } else if (occ) {
    // ${Suburb} and ${StoreName} in the copy; headlines are rich text, the other lines plain.
    const R = (t) => applyStoreName(rich(t, sub), s.name), P = (t) => applyStoreName(fill(t, sub), s.name);
    const k = seq[scene].k, x = d.scenes[k] || {};
    hl = `<h2>${R(x.title)}</h2>`;
    const a = P(x.sub); acc = a ? `<p>${a}</p>` : '';
    T.Line1 = P(x.line1); T.Line2 = P(x.line2);
    const lines = (cls) => (T.Line1 ? `<h3 class="s-title ${cls}">${T.Line1}</h3>` : '') + (T.Line2 ? `<p class="s-sub ${cls}">${T.Line2}</p>` : '');
    const tiles = `<div class="s-tiles">${occ.tiles.map((n, i) => `<div class="s-tile d${i + 1}">${ico(n)}</div>`).join('')}</div>`;
    T.Tiles = tiles;
    if (k === 0) body = tiles + lines('d3');
    else { T.Icon = ico(occ.icons[k - 1] || occ.tiles[0], true); body = `<div class="bigwrap">${T.Icon}</div>` + lines('d1'); }
    T.Decor = decorHtml(occ, land);
    const f1 = footerMessage(s, d, state);
    T.OpenToday = f1;
    T.HolidayNote = esc(HOLIDAY_NOTE);
    T.Footer = footerConfig(d).show === false ? '' : `<div class="s-foot"><span class="f1">${f1}</span><span class="f2">${T.HolidayNote}</span></div>`;
    T.Content = body;
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
  el.className = 'screen' + (land ? ' land' : '') + (hours ? ' closed' : '') + (occ ? ` occ occ-${occ.id}${occ.solemn ? ' solemn' : ''}` : '') + (opts.enter ? ' enter' : '');
  Object.assign(T, {
    ViewBox: `0 0 ${G.W} ${G.H}`, EdgePath: ptsPath(G.edge), Logo: logoHtml(s), Headline: hl, AccentLine: acc,
    Chevron: `<svg class="s-chev" viewBox="0 0 90 50" style="${G.chev}"><path d="M8 8 L45 42 L82 8"/></svg>`,
    Suburb: esc(sub), StoreName: esc(s.name), Phone: esc(s.phone || ''),
  });
  const P = play.template;
  const html = fillTemplate(P.html || DEFAULT_HTML[play.base], T);
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
  return { G, fit, state };
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
