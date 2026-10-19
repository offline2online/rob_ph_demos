'use strict';
// In-memory, date-indexed aggregate store. Rows are sorted by date once; a query binary-searches
// the date range and then applies the remaining page filters with Set lookups.
//
// Beside the fine cube (date x display type x store x deal x DSP x advertiser) the store builds, once at load:
//   - a store-less daily rollup (date x display type x deal x DSP x advertiser), read by every query with no store filter;
//   - a per-store partition of the fine cube (indices into it, in the same order), read by a query with a store filter;
//   - the same two for inventory (rollup: date x display type).
// A query therefore never scans the rows of stores it did not ask for, and never scans the store dimension it did not
// ask about. `new AggregateStore(data, { indexed: false })` keeps the straight scan of the fine cube: the reference
// implementation the equivalence test compares every endpoint against.
//
// A rollup row carries `maxCpm` too (see below). Every row also carries small integers (dayIx, the day number since 1970; dealIx, typeIx, advIx; no dealIx or advIx on
// inventory) so the hot handlers can accumulate into dense arrays instead of building a string key per row. The codes are
// indexes into dealIds/typeIds/advIds, and dealCode/typeCode/advCode map an id back to its code.

function lowerBound(rows, date) {
  let lo = 0; let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].date < date) lo = mid + 1; else hi = mid;
  }
  return lo;
}

const { effectiveCpm } = require('./calc');

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
const asSet = (list) => (list ? new Set(list) : null);

const DELIVERY_MEASURES = ['revenue', 'earned', 'estimated', 'views', 'earnedViews', 'slots', 'earnedSlots'];
const INVENTORY_MEASURES = ['sold', 'unsold', 'offline', 'outsideHours', 'unsoldViews', 'lostRevenue'];

/** Dense integer codes for a dimension: code(value) assigns the next free one. */
function dictionary() {
  const ids = []; const map = new Map();
  return { ids, code(v) { let i = map.get(v); if (i === undefined) { i = ids.length; ids.push(v); map.set(v, i); } return i; } };
}

/**
 * Sum rows that agree on everything `keyOf` looks at, per date (rows are sorted by date, so one date's groups are built
 * and flushed together). `make(first)` creates the group row from its first member; the measures are added in row order.
 */
function rollup(rows, keyOf, make, measures, each) {
  const out = [];
  let groups = new Map(); let day = null;
  for (const r of rows) {
    if (r.date !== day) { groups = new Map(); day = r.date; }
    const k = keyOf(r);
    let g = groups.get(k);
    if (!g) { g = make(r); groups.set(k, g); out.push(g); }
    for (const m of measures) g[m] += r[m];
    if (each) each(g, r);
  }
  return out;
}

/** value of `field` -> Int32Array of positions in `rows` (ascending, so date order and tie order are those of `rows`). */
function partition(rows, field) {
  const lists = new Map();
  rows.forEach((r, i) => { let l = lists.get(r[field]); if (!l) { l = []; lists.set(r[field], l); } l.push(i); });
  return new Map([...lists].map(([k, l]) => [k, Int32Array.from(l)]));
}

const DAY_MS = 86400000;
/** Stamp dayIx on date-sorted rows (one Date.parse per distinct day). */
function stampDays(rows) {
  let day = null; let ix = 0;
  for (const r of rows) { if (r.date !== day) { day = r.date; ix = Math.round(Date.parse(`${day}T00:00:00Z`) / DAY_MS); } r.dayIx = ix; }
}

const OPEN_AUCTION_DEAL_TYPE = 'Open auction';

/**
 * The settled (earned) delivery of every advertiser together, per day x display type x deal (block `nDeals` is the open auction):
 * plays, revenue, views, the cleared CPM of each winning buyer (the winning CPM range is read from them) and which advertisers won plays. What advertiser Delivery shows about the
 * other buyers on a deal ("all plays", the aggregate winning CPM, how many others won) is a function of these cells alone.
 * `rows` are date-ordered rows (the rollup or, for a store filter, fine rows); `cell.dealIx` is -1 for the open auction.
 */
