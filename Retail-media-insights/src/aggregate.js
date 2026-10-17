'use strict';
// Daily pre-aggregates built from raw billing line items and unsold-slot records.
//   delivery:  date x displayType x store x deal x DSP x advertiser
//   inventory: date x displayType x store   (slot records carry no advertiser)

const calc = require('./calc');

/**
 * raw.billing:     {date, displayTypeId, storeId, dealId, dsp, advertiserId, revenue, views, slots, settled}
 * raw.slotRecords: {date, storeId, displayTypeId, hour, status: sold|unsold|offline, count, views}
 *                  `views` is the expected VAC-d of one slot of that record.
 * raw.campaigns:    {id, advertiserId, start, end|null, displayTypeIds[]|null, variables[], scheduled, schedules, targetedVersions}
 *                  (campaign submissions: targeting rules, scheduling) - optional
 * ctx.advertisers: {[id]: {name, dsp}} - optional
 * ctx.displayTypes: {[id]: {is24Hour}}, ctx.stores: {[id]: {open, close}}, ctx.deals: {[id]: {dealType}}
 */
function buildAggregates(raw, ctx) {
  const delivery = new Map();
  for (const b of raw.billing) {
    const key = [b.date, b.displayTypeId, b.storeId, b.dealId, b.dsp, b.advertiserId].join('|');
    let row = delivery.get(key);
    if (!row) {
      row = {
        date: b.date, displayTypeId: b.displayTypeId, storeId: b.storeId, dealId: b.dealId,
        dealType: (ctx.deals[b.dealId] || {}).dealType || 'Open auction',
        dsp: b.dsp, advertiserId: b.advertiserId, revenue: 0, earned: 0, estimated: 0, views: 0, earnedViews: 0, slots: 0,
      };
      delivery.set(key, row);
    }
    row.revenue += b.revenue;
    if (b.settled) row.earned += b.revenue; else row.estimated += b.revenue;
    row.views += b.views;
    if (b.settled) row.earnedViews += b.views;
    row.slots += b.slots;
  }

  const inventory = new Map();
  for (const r of raw.slotRecords) {
    const key = [r.date, r.displayTypeId, r.storeId].join('|');
    let row = inventory.get(key);
    if (!row) {
      row = {
        date: r.date, displayTypeId: r.displayTypeId, storeId: r.storeId,
        sold: 0, unsold: 0, offline: 0, outsideHours: 0, unsoldViews: 0,
      };
      inventory.set(key, row);
    }
    const window = calc.operatingWindow(ctx.displayTypes[r.displayTypeId] || {}, ctx.stores[r.storeId]);
    const kind = calc.classifySlot(r, window);
    row[kind] += r.count;
    if (kind === 'unsold') row.unsoldViews += r.count * (r.views || 0);
  }
  const campaigns = (raw.campaigns || []).map((c) => ({
    id: c.id,
    advertiserId: c.advertiserId,
    start: c.start,
    end: c.end || null,
    displayTypeIds: c.displayTypeIds || null,
    // Only Shared Targeting Variables survive; Daypart and unknown labels never count as targeting.
    variables: calc.sharedVariables(c.variables),
    level: calc.campaignLevel(c.variables),
    scheduled: Boolean(c.scheduled),
    schedules: c.scheduled ? Math.max(c.schedules || 1, 1) : 0,
    targetedVersions: c.targetedVersions || 0,
  }));
  return {
    delivery: [...delivery.values()], inventory: [...inventory.values()], campaigns, advertisers: ctx.advertisers || {},
  };
}

module.exports = { buildAggregates };
