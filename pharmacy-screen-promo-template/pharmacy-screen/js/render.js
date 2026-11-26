// Render engine for the pharmacy screen: one scene of one promotion for one store, in either orientation.
// Shared by the player page (pharmacy-screen.html) and the admin editor's live preview.
//
//   const store = storeModel(campaignData, config)          // Location API response + per-pharmacy config
//   const play  = resolvePromotion(config, store, 'morning') // promotion + its template + this store's content
//   const seq   = sequence(play)                              // [{k, t}] scenes and their seconds
//   renderScene(screenEl, { store, play, orientation: 'portrait', scene: 0, now, enter: true })

import { DAYS, parseOpeningHours, storeNow, storeState, fmtShort, weeklyRows } from './hours.js';
import { esc, rich, fill, timeTokens, fillTemplate, applyStoreName, cleanTokens, applyTokens, DATA_TOKENS } from './tokens.js';
import { geom, ptsPath, ptsClip, fitText, fitOccasion, fitSale } from './fit-text.js';
import { OCCASION_DESIGNS, OCCASION_CSS } from './occasions.js';

// ---------- seasonal (internally "occasions") ----------
// The "Seasonal" promotion (promo=occasions, the ID kept so existing campaign URLs keep working) plays one of six
// read-only built-in templates, one per season. Which one is worked out from the date in the store's time zone: each
// season has its dates (content.occasions[<season>].from / .to, "MM-DD", inclusive, each year; defaults in
// OCCASIONS[].season, Easter Good Friday to Easter Monday, worked out for each year), and the screen plays the season
// whose dates hold today (activeOccasion()), switching by itself at midnight. Outside every season's dates it plays
// the season picked in the admin editor's Season drop-down (the pharmacy's own; the config API publishes it as the
// promotion's template for that store, config-api/src/seasonal.js). Each is a
// standalone, full-screen animation (js/occasions.js, the approved designs): no brand panel, logo, brand colours,
// icon tiles or Open today bar. Its copy plays as beats over 12 s (Christmas 2 beats, the others 3: on the player once
// through, the last beat then staying on screen, js/player.js; in the editor's preview and with loop=1 on a loop); a beat is
// a main line and, where the design has one, a small label line (above it, or for Australia Day's last beat a pill
// below it). Each beat's seconds on screen can be set (beat.dur, 1-60; the loop is then their sum): left at the
// defaults, the design's own CSS loop plays unchanged (occasionTiming()).
// The copy is each pharmacy's own (content.occasions[<occasion>] = {beats: [{label?, text, dur?}], from?, to?}), with
// ${Suburb} in all six and ${StoreName} in Christmas and New Year's. Anzac Day is commemorative: fades only.
// design: the template's key in js/occasions.js. fonts: what to load before fitting the copy (document.fonts.load).
// season: the default dates ({from, to} as "MM-DD"; {easter: true}: Good Friday to Easter Monday, moving each year).
const BT = (main, text, label) => ({ main, text, ...label });
const ABOVE = (cls, value, span) => ({ label: { cls, pos: 'above', span: !!span, value } });
const BELOW = (cls, value) => ({ label: { cls, pos: 'below', value } });
export const OCCASIONS = [
  // The fallback (23 Nov 2026): what the Seasonal promotion plays whenever no season is on (no dates of its own, so
  // activeOccasion() never picks it; liveOccasion() falls back to it). Unlike the seasons it is drawn in the pharmacy's
  // own brand colours with its logo and name: "Thank you, ${Suburb}" (0-2 s), "for supporting your local pharmacy"
  // beneath it (2-5 s), then the logo and ${StoreName} at the bottom (5-7 s). Exactly 7 s: its timings are fixed (durs).
  {
    id: 'fallback', name: 'Fallback', fallback: true, branded: true, season: null, design: 'thankyou', durs: [2, 3, 2],
    fonts: ['800 1em "Figtree"', '500 1em "Figtree"', '700 1em "Figtree"'],
    beats: [BT('hl', 'Thank you, ${Suburb}'), BT('sub', 'for supporting your local pharmacy'), BT('nm', '${StoreName}')],
  },
  {
    id: 'christmas', name: 'Christmas', season: { from: '12-15', to: '12-27' }, design: 'christmas',
    fonts: ['italic 600 1em "Playfair Display"', '500 1em "Playfair Display"', '500 1em "Outfit"'],
    beats: [BT('hl', 'Merry Christmas, ${Suburb}'), BT('sub', 'from the whole ${StoreName} team', ABOVE('kicker', 'With warm wishes'))],
  },
  {
    id: 'new-year', name: "New Year's", season: { from: '12-28', to: '01-05' }, design: 'newyear',
    fonts: ['900 1em "Big Shoulders Display"', '800 1em "Big Shoulders Display"', '400 1em "Outfit"'],
    beats: [BT('hl', 'Happy<br>New Year'), BT('sub', 'Thank you for a great year, ${Suburb}'), BT('sub sm', 'from the whole ${StoreName} team', ABOVE('kicker', "Here's to a healthy year ahead"))],
  },
  {
    id: 'australia-day', name: 'Australia Day', season: { from: '01-26', to: '01-26' }, design: 'ausday',
    fonts: ['400 1em "Archivo Black"', '700 1em "Archivo"'],
    beats: [BT('hl', 'Happy Australia Day, ${Suburb}', ABOVE('kicker', '26 January', true)), BT('hl', 'Enjoy the sunshine'), BT('hl', 'Slip, slop, slap', BELOW('sub', 'Stay sun safe this summer'))],
  },
  {
    id: 'valentines-day', name: "Valentine's Day", season: { from: '02-14', to: '02-14' }, design: 'valentine',
    fonts: ['italic 400 1em "DM Serif Display"', '500 1em "Outfit"'],
    beats: [BT('hl', "Happy Valentine's Day, ${Suburb}", ABOVE('kicker', '14 February')), BT('hl', 'Look after the ones you love'), BT('hl', 'and yourself, too')],
  },
  {
    id: 'easter', name: 'Easter', season: { easter: true }, design: 'easter',
    fonts: ['600 1em "Fredoka"'],
    beats: [BT('hl', 'Happy Easter, ${Suburb}'), BT('hl', 'Wishing you a restful long weekend'), BT('hl', 'Take time to recharge')],
  },
  {
    id: 'anzac-day', name: 'Anzac Day', season: { from: '04-25', to: '04-25' }, design: 'anzac', solemn: true,
    fonts: ['500 1em "Cormorant Garamond"', '600 1em "Cormorant Garamond"', 'italic 500 1em "Cormorant Garamond"'],
    beats: [BT('hl', 'Anzac Day', ABOVE('kicker', '25 April')), BT('hl', 'Lest we forget'), BT('sub', 'Remembering together, ${Suburb}')],
  },
];
export const OCCASION_IDS = OCCASIONS.map((o) => o.id);
/** The seasons proper: every occasion but the fallback (the ones with dates). */
export const SEASON_IDS = OCCASIONS.filter((o) => !o.fallback).map((o) => o.id);
export const FALLBACK_OCCASION = 'fallback';
export const DEFAULT_OCCASION = 'christmas';
/** One loop of an occasion's beats at their default timings, in seconds (the designs' CSS animations). */
export const OCCASION_LOOP = 12;

