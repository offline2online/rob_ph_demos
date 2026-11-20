// Token resolver for the pharmacy screen, shared with the admin editor. No DOM: runs under `node --test`.
//
// Copy uses Personalisation Hub's token format, ${TokenName}:
//   ${Suburb}    store_info.address_info.suburb. With no suburb it is blanked, together with its
//                leading comma and/or line break ("Good morning,<br>${Suburb}" -> "Good morning").
//   ${StoreName} the pharmacy's name (Seasonal copy: "from the whole ${StoreName} team").
//   ${CloseTime} ${OpenTime}   the current session's times, e.g. "7PM" (the "Open today" bar).
//   ${Phone} ${State} ${StoreCode}   store_info.address_info.phone_number / .state and store_location.store_code.
// The editor's "+ Add token" menu on every headline field lists the tokens copy can use (ADD_TOKENS).
// Templates use the same format for their slots (${Headline}, ${Content}, ... see TEMPLATE_TOKENS).
//
// A pharmacy can set a token's value by hand (Admin → Settings → Tokens; pharmacy.tokens, a map of token name ->
// text). A set value wins over the store's data for ${Suburb} and ${Phone}, and over nothing for any other token
// name used in copy or template HTML, which otherwise renders as nothing. ${StoreName} is the pharmacy name
// (Settings → Pharmacy details) and ${CloseTime} / ${OpenTime} change through the day, so none of the three can be
// set by hand (LIVE_TOKENS): a value stored for one before that rule is ignored.

export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SUB = /\$\{Suburb\}|\{store\}/g;
const SUBGAP = /,?\s*(<br>)?\s*(\$\{Suburb\}|\{store\})/g;

/**
 * Rich-text sanitiser for headlines and bar messages. Keeps only bold, italic, line breaks and the two
 * styling spans the editor writes (<span class="reg"> regular weight, <span class="acc"> accent colour).
 * Every other tag is dropped and its text kept; <div>/<p> become line breaks; script/style are removed.
 */
export function clean(html) {
  const src = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = [];
  const stack = []; // {src, close}
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let last = 0, m;
  const text = (t) => out.push(t.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const ends = () => out.join('').replace(/\s+$/, '');
  while ((m = re.exec(src))) {
    if (m.index > last) text(src.slice(last, m.index));
    last = re.lastIndex;
    const closing = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (closing) {
      const i = stack.map((s) => s.src).lastIndexOf(tag);
      if (i < 0) continue;
      while (stack.length > i) { const s = stack.pop(); if (s.close) out.push(s.close); }
      continue;
    }
    if (tag === 'br') { out.push('<br>'); continue; }
    if (/\/\s*$/.test(attrs)) continue; // other self-closing tags: dropped
    let open = '', close = '';
    if (tag === 'b' || tag === 'strong') { open = '<b>'; close = '</b>'; }
    else if (tag === 'i' || tag === 'em') { open = '<i>'; close = '</i>'; }
    else if (tag === 'span') {
      const cls = (/class\s*=\s*["']([^"']*)["']/i.exec(attrs) || [])[1] || '';
      const list = cls.split(/\s+/);
      if (list.includes('acc')) { open = '<span class="acc">'; close = '</span>'; }
      else if (list.includes('reg')) { open = '<span class="reg">'; close = '</span>'; }
    } else if (tag === 'div' || tag === 'p') {
      const sofar = ends();
      if (sofar && !/<br>$/.test(sofar)) out.push('<br>');
    }
    if (open) out.push(open);
    stack.push({ src: tag, close });
  }
  if (last < src.length) text(src.slice(last));
  while (stack.length) { const s = stack.pop(); if (s.close) out.push(s.close); }
  return out.join('').replace(/(<br>)+$/, '');
}

/** ${Suburb} in already-safe HTML: insert the escaped suburb, or blank it with its leading comma / line break. */
export function applySuburb(html, suburb) {
  const v = String(suburb || '').trim();
  return v ? String(html).replace(SUB, esc(v)) : String(html).replace(SUBGAP, '');
}

/** Rich text (headlines, bar messages) -> safe HTML with ${Suburb} resolved. */
export const rich = (t, suburb) => applySuburb(clean(t), suburb);

/** Plain text (accent line, line 1, line 2, intro lines) -> escaped text with ${Suburb} resolved. */
export function fill(t, suburb) {
  const v = String(suburb || '').trim(), x = String(t || '');
  return esc(v ? x.replace(SUB, v) : x.replace(SUBGAP, ''));
}

/** ${StoreName} in already-safe HTML (rich() / fill() output): the escaped store name. */
export const applyStoreName = (html, name) => String(html).replace(/\$\{StoreName\}/g, esc(String(name || '').trim()));

/** ${CloseTime} / ${OpenTime} in already-safe HTML. */
export const timeTokens = (html, closeTime, openTime) =>
  String(html).replace(/\$\{CloseTime\}/g, esc(closeTime || '')).replace(/\$\{OpenTime\}/g, esc(openTime || ''));

/** Fill a template's ${Token} slots from T; an unknown token renders as nothing. */
export const fillTemplate = (html, T) => String(html || '').replace(/\$\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(T, k) ? T[k] : ''));

