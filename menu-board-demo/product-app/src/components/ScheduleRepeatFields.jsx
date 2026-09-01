import ClearableDate from './ClearableDate.jsx';
import RecurrenceControl from './RecurrenceControl.jsx';

// Shared by TargetingBuilder's per-group schedule (Product Assets, and
// Pricing offers' own targeting groups) and PricingTab's offer-level
// schedule — one visual pattern for "when does this apply, and does it
// repeat": Schedule from, then Schedule until, then Repeat last (reading
// order matches how the rule is actually built — pick the window first,
// then decide whether it repeats), each kept narrow since none of the
// three needs much width to show a date, a time, or a short repeat label.
// Extracted so every caller renders pixel-identical UI instead of
// near-duplicate copies of this layout. Each column stretches (flex: 1)
// rather than sitting at a fixed width, so the row fills the same full
// width as the targeting-condition row beneath it instead of sitting
// narrower than it.
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
      <div style={{ flex: 1, minWidth: 210 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>{fromLabel}</label>
        <ClearableDate showTime timeWidth={90} value={scheduleFrom} onChange={onScheduleFromChange} blankHint={fromHint} />
      </div>
      <div style={{ flex: 1, minWidth: 210 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>{untilLabel}</label>
        <ClearableDate showTime timeWidth={90} value={scheduleUntil} onChange={onScheduleUntilChange} blankHint={untilHint} />
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <label style={{ fontSize: 11, color: 'rgba(0,0,0,.55)', display: 'block', marginBottom: 3 }}>Repeat</label>
        <div style={!scheduleFrom ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
          <RecurrenceControl value={recurrence} startDate={scheduleFrom} onChange={onRecurrenceChange} />
        </div>
        {!scheduleFrom && (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,.45)', marginTop: 3 }}>{repeatDisabledHint}</div>
        )}
      </div>
    </div>
  );
}