/** Seconds on screen, as set in the editor: a number from 1 to 60, or the default `d` when it is not one. */
export const sceneSeconds = (v, d) => { const n = typeof v === 'string' && v.trim() ? +v : v; return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.max(1, Math.min(60, n)) : d; };

/** The default seconds of the opening-hours headlines: 2.7, 2.7, 2.6 for three (8 s), else 8 s shared equally. */
export const defaultHeadlineSeconds = (n) => (n === 3 ? [2.7, 2.7, 2.6] : Array.from({ length: n }, () => +(8 / n).toFixed(2)));

/** One beat's seconds on screen: its `dur`, else its share of the design's default 12 s loop. */
export const beatSeconds = (beat, count) => sceneSeconds(beat && beat.dur, OCCASION_LOOP / (count || 1));
/** Beat i of occasion `id`: its fixed seconds where the design has them (the fallback: 2, 3, 2), else beatSeconds. */
export const occasionBeatSeconds = (id, beat, i, count) => { const f = occasionOf(id).durs; return f ? f[i] || 0 : beatSeconds(beat, count); };
export const occasionOf = (id) => OCCASIONS.find((o) => o.id === id) || OCCASIONS[0]; // unknown: the fallback
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
const isLegacyDefault = (id, scenes) => Array.isArray(scenes) && scenes.length === 3 && !!LEGACY_OCCASION_COPY[id] && scenes.every((x, i) => sameCopy(x, LEGACY_OCCASION_COPY[id][i]) && !(x && x.dur));

// ---------- season dates ----------
const MD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A valid "MM-DD" (a day that exists in some year: 02-29 is allowed, 02-30 is not), or ''. */
export function cleanMonthDay(v) {
  const m = MD.exec(String(v || '').trim());
  if (!m) return '';
  return +m[2] <= [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+m[1] - 1] ? m[0] : '';
}
/** The dates saved on one season's copy: {from, to} when both are valid "MM-DD", else {} (the defaults apply). */
export function seasonDatesOf(saved) {
  const from = cleanMonthDay(saved && saved.from), to = cleanMonthDay(saved && saved.to);
  return from && to ? { from, to } : {};
}
/** Easter Sunday of year y, as {m, d} (the Gregorian computus). */
export function easterSunday(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}
const pad2 = (n) => String(n).padStart(2, '0');
const shiftDay = (y, m, d, by) => { const t = new Date(Date.UTC(y, m - 1, d + by)); return pad2(t.getUTCMonth() + 1) + '-' + pad2(t.getUTCDate()); };
/**
 * One season's dates in year y, as {from, to} ("MM-DD", inclusive; from after to: the dates run over New Year):
 * the dates saved on its copy, else its defaults (Easter: Good Friday to Easter Monday of that year).
 */
export function seasonDates(id, saved, y) {
  const own = seasonDatesOf(saved);
  if (own.from) return own;
  const s = occasionOf(id).season || {};
  if (!occasionOf(id).season) return {};
  if (s.easter) { const e = easterSunday(y); return { from: shiftDay(y, e.m, e.d, -2), to: shiftDay(y, e.m, e.d, 1) }; }
  return { from: s.from, to: s.to };
}
/** Whether "MM-DD" `md` falls within {from, to} (inclusive; a range whose from is after its to runs over New Year). */
export const inSeason = (md, r) => !!(r && r.from && r.to) && (r.from <= r.to ? md >= r.from && md <= r.to : md >= r.from || md <= r.to);
/**
 * The season whose dates hold `today` ({y, m, d}, the store's date), from a promotion's content.occasions, or ''.
 * Where two seasons' dates overlap, the one that started most recently wins (a one-day season inside a longer one
 * plays on its day).
 */
export function activeOccasion(occasions, today) {
  if (!today || !today.y) return '';
  const md = pad2(today.m) + '-' + pad2(today.d);
  // How many days ago a range started (0: today), counting back over New Year.
  const since = (from) => { const [fm, fd] = from.split('-').map(Number); let a = Date.UTC(today.y, fm - 1, fd); const t = Date.UTC(today.y, today.m - 1, today.d); if (a > t) a = Date.UTC(today.y - 1, fm - 1, fd); return (t - a) / 864e5; };
  let best = '', bestSince = Infinity;
  for (const id of SEASON_IDS) {
    // A range that runs over New Year, seen in January, started last year: Easter's of this year is right either way.
    const r = seasonDates(id, occasions && occasions[id], today.y);
    if (!inSeason(md, r)) continue;
    const s = since(r.from);
    if (s < bestSince) { best = id; bestSince = s; }
  }
  return best;
}
const ymdOf = (t) => t.y + '-' + pad2(t.m) + '-' + pad2(t.d);
const YMD = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/**
 * A pharmacy's one-off "Activate on display" (content.activation = {occasion, until: "YYYY-MM-DD"}), when it is
 * well formed and still running on `today` (the store's date): {occasion, until}; else null. It ends at the end of
 * its `until` day, so it never carries over into the next year.
 */