/** The slots each built-in template base offers to custom template HTML (shown as chips in the editor). */
export const TEMPLATE_TOKENS = {
  scenes: ['Logo', 'Headline', 'AccentLine', 'Content', 'Icon', 'ServiceLabel', 'Line1', 'Line2', 'Tiles', 'Footer', 'OpenToday', 'Chevron', 'ViewBox', 'EdgePath', 'Suburb', 'StoreName', 'Phone', 'State', 'StoreCode'],
  hours: ['Logo', 'Headline', 'HoursCard', 'HolidayNote', 'ContactLine', 'Chevron', 'ViewBox', 'EdgePath', 'Suburb', 'StoreName', 'Phone', 'State', 'StoreCode'],
  occasion: ['Logo', 'Headline', 'AccentLine', 'Content', 'Icon', 'Line1', 'Line2', 'Tiles', 'Decor', 'Footer', 'OpenToday', 'HolidayNote', 'Chevron', 'ViewBox', 'EdgePath', 'Suburb', 'StoreName', 'Phone', 'State', 'StoreCode'],
};

/** Tokens filled from the store's data (the Location API, the pharmacy's name, today's hours). */
export const DATA_TOKENS = ['Suburb', 'StoreName', 'Phone', 'State', 'StoreCode', 'CloseTime', 'OpenTime'];

/** The tokens the editor's "+ Add token" menu offers above every headline field, in the order shown: the store's
 *  data first, then the ones a pharmacy sets in Settings → Tokens (they show nothing until a value is set there). */
export const ADD_TOKENS = [
  { name: 'StoreName', label: 'Store name', source: 'Pharmacy name' },
  { name: 'Suburb', label: 'Suburb', source: 'From Personalisation Hub' },
  { name: 'BrandName', label: 'Brand name', source: 'Set in Settings → Tokens' },
  { name: 'StoreCode', label: 'Store code', source: 'From Personalisation Hub' },
  { name: 'State', label: 'State', source: 'From Personalisation Hub' },
  { name: 'Phone', label: 'Phone number', source: 'From Personalisation Hub' },
  { name: 'Website', label: 'Website', source: 'Set in Settings → Tokens' },
  { name: 'LanguagesSpoken', label: 'Languages spoken by store staff', source: 'Set in Settings → Tokens' },
  { name: 'LocalisedCopy', label: 'Localised copy', source: 'Set in Settings → Tokens' },
];

/** Data tokens never set by hand: ${StoreName} is the pharmacy name (Settings → Pharmacy details), and today's
 *  ${CloseTime} / ${OpenTime} change through the day, so a fixed value would be wrong most of the time. */
export const LIVE_TOKENS = ['StoreName', 'CloseTime', 'OpenTime'];

/** Template slots the render engine fills with layout (headline, logo, tiles, ...): never set by hand. */
export const SLOT_TOKENS = [...new Set(Object.values(TEMPLATE_TOKENS).flat())].filter((k) => !DATA_TOKENS.includes(k));

/** A token name a pharmacy may set: letters, digits and underscores, starting with a letter, not a template slot and
 *  not a live data token (LIVE_TOKENS). */
export const TOKEN_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
export const isSettableToken = (name) => TOKEN_NAME_RE.test(String(name)) && !SLOT_TOKENS.includes(String(name)) && !LIVE_TOKENS.includes(String(name));

/** The ${Token} names in a string, in order of first use. */
export function tokensIn(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(/\$\{(\w+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** A pharmacy's hand-set token values: settable names with non-blank text only (trimmed). */
export function cleanTokens(tokens) {
  const out = {};
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return out;
  for (const [k, v] of Object.entries(tokens)) if (isSettableToken(k) && typeof v === 'string' && v.trim()) out[k] = v.trim();
  return out;
}

/** ${Token}s in already-safe HTML for every name in `values` (own properties only), escaped; others are left alone. */
export const applyTokens = (html, values) =>
  String(html).replace(/\$\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(values, k) ? esc(values[k]) : m));
