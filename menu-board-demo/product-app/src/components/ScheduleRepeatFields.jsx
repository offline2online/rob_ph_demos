import ClearableDate from './ClearableDate.jsx';
import RecurrenceControl from './RecurrenceControl.jsx';

// Shared by TargetingBuilder's per-group schedule (Product Assets, and
// Pricing offers' own targeting groups) and PricingTab's offer-level
// schedule — one visual pattern for "when does this apply, and does it
// repeat": Repeat sits to the left of Schedule from/until in a single row,
// each kept narrow since none of the three needs much width to show a
// date, a time, or a short repeat label. Extracted so every caller renders
// pixel-identical UI instead of near-duplicate copies of this layout.
export default function ScheduleRepeatFields({
  scheduleFrom,
  scheduleUntil,
  recurrence,
  onScheduleFromChange,
  onScheduleUntilChange,
  onRecurrenceChange,
  fromLabel = 'Schedule from',
  untilLabel = 'Schedule until',
  fromHint,
  untilHint,
  repeatDisabledHint = 'Set a Schedule from date to repeat this.',
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
      <div style={{ width: 150, flexShrink: 0 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>Repeat</label>
        <div style={!scheduleFrom ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          <RecurrenceControl value={recurrence} startDate={scheduleFrom} onChange={onRecurrenceChange} />
        </div>
        {!scheduleFrom && (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginTop: 3 }}>{repeatDisabledHint}</div>
        )}
      </div>
      <div style={{ width: 210, flexShrink: 0 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>{fromLabel}</label>
        <ClearableDate showTime timeWidth={90} value={scheduleFrom} onChange={onScheduleFromChange} blankHint={fromHint} />
      </div>
      <div style={{ width: 210, flexShrink: 0 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>{untilLabel}</label>
        <ClearableDate showTime timeWidth={90} value={scheduleUntil} onChange={onScheduleUntilChange} blankHint={untilHint} />
      </div>
    </div>
  );
}