export function activationOn(activation, today) {
  if (!activation || typeof activation !== 'object' || !today || !today.y) return null;
  const { occasion, until } = activation;
  if (!OCCASION_IDS.includes(occasion) || !YMD.test(String(until || ''))) return null;
  return ymdOf(today) <= until ? { occasion, until } : null;
}
/** The season the schedule plays on `today` by the pharmacy's dates, else the fallback. */
export const scheduledOccasion = (occasions, today) => activeOccasion(occasions, today) || FALLBACK_OCCASION;
/**
 * What a Seasonal promotion plays on `today` for one pharmacy's content ({occasions, activation}): a running
 * activation, else the season whose dates hold today, else the fallback. No date known: the fallback.
 */
export function liveOccasion(content, today) {
  const a = activationOn(content && content.activation, today);
  return a ? a.occasion : scheduledOccasion(content && content.occasions, today);
}
/**
 * The last day ("YYYY-MM-DD") an "Activate on display" of `id` on `today` runs to: the scheduled end date of that
 * season's current run, or of its next one when it is not on yet (by the pharmacy's dates; Easter worked out for the
 * year; a range over New Year ends in the next year). The fallback runs to the end of the season the schedule plays
 * today. '' when there is nothing to run to (the fallback with no season on: the schedule already plays it).
 */
export function activationUntil(id, occasions, today) {
  if (!today || !today.y || !OCCASION_IDS.includes(id)) return '';
  if (occasionOf(id).fallback) { const on = activeOccasion(occasions, today); return on ? activationUntil(on, occasions, today) : ''; }
  const md = pad2(today.m) + '-' + pad2(today.d);
  const end = (y) => { const r = seasonDates(id, occasions && occasions[id], y); return r.from && r.to ? { ...r, y: r.from <= r.to ? y : y + 1 } : null; };
  // Its run that started this year (or, over New Year, the one that started last year and ends this year).
  const runs = [end(today.y - 1), end(today.y), end(today.y + 1)].filter(Boolean);
  for (const r of runs) {
    const stop = r.y + '-' + r.to;
    if (today.y + '-' + md <= stop) return stop; // the first run not yet over: on now, or the next one
  }
  return '';
}
/** "15 Dec", for a "MM-DD". */
export const fmtMonthDay = (md) => { const m = MD.exec(md || ''); return m ? `${+m[2]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m[1] - 1]}` : ''; };

/**
 * A pharmacy's saved copy for one occasion as {beats}, whatever shape it was saved in: the current shape with any
 * missing line filled from the defaults, the old three-scene shape (unedited: the new defaults; edited: kept, beat by
 * beat), or the defaults when there is none.
 */
export function occasionCopy(id, saved) {
  const occ = occasionOf(id), def = defaultOccasion(occ.id);
  const str = (v, d) => (typeof v === 'string' ? v : d);
  if (saved && Array.isArray(saved.beats)) {
    // The fallback has no dates and fixed timings: only its copy is kept.
    const fixed = !!occ.durs;
    return { ...(fixed ? {} : seasonDatesOf(saved)), beats: def.beats.map((d, i) => {
      const v = saved.beats[i] && typeof saved.beats[i] === 'object' ? saved.beats[i] : {};
      const b = 'label' in d ? { label: str(v.label, d.label), text: str(v.text, d.text) } : { text: str(v.text, d.text) };
      const dur = fixed ? undefined : sceneSeconds(v.dur, undefined);
      return dur === undefined ? b : { ...b, dur };
    }) };
  }
  if (saved && Array.isArray(saved.scenes) && !isLegacyDefault(occ.id, saved.scenes)) {
    return { beats: def.beats.map((d, i) => { const v = saved.scenes[i] && typeof saved.scenes[i] === 'object' ? saved.scenes[i] : {}; return 'label' in d ? { label: str(v.sub, d.label), text: str(v.title, d.text) } : { text: str(v.title, d.text) }; }) };
  }
  return def;
}

// ---------- sales promos (promo=sale) ----------
// The "Sales Promos" promotion (promo=sale, the first tab in the editor) plays its own built-in template (t_sale,
// config-api/src/builtins.js "builtin-sale"), drawn by renderSale() in the pharmacy's own branding: two scenes on the
// brand shell (the wedge with the logo, the accent edge line and chevron, the footer band). Scene 1 "the brands"
// (default 3.5 s): the headline pops in inside the wedge, the brand cards pop in one after another under it, then the
// caption. Scene 2 "the offer" (default 5.85 s, after a 0.65 s transition in which the wedge grows until the brand
// colour fills the screen above the footer band): rotating rays, "UP TO", the offer value counting up from 0 with a
// bounce and a heartbeat, "OFF", the pulsing end-date panel and the brand list. The footer band shows the sale.
// The copy is each pharmacy's own (content.sale, saleCopy()): it is not a master section, so a pharmacy's own copy
// always wins and a promotion's master only supplies the copy of pharmacies that have none. The end date is a
// "YYYY-MM-DD" (a date picker in the editor); its wording ("Wednesday 2nd December") is generated from it, so the
// weekday always agrees with the date. Once the end date is over in the store's time zone, the screen plays the
// pharmacy's Morning promotion (before 12:00) or Afternoon (from 12:00) instead (resolvePromotion).
export const SALE_TRANSITION = 0.65;
export const SALE_MAX_BRANDS = 6;
export const SALE_MAX_BRAND_LENGTH = 30;
/** The default copy: the Big Brand Sale made for the launch pharmacies (26 Nov 2026). */
export const defaultSale = () => ({
  headline1: 'BIG BRAND', headline2: 'SALE', brands: ['TOSHI', 'CETAPHIL', 'NATIO', 'BLACKMORES'],
  lead: 'UP TO', value: 30, suffix: 'OFF', caption: 'Four big brands. One big sale.', endDate: '2026-12-02',
  panelLabel: 'SALE FINISHES', s1: 3.5, s2: 5.85,
});
const SALE_YMD = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
/** A real calendar date "YYYY-MM-DD" (2026-02-30 is not one), or ''. */
export function cleanYmd(v) {
  const m = SALE_YMD.exec(String(v || '').trim());
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCDate() === +m[3] && t.getUTCMonth() === +m[2] - 1 ? m[0] : '';
}
/** The offer value: a whole number from 1 to 99, or undefined. */
export const saleValue = (v) => { const n = typeof v === 'string' && v.trim() ? +v : v; return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99 ? n : undefined; };
/**
 * A pharmacy's saved sale copy, whatever is missing filled from the defaults: {headline1, headline2, brands [1-6],
 * lead, value (1-99), suffix, caption, endDate "YYYY-MM-DD", panelLabel, s1, s2 (seconds), footer? {custom: true,
 * line1, line2}}. The footer override is kept only while it is switched on.
 */
