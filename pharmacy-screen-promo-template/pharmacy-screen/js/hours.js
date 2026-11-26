// Opening-hours logic for the pharmacy screen, shared with the admin editor.
// Pure functions, no DOM: runs in the browser and under `node --test`.
//
// Input is the Location API's store_info.opening_hours[]:
//   { open_day: "MONDAY", open_time: "08:30:00", close_day: "MONDAY", close_time: "19:00:00", is_active: true }
// A session may cross midnight (close_day after open_day, or close_time <= open_time on the same day).
// Everything is evaluated in the store's own timezone (store_location.store_timezone).

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const DAY_NAMES = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const WEEK = 7 * 1440;
const LAST_MINUTES = 30; // "Closing soon" window

export const toMin = (hhmm) => {
  const [a, b] = String(hhmm).split(':').map(Number);
  return (a || 0) * 60 + (b || 0);
};
const dayIndex = (d) => DAYS.indexOf(String(d || '').slice(0, 3).toLowerCase());
const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Location API opening_hours[] -> sessions [{day, open, close, start, end}] in week minutes (Monday 00:00 = 0). */
export function parseOpeningHours(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || r.is_active === false) continue;
    const od = dayIndex(r.open_day);
    if (od < 0 || !r.open_time || !r.close_time) continue;
    let cd = dayIndex(r.close_day);
    if (cd < 0) cd = od;
    const start = od * 1440 + toMin(r.open_time);
    let end = cd * 1440 + toMin(r.close_time);
    while (end <= start) end += (cd === od && toMin(r.close_time) <= toMin(r.open_time)) ? 1440 : WEEK;
    out.push({ day: DAYS[od], open: hhmm(toMin(r.open_time)), close: hhmm(toMin(r.close_time)), start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

// ---------- the store's time zone ----------
// store_location.store_timezone should be an IANA zone ("Australia/Melbourne"), but a value Intl does not know
// ("AEST", "AUS Eastern Standard Time", "(UTC+10:00) Canberra, Melbourne, Sydney", "+10:00") used to make the
// screen fall back to the PLAYER's own clock, which on a player kept in UTC reads "Closed now" all through the
// store's open hours. tzOf() turns those into the IANA zone they mean, and anything else into DEFAULT_TZ
// (Melbourne and Sydney keep the same time all year), never the player's clock.
export const DEFAULT_TZ = 'Australia/Melbourne';
const TZ_NAMES = [
  // Windows zone names and Australian abbreviations (exact, case-insensitive)
  [/^(aus eastern( standard| daylight)? time|aest|aedt|aet|est|eastern standard time \(australia\))$/i, 'Australia/Melbourne'],
  [/^(e\. australia standard time)$/i, 'Australia/Brisbane'],
  [/^(cen\. australia standard time|acst|acdt)$/i, 'Australia/Adelaide'],
  [/^(aus central standard time)$/i, 'Australia/Darwin'],
  [/^(w\. australia standard time|awst|awt|wst)$/i, 'Australia/Perth'],
  [/^(tasmania standard time)$/i, 'Australia/Hobart'],
  // a city named in a longer label ("(UTC+10:00) Canberra, Melbourne, Sydney"); Sydney/Melbourne/Canberra first
  [/\b(melbourne|sydney|canberra|victoria|new south wales|nsw|vic|act)\b/i, 'Australia/Melbourne'],
  [/\b(brisbane|queensland|qld)\b/i, 'Australia/Brisbane'],
  [/\b(hobart|tasmania|tas)\b/i, 'Australia/Hobart'],
  [/\b(adelaide|south australia)\b/i, 'Australia/Adelaide'],
  [/\b(darwin|northern territory)\b/i, 'Australia/Darwin'],
  [/\b(perth|western australia)\b/i, 'Australia/Perth'],
];
const tzCache = new Map();
const knownTz = (z) => {
  try { new Intl.DateTimeFormat('en-AU', { timeZone: z }); return true; } catch (e) { return false; }
};
/** The IANA zone a store_timezone value means; DEFAULT_TZ when it is empty or not recognisable. */
export function tzOf(tz) {
  const v = String(tz == null ? '' : tz).trim();
  if (!v) return DEFAULT_TZ;
  if (tzCache.has(v)) return tzCache.get(v);
  let out = '';
  // A plain IANA zone (Intl ignores case), but not a bare abbreviation such as "EST" that Intl may also accept
  if (v.includes('/') && knownTz(v)) out = v;
  if (!out) for (const [re, z] of TZ_NAMES) if (re.test(v)) { out = z; break; }
  if (!out) {
    // A fixed offset: "+10:00", "UTC+10", "GMT+9:30" -> the Australian zone at that offset (standard or daylight)
    const m = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(v);
    if (m) {
      const min = (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +(m[3] || 0));
      out = min === 480 ? 'Australia/Perth' : min === 570 || min === 630 ? 'Australia/Adelaide' : DEFAULT_TZ;
    }
  }
  if (!out || !knownTz(out)) out = DEFAULT_TZ;
  tzCache.set(v, out);
  return out;
}

/** The store's current weekday and minute of day, in its timezone. `override` = {day, min} for tests and previews. */
export function storeNow(tz, date = new Date(), override = null) {
  if (override && override.day && Number.isFinite(override.min)) return { day: override.day, min: override.min };
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tzOf(tz), weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const g = (k) => p.find((x) => x.type === k).value;
    return { day: g('weekday').slice(0, 3).toLowerCase(), min: (+g('hour') % 24) * 60 + +g('minute') };
  } catch (e) {
    return { day: DAYS[(date.getDay() + 6) % 7], min: date.getHours() * 60 + date.getMinutes() };
  }
}

/** The store's date ({y, m, d}) at `date` (default now) in time zone tz, for the seasonal promotion's dates. */
export function storeDate(tz, date = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tzOf(tz), year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
    const g = (k) => +p.find((x) => x.type === k).value;
    return { y: g('year'), m: g('month'), d: g('day') };
  } catch (e) {
    return { y: date.getFullYear(), m: date.getMonth() + 1, d: date.getDate() };
  }
}

