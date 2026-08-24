// Recurring day-part schedules for offers — verified live against Campaign
// Scheduling's own "Add a New Schedule" → Repeat Option control
// (demo.personalisationhub.com, 24 Aug 2026): Does not repeat / Daily /
// Weekly on {weekday} / Monthly on the {nth} {weekday} / Annually on
// {month day} / Every weekday / Custom (repeat every N day/week/month/
// year, a weekday picker for week-based custom rules, and Ends: Never /
// On date / After N occurrences). Presets are shortcuts that derive their
// weekday/month-day/nth-occurrence from the offer's own Start date — same
// as the live product's own pickers — so every rule, preset or custom,
// evaluates through the one shape below.
//
// An offer's existing offerFrom/offerUntil datetimes double as the daily
// time-of-day window (e.g. 11:00-14:00) that repeats on each matching
// date; a recurrence of `{ freq: 'none' }` collapses to exactly the old
// single-window behaviour.

export const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const WEEKDAY_LABELS = {
  SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday',
  THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday',
};

export const REPEAT_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Annually' },
  { value: 'weekday', label: 'Every weekday (Mon-Fri)' },
  { value: 'custom', label: 'Custom...' },
];

export function blankRecurrence() {
  return { freq: 'none', interval: 1, unit: 'week', byDay: [], monthlyMode: 'nthWeekday', ends: { type: 'never', date: '', count: '' } };
}

// Preset -> concrete rule, anchored on the offer's own start date.
export function ruleForPreset(freq, startDate) {
  const d = startDate ? new Date(startDate) : new Date();
  const base = blankRecurrence();
  switch (freq) {
    case 'daily':   return { ...base, freq: 'daily', unit: 'day' };
    case 'weekly':  return { ...base, freq: 'weekly', unit: 'week', byDay: [WEEKDAYS[d.getDay()]] };
    case 'monthly': return { ...base, freq: 'monthly', unit: 'month' };
    case 'yearly':  return { ...base, freq: 'yearly', unit: 'year' };
    case 'weekday': return { ...base, freq: 'weekday', unit: 'week', byDay: ['MON', 'TUE', 'WED', 'THU', 'FRI'] };
    case 'custom':  return { ...base, freq: 'custom', unit: 'week', byDay: [WEEKDAYS[d.getDay()]] };
    case 'none':
    default:        return base;
  }
}

function startOfDay(d) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function endOfDay(d) { const r = new Date(d); r.setHours(23, 59, 59, 999); return r; }
function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function nthWeekdayOfMonth(d) { return Math.ceil(d.getDate() / 7); }

// Does the calendar date alone (ignoring time-of-day) match the rule's
// cadence, without regard to any Ends bound?
function matchesCadence(rule, startDate, testDate) {
  const start = startOfDay(startDate);
  const test = startOfDay(testDate);
  if (test < start) return false;
  const interval = Math.max(1, Number(rule.interval) || 1);

  if (rule.unit === 'day') {
    const diffDays = Math.round((test - start) / 86400000);
    return diffDays % interval === 0;
  }
  if (rule.unit === 'week') {
    const days = (rule.byDay && rule.byDay.length) ? rule.byDay : [WEEKDAYS[start.getDay()]];
    if (!days.includes(WEEKDAYS[test.getDay()])) return false;
    const startSunday = addDays(start, -start.getDay());
    const testSunday = addDays(test, -test.getDay());
    const weekIndex = Math.round((testSunday - startSunday) / (7 * 86400000));
    return weekIndex % interval === 0;
  }
  if (rule.unit === 'month') {
    if (rule.monthlyMode === 'dayOfMonth') {
      if (test.getDate() !== start.getDate()) return false;
    } else {
      if (test.getDay() !== start.getDay()) return false;
      if (nthWeekdayOfMonth(test) !== nthWeekdayOfMonth(start)) return false;
    }
    const diffMonths = (test.getFullYear() - start.getFullYear()) * 12 + (test.getMonth() - start.getMonth());
    return diffMonths >= 0 && diffMonths % interval === 0;
  }
  if (rule.unit === 'year') {
    if (test.getMonth() !== start.getMonth() || test.getDate() !== start.getDate()) return false;
    const diffYears = test.getFullYear() - start.getFullYear();
    return diffYears >= 0 && diffYears % interval === 0;
  }
  return false;
}

// "Ends after N occurrences" needs an occurrence count, not just a
// cadence check — a multi-weekday weekly rule doesn't have a clean closed
// form for that, so count by walking day-by-day. Bounded to 10 years,
// far past any realistic offer, so this stays cheap even though it's a
// loop rather than arithmetic.
function occurrenceIndex(rule, startDate, testDate) {
  const start = startOfDay(startDate);
  const test = startOfDay(testDate);
  const cap = addDays(start, 3660);
  let count = 0;
  let cursor = start;
  while (cursor <= test && cursor <= cap) {
    if (matchesCadence(rule, start, cursor)) {
      count += 1;
      if (cursor.getTime() === test.getTime()) return count;
    }
    cursor = addDays(cursor, 1);
  }
  return count;
}