export function saleCopy(saved) {
  const d = defaultSale(), s = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const str = (k) => (typeof s[k] === 'string' ? s[k] : d[k]);
  const brands = Array.isArray(s.brands) ? s.brands.filter((b) => typeof b === 'string').map((b) => b.slice(0, SALE_MAX_BRAND_LENGTH)).slice(0, SALE_MAX_BRANDS) : null;
  const f = s.footer && typeof s.footer === 'object' && s.footer.custom === true ? s.footer : null;
  return {
    headline1: str('headline1'), headline2: str('headline2'), brands: brands && brands.length ? brands : d.brands,
    lead: str('lead'), value: saleValue(s.value) ?? d.value, suffix: str('suffix'), caption: str('caption'),
    endDate: cleanYmd(s.endDate) || d.endDate, panelLabel: str('panelLabel'),
    s1: sceneSeconds(s.s1, d.s1), s2: sceneSeconds(s.s2, d.s2),
    ...(f ? { footer: { custom: true, line1: typeof f.line1 === 'string' ? f.line1 : '', line2: typeof f.line2 === 'string' ? f.line2 : '' } } : {}),
  };
}
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st, 22nd, 23rd … 31st. */
export const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
/** "Wednesday 2nd December" for "2026-12-02": the weekday worked out from the date, never typed. '' for a bad date. */
export function saleDateText(ymd) {
  const v = cleanYmd(ymd);
  if (!v) return '';
  const [y, m, d] = v.split('-').map(Number);
  return `${WEEKDAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${ordinal(d)} ${MONTH_NAMES[m - 1]}`;
}
/** Whether the sale's end date is over on `today` ({y, m, d}, the store's date): it runs to the end of its end date. */
export function saleEnded(copy, today) {
  if (!today || !today.y) return false;
  return `${today.y}-${String(today.m).padStart(2, '0')}-${String(today.d).padStart(2, '0')}` > saleCopy(copy).endDate;
}
/** "UP TO 30% OFF". */
export const saleOffer = (c) => [c.lead, `${c.value}%`, c.suffix].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
/** Caption line 2: "Finishes Wednesday 2nd December". */
export const saleFinishes = (c) => { const t = saleDateText(c.endDate); return t ? `Finishes ${t}` : ''; };
/** The footer band's two lines: derived from the copy ("BIG BRAND SALE · UP TO 30% OFF" / "Finishes Wednesday 2nd
 *  December", set in capitals on screen), or the text typed in the editor when the override is on. */
export function saleFooter(c) {
  if (c.footer && c.footer.custom) return { line1: c.footer.line1, line2: c.footer.line2 };
  const head = [c.headline1, c.headline2].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
  return { line1: [head, saleOffer(c)].filter(Boolean).join(' · '), line2: saleFinishes(c) };
}
/** One loop of the sale in seconds: scene 1, the transition, scene 2 (10 s at the defaults). */
export const saleSeconds = (c) => Math.round((c.s1 + SALE_TRANSITION + c.s2) * 1000) / 1000;
/** The promotions a finished sale falls back to, in order: Morning before 12:00 store time, else Afternoon. */
export const saleFallbackOrder = (now) => (now && Number.isFinite(now.min) && now.min < 720 ? ['morning', 'afternoon'] : ['afternoon', 'morning']);

