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

/** The store's current weekday and minute of day, in its timezone. `override` = {day, min} for tests and previews. */
export function storeNow(tz, date = new Date(), override = null) {
  if (override && override.day && Number.isFinite(override.min)) return { day: override.day, min: override.min };
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tz || 'Australia/Melbourne', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const g = (k) => p.find((x) => x.type === k).value;
    return { day: g('weekday').slice(0, 3).toLowerCase(), min: (+g('hour') % 24) * 60 + +g('minute') };
  } catch (e) {
    return { day: DAYS[(date.getDay() + 6) % 7], min: date.getHours() * 60 + date.getMinutes() };
  }
}

/** The store's date ({y, m, d}) at `date` (default now) in time zone tz, for the seasonal promotion's dates. */
export function storeDate(tz, date = new Date()) {
  try {
    const p = new Intl.DateTimeFormat('en-AU', { timeZone: tz || 'Australia/Melbourne', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(date);
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