/** Parse a test-date string: "2026-12-20" or "12-20" (this year), as {y, m, d}, or null. */
export function parseTestDate(v, fallbackYear) {
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(String(v || '').trim());
  if (!m) return null;
  const y = m[1] ? +m[1] : fallbackYear, mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? { y, m: mo, d } : null;
}

/** Parse a test-time string: "fri-18:45", "fri 18:45" or "18:45" (today). */
export function parseTestTime(v, fallbackDay) {
  const m = /^(?:([a-z]{3})[a-z]*[\sT-]+)?(\d{1,2}):(\d{2})$/i.exec(String(v || '').trim());
  if (!m) return null;
  const day = m[1] ? m[1].toLowerCase() : fallbackDay;
  if (!DAYS.includes(day)) return null;
  return { day, min: +m[2] * 60 + +m[3] };
}

/**
 * The store's state at {day, min}:
 *   open    - inside a session, more than 30 minutes before it closes
 *   closing - inside a session, 30 minutes or less before it closes
 *   before  - not open yet, but a session opens later today
 *   closed  - not open and nothing more opens today
 * closeTime / openTime are "HH:MM" for ${CloseTime} / ${OpenTime} (closed: the next opening, any day).
 */
export function storeState(sessions, now) {
  const t = dayIndex(now.day) * 1440 + now.min;
  const di = dayIndex(now.day);
  for (const s of sessions) {
    for (const off of [0, -WEEK]) {
      const a = s.start + off, b = s.end + off;
      if (t >= a && t < b) return { state: b - t <= LAST_MINUTES ? 'closing' : 'open', day: now.day, min: now.min, openTime: s.open, closeTime: s.close, session: s };
    }
  }
  const later = sessions.find((s) => s.start > t && Math.floor(s.start / 1440) === di);
  if (later) return { state: 'before', day: now.day, min: now.min, openTime: later.open, closeTime: later.close, session: later };
  const next = sessions.find((s) => s.start > t) || sessions[0] || null;
  return { state: 'closed', day: now.day, min: now.min, openTime: next ? next.open : '', closeTime: next ? next.close : '', session: next };
}