// ---------- built-in templates ----------
export const BUILTIN_TEMPLATES = [
  { id: 't_scenes', name: 'Promotion scenes', base: 'scenes', builtin: true },
  { id: 't_hours', name: 'Opening hours', base: 'hours', builtin: true },
  ...OCCASIONS.map((o) => ({ id: 't_occ_' + o.id, name: o.name, base: 'occasion', occasion: o.id, builtin: true })), // drawn by renderOccasion()
  { id: 't_sale', name: 'Sales promo', base: 'sale', builtin: true }, // drawn by renderSale()
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
  if (base === 'sale') return { sale: defaultSale() };
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
  // Token values set by hand on the pharmacy (Admin → Settings → Tokens) win over the store's data. ${StoreName}
  // cannot be set by hand (cleanTokens drops LIVE_TOKENS): it is the store name the Location API returns for this
  // screen's device, and the pharmacy name in the editor only when the API has none.
  const tokens = cleanTokens(ph.tokens);
  return {
    code,
    name: String(loc.store_name || '').trim() || String(ph.name || '').trim(),
    suburb: tokens.Suburb || String(addr.suburb || '').trim(),
    tz: loc.store_timezone || 'Australia/Melbourne',
    phone: tokens.Phone || addr.phone_number || '',
    // ${State} / ${StoreCode} (the editor's "+ Add token" menu): the store's data unless set by hand.
    state: tokens.State || String(addr.state || '').trim(),
    storeCode: tokens.StoreCode || code,
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
 * opts.today: the store's date ({y, m, d}, hours.js storeDate()): a seasonal promotion plays the season whose dates
 * hold it (activeOccasion), else the one it is set to. opts.occasion: play that season instead (a seasonal promotion
 * only; the copy-fit audit uses it to check every season).
 */
export function resolvePromotion(config, store, promoId, opts = {}) {
  const promos = (config && config.promotions) || [];
  const promo = promos.find((p) => promoIdOf(p) === String(promoId || ''));
  if (!promo) throw new ScreenError('unknown-promo', 'Promotion not found', `No promotion has the promo ID "${promoId || ''}".`);
  const templates = BUILTIN_TEMPLATES.concat(((config && config.templates) || []).filter((t) => !t.builtin));
  const tid = promo.template || promo.tpl;
  let template = templates.find((t) => t.id === tid);
  if (!template) template = BUILTIN_TEMPLATES[promo.type === 'hours' ? 1 : 0];
  let content = store.content[promoIdOf(promo)] || store.content[promo.id];
  // A seasonal promotion plays the season whose dates hold opts.today (the store's date; the player passes it),
  // else the one it is set to. opts.occasion (the copy-fit audit, the editor's preview) wins over both.
  let auto = false;
  if (template.base === 'occasion') {
    // opts.today known (the player): a running "Activate on display", else the season whose dates hold it, else the
    // fallback (liveOccasion). Without it, the season the template names (the fallback, as the config API publishes it).
    const pick = opts.occasion && OCCASION_IDS.includes(opts.occasion) ? opts.occasion : opts.today ? liveOccasion(content, opts.today) : '';
    if (pick) { auto = !opts.occasion; template = BUILTIN_TEMPLATES.find((t) => t.occasion === pick); }
  }
  if (template.base === 'occasion') {
    // Content keeps every occasion's copy (content.occasions[<occasion>]), so switching occasion and back loses nothing.
    const occasion = occasionOf(template.occasion).id;
    const copy = occasionCopy(occasion, content && content.occasions && content.occasions[occasion]);
    return { promo, promoId: promoIdOf(promo), template, base: 'occasion', occasion, auto, content: { beats: copy.beats } };
  }
  if (template.base === 'sale') {
    const copy = saleCopy(content && content.sale);
    // The end date is over at the store (opts.today, the store's date; the player passes it): the pharmacy's Morning
    // promotion before 12:00 store time, else its Afternoon (whichever of the two it has), with endedSale saying which
    // sale it stands in for. Without opts.today (the editor's preview) the sale plays as it is.
    if (opts.today && !opts.noSaleFallback && saleEnded(copy, opts.today)) {
      const fb = saleFallbackOrder(opts.now || storeNow(store.tz)).find((id) => id !== promoIdOf(promo) && promos.some((p) => promoIdOf(p) === id));
      if (fb) return { ...resolvePromotion(config, store, fb, { ...opts, noSaleFallback: true }), endedSale: promoIdOf(promo) };
    }
    return { promo, promoId: promoIdOf(promo), template, base: 'sale', content: { sale: copy } };
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
    // Each headline's seconds (headlineDurs[i]), else the defaults (2.7 + 2.7 + 2.6 for three).
    const n = (d.headlines || []).length || 1, def = defaultHeadlineSeconds(n), durs = Array.isArray(d.headlineDurs) ? d.headlineDurs : [];
    return def.map((t, i) => ({ k: i, t: sceneSeconds(durs[i], t) }));
  }
  // An occasion's beats: each its own seconds, else an equal share of the design's 12 s loop (Christmas 6 s + 6 s,
  // the others 4 s each).
  // The sale: scene 1 (the brands), then scene 2 (the offer), which starts with the 0.65 s transition.
  if (play.base === 'sale') return [{ k: 'brands', t: d.sale.s1 }, { k: 'offer', t: Math.round((SALE_TRANSITION + d.sale.s2) * 1000) / 1000 }];
  if (play.base === 'occasion') return d.beats.map((x, i) => ({ k: i, t: occasionBeatSeconds(play.occasion, x, i, d.beats.length) }));
  return [{ k: 'intro', t: +d.introDur || 3 }, ...d.slots.map((x, i) => ({ k: i, t: +x.dur || 2 })), { k: 'close', t: +(d.close && d.close.dur) || 2 }];
}

export function sceneName(play, i) {
  const s = sequence(play)[i];
  if (!s) return '';
  if (play.base === 'hours') return 'Headline ' + (i + 1);
  if (play.base === 'occasion') return 'Beat ' + (i + 1);
  if (play.base === 'sale') return s.k === 'brands' ? 'The brands' : 'The offer';
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
  // Today's times, always live: ${CloseTime} / ${OpenTime} cannot be set by hand (tokens.js LIVE_TOKENS).
  return timeTokens(rich(F[key], store.suburb), fmtShort(state.closeTime, true), fmtShort(state.openTime, true));
}

// Template HTML is written by an administrator, and it plays on unattended screens and in the editor's preview,
// so nothing in it may run: the config API refuses unsafe markup when it is saved (config-api/src/validate.js)
// and this is the screen's own half. The markup is parsed inertly, every element that can load or run something
// and every event handler or script URL is removed, and only then does it enter the page.
const BLOCKED_TAGS = new Set(['script', 'iframe', 'object', 'embed', 'frame', 'frameset', 'base', 'meta', 'link', 'form', 'foreignobject', 'animate', 'set', 'animatemotion', 'animatetransform', 'handler', 'listener']);
const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'data', 'srcset', 'ping']);
const BAD_URL = /^[\s\u0000-\u001f]*(javascript|vbscript|data\s*:\s*text\/html)\s*:?/i;
export function cleanTemplateDom(root) {
  for (const node of [...root.querySelectorAll('*')]) {
    if (BLOCKED_TAGS.has(node.localName.toLowerCase())) { node.remove(); continue; }
    for (const a of [...node.attributes]) {
      const name = a.name.toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || (URL_ATTRS.has(name) && BAD_URL.test(a.value)) || (name === 'style' && /expression\s*\(|javascript\s*:|@import/i.test(a.value))) node.removeAttribute(a.name);
    }
  }
  return root;
}
function writeTemplate(el, markup) {
  const doc = el.ownerDocument;
  const tpl = doc && doc.createElement ? doc.createElement('template') : null;
  if (!tpl || !tpl.content) { el.innerHTML = markup; return; }
  tpl.innerHTML = markup;
  cleanTemplateDom(tpl.content);
  if (el.replaceChildren) el.replaceChildren(tpl.content);
  else { el.textContent = ''; el.appendChild(tpl.content); } // an older WebView
}


