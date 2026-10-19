'use strict';
const calc = require('../calc');
const { ForbiddenError } = require('../filters');
const { displayTypeFacts } = require('../display-types');

const HOURS = 24;

// Fill and effective CPM by hour of day, per display type. Retailer view only. Only hours inside a display type's
// operating hours are inventory, so only those hours have a cell (the API never says when a store opens).
// Billing line items carry no play timestamp yet, so each day's earned revenue and assumed views are spread over its
// hours by the share of that day's sold slots played in the hour (`viewsBasis`); the hourly impression multiplier
// (DSP Integration) replaces this. Fill is the Missed revenue & fill rule: sold / (sold + unsold + offline).
module.exports = {
  path: '/hourly',
  handler({ store, filters, principal }) {
    if (principal.principalType === 'advertiser') throw new ForbiddenError('hourly fill is a retailer view'); // also denied by default in the server
    const facts = displayTypeFacts(store, filters);
    const slots = new Map(); // type -> hour -> {sold, unsold, offline}
    const days = new Map(); // `${date}|${type}` -> { sold[24], total[24] }
    store.scanHourlyInventory(filters, (r) => {
      let hours = slots.get(r.displayTypeId);
      if (!hours) { hours = Array.from({ length: HOURS }, () => ({ sold: 0, unsold: 0, offline: 0 })); slots.set(r.displayTypeId, hours); }
      const c = hours[r.hour];
      c.sold += r.sold; c.unsold += r.unsold; c.offline += r.offline;
      const key = `${r.date}|${r.displayTypeId}`;
      let d = days.get(key);
      if (!d) { d = { sold: new Float64Array(HOURS), total: new Float64Array(HOURS) }; days.set(key, d); }
      d.sold[r.hour] += r.sold; d.total[r.hour] += r.sold + r.unsold + r.offline;
    });
    // Earned revenue and views per day x display type, for the advertiser filter too (slot records belong to no advertiser).
    const earned = new Map();
    store.scanDelivery(filters, (r) => {
      if (r.earned <= 0 && r.earnedViews <= 0) return;
      const key = `${r.date}|${r.displayTypeId}`;
      const e = earned.get(key) || { revenue: 0, views: 0 };
      e.revenue += r.earned; e.views += r.earnedViews;
      earned.set(key, e);
    });
    const spread = new Map(); // type -> { revenue[24], views[24] }
    for (const [key, e] of earned) {
      const d = days.get(key);
      if (!d) continue;
      const typeId = key.slice(key.indexOf('|') + 1);
      let weights = d.sold; let sum = weights.reduce((a, b) => a + b, 0);
      if (!(sum > 0)) { weights = d.total; sum = weights.reduce((a, b) => a + b, 0); }
      if (!(sum > 0)) continue;
      let acc = spread.get(typeId);
      if (!acc) { acc = { revenue: new Float64Array(HOURS), views: new Float64Array(HOURS) }; spread.set(typeId, acc); }
      for (let h = 0; h < HOURS; h += 1) { acc.revenue[h] += (e.revenue * weights[h]) / sum; acc.views[h] += (e.views * weights[h]) / sum; }
    }
    const rows = facts.map((t) => {
      const hours = slots.get(t.id);
      const acc = spread.get(t.id);
      const live = []; // hours with inventory
      for (let h = 0; h < HOURS; h += 1) if (hours && hours[h].sold + hours[h].unsold + hours[h].offline > 0) live.push(h);
      // Parts add to the day-level totals: revenue to the cent, views to the whole number.
      const revenue = acc ? calc.roundToTotal(live.map((h) => acc.revenue[h]), 2) : live.map(() => 0);
      const views = acc ? calc.roundToTotal(live.map((h) => acc.views[h]), 0) : live.map(() => 0);
      return {
        id: t.id, name: t.def.name,
        connectedDisplays: { displays: t.displays.length, stores: t.storeCount },
        hours: live.map((h, i) => {
          const c = hours[h];
          return {
            hour: h, fillPercent: calc.fillPercent(c.sold, c.unsold, c.offline),
            slotsSold: c.sold, slotsUnsold: c.unsold, slotsOffline: c.offline, slotsTotal: c.sold + c.unsold + c.offline,
            revenue: revenue[i], views: views[i],
            effectiveCpm: views[i] > 0 ? Math.round(calc.effectiveCpm(revenue[i], views[i]) * 100) / 100 : null,
          };
        }),
      };
    });
    return { viewsBasis: 'share-of-slots-sold', rows };
  },
};
