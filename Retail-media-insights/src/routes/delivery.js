'use strict';
const calc = require('../calc');
const { FilterError } = require('../filters');
const { MIN_OTHER_BUYERS_FOR_WINNING_CPM } = require('../constants');
const { addDays, eachDay, dayDiff } = require('../dealing');
const { OPEN_AUCTION, ownAdvertiser, isOpenAuction, dealsInScope, cents } = require('../advertiser-view');

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
    const rows = [];
    store.scanDelivery({ ...filters, dateFrom: addDays(filters.dateFrom, -1), advertiserIds: null }, (r) => rows.push(r));
    const mine = rows.filter((r) => r.advertiserId === me);

    const deals = dealsInScope(store, me, mine);
    const dealFilter = params.get('dealId') || null;
    if (dealFilter && dealFilter !== OPEN_AUCTION && !deals.some((d) => d.id === dealFilter)) throw new FilterError('unknown dealId');
    const keyOf = (r) => (isOpenAuction(r) ? OPEN_AUCTION : r.dealId);
    const wanted = (key) => !dealFilter || dealFilter === key;

    // Open auction: the display types the advertiser's campaigns run on (within its scope), plus any it has won on.
    const inScope = filters.displayTypeIds ? new Set(filters.displayTypeIds) : null;
    const openTypes = new Set(mine.filter(isOpenAuction).map((r) => r.displayTypeId));
    store.scanCampaigns(filters, (c) => { for (const t of c.displayTypeIds || []) openTypes.add(t); });
    for (const t of [...openTypes]) if ((inScope && !inScope.has(t)) || !store.catalog.displayTypes[t]) openTypes.delete(t);
    const floors = [...openTypes].map((t) => store.catalog.displayTypes[t].floorCpm).filter((v) => v != null);

    const blocks = [...deals.map((d) => ({ key: d.id, deal: d })), ...(openTypes.size ? [{ key: OPEN_AUCTION, deal: null }] : [])]
      .filter((b) => wanted(b.key));

    // date -> key -> { all plays, winners' revenue/views/highest CPM, other buyer ids, own plays/revenue/views }
    const perDay = new Map();
    for (const r of rows) {
      const key = keyOf(r);
      if (key === OPEN_AUCTION && !openTypes.has(r.displayTypeId)) continue;
      if (r.slots <= 0 && r.revenue <= 0) continue;
      const day = perDay.get(r.date) || perDay.set(r.date, new Map()).get(r.date);
      const a = day.get(key) || day.set(key, { all: 0, rev: 0, views: 0, high: 0, others: new Set(), own: { plays: 0, rev: 0, views: 0 } }).get(key);
      a.all += r.slots; a.rev += r.revenue; a.views += r.views;
      if (r.views > 0) a.high = Math.max(a.high, calc.effectiveCpm(r.revenue, r.views));
      if (r.advertiserId === me) { a.own.plays += r.slots; a.own.rev += r.revenue; a.own.views += r.views; } else if (r.slots > 0) a.others.add(r.advertiserId);
    }

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
      out.allPlays = all;
      if (all > 0) out.sharePercent = calc.wholePercent(own.plays, all);
      if (own.plays > 0 && own.views > 0) out.yourCpm = cents(calc.effectiveCpm(own.rev, own.views));
      if (a && a.others.size >= MIN_OTHER_BUYERS_FOR_WINNING_CPM && a.views > 0) {
        out.winningCpm = { average: cents(calc.effectiveCpm(a.rev, a.views)), highest: cents(a.high) };
      }
      const lo = key === OPEN_AUCTION ? Math.min(...floors) : deal.floorCpm;
      const hi = key === OPEN_AUCTION ? Math.max(...floors) : deal.floorCpm;
      if (Number.isFinite(lo) && Number.isFinite(hi)) out.floorCpm = { min: cents(lo), max: cents(hi) };
      return out;
    };

    const own = new Map(); // date -> { plays, spend }
    for (const r of mine) {
      if (!wanted(keyOf(r))) continue;
      const o = own.get(r.date) || own.set(r.date, { plays: 0, spend: 0 }).get(r.date);
      o.plays += r.slots; o.spend += r.revenue;
    }
    const daily = (date) => { const o = own.get(date); return { playsWon: o ? o.plays : 0, spend: o ? cents(o.spend) : 0 }; };

    const dates = eachDay(filters.dateFrom, filters.dateTo);
    const days = dates.map((date) => {
      const now = daily(date); const before = daily(addDays(date, -1));
      const day = perDay.get(date);
      return {
        date, ...now,
        vsPreviousDay: { playsWon: change(now.playsWon, before.playsWon, whole), spend: change(now.spend, before.spend, cents) },
        deals: blocks.map((b) => block(b, day && day.get(b.key))),
      };
    });

    // Programmatic guaranteed pacing: guaranteed vs delivered VAC-d, the advertiser's own rows only, from the flight start.
    const pacing = [];
    for (const d of deals.filter((x) => x.dealType === 'Programmatic guaranteed' && x.flight && wanted(x.id))) {
      const { start, end } = d.flight;
      const flightDays = dayDiff(start, end) + 1;
      const upTo = filters.dateTo < end ? filters.dateTo : end;
      const views = new Map();
      if (filters.dateTo >= start) store.scanDelivery({ ...filters, dateFrom: start, dateTo: upTo }, (r) => { if (r.dealId === d.id) views.set(r.date, (views.get(r.date) || 0) + r.views); });
      let delivered = 0;
      const series = [];
      for (const date of eachDay(start, upTo < start ? addDays(start, -1) : upTo)) {
        delivered += views.get(date) || 0;
        if (date < filters.dateFrom) continue;
        const p = calc.pgPacing({ delivered, forecast: d.forecast, buffer: d.buffer, daysElapsed: dayDiff(start, date) + 1, totalDays: flightDays });
        series.push({ date, guaranteed: Math.round(p.guaranteedToDate), delivered: Math.round(delivered) });
      }
      pacing.push({ dealId: d.id, name: d.name, flightStart: start, flightEnd: end, flightDays, guaranteedForFlight: Math.round(calc.guaranteedVolume(d.forecast, d.buffer)), series });
    }

    return {
      dateFrom: filters.dateFrom, dateTo: filters.dateTo, dealId: dealFilter,
      totals: { playsWon: days.reduce((s, x) => s + x.playsWon, 0), spend: cents(days.reduce((s, x) => s + x.spend, 0)) },
      dealOptions: [...deals.map((d) => ({ dealId: d.id, name: d.name, dealType: d.dealType })), ...(openTypes.size ? [{ dealId: OPEN_AUCTION, name: 'Open auction', dealType: 'Open auction' }] : [])],
      days, pacing,
    };
  },
};
