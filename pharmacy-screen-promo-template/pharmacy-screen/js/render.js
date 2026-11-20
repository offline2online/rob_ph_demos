// Render engine for the pharmacy screen: one scene of one promotion for one store, in either orientation.
// Shared by the player page (pharmacy-screen.html) and the admin editor's live preview.
//
//   const store = storeModel(campaignData, config)          // Location API response + per-pharmacy config
//   const play  = resolvePromotion(config, store, 'morning') // promotion + its template + this store's content
//   const seq   = sequence(play)                              // [{k, t}] scenes and their seconds
//   renderScene(screenEl, { store, play, orientation: 'portrait', scene: 0, now, enter: true })

import { DAYS, parseOpeningHours, storeNow, storeState, fmtShort, weeklyRows } from './hours.js';
import { esc, rich, fill, timeTokens, fillTemplate } from './tokens.js';
import { geom, ptsPath, ptsClip, fitText } from './fit-text.js';

// ---------- built-in templates ----------
export const BUILTIN_TEMPLATES = [
  { id: 't_scenes', name: 'Promotion scenes', base: 'scenes', builtin: true },
  { id: 't_hours', name: 'Opening hours', base: 'hours', builtin: true },
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
    logo: data.logo_url || ph.logo || null,
    content: ph.content || {},
  };
}

/** A promotion by its promo ID, with its template (custom or built-in) and this store's content for it. */
export function resolvePromotion(config, store, promoId) {
  const promos = (config && config.promotions) || [];
  const promo = promos.find((p) => promoIdOf(p) === String(promoId || ''));
  if (!promo) throw new ScreenError('unknown-promo', 'Promotion not found', `No promotion has the promo ID "${promoId || ''}".`);
  const templates = BUILTIN_TEMPLATES.concat(((config && config.templates) || []).filter((t) => !t.builtin));
  const tid = promo.template || promo.tpl;
  let template = templates.find((t) => t.id === tid);
  if (!template) template = BUILTIN_TEMPLATES[promo.type === 'hours' ? 1 : 0];
  const base = template.base === 'hours' ? 'hours' : 'scenes';
  let content = store.content[promoIdOf(promo)] || store.content[promo.id];
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
  return [{ k: 'intro', t: +d.introDur || 3 }, ...d.slots.map((x, i) => ({ k: i, t: +x.dur || 2 })), { k: 'close', t: +(d.close && d.close.dur) || 2 }];
}

export function sceneName(play, i) {
  const s = sequence(play)[i];
  if (!s) return '';
  if (play.base === 'hours') return 'Headline ' + (i + 1);
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
function ico(n, big) { return `<div class="s-ico${big ? ' big' : ''}"><span class="ms">${esc(n)}</span></div>`; }
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

/** A plain message in place of the screen (invalid URL, not set up, data could not load). */
export function renderMessage(el, orientation, title, detail) {
  el.className = 'screen msg' + (orientation === 'landscape' ? ' land' : '');
  el.removeAttribute('style');
  el.innerHTML = `<div class="s-msg"><span class="ms">tv_off</span><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}</div>`;
}

export { DAYS };