function buildCells(rows, nDeals, out = [], index = new Map()) {
  let day = null;
  const acc = new Map(); // cell -> revenue and views per winning buyer, aligned with cell.advs; gone once the cells' cpms are set
  for (const r of rows) {
    if (r.date !== day) { day = r.date; index.clear(); }
    if (r.earnedSlots <= 0 && r.earned <= 0) continue;
    const open = r.dealType === OPEN_AUCTION_DEAL_TYPE;
    const key = r.typeIx * (nDeals + 1) + (open ? nDeals : r.dealIx);
    let c = index.get(key);
    if (!c) {
      c = { date: r.date, dayIx: r.dayIx, displayTypeId: r.displayTypeId, dealIx: open ? -1 : r.dealIx, all: 0, rev: 0, views: 0, cpms: [], advs: [] };
      index.set(key, c); out.push(c); acc.set(c, { rev: [], views: [] });
    }
    c.all += r.earnedSlots; c.rev += r.earned; c.views += r.earnedViews;
    if (r.earnedSlots > 0) {
      const a = acc.get(c);
      let at = c.advs.indexOf(r.advIx);
      if (at < 0) { at = c.advs.length; c.advs.push(r.advIx); a.rev.push(0); a.views.push(0); }
      a.rev[at] += r.earned; a.views[at] += r.earnedViews;
    }
  }
  // The cleared CPM of each winning buyer in the cell (revenue / views), which the winning CPM range is read from. Never keyed by buyer.
  for (const [c, a] of acc) for (let i = 0; i < c.advs.length; i += 1) if (a.views[i] > 0) c.cpms.push(effectiveCpm(a.rev[i], a.views[i]));
  return out;
}

class AggregateStore {
  constructor({ delivery, inventory, campaigns = [], advertisers = {}, catalog = { displayTypes: {}, displays: [] } }, { indexed = true } = {}) {
    this.catalog = catalog;
    this.campaigns = campaigns;
    this.advertisers = advertisers;
    this.indexed = indexed;
    this.delivery = [...delivery].sort(byDate);
    this.inventory = [...inventory].sort(byDate);

    const deals = dictionary(); const types = dictionary(); const advs = dictionary();
    stampDays(this.delivery); stampDays(this.inventory);
    for (const r of this.delivery) { r.dealIx = deals.code(r.dealId); r.typeIx = types.code(r.displayTypeId); r.advIx = advs.code(r.advertiserId); }
    for (const r of this.inventory) r.typeIx = types.code(r.displayTypeId);
    // The first and last played day: days with inventory or earned delivery. Reservations (estimated rows booked ahead) are not played days.
    let first = null; let last = null;
    const played = (date) => { if (first === null || date < first) first = date; if (last === null || date > last) last = date; };
    for (const r of this.inventory) played(r.date);
    for (const r of this.delivery) if (r.earnedSlots > 0 || r.earned > 0) played(r.date);
    this.firstPlayedDay = first; this.lastPlayedDay = last;
    this.dealIds = deals.ids; this.typeIds = types.ids; this.advIds = advs.ids;
    this.dealCode = new Map(deals.ids.map((v, i) => [v, i])); this.typeCode = new Map(types.ids.map((v, i) => [v, i])); this.advCode = new Map(advs.ids.map((v, i) => [v, i]));

    if (indexed) {
      const dsps = dictionary(); const dealTypes = dictionary();
      for (const r of this.delivery) { dsps.code(r.dsp); dealTypes.code(r.dealType); }
      const T = types.ids.length; const A = advs.ids.length; const D = dsps.ids.length; const K = dealTypes.ids.length;
      this.deliveryRollup = rollup(this.delivery,
        (r) => (((r.dealIx * T + r.typeIx) * D + dsps.code(r.dsp)) * A + r.advIx) * K + dealTypes.code(r.dealType),
        (r) => ({ date: r.date, displayTypeId: r.displayTypeId, storeId: null, dealId: r.dealId, dealType: r.dealType, dsp: r.dsp, advertiserId: r.advertiserId,
          dayIx: r.dayIx, dealIx: r.dealIx, typeIx: r.typeIx, advIx: r.advIx, revenue: 0, earned: 0, estimated: 0, views: 0, earnedViews: 0, slots: 0, earnedSlots: 0 }),
        DELIVERY_MEASURES);
      this.inventoryRollup = rollup(this.inventory, (r) => r.typeIx,
        (r) => ({ date: r.date, displayTypeId: r.displayTypeId, storeId: null, dayIx: r.dayIx, typeIx: r.typeIx, sold: 0, unsold: 0, offline: 0, outsideHours: 0, unsoldViews: 0, lostRevenue: 0 }),
        INVENTORY_MEASURES);
      this.deliveryCells = buildCells(this.deliveryRollup, deals.ids.length);
      this.deliveryByStore = partition(this.delivery, 'storeId');
      this.inventoryByStore = partition(this.inventory, 'storeId');
      this.rollupByAdvertiser = partition(this.deliveryRollup, 'advertiserId');
    }
  }