/**
 * Render one scene into `el` (the 1080x1920 / 1920x1080 .screen element, id "screen").
 * opts: { store, play, orientation, scene, now: {day, min} | undefined, enter: boolean, loop: boolean, once: boolean,
 *   at: number }
 * An occasion promotion draws its whole animation (renderOccasion): with opts.loop its beats play on their CSS loop
 * (with opts.once too: one time through, the last beat staying on screen; opts.at: seconds already played, for a
 * redraw), otherwise beat `scene` is held still.
 * Returns { G, fit, state, ready } (ready: a promise, settled once an occasion's fonts are in and its copy refitted).
 */
export function renderScene(el, opts) {
  const { store, play } = opts;
  if (play.base === 'occasion') return renderOccasion(el, opts);
  if (play.base === 'sale') return renderSale(el, opts);
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
    // .multi: a day with more than one session, whose longer line the landscape card sets smaller (css/screen.css)
    const rows = weeklyRows(s.sessions).map((r) => `<div class="s-row${r.text && r.text.includes(', ') ? ' multi' : ''}"><span>${r.name}</span>${r.text ? `<span>${esc(r.text)}</span>` : '<span class="closed">Closed</span>'}</div>`).join('');
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
    Suburb: esc(sub), StoreName: esc(s.name), Phone: esc(s.phone || ''), State: esc(s.state || ''), StoreCode: esc(s.storeCode || ''),
  });
  // Any other token the pharmacy has set by hand: in template HTML as a slot, and in copy (with ${StoreName} and
  // ${Phone}, which copy otherwise leaves as written outside occasions).
  const custom = Object.fromEntries(Object.entries(s.tokens || {}).filter(([k]) => !DATA_TOKENS.includes(k) && !(k in T)));
  for (const [k, v] of Object.entries(custom)) T[k] = esc(v);
  const P = play.template;
  const html = applyTokens(fillTemplate(P.html || DEFAULT_HTML[play.base], T), { ...custom, StoreName: s.name, Phone: s.phone || '', State: s.state || '', StoreCode: s.storeCode || '' });
  const css = P.css ? scopeCss(P.css, '#' + (el.id || 'screen')) : '';
  const markup = (css ? `<style>${css}</style>` : '') + html;
  writeTemplate(el, markup);
  const top = el.querySelector('.s-top');
  if (top) top.style.clipPath = ptsClip(G.pts);
  const ep = el.querySelector('.s-edge path');
  if (ep) ep.style.d = `path('${ptsPath(G.edge)}')`;
  const bgP = safeUrl(P.bgPortrait || P.bgP), bgL = safeUrl(P.bgLandscape || P.bgL);
  const bg = land ? bgL || bgP : bgP || bgL;
  el.style.backgroundImage = bg ? `url("${bg}")` : '';
  el.style.backgroundSize = bg ? 'cover' : '';
  el.style.backgroundPosition = bg ? 'center' : '';
  const fit = fitScene(el, G, `${el.className}\n${markup}`);
  return { G, fit, state, ready: Promise.resolve() };
}

// A scene's fitted copy sizes, kept per content signature (the scene's class and its whole markup, so any change to
// the copy, template, data or clock text is a new signature): the loop's next pass over the same scene, or a redraw
// with nothing changed, sets the sizes it found last time instead of running the fit loop again. A fit measured
// before the fonts are in is not kept. Bounded, and emptied when full.
const FIT_MEMO = new Map();
const FIT_MEMO_MAX = 64;
/** How often the fit loop ran (misses) and how often a kept fit was reused (hits); for the tests. */
export const fitMemoStats = { hits: 0, misses: 0 };
function fitScene(el, G, key) {
  const fonts = el.ownerDocument && el.ownerDocument.fonts;
  const keep = !fonts || fonts.status === 'loaded';
  const head = el.querySelector('.s-head'), body = el.querySelector('.s-body');
  const hit = keep ? FIT_MEMO.get(key) : null;
  if (hit) {
    fitMemoStats.hits++;
    if (head && hit.k !== null) head.style.setProperty('--k', hit.k);
    if (body && hit.kb !== null) body.style.setProperty('--kb', hit.kb);
    return { ...hit.fit };
  }
  fitMemoStats.misses++;
  const fit = fitText(el, G);
  if (keep) {
    if (FIT_MEMO.size >= FIT_MEMO_MAX) FIT_MEMO.clear();
    FIT_MEMO.set(key, { fit: { ...fit }, k: head ? head.style.getPropertyValue('--k') : null, kb: body ? body.style.getPropertyValue('--kb') : null });
  }
  return fit;
}

/** The occasion templates' CSS (js/occasions.js), added to the document once. */
function occasionStyles(doc) {
  if (doc.getElementById('occasion-styles')) return;
  const st = doc.createElement('style');
  st.id = 'occasion-styles';
  st.textContent = OCCASION_CSS;
  doc.head.appendChild(st);
}

/**
 * An occasion's beat timings. Left at their defaults (every beat an equal share of 12 s) the design's own CSS loop
 * plays unchanged: { custom: false }. Otherwise { custom: true, total, css, style(i) }: keyframes for each beat over
 * a loop of `total` seconds, fading in and out like the designs (in 0.6 s, out 0.5 s, shorter for a 1 s beat), and
 * the inline style that puts beat i on them (inline, so it wins over each design's own animation-name).
 * opts.once (the player, playing once through): the last beat's keyframes end visible instead of fading out (the
 * designs' own loop does the same with the .once class, js/occasions.js).
 */
