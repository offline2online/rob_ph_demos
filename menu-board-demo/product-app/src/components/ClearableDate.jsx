import { DatePicker, TimePicker } from 'antd';
import dayjs from 'dayjs';

// Every start/end datetime pair in the app (an offer's schedule, a
// product's featured window) defaults its end to one hour after whatever
// start just got picked — ph-designer skill components.md §13's
// date-pair rule. Picking a start always arrives with a sensible non-empty
// end already filled in, rather than leaving staff to pick a second
// timestamp by hand for the common case. Callers wire this into the
// start field's own onChange; it only fires when a start value is
// actually being set, never on clear.
export function shiftEndOneHour(startISO) {
  if (!startISO) return '';
  const d = dayjs(startISO);
  return d.isValid() ? d.add(1, 'hour').toISOString() : '';
}

// Brief §7 / requirements.md G2: every optional date field carries a clear
// button (AntD DatePicker's built-in allowClear covers this) and a hint
// stating what blank means, re-evaluated live.
//
// Date and time are deliberately split into two side-by-side fields rather
// than DatePicker's own combined showTime mode — this is the platform's
// standard date/time selection pattern: a plain calendar for the date, and
// AntD's TimePicker (a discrete, scrollable hour/minute list — not a
// continuously-spinning wheel) for the time.
export default function ClearableDate({ value, onChange, blankHint, showTime = false, style }) {
  const parsed = value ? dayjs(value) : null;
  const valid = parsed && parsed.isValid() ? parsed : null;

  // Datetime values (showTime) are written as a real UTC-anchored ISO
  // string (toISOString(), always ending in Z) rather than a bare
  // "YYYY-MM-DDTHH:mm" — a naive string like that gets parsed as local
  // time by whichever browser reads it back, but as UTC by the backend
  // sweep (functions/index.js), which runs in a different timezone. Two
  // readers disagreeing about what "now" means relative to the same
  // string is exactly what let an already-expired offer keep showing as
  // live: the backend's clock had to catch up hours later than the
  // browser's before it agreed the offer had ended. A real UTC string
  // parses identically everywhere, so there's nothing left to disagree
  // about. Date-only values (no showTime) are untouched — they're calendar
  // dates, not exact moments, and converting those to a UTC timestamp
  // could shift them onto the wrong day depending on the reader's zone.
  const handleDateChange = (d) => {
    if (!d) { onChange(''); return; }
    const next = valid ? d.hour(valid.hour()).minute(valid.minute()) : d;
    onChange(showTime ? next.toISOString() : next.format('YYYY-MM-DD'));
  };

  const handleTimeChange = (t) => {
    if (!t) return;
    const base = valid || dayjs();
    onChange(base.hour(t.hour()).minute(t.minute()).toISOString());
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, ...style }}>
        <DatePicker allowClear style={{ flex: 1 }} value={valid} onChange={handleDateChange} />
        {showTime && (
          // needConfirm={false}: without it, AntD shows an "OK" button in
          // the time panel and won't fire onChange until it's clicked — so
          // picking an hour/minute and then just clicking away (closing the
          // panel, tabbing out, saving the form) silently drops the change.
          // Every date/time picker on both HQ Admin and Retail Admin should
          // carry this; see ph-designer skill, components.md §13.
          <TimePicker
            allowClear={false}
            needConfirm={false}
            format="HH:mm"
            style={{ width: 110 }}
            value={valid}
            onChange={handleTimeChange}
          />
        )}
      </div>
      {blankHint && (
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>
          {value ? blankHint.set : blankHint.blank}
        </p>
      )}
    </div>
  );
}