  /** Visit the rows of `rows` in [dateFrom, dateTo] that pass the Set filters; `pos` (optional) lists the candidate positions. */
  static #visit(rows, f, fn, useAdvertiser, pos, rolled) {
    const types = asSet(f.displayTypeIds);
    const advs = useAdvertiser ? asSet(f.advertiserIds) : null;
    // The straight scan of the fine cube (the reference) checks the stores itself; a partition has already chosen them.
    const stores = !pos && f.storeIds && !rolled ? asSet(f.storeIds) : null;
    if (pos) {
      for (let i = 0; i < pos.length; i += 1) {
        const r = rows[pos[i]];
        if ((!types || types.has(r.displayTypeId)) && (!advs || advs.has(r.advertiserId))) fn(r);
      }
      return;
    }
    const end = lowerBound(rows, `${f.dateTo}￿`);
    const start = lowerBound(rows, f.dateFrom);
    if (!types && !advs && !stores) { for (let i = start; i < end; i += 1) fn(rows[i]); return; }
    for (let i = start; i < end; i += 1) {
      const r = rows[i];
      if ((!stores || stores.has(r.storeId)) && (!types || types.has(r.displayTypeId)) && (!advs || advs.has(r.advertiserId))) fn(r);
    }
  }

  /** The positions, in `rows` order, of the date range's rows under the given keys of a partition. */
  static #inParts(rows, parts, keys, f) {
    const ranges = [];
    let total = 0;
    const stop = `${f.dateTo}￿`;
    for (const k of new Set(keys)) {
      const p = parts.get(k);
      if (!p) continue;
      let lo = 0; let hi = p.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[p[mid]].date < f.dateFrom) lo = mid + 1; else hi = mid; }
      let end = lo; hi = p.length;
      while (end < hi) { const mid = (end + hi) >> 1; if (rows[p[mid]].date < stop) end = mid + 1; else hi = mid; }
      if (end > lo) { ranges.push(p.subarray(lo, end)); total += end - lo; }
    }
    if (ranges.length === 1) return ranges[0];
    const out = new Int32Array(total); let at = 0;
    for (const r of ranges) { out.set(r, at); at += r.length; }
    return out.sort(); // typed arrays sort numerically: restores the order of `rows` across the keys
  }

  #scan(fine, rolled, parts, f, fn, useAdvertiser) {
    if (!this.indexed) return AggregateStore.#visit(fine, f, fn, useAdvertiser, undefined, false);
    if (f.storeIds) return AggregateStore.#visit(fine, f, fn, useAdvertiser, AggregateStore.#inParts(fine, parts, f.storeIds, f));
    // No store filter: the rollup, through the advertiser partition when only some advertisers are asked for.
    if (useAdvertiser && f.advertiserIds && rolled === this.deliveryRollup) {
      return AggregateStore.#visit(rolled, f, fn, useAdvertiser, AggregateStore.#inParts(rolled, this.rollupByAdvertiser, f.advertiserIds, f));
    }
    return AggregateStore.#visit(rolled, f, fn, useAdvertiser, undefined, true);
  }

  /**
   * The cells (see buildCells) of every advertiser for the filters' date range and display types, in no particular order.
   * With no store filter they are the precomputed ones; with a store filter (or no indexes) they are built from the fine rows.
   */
  scanDeliveryCells(filters, fn) {
    const types = asSet(filters.displayTypeIds);
    if (this.indexed && !filters.storeIds) {
      const end = lowerBound(this.deliveryCells, `${filters.dateTo}\uffff`);
      for (let i = lowerBound(this.deliveryCells, filters.dateFrom); i < end; i += 1) {
        const c = this.deliveryCells[i];
        if (!types || types.has(c.displayTypeId)) fn(c);
      }
      return;
    }
    const rows = [];
    this.scanDelivery({ ...filters, advertiserIds: null }, (r) => rows.push(r));
    for (const c of buildCells(rows, this.dealIds.length)) fn(c);
  }

  scanDelivery(filters, fn) { this.#scan(this.delivery, this.deliveryRollup, this.deliveryByStore, filters, fn, true); }

  /**
   * Campaigns live in the date range (start/end overlap it) for the advertiser and display type
   * filters. A campaign with no display types targets all of them; stores are not a campaign property.
   */
  scanCampaigns(f, fn) {
    const advs = asSet(f.advertiserIds);
    const types = asSet(f.displayTypeIds);
    for (const c of this.campaigns) {
      if (c.start > f.dateTo || (c.end && c.end < f.dateFrom)) continue;
      if (advs && !advs.has(c.advertiserId)) continue;
      if (types && c.displayTypeIds && !c.displayTypeIds.some((t) => types.has(t))) continue;
      fn(c);
    }
  }

  /** Unsold inventory ignores the advertiser filter: slot records belong to no advertiser (README open question 1 default). */
  scanInventory(filters, fn) { this.#scan(this.inventory, this.inventoryRollup, this.inventoryByStore, filters, fn, false); }
}

module.exports = { AggregateStore };