export function occasionTiming(beats, opts = {}) {
  const n = beats.length, t = beats.map((b) => beatSeconds(b, n));
  if (t.every((x) => x === OCCASION_LOOP / n)) return { custom: false, total: OCCASION_LOOP };
  const once = !!opts.once;
  const total = t.reduce((a, b) => a + b, 0), pc = (s) => +((s / total) * 100).toFixed(3) + '%';
  const id = 'occT' + (once ? 'o' : '') + t.map((x) => String(x).replace('.', 'p')).join('_');
  let start = 0, css = '';
  t.forEach((d, i) => {
    const a = start, end = start + d, fin = Math.min(0.6, d / 4), fout = Math.min(0.5, d / 4);
    const hide = 'opacity:0;transform:var(--from,translateY(5cqmin))', gone = 'opacity:0;transform:var(--to,translateY(-3cqmin))';
    const out = once && i === n - 1 ? `${pc(a + fin)},100%{opacity:1;transform:none}` : `${pc(a + fin)},${pc(end - fout)}{opacity:1;transform:none}${end < total ? `${pc(end)},100%` : '100%'}{${gone}}`;
    css += `@keyframes ${id}B${i + 1}{${a ? `0%,${pc(a)}` : '0%'}{${hide}}${out}}`;
    start = end;
  });
  return { custom: true, total, css, style: (i) => `animation-name:${id}B${i + 1};animation-duration:${total}s` };
}

/** One beat of an occasion: its label line (above or below, where the design has one) and its main line. */
function beatHtml(layout, copy, i, on, R, P, style) {
  const text = R(copy.text), lab = layout.label ? P(copy.label) : '';
  const label = lab ? `<div class="${layout.label.cls}">${layout.label.span ? `<span>${lab}</span>` : lab}</div>` : '';
  const main = text ? `<div class="${layout.main}">${text}</div>` : '';
  const pos = layout.label && layout.label.pos;
  return `<div class="b b${i + 1}${on ? ' on' : ''}"${style ? ` style="${style}"` : ''}>${pos === 'above' ? label : ''}${main}${pos === 'below' ? label : ''}</div>`;
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
  const T = (h) => applyTokens(applyStoreName(h, store.name), { ...custom, Phone: store.phone || '', State: store.state || '', StoreCode: store.storeCode || '' });
  const R = (t) => T(rich(t, store.suburb)), P = (t) => T(fill(t, store.suburb));
  el.removeAttribute('style');
  el.className = 'screen occasion' + (land ? ' land' : '');
  // Beat timings set in the editor: the loop's own keyframes (only while it plays; a held beat has no animation).
  // Played once (opts.once): the beats run one time and the last stays; opts.at (seconds) carries on from where a
  // redraw caught it (new data, late fonts) instead of starting the beats again.
  const once = !!(opts.loop && opts.once);
  // The fallback's timings are fixed (2 + 3 + 2 s): its design's own 7 s loop always plays.
  const timing = opts.loop && !occ.durs ? occasionTiming(occ.beats.map((_, i) => beats[i] || {}), { once }) : { custom: false };
  const at = once && opts.at > 0 ? `animation-delay:-${(+opts.at).toFixed(3)}s` : '';
  const style = (i) => [timing.custom ? timing.style(i) : '', at].filter(Boolean).join(';');
  let copy = occ.beats.map((layout, i) => beatHtml(layout, beats[i] || {}, i, !opts.loop && i === scene, R, P, style(i))).join('');
  // The fallback is the one design in the pharmacy's own branding: its colours fill the screen, and the last beat
  // carries its logo above its name (the name alone when it has no logo). Its beats build up rather than replace each
  // other, so a held beat (the editor's paused preview) shows the ones before it too (.past).
  let brand = '';
  if (occ.branded) {
    const b = store.brand || DEFAULT_BRAND, logo = safeUrl(store.logo);
    brand = ` style="--b-p:${esc(b.p)};--b-p2:${esc(boost(b.p, 1.5))};--b-a:${esc(b.a)}"`;
    copy = occ.beats.map((layout, i) => {
      const x = beats[i] || {}, on = !opts.loop && i === scene, past = !opts.loop && i < scene;
      const main = R(x.text);
      const inner = i === occ.beats.length - 1 ? `${logo ? `<div class="lg"><img src="${esc(logo)}" alt=""></div>` : ''}${main ? `<div class="${layout.main}">${main}</div>` : ''}` : (main ? `<div class="${layout.main}">${main}</div>` : '');
      return `<div class="b b${i + 1}${on ? ' on' : ''}${past ? ' past' : ''}"${style(i) ? ` style="${style(i)}"` : ''}>${inner}</div>`;
    }).join('');
  }
  el.innerHTML = `${timing.custom ? `<style>${timing.css}</style>` : ''}<div class="occ occ-${occ.design}${opts.loop ? (once ? ' once' : '') : ' hold'}"${brand}>${design.fx}<div class="txt">${copy}</div></div>`;
  const G = { W: land ? 1920 : 1080, H: land ? 1080 : 1920, inside: () => true };
  const fit = fitOccasion(el, G);
  const root = el.querySelector('.occ');
  const fonts = doc.fonts && doc.fonts.load ? Promise.all(occ.fonts.map((f) => doc.fonts.load(f).catch(() => null))) : Promise.resolve();
  // Measured again once the fonts are in, unless the screen has been redrawn since.
  const ready = fonts.then(() => { if (el.querySelector('.occ') === root) Object.assign(fit, fitOccasion(el, G)); });
  return { G, fit, state, ready };
}

/**
 * The sale template (promo=sale), one scene: 0 "the brands", 1 "the offer". Drawn on the pharmacy's brand shell in
 * its own colours and logo; animated with transform and opacity only (css/screen.css .sale), so it plays smoothly on
 * the signage players. With opts.enter the scene's entrance plays (scene 2: the wedge grows to fill the screen above
 * the footer band, then the offer builds up, the value counting up from 0); without it (a redraw, a held scene) it is
 * drawn as it ends. The idle motion (floating cards, rays, the value's heartbeat, the panel's pulse) always runs, and
 * none of it under reduced motion. Copy is plain text with ${…} tokens, shrunk to fit (fit-text.js fitSale).
 */
