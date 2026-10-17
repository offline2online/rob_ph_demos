'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { chartFilter, cents } = require('./params');

const GRANULARITIES = ['day', 'week', 'month'];

function periodStart(date, granularity) {
  if (granularity === 'day') return date;
  const d = new Date(`${date}T00:00:00Z`);
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
}

// Revenue per day/week/month x DSP x deal type, earned and estimated.
module.exports = {
  path: '/revenue',
  handler({ store, filters, params }) {
    const granularity = params.get('granularity') || 'day';
    if (!GRANULARITIES.includes(granularity)) throw new FilterError(`granularity must be one of ${GRANULARITIES.join(', ')}`);
    const keep = chartFilter(params);
    // Accumulate per date into small numeric-indexed arrays (cheap per row), then fold dates into periods.
    const dspIdx = new Map(); const typeIdx = new Map();
    const dspNames = []; const typeNames = [];
    const idxOf = (map, names, v) => { let i = map.get(v); if (i === undefined) { i = names.length; names.push(v); map.set(v, i); } return i; };
    const perDate = new Map();
    let curDate = null; let cur = null;
    store.scanDelivery(filters, (r) => {
      if (keep && !keep(r)) return;
      if (r.date !== curDate) {
        curDate = r.date;
        cur = perDate.get(curDate);
        if (!cur) { cur = []; perDate.set(curDate, cur); }
      }
      const k = idxOf(dspIdx, dspNames, r.dsp) * 16 + idxOf(typeIdx, typeNames, r.dealType);
      const b = cur[k] || (cur[k] = [0, 0]);
      b[0] += r.earned; b[1] += r.estimated;
    });
    const buckets = new Map();
    for (const [date, arr] of perDate) {
      const period = periodStart(date, granularity);
      arr.forEach((v, k) => {
        if (!v) return;
        const dsp = dspNames[Math.floor(k / 16)]; const dealType = typeNames[k % 16];
        const key = `${period}|${dsp}|${dealType}`;
        const b = buckets.get(key) || { period, dsp, dealType, earned: 0, estimated: 0 };
        b.earned += v[0]; b.estimated += v[1];
        buckets.set(key, b);
      });
    }
    const rows = [...buckets.values()].sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0)
      || calc.compareDsps(a.dsp, b.dsp) || calc.compareDealTypes(a.dealType, b.dealType));
    return { granularity, rows: rows.map((b) => ({ ...b, earned: cents(b.earned), estimated: cents(b.estimated) })) };
  },
};