/** "19:00" -> "7pm", "08:30" -> "8.30am" (upper=true -> "7PM"). */
export function fmtShort(h, upper) {
  if (!h) return '';
  let [a, b] = h.split(':').map(Number);
  const ap = a >= 12 ? 'pm' : 'am';
  a = a % 12 || 12;
  const s = b ? `${a}.${String(b).padStart(2, '0')}${ap}` : `${a}${ap}`;
  return upper ? s.toUpperCase() : s;
}

/** "19:00" -> "7.00pm" (the weekly hours card). */
export function fmtLong(h) {
  let [a, b] = h.split(':').map(Number);
  const ap = a >= 12 ? 'pm' : 'am';
  a = a % 12 || 12;
  return `${a}.${String(b).padStart(2, '0')}${ap}`;
}

/** Rows for the weekly hours card: [{day, name, text|null}] - sessions that open on that day, joined with ", ". */
export function weeklyRows(sessions) {
  return DAYS.map((d) => {
    const own = sessions.filter((s) => s.day === d);
    return { day: d, name: DAY_NAMES[d], text: own.length ? own.map((s) => `${fmtLong(s.open)} – ${fmtLong(s.close)}`).join(', ') : null };
  });
}

/**
 * A store time {day, min} at which the store is in `want` ('open' | 'closing' | 'before' | 'closed'), for the
 * editor's preview of each "Open today" bar message. Looks from `today` 00:00 through the week in 5-minute steps,
 * so it is today wherever today allows (no session today: the first day that has one). 'open' is taken an hour into
 * the session where that is still open, so the bar reads as a normal open time. null when the hours never give it.
 */
export function nowInState(sessions, want, today) {
  const d0 = Math.max(0, dayIndex(today && today.day));
  for (let m = 0; m < WEEK; m += 5) {
    const t = (d0 * 1440 + m) % WEEK;
    const at = { day: DAYS[Math.floor(t / 1440)], min: t % 1440 };
    if (storeState(sessions, at).state !== want) continue;
    if (want === 'open') {
      const t2 = (t + 60) % WEEK, later = { day: DAYS[Math.floor(t2 / 1440)], min: t2 % 1440 };
      if (storeState(sessions, later).state === 'open') return later;
    }
    return at;
  }
  return null;
}

// ---------- special opening hours (dated exceptions: Christmas Day closed, Christmas Eve 08:30-19:00, ...) ----------
// Set in Personalisation Hub and passed through by the proxy as store_info.special_hours[]:
//   { name: "Christmas Eve", date: "2026-12-24", open: true, open_time: "08:30", close_time: "19:00" }
//   { name: "Christmas Day", date: "2026-12-25", open: false }
// (PH's own camelCase openTime / closeTime and the specialHours key are read too: the mock data uses PH's shape.)
// `date` is the store's own date. An open entry replaces that date's weekly hours, even when the times are the same;
// a closed one closes the whole date, even if the weekly hours say open. Several entries on one date are several
// sessions; a session whose close is not after its open runs past midnight, as a weekly one does. With no special
// hours, every function below gives exactly what the weekly-only functions above give.

