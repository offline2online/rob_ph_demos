'use strict';
const calc = require('../calc');
const { ForbiddenError } = require('../filters');
const { displayTypeFacts } = require('../display-types');

const zero = () => ({ sold: 0, unsold: 0, offline: 0, unsoldViews: 0, lostRevenue: 0 });

// Fill and missed revenue per display type plus an all-types total. Retailer view only: downtime and
// lost revenue are never shown to an advertiser login (REQUIREMENTS.md 3.3).
module.exports = {
  path: '/missed-revenue',
  handler({ store, filters, principal }) {
    if (principal && principal.advertiserId) throw new ForbiddenError('missed revenue is a retailer view');
    const inv = new Map();
    store.scanInventory(filters, (r) => {
      const a = inv.get(r.displayTypeId) || zero();
      a.sold += r.sold; a.unsold += r.unsold; a.offline += r.offline;
      a.unsoldViews += r.unsoldViews; a.lostRevenue += r.lostRevenue;
      inv.set(r.displayTypeId, a);
    });
    const facts = displayTypeFacts(store, filters);
    const rows = facts.map((t) => {
      const a = inv.get(t.id) || zero();
      const floorCpm = t.def.floorCpm || 0;
      const missed = calc.missedRevenue(a.unsoldViews, floorCpm, a.lostRevenue);
      const { parts } = calc.roundParts([missed.unsold, missed.downtime]);
      return {
        id: t.id, name: t.def.name,
        connectedDisplays: { displays: t.displays.length, stores: t.storeCount },
        floorCpm,
        fillPercent: calc.fillPercent(a.sold, a.unsold),
        slotsSold: a.sold, slotsUnsold: a.unsold, slotsOffline: a.offline, slotsTotal: a.sold + a.unsold + a.offline,
        unsoldValueAtFloor: parts[0],
        downtimeLostRevenue: parts[1], slotsOfflineLost: a.offline,
        totalMissed: parts[0] + parts[1],
      };
    });
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    const cpms = rows.map((r) => r.floorCpm);
    const stores = new Set(facts.flatMap((t) => t.displays.map((d) => d.storeId))).size;
    const slotsSold = sum('slotsSold'); const slotsUnsold = sum('slotsUnsold');
    const total = {
      name: 'All display types',
      connectedDisplays: { displays: rows.reduce((n, r) => n + r.connectedDisplays.displays, 0), stores },
      floorCpm: cpms.length ? { min: Math.min(...cpms), max: Math.max(...cpms) } : null,
      fillPercent: calc.fillPercent(slotsSold, slotsUnsold),
      slotsSold, slotsUnsold, slotsOffline: sum('slotsOffline'), slotsTotal: sum('slotsTotal'),
      unsoldValueAtFloor: sum('unsoldValueAtFloor'),
      downtimeLostRevenue: sum('downtimeLostRevenue'), slotsOfflineLost: sum('slotsOfflineLost'),
      totalMissed: sum('totalMissed'),
    };
    return { rows, total };
  },
};
