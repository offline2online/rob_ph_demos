import { useState } from 'react';
import { Select, Modal, InputNumber, Radio } from 'antd';
import ClearableDate from './ClearableDate.jsx';
import { WEEKDAYS, WEEKDAY_LABELS, ruleForPreset, describeRecurrence } from '../lib/recurrence.js';

// Same control as Campaign Scheduling's own "Add a New Schedule" → Repeat
// Option (ph-designer skill, verified live against
// demo.personalisationhub.com 24 Aug 2026): a preset select whose options
// resolve to plain-English labels off the offer's own start date (e.g.
// "Weekly on Monday"), plus a "Custom..." option that opens a Google
// Calendar-style Custom Recurrence dialog — repeat every N day/week/
// month/year, a day-of-week picker for week-based rules, and an Ends:
// Never / On date / After N occurrences group.
export default function RecurrenceControl({ value, startDate, onChange }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [draftRule, setDraftRule] = useState(null);

  const rule = value && value.freq !== 'none' ? value : null;
  const selectValue = rule ? (rule.freq === 'custom' ? 'custom' : rule.freq) : 'none';

  const options = [
    { value: 'none', label: 'Does not repeat' },
    { value: 'daily', label: describeRecurrence(ruleForPreset('daily', startDate), startDate) },
    { value: 'weekly', label: describeRecurrence(ruleForPreset('weekly', startDate), startDate) },
    { value: 'monthly', label: describeRecurrence(ruleForPreset('monthly', startDate), startDate) },
    { value: 'yearly', label: describeRecurrence(ruleForPreset('yearly', startDate), startDate) },
    { value: 'weekday', label: describeRecurrence(ruleForPreset('weekday', startDate), startDate) },
    { value: 'custom', label: rule && rule.freq === 'custom' ? describeRecurrence(rule, startDate) : 'Custom...' },
  ];

  const handleSelect = (v) => {
    if (v === 'custom') {
      setDraftRule(rule && rule.freq === 'custom' ? rule : ruleForPreset('custom', startDate));
      setCustomOpen(true);
      return;
    }
    onChange(v === 'none' ? null : ruleForPreset(v, startDate));
  };

  const toggleDay = (day) => {
    setDraftRule((r) => {
      const has = r.byDay.includes(day);
      return { ...r, byDay: has ? r.byDay.filter((d) => d !== day) : [...r.byDay, day] };
    });
  };

  return (
    <>
      <Select style={{ width: '100%' }} value={selectValue} options={options} onChange={handleSelect} />
      <Modal
        open={customOpen}
        title="Custom Recurrence"
        onCancel={() => setCustomOpen(false)}
        onOk={() => {
          onChange(draftRule);
          setCustomOpen(false);
        }}
        okText="OK"
        width={420}
        destroyOnClose
      >
        {draftRule && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 13 }}>Repeat every</span>
              <InputNumber
                min={1}
                value={draftRule.interval}
                onChange={(v) => setDraftRule((r) => ({ ...r, interval: v || 1 }))}
                style={{ width: 70 }}
              />
              <Select
                value={draftRule.unit}
                style={{ width: 110 }}
                onChange={(v) =>
                  setDraftRule((r) => ({
                    ...r,
                    unit: v,
                    byDay: v === 'week' ? (r.byDay.length ? r.byDay : [WEEKDAYS[new Date(startDate || Date.now()).getDay()]]) : [],
                  }))
                }
                options={[
                  { value: 'day', label: draftRule.interval === 1 ? 'day' : 'days' },
                  { value: 'week', label: draftRule.interval === 1 ? 'week' : 'weeks' },
                  { value: 'month', label: draftRule.interval === 1 ? 'month' : 'months' },
                  { value: 'year', label: draftRule.interval === 1 ? 'year' : 'years' },
                ]}
              />
            </div>

            {draftRule.unit === 'week' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 13, marginBottom: 8 }}>Repeat On</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => toggleDay(d)}
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        cursor: 'pointer',
                        border: '1px solid #d9d9d9',
                        background: draftRule.byDay.includes(d) ? '#169bc2' : '#fff',
                        color: draftRule.byDay.includes(d) ? '#fff' : 'rgba(0,0,0,.65)',
                        fontSize: 12,
                      }}
                    >
                      {WEEKDAY_LABELS[d].slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ fontSize: 13, marginBottom: 8 }}>Ends</div>
            <Radio.Group
              value={draftRule.ends.type}
              onChange={(e) => setDraftRule((r) => ({ ...r, ends: { ...r.ends, type: e.target.value } }))}
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <Radio value="never">Never</Radio>
              <Radio value="on">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  On
                  <span style={{ width: 160 }}>
                    <ClearableDate
                      value={draftRule.ends.date}
                      onChange={(v) => setDraftRule((r) => ({ ...r, ends: { ...r.ends, type: 'on', date: v } }))}
                    />
                  </span>
                </span>
              </Radio>
              <Radio value="after">
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  After
                  <InputNumber
                    size="small"
                    min={1}
                    value={draftRule.ends.count}
                    onChange={(v) => setDraftRule((r) => ({ ...r, ends: { ...r.ends, type: 'after', count: v } }))}
                    style={{ width: 70 }}
                  />
                  occurrences
                </span>
              </Radio>
            </Radio.Group>
          </div>
        )}
      </Modal>
    </>
  );
}
