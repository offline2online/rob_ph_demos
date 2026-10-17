'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../constants');
const { addDays, eachDay, dayDiff, dayNumber, dealsOf } = require('../dealing');
const { OPEN_AUCTION, ownAdvertiser, isOpenAuction, dealsDelivered, cents } = require('../advertiser-view');

const change = (now, before, round) => {
  const out = { change: round(now - before) };
  if (before !== 0) out.percent = Math.round(((now - before) / before) * 100);
  return out;
};
const whole = (n) => n;

// Advertiser Delivery: plays won and spend per day, a per-deal block explaining each day (plays won of all
// plays, the advertiser's own CPM, the aggregate winning CPM, the floor), day-on-day change, and PG pacing.
// Other buyers appear only as aggregates: never their names, ids, per-buyer plays or per-buyer CPMs.
// `dealId` narrows to one deal (or `open-auction`). Money is USD to the cent, rounded per day first.
module.exports = {
  path: '/delivery',
  advertiserAccess: true,
  handler({ store, filters, params }) {
    const me = ownAdvertiser(filters);
    // Settled (earned) rows only, like every retailer figure: booked-ahead plays are not delivery yet. `mine` is this
    // advertiser's rows; the aggregates below also read every other buyer's rows, in a second pass over all advertisers.
    const scanFilters = { ...filters, dateFrom: addDays(filters.dateFrom, -1), advertiserIds: null };
    const dealFilter = params.get('dealId') || null;
    const wanted = (key) => !dealFilter || dealFilter === key;
    // One pass over the advertiser's rows keeps them and collects what the rest needs: the deals and open-auction display types it
    // has delivery on, and its plays and spend per day (arrays indexed by day; firstDay is the day before dateFrom).
    const firstDay = dayNumber(scanFilters.dateFrom);
    const spanDays = dayNumber(filters.dateTo) - firstDay + 1;
    const ownPlays = new Float64Array(spanDays); const ownSpend = new Float64Array(spanDays);
    const mine = []; const delivered = new Set(); const dealSeen = new Uint8Array(store.dealIds.length);
    const openTypes = new Set(); const typeSeen = new Uint8Array(store.typeIds.length);
    // Pacing (below) reads this advertiser's views per Programmatic guaranteed deal per day from the flight start, ignoring the store
    // and display type page filters. With neither filter set it is the same rows as this pass but from an earlier day, so one pass
    // does both; otherwise pacing has its own pass.
    const sharedPass = !filters.storeIds && !filters.displayTypeIds;
    let pgFrom = null; const isPg = new Uint8Array(store.dealIds.length);
    for (const d of dealsOf(store)) {
      if (d.dealType !== 'Programmatic guaranteed' || !d.flight || filters.dateTo < d.flight.start || d.flight.end < filters.dateFrom) continue;
      const ix = store.dealCode.get(d.id);
      if (ix !== undefined) isPg[ix] = 1;
      if (pgFrom === null || d.flight.start < pgFrom) pgFrom = d.flight.start;
    }
    const sharedFrom = sharedPass && pgFrom !== null && pgFrom < scanFilters.dateFrom ? pgFrom : scanFilters.dateFrom;
    const sharedBase = dayNumber(sharedFrom);
    const sharedViews = new Map(); // deal code -> views per day since sharedBase
    store.scanDelivery({ ...scanFilters, dateFrom: sharedPass ? sharedFrom : scanFilters.dateFrom, advertiserIds: [me] }, (r) => {
      if (sharedPass && isPg[r.dealIx]) {
        let v = sharedViews.get(r.dealIx);
        if (!v) { v = new Float64Array(spanDays + (firstDay - sharedBase)); sharedViews.set(r.dealIx, v); }
        v[r.dayIx - sharedBase] += r.earnedViews;
      }
      if (r.dayIx < firstDay || (r.earnedSlots <= 0 && r.earned <= 0)) return;
      mine.push(r);
      const open = isOpenAuction(r);
      if (open) { if (!typeSeen[r.typeIx]) { typeSeen[r.typeIx] = 1; openTypes.add(r.displayTypeId); } } else if (!dealSeen[r.dealIx]) { dealSeen[r.dealIx] = 1; delivered.add(r.dealId); }
      if (wanted(open ? OPEN_AUCTION : r.dealId)) { ownPlays[r.dayIx - firstDay] += r.earnedSlots; ownSpend[r.dayIx - firstDay] += r.earned; }
    });

    const deals = dealsDelivered(store, me, delivered);
    if (dealFilter && dealFilter !== OPEN_AUCTION && !deals.some((d) => d.id === dealFilter)) throw new FilterError('unknown dealId');

    // Open auction: the display types the advertiser's campaigns run on (within its scope), plus any it has won on.
    const inScope = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    store.scanCampaigns(filters, (c) => { for (const t of c.displayTypeIds || []) openTypes.add(t); });
    for (const t of [...openTypes]) if ((inScope && !inScope.has(t)) || !store.catalog.displayTypes[t]) openTypes.delete(t);
    const floors = [...openTypes].map((t) => store.catalog.displayTypes[t].floorCpm).filter((v) => v != null);

    const blocks = [...deals.map((d) => ({ key: d.id, deal: d })), ...(openTypes.size ? [{ key: OPEN_AUCTION, deal: null }] : [])]
      .filter((b) => wanted(b.key));

    // (date x block) -> { all plays, winners' revenue/views/highest CPM, other buyers, own plays/revenue/views }, where a block is
    // a deal the advertiser is on, or the open auction. A second pass over the same rows, now that the open-auction display types
    // are known and with every advertiser in (other buyers only feed these aggregates); rows of no block are skipped.
    const blockOf = new Int32Array(store.dealIds.length).fill(-1); let openBlock = -1;
    const blockIx = new Map(blocks.map((b, i) => [b.key, i]));
    blocks.forEach((b, i) => { if (b.key === OPEN_AUCTION) openBlock = i; else { const d = store.dealCode.get(b.key); if (d !== undefined) blockOf[d] = i; } });
    const nBlocks = blocks.length;
    const cells = [];
    const meIx = store.advCode.get(me);
    const cellAt = (dayIx, b) => {
      const at = (dayIx - firstDay) * nBlocks + b;
      return cells[at] || (cells[at] = { all: 0, rev: 0, views: 0, high: 0, others: [], own: { plays: 0, rev: 0, views: 0 } });
    };
    const blockFor = (isOpen, dealIx, typeId) => {
      if (isOpen) return openBlock >= 0 && openTypes.has(typeId) ? openBlock : -1;
      return blockOf[dealIx];
    };
    // Everyone's plays, revenue, views, highest CPM and the other buyers, from the store's precomputed day x type x deal cells.
    store.scanDeliveryCells(scanFilters, (c) => {
      const b = blockFor(c.dealIx < 0, c.dealIx, c.displayTypeId);
      if (b < 0) return;
      const a = cellAt(c.dayIx, b);
      a.all += c.all; a.rev += c.rev; a.views += c.views;
      if (c.high > a.high) a.high = c.high;
      for (const x of c.advs) if (x !== meIx && !a.others.includes(x)) a.others.push(x);
    });
    // The advertiser's own plays, from its own rows (already settled-only).
    for (const r of mine) {
      const b = blockFor(isOpenAuction(r), r.dealIx, r.displayTypeId);
      if (b < 0) continue;
      const own = cellAt(r.dayIx, b).own;
      own.plays += r.earnedSlots; own.rev += r.earned; own.views += r.earnedViews;
    }
    const cellOf = (date, key) => cells[(dayNumber(date) - firstDay) * nBlocks + blockIx.get(key)];

    const block = ({ key, deal }, a) => {
      const own = a ? a.own : { plays: 0, rev: 0, views: 0 };
      const auction = key === OPEN_AUCTION || deal.dealType === 'Private auction';
      const out = { dealId: key, name: key === OPEN_AUCTION ? 'Open auction' : deal.name, dealType: key === OPEN_AUCTION ? 'Open auction' : deal.dealType, playsWon: own.plays };
      if (!auction) {
        if (deal.cpm != null) out.fixedCpm = cents(deal.cpm);
        out.otherBuyers = 'None';
        return out;
      }
      const all = a ? a.all : 0;
      // With exactly one other buyer (1 <= others < MIN) all plays minus the advertiser's own is that buyer's plays, so
      // allPlays and the share are omitted. With none, the advertiser has the block to itself and the share is 100%.
      const others = a ? a.others.length : 0;
      if (!(others >= 1 && others < MIN_OTHER_BUYERS_FOR_WINNING_CPM)) {
        out.allPlays = all;
        if (all > 0) out.sharePercent = calc.wholePercent(own.plays, all);
      }
      if (own.plays > 0 && own.views > 0) out.yourCpm = cents(calc.effectiveCpm(own.rev, own.views));
      if (a && a.others.length >= MIN_OTHER_BUYERS_FOR_WINNING_CPM && a.views > 0) {
        out.winningCpm = { average: cents(calc.effectiveCpm(a.rev, a.views)), highest: cents(a.high) };
      }
      const lo = key === OPEN_AUCTION ? Math.min(...floors) : deal.floorCpm;
      const hi = key === OPEN_AUCTION ? Math.max(...floors) : deal.floorCpm;
      if (Number.isFinite(lo) && Number.isFinite(hi)) out.floorCpm = { min: cents(lo), max: cents(hi) };
      return out;
    };

    const daily = (date) => { const i = dayNumber(date) - firstDay; return { playsWon: ownPlays[i], spend: cents(ownSpend[i]) }; };

    const dates = eachDay(filters.dateFrom, filters.dateTo);
    const days = dates.map((date) => {
      const now = daily(date); const before = daily(addDays(date, -1));
      return {
        date, ...now,
        vsPreviousDay: { playsWon: change(now.playsWon, before.playsWon, whole), spend: change(now.spend, before.spend, cents) },
        deals: blocks.map((b) => block(b, cellOf(date, b.key))),
      };
    });

    // Programmatic guaranteed pacing: guaranteed vs delivered (settled) VAC-d from the flight start. Pacing is a deal-level
    // fact, so the store and display type page filters are ignored (the guarantee covers the whole deal); only the
    // advertiser's own rows are read, and a PG deal has exactly one buyer.
    const pacing = [];
    const pgDeals = deals.filter((x) => x.dealType === 'Programmatic guaranteed' && x.flight && wanted(x.id) && filters.dateTo >= x.flight.start && x.flight.end >= filters.dateFrom);
    // Settled views per deal per day in dense arrays (the shared pass above, or a pass of their own when a page filter applies).
    let viewsOfDeal = sharedViews; let viewsBase = sharedBase;
    if (!sharedPass && pgDeals.length) {
      const from = pgDeals.reduce((m, d) => (d.flight.start < m ? d.flight.start : m), pgDeals[0].flight.start);
      viewsBase = dayNumber(from);
      viewsOfDeal = new Map();
      const wantedIx = new Set(pgDeals.map((d) => store.dealCode.get(d.id)));
      store.scanDelivery({ dateFrom: from, dateTo: filters.dateTo, storeIds: null, displayTypeIds: null, advertiserIds: [me] }, (r) => {
        if (!wantedIx.has(r.dealIx)) return;
        let v = viewsOfDeal.get(r.dealIx);
        if (!v) { v = new Float64Array(dayNumber(filters.dateTo) - viewsBase + 1); viewsOfDeal.set(r.dealIx, v); }
        v[r.dayIx - viewsBase] += r.earnedViews;
      });
    }
    for (const d of deals.filter((x) => x.dealType === 'Programmatic guaranteed' && x.flight && wanted(x.id))) {
      const { start, end } = d.flight;
      const flightDays = dayDiff(start, end) + 1;
      const upTo = filters.dateTo < end ? filters.dateTo : end;
      const views = viewsOfDeal.get(store.dealCode.get(d.id));
      const viewsOn = (date) => (views ? views[dayNumber(date) - viewsBase] || 0 : 0);
      let delivered = 0;
      const series = [];
      // A flight that starts after dateTo or ended before dateFrom has nothing in the range, and is not scanned.
      const inRange = filters.dateTo >= start && end >= filters.dateFrom;
      for (const date of inRange ? eachDay(start, upTo) : []) {
        delivered += viewsOn(date);
        if (date < filters.dateFrom) continue;
        const p = calc.pgPacing({ delivered, forecast: d.forecast, buffer: d.buffer, daysElapsed: dayDiff(start, date) + 1, totalDays: flightDays });
        series.push({ date, guaranteed: Math.round(p.guaranteedToDate), delivered: Math.round(delivered) });
      }
      pacing.push({ dealId: d.id, name: d.name, flightStart: start, flightEnd: end, flightDays, guaranteedForFlight: Math.round(calc.guaranteedVolume(d.forecast, d.buffer)), scope: 'deal', series });
    }

    return {
      dateFrom: filters.dateFrom, dateTo: filters.dateTo, dealId: dealFilter,
      totals: { playsWon: days.reduce((s, x) => s + x.playsWon, 0), spend: cents(days.reduce((s, x) => s + x.spend, 0)) },
      dealOptions: [...deals.map((d) => ({ dealId: d.id, name: d.name, dealType: d.dealType })), ...(openTypes.size ? [{ dealId: OPEN_AUCTION, name: 'Open auction', dealType: 'Open auction' }] : [])],
      days, pacing,
    };
  },
};