export const SPECIAL_MAX_SHOWN = 6; // dates listed on the opening hours template
export const SPECIAL_DAYS_AHEAD = 90; // ... no further ahead than this
const YMD_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const pad = (n) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" when `v` is a real calendar date, else ''. */
export function cleanDate(v) {
  const m = YMD_RE.exec(String(v == null ? '' : v).trim());
  if (!m) return '';
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3] ? m[0] : '';
}
/** "HH:MM" from "HH:MM" or "HH:MM:SS", else ''. */
export const cleanHm = (v) => { const m = HM_RE.exec(String(v == null ? '' : v).trim()); return m ? `${m[1]}:${m[2]}` : ''; };
/** {y, m, d} -> "YYYY-MM-DD". */
export const ymdOf = (t) => `${t.y}-${pad(t.m)}-${pad(t.d)}`;
/** "YYYY-MM-DD" plus n days. */
export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
/** The weekday of "YYYY-MM-DD" as 'mon' … 'sun'. */
export function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}
/** "Thu 24 Dec" for "2026-12-24". */
export function fmtSpecialDate(ymd) {
  const [, m, d] = ymd.split('-').map(Number);
  const w = weekdayOf(ymd);
  return `${w[0].toUpperCase()}${w.slice(1)} ${d} ${MONTHS[m - 1]}`;
}

/**
 * special_hours[] (the proxy's, or PH's own shape) -> [{date, name, open, openTime, closeTime}], valid entries only,
 * sorted by date then opening time. An entry is dropped unless its date is a real "YYYY-MM-DD", `open` is a boolean
 * and, when open, both times are "HH:MM". name: PH's name for the day ("Christmas Eve"), or '' (the date alone).
 */
export function parseSpecialHours(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list.slice(0, 400) : []) {
    if (!r || typeof r !== 'object') continue;
    const date = cleanDate(r.date);
    if (!date || typeof r.open !== 'boolean') continue;
    const name = typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!r.open) { out.push({ date, name, open: false, openTime: '', closeTime: '' }); continue; }
    const openTime = cleanHm(r.open_time !== undefined ? r.open_time : r.openTime);
    const closeTime = cleanHm(r.close_time !== undefined ? r.close_time : r.closeTime);
    if (!openTime || !closeTime) continue;
    out.push({ date, name, open: true, openTime, closeTime });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.openTime < b.openTime ? -1 : a.openTime > b.openTime ? 1 : 0));
}

/**
 * The store's clock as {ymd, day, min}: `now` ({day, min}, the store's weekday and minute) on `today` ({y, m, d}, the
 * store's date). When now's weekday is not today's (a test clock such as now=fri-18:45 on another day, or the
 * editor's preview of a bar state), the date is the next one with that weekday, today included.
 */
export function storeClock(now, today) {
  const base = ymdOf(today);
  let ymd = base;
  for (let i = 0; i < 7 && weekdayOf(ymd) !== now.day; i++) ymd = addDays(base, i + 1);
  return { ymd, day: now.day, min: now.min };
}

/** The special entries for one date. */
const specialOn = (special, ymd) => special.filter((x) => x.date === ymd);

/**
 * Sessions opening on date `ymd`, in minutes from that date's 00:00 ({open, close, start, end, special}): its special
 * hours when it has any (none when closed), else its weekday's weekly sessions.
 */
export function sessionsOn(sessions, special, ymd) {
  const own = specialOn(special || [], ymd);
  if (own.length) {
    return own.filter((x) => x.open).map((x) => {
      const start = toMin(x.openTime);
      let end = toMin(x.closeTime);
      if (end <= start) end += 1440;
      return { open: x.openTime, close: x.closeTime, start, end, special: true };
    });
  }
  const di = DAYS.indexOf(weekdayOf(ymd));
  return sessions.filter((s) => s.day === DAYS[di]).map((s) => ({ open: s.open, close: s.close, start: s.start - di * 1440, end: s.end - di * 1440, special: false }));
}

/**
 * storeState() for a store with special hours: the same {state, day, min, openTime, closeTime, session} at `clock`
 * ({ymd, day, min}, storeClock()), working from the actual dates around it. A weekly session that runs past midnight
 * into a date with special hours stops at midnight (that date is the special hours' alone). closed: openTime is the
 * next opening on any later date (openDate says which: "YYYY-MM-DD"). With no special hours this is storeState().
 */