export function renderSale(el, opts) {
  const { store, play } = opts;
  const land = opts.orientation === 'landscape';
  const c = play.content.sale;
  const scene = Math.max(0, Math.min(1, opts.scene | 0)), offer = scene === 1;
  const state = storeState(store.sessions, opts.now || storeNow(store.tz));
  const s = store;
  el.removeAttribute('style');
  el.style.setProperty('--s-p', s.brand.p);
  el.style.setProperty('--s-p2', boost(s.brand.p, 1.8));
  el.style.setProperty('--s-p3', tileTop(s.brand.p));
  el.style.setProperty('--s-p4', boost(s.brand.p, 1.15));
  el.style.setProperty('--s-a', s.brand.a);
  el.style.setProperty('--s-bg', '#f1f3f8');
  el.style.setProperty('--s-bg2', '#e6eaf3');
  el.style.setProperty('--s-ink', s.brand.p);
  // Tokens in the copy, as in the other templates' plain lines: ${Suburb} (blanked with its comma when the store has
  // none), ${StoreName}, the store's data and any token set by hand.
  const custom = Object.fromEntries(Object.entries(s.tokens || {}).filter(([k]) => !DATA_TOKENS.includes(k)));
  const P = (t) => applyTokens(applyStoreName(fill(t, s.suburb), s.name), { ...custom, Phone: s.phone || '', State: s.state || '', StoreCode: s.storeCode || '' });
  const brands = c.brands.map((b) => String(b || '').trim()).filter(Boolean);

  // The wedge: the brand panel of the other templates (fit-text.js geom), drawn as one long shape that scene 2 slides
  // over the screen (transform only) until the brand colour fills everything above the footer band.
  const G = geom(land, false);
  const W = G.W, H = G.H, foot = land ? 120 : 170;
  let box, clip, edge, shift;
  if (!land) {
    const fillH = H - foot, extra = 920 - 300;
    box = `width:${W}px;height:${fillH + extra}px`;
    clip = [[0, 0], [W, 0], [W, fillH], [W / 2, fillH + extra], [0, fillH]];
    edge = [[0, fillH], [W / 2, fillH + extra], [W, fillH]];
    shift = `translateY(-${fillH - 300}px)`;
  } else {
    const ph = H - foot, w1 = 580, extra = 780 - w1;
    box = `width:${W + extra}px;height:${ph}px`;
    clip = [[0, 0], [W, 0], [W + extra, ph / 2], [W, ph], [0, ph]];
    edge = [[W, 0], [W + extra, ph / 2], [W, ph]];
    shift = `translateX(-${W - w1}px)`;
  }
  const [bw, bh] = box.match(/\d+/g).map(Number);
  const wedge = `<div class="sl-wedge" style="${box};--sl-from:${shift}${offer ? '' : `;transform:${shift}`}"><div class="sl-fill" style="clip-path:${ptsClip(clip)}"></div>`
    + `<svg class="sl-edge" viewBox="0 0 ${bw} ${bh}"><path d="${ptsPath(edge)}"/></svg></div>`;
  const chev = `<svg class="s-chev sl-chev" viewBox="0 0 90 50" style="${G.chev}"><path d="M8 8 L45 42 L82 8"/></svg>`;
  const logo = `<div class="s-logo">${logoHtml(s)}</div>`;
  const f = saleFooter(c);
  const footer = `<div class="s-foot sl-foot"><span class="f1">${P(f.line1)}</span>${String(f.line2 || '').trim() ? `<span class="f2">${P(f.line2)}</span>` : ''}</div>`;
  let body;
  if (!offer) {
    const n = brands.length;
    const cards = brands.map((b, i) => `<div class="sl-cw" style="--i:${i}"><div class="sl-card"><span class="sl-nm">${P(b)}</span></div></div>`).join('');
    body = `<div class="s-head sl-head"><h2 class="sl-l1">${P(c.headline1)}</h2><h2 class="sl-l2">${P(c.headline2)}</h2><p class="sl-l3">${P(saleOffer(c))}</p></div>`
      + `<div class="s-body sl-body" style="--n:${n}"><div class="sl-grid${n > 4 ? ' many' : ''}">${cards}</div>`
      + `<h3 class="s-title sl-c1">${P(c.caption)}</h3><p class="s-sub sl-c2">${P(saleFinishes(c))}</p></div>`;
  } else {
    body = `<div class="sl-rays" aria-hidden="true"><i></i></div><div class="sl-offer"><div class="sl-in"><div class="sl-big">`
      + `<div class="sl-lead">${P(c.lead)}</div><div class="sl-valb"><div class="sl-valw"><span class="sl-val">${c.value}</span><span class="sl-pc">%</span></div></div>`
      + `<div class="sl-suf">${P(c.suffix)}</div></div><div class="sl-fin"><div class="sl-panelw"><div class="sl-glow"></div><div class="sl-panel">`
      + `<span class="sl-pl">${P(c.panelLabel)}</span><span class="sl-pd">${esc(saleDateText(c.endDate))}</span></div></div>`
      + `<div class="sl-brands">${brands.map(P).join(' · ')}</div></div></div></div>`;
  }
  el.className = 'screen sale ' + (offer ? 'sl-2' : 'sl-1') + (land ? ' land' : '') + (opts.enter ? ' enter' : '');
  el.innerHTML = `<div class="sl">${wedge}${offer && !opts.enter ? '' : chev}${logo}${body}${footer}</div>`;
  const fit = fitSale(el, G);
  // Scene 2's value counts up from 0 over 0.8 s (ease-out), once the wedge has filled the screen; not under reduced
  // motion, and not on a redraw (it is drawn at its value).
  const val = el.querySelector('.sl-val'), win = el.ownerDocument && el.ownerDocument.defaultView;
  const still = !win || !win.requestAnimationFrame || (win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (val && opts.enter && !still) {
    const root = el.querySelector('.sl'), to = c.value, t0 = win.performance.now() + 1000, dur = 800;
    val.textContent = '0';
    const step = (t) => {
      if (el.querySelector('.sl') !== root) return; // redrawn since
      const k = Math.max(0, Math.min(1, (t - t0) / dur));
      val.textContent = String(Math.round(to * (1 - Math.pow(1 - k, 3))));
      if (k < 1) win.requestAnimationFrame(step);
    };
    win.requestAnimationFrame(step);
  }
  return { G, fit, state, ready: Promise.resolve() };
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
