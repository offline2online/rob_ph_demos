import { DatePicker } from 'antd';
import dayjs from 'dayjs';

// Brief §7 / requirements.md G2: every optional date field carries a clear
// button (AntD DatePicker's built-in allowClear covers this) and a hint
// stating what blank means, re-evaluated live.
export default function ClearableDate({ value, onChange, blankHint, showTime = false, style }) {
  const parsed = value ? dayjs(value) : null;
  return (
    <div>
      <DatePicker
        allowClear
        showTime={showTime}
        style={{ width: '100%', ...style }}
        value={parsed && parsed.isValid() ? parsed : null}
        onChange={(d) => onChange(d ? (showTime ? d.format('YYYY-MM-DDTHH:mm') : d.format('YYYY-MM-DD')) : '')}
      />
      {blankHint && (
        <p style={{ fontSize: 12, color: 'rgba(0,0,0,.45)', marginTop: 5 }}>
          {value ? blankHint.set : blankHint.blank}
        </p>
      )}
    </div>
  );
}