export function storeStateOn(sessions, special, clock) {
  if (!special || !special.length) return storeState(sessions, { day: clock.day, min: clock.min });
  const line = [];
  for (let off = -1; off <= 14; off++) {
    const ymd = addDays(clock.ymd, off);
    const nextSpecial = specialOn(special, addDays(ymd, 1)).length > 0;
    for (const s of sessionsOn(sessions, special, ymd)) {
      const end = !s.special && nextSpecial ? Math.min(s.end, 1440) : s.end;
      if (end > s.start) line.push({ ...s, start: s.start + off * 1440, end: end + off * 1440, date: ymd });
    }
  }
  line.sort((a, b) => a.start - b.start);
  const t = clock.min;
  const base = { day: clock.day, min: clock.min };
  const here = line.find((s) => t >= s.start && t < s.end);
  if (here) return { ...base, state: here.end - t <= LAST_MINUTES ? 'closing' : 'open', openTime: here.open, closeTime: here.close, session: here, openDate: here.date };
  const later = line.find((s) => s.start > t && s.start < 1440);
  if (later) return { ...base, state: 'before', openTime: later.open, closeTime: later.close, session: later, openDate: later.date };
  const next = line.find((s) => s.start > t) || null;
  return { ...base, state: 'closed', openTime: next ? next.open : '', closeTime: next ? next.close : '', session: next, openDate: next ? next.date : '' };
}

/**
 * The special hours the opening hours template lists from date `ymd`: the nearest dates from today on, at most
 * SPECIAL_MAX_SHOWN, none more than SPECIAL_DAYS_AHEAD days ahead, past dates never.
 * [{date, label: "Thu 24 Dec", name, open, text: "8.30am – 7.00pm" | null, times: ["8.30am – 7.00pm", ...]}]
 */
export function upcomingSpecialHours(special, ymd, max = SPECIAL_MAX_SHOWN, ahead = SPECIAL_DAYS_AHEAD) {
  const last = addDays(ymd, ahead), out = [];
  for (const x of special || []) {
    if (x.date < ymd || x.date > last) continue;
    let row = out.find((r) => r.date === x.date);
    if (!row) {
      if (out.length >= max) break;
      row = { date: x.date, label: fmtSpecialDate(x.date), name: x.name, open: false, times: [] };
      out.push(row);
    }
    if (!row.name && x.name) row.name = x.name;
    if (x.open) { row.open = true; row.times.push(`${fmtLong(x.openTime)} – ${fmtLong(x.closeTime)}`); }
  }
  return out.map((r) => ({ ...r, text: r.open ? r.times.join(', ') : null }));
}

/**
 * nowInState() for a store with special hours, for the editor's preview of each "Open today" bar message: a store
 * clock {ymd, day, min} at which the store is in `want`, on the actual dates from `today` ({y, m, d}, the store's
 * date) on, so a closed special date is never previewed as "While open". Looks 14 days ahead in 5-minute steps;
 * 'open' is taken an hour into the session where that is still open. With no special hours this is nowInState() on
 * the date that weekday falls on (storeClock()). null when the hours never give it.
 */
export function nowInStateOn(sessions, special, want, today) {
  if (!special || !special.length) {
    const at = nowInState(sessions, want, { day: weekdayOf(ymdOf(today)) });
    return at ? storeClock(at, today) : null;
  }
  const base = ymdOf(today);
  const clockAt = (m) => { const ymd = addDays(base, Math.floor(m / 1440)); return { ymd, day: weekdayOf(ymd), min: m % 1440 }; };
  for (let m = 0; m < 14 * 1440; m += 5) {
    const at = clockAt(m);
    if (storeStateOn(sessions, special, at).state !== want) continue;
    if (want === 'open') {
      const later = clockAt(m + 60);
      if (storeStateOn(sessions, special, later).state === 'open') return later;
    }
    return at;
  }
  return null;
}
