import { DatePicker, TimePicker } from 'antd';
import dayjs from 'dayjs';

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

  const handleDateChange = (d) => {
    if (!d) { onChange(''); return; }
    const next = valid ? d.hour(valid.hour()).minute(valid.minute()) : d;
    onChange(showTime ? next.format('YYYY-MM-DDTHH:mm') : next.format('YYYY-MM-DD'));
  };

  const handleTimeChange = (t) => {
    if (!t) return;
    const base = valid || dayjs();
    onChange(base.hour(t.hour()).minute(t.minute()).format('YYYY-MM-DDTHH:mm'));
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, ...style }}>
        <DatePicker allowClear style={{ flex: 1 }} value={valid} onChange={handleDateChange} />
        {showTime && (
          <TimePicker allowClear={false} format="HH:mm" style={{ width: 110 }} value={valid} onChange={handleTimeChange} />
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