// Does `testDate` carry an occurrence of this rule, anchored at
// `startDate`, honouring the rule's Ends bound?
export function occursOnDate(rule, startDate, testDate) {
  if (!startDate) return false;
  if (!rule || rule.freq === 'none') return startOfDay(startDate).getTime() === startOfDay(testDate).getTime();
  if (rule.ends && rule.ends.type === 'on' && rule.ends.date) {
    if (startOfDay(testDate) > endOfDay(new Date(rule.ends.date))) return false;
  }
  if (!matchesCadence(rule, startDate, testDate)) return false;
  if (rule.ends && rule.ends.type === 'after' && rule.ends.count) {
    if (occurrenceIndex(rule, startDate, testDate) > Number(rule.ends.count)) return false;
  }
  return true;
}

// Is the offer's window open right now, combining the recurring date
// pattern with the daily time-of-day window offerFrom/offerUntil define?
// offerUntil earlier in the day than offerFrom means the window crosses
// midnight (checked against both today's and yesterday's occurrence).
export function isOfferWindowLiveNow(offerFrom, offerUntil, recurrence, now = new Date()) {
  if (!offerFrom) return true; // blank start means "runs from now"
  const from = new Date(offerFrom);
  const until = offerUntil ? new Date(offerUntil) : null;

  if (!recurrence || recurrence.freq === 'none') {
    if (from > now) return false;
    if (until && until < now) return false;
    return true;
  }
  if (from > now) return false;

  const fromMinutes = from.getHours() * 60 + from.getMinutes();
  const untilMinutes = until ? until.getHours() * 60 + until.getMinutes() : 24 * 60;
  const crossesMidnight = !!until && untilMinutes <= fromMinutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (occursOnDate(recurrence, from, now)) {
    if (!crossesMidnight) {
      if (nowMinutes >= fromMinutes && nowMinutes < untilMinutes) return true;
    } else if (nowMinutes >= fromMinutes) {
      return true;
    }
  }
  if (crossesMidnight && nowMinutes < untilMinutes && occursOnDate(recurrence, from, addDays(now, -1))) {
    return true;
  }
  return false;
}

// live | scheduled | recurring | ended — 'recurring' means the series has
// started and hasn't ended, but right now falls outside today's window
// (e.g. a lunch day-part, checked at 9pm). "Ends after N occurrences" is
// intentionally not distinguished from 'recurring' here (see
// isOfferWindowLiveNow, which stays exactly correct either way) — an
// offer that finished its last occurrence weeks ago just keeps reading
// as 'recurring' rather than 'ended', a label-only simplification.
export function recurrenceOverallState(offerFrom, offerUntil, recurrence, now = new Date()) {
  const from = new Date(offerFrom);
  if (from > now) return 'scheduled';
  if (recurrence.ends && recurrence.ends.type === 'on' && recurrence.ends.date) {
    if (now > endOfDay(new Date(recurrence.ends.date))) return 'ended';
  }
  return isOfferWindowLiveNow(offerFrom, offerUntil, recurrence, now) ? 'live' : 'recurring';
}

// Plain-English label, matching the live product's own Repeat Option
// vocabulary (e.g. "Weekly on Monday", "Monthly on the 4th Monday").
export function describeRecurrence(rule, startDate) {
  if (!rule || rule.freq === 'none') return 'Does not repeat';
  const d = startDate ? new Date(startDate) : new Date();
  const weekdayLabel = WEEKDAY_LABELS[WEEKDAYS[d.getDay()]];
  const nth = ['1st', '2nd', '3rd', '4th', '5th'][nthWeekdayOfMonth(d) - 1] || `${nthWeekdayOfMonth(d)}th`;
  const monthDay = d.toLocaleDateString('en-GB', { month: 'long', day: 'numeric' });

  let base;
  if (rule.freq === 'daily') base = 'Daily';
  else if (rule.freq === 'weekly') base = `Weekly on ${weekdayLabel}`;
  else if (rule.freq === 'monthly') base = `Monthly on the ${nth} ${weekdayLabel}`;
  else if (rule.freq === 'yearly') base = `Annually on ${monthDay}`;
  else if (rule.freq === 'weekday') base = 'Every weekday (Mon-Fri)';
  else {
    const interval = Math.max(1, Number(rule.interval) || 1);
    const unitLabel = { day: 'day', week: 'week', month: 'month', year: 'year' }[rule.unit] || 'week';
    let s = interval === 1 ? `Every ${unitLabel}` : `Every ${interval} ${unitLabel}s`;
    if (rule.unit === 'week' && rule.byDay && rule.byDay.length) {
      s += ` on ${rule.byDay.map((c) => WEEKDAY_LABELS[c].slice(0, 3)).join(', ')}`;
    }
    base = s;
  }
  if (rule.ends && rule.ends.type === 'on' && rule.ends.date) {
    base += `, until ${new Date(rule.ends.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}`;
  } else if (rule.ends && rule.ends.type === 'after' && rule.ends.count) {
    base += `, ${rule.ends.count} time${Number(rule.ends.count) === 1 ? '' : 's'}`;
  }
  return base;
}
