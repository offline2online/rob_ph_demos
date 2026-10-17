// Fixture responses for the advertiser view, in the shapes of the delivery, deals-by-display-type, audience and
// my-targeting endpoints (src/routes/). One advertiser's own data only: no other advertiser's name, no downtime,
// one DSP's deal ID. 12 Sep – 11 Oct 2026, today = 11 Oct.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AVFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAYS = 30;
  function iso(i) { return new Date(Date.UTC(2026, 8, 12 + i)).toISOString().slice(0, 10); }
  function pct(now, before) { return before ? Math.round((now - before) / before * 100) : undefined; }
  function change(now, before, dp) {
    var c = { change: Math.round((now - before) * Math.pow(10, dp)) / Math.pow(10, dp) };
    var p = pct(now, before); if (p !== undefined) c.percent = p;
    return c;
  }
  var DEALS = [
    { dealId: 'd1', name: 'Wellness PG', dealType: 'Programmatic guaranteed' },
    { dealId: 'd3', name: 'Everyday Preferred', dealType: 'Preferred deal' },
    { dealId: 'd4', name: 'Pharmacy Auction', dealType: 'Private auction' },
    { dealId: 'open-auction', name: 'Open auction', dealType: 'Open auction' }
  ];
  function plays(i, k) { return Math.max(0, Math.round((28 + k * 14) * (1 + 0.3 * Math.sin(i * 1.1 + k)))); }
  function block(deal, i) {
    var k = DEALS.indexOf(deal), w = plays(i, k);
    if (deal.dealType === 'Programmatic guaranteed') return { dealId: deal.dealId, name: deal.name, dealType: deal.dealType, playsWon: w, fixedCpm: 22, otherBuyers: 'None' };
    if (deal.dealType === 'Preferred deal') return { dealId: deal.dealId, name: deal.name, dealType: deal.dealType, playsWon: w, fixedCpm: 17.5, otherBuyers: 'None' };
    var all = w * 3 + 6, b = { dealId: deal.dealId, name: deal.name, dealType: deal.dealType, playsWon: w, allPlays: all, floorCpm: deal.dealType === 'Open auction' ? { min: 5.5, max: 7.5 } : { min: 9, max: 9 } };
    if (w > 0) { b.sharePercent = Math.round(w / all * 100); b.yourCpm = deal.dealType === 'Open auction' ? 6.4 : 9.4; }
    if (i % 7 !== 3) b.winningCpm = { average: deal.dealType === 'Open auction' ? 6.9 : 9.18, highest: deal.dealType === 'Open auction' ? 8.2 : 10.11 };
    return b;
  }
  function delivery(p) {
    var dealId = (p && p.dealId) || null;
    var chosen = DEALS.filter(function (d) { return !dealId || d.dealId === dealId; });
    var days = [], tot = { playsWon: 0, spend: 0 };
    function day(i) {
      var blocks = chosen.map(function (d) { return block(d, i); });
      var pl = blocks.reduce(function (a, b) { return a + b.playsWon; }, 0);
      return { blocks: blocks, playsWon: pl, spend: Math.round(blocks.reduce(function (a, b) { return a + b.playsWon * (b.yourCpm || b.fixedCpm || 8) * 0.06; }, 0) * 100) / 100 };
    }
    for (var i = 0; i < DAYS; i++) {
      var now = day(i), before = day(i - 1);
      days.push({ date: iso(i), playsWon: now.playsWon, spend: now.spend,
        vsPreviousDay: { playsWon: change(now.playsWon, before.playsWon, 0), spend: change(now.spend, before.spend, 2) }, deals: now.blocks });
      tot.playsWon += now.playsWon; tot.spend += now.spend;
    }
    tot.spend = Math.round(tot.spend * 100) / 100;
    var pacing = [];
    var series = [], deliv = 0;
    for (var j = 0; j < DAYS; j++) { deliv += 5200 + (j % 5) * 300; series.push({ date: iso(j), guaranteed: Math.round(5600 * (j + 1)), delivered: deliv }); }
    pacing.push({ dealId: 'd1', name: 'Wellness PG', flightStart: '2026-09-12', flightEnd: '2026-11-15', flightDays: 65, guaranteedForFlight: 360000, series: series });
    return { dateFrom: iso(0), dateTo: iso(DAYS - 1), dealId: dealId, totals: tot, dealOptions: DEALS, days: days, pacing: pacing };
  }

  var TYPES = [
    { id: 'window', name: 'Window Portrait', description: 'Portrait screen facing out of the store.', connectedDisplays: { displays: 10, stores: 5 }, iabZone: 'Entrance & out of category', operatingHours: '24 hours',
      touchPoint: 'Window', canvas: { width: 1080, height: 1920, label: '1080 × 1920 px' }, displayOrientation: '90°', creativeFormats: ['Image', 'Video'],
      averages: { averageAssumedViewsPerSlotPerDay: 200, averageFootfallPerDay: 4000, averageVisibility: 0.5, shareOfLoopTime: { percent: 10, advertiserSlotSeconds: 6, loopSeconds: 60 },
        averagesCover: { label: 'Averages across all 10 connected Window Portrait displays in 5 stores, 12 Sep – 11 Oct.' } } },
    { id: 'queue', name: 'Queue Screen', description: 'Screen at the checkout queue.', connectedDisplays: { displays: 8, stores: 4 }, iabZone: 'Checkout', operatingHours: 'Store opening hours', touchPoint: 'Queue' }
  ];
  function dealRow(id, name, desc, type, dsp, slotsAssigned, playsWon, views, spend, cpm, share) {
    return { id: id, name: name, description: desc, dealType: type, dealIds: [{ dsp: dsp, dealId: 'PH-' + id.toUpperCase() + '9XQ' }],
      slots: { count: slotsAssigned.length, assigned: slotsAssigned }, playsWon: playsWon, assumedViews: views, spend: spend, effectiveCpm: cpm,
      share: { playsWon: playsWon, allPlays: Math.round(playsWon / (share / 100)), advertisersOnDeal: share === 100 ? 1 : 3, percent: share } };
  }
  var S1 = { playlist: 'Window loop', zone: 'Zone A', playlistZone: 'Window loop · Zone A', advertiserSlot: 2, loopSlot: 3, label: 'Advertiser slot 2 (loop slot 3)', playsPerWindow: 12 };
  var S2 = { playlist: 'Queue loop', zone: 'Zone B', playlistZone: 'Queue loop · Zone B', advertiserSlot: 1, loopSlot: 1, label: 'Advertiser slot 1 (loop slot 1)', playsPerWindow: 8 };
  function dealsByDisplayType() {
    return {
      slotsWon: { complete: true, retentionDays: 90 },
      totals: { playsWon: 1480, assumedViews: 248000, spend: 3751 },
      groups: [
        { displayType: TYPES[0], dealCount: 2, slots: 2, playsWon: 980, assumedViews: 168000, spend: 2610, effectiveCpm: 15.54, sharePercent: 70, deals: [
          dealRow('d1', 'Wellness PG', 'Guaranteed wellness reach on windows.', 'Programmatic guaranteed', 'DV360', [S1], 620, 110000, 2090, 19, 100),
          dealRow('d4', 'Pharmacy Auction', 'Private auction at floor CPM.', 'Private auction', 'DV360', [S1], 360, 58000, 520, 8.97, 28)] },
        { displayType: TYPES[1], dealCount: 1, slots: 1, playsWon: 500, assumedViews: 80000, spend: 1141, effectiveCpm: 14.26, sharePercent: 30, deals: [
          dealRow('d3', 'Everyday Preferred', 'Fixed-CPM preferred access.', 'Preferred deal', 'DV360', [S2], 500, 80000, 1141, 14.26, 100)] }
      ]
    };
  }
  function audience() {
    var trend = [], total = 0;
    for (var i = 0; i < DAYS; i++) { var v = Math.round(7600 + 1400 * Math.sin(i / 3) + i * 40); trend.push({ date: iso(i), assumedViews: v }); total += v; }
    return { assumedViews: total, trend: trend };
  }
  function myTargeting() {
    return {
      level: 'Localised',
      variablesUsed: [{ label: 'State', kind: 'Localised' }, { label: 'Suburb', kind: 'Localised' }],
      scheduling: { uses: true, scheduledCampaigns: 3, campaigns: 4, schedules: 5 },
      otherVariablesAvailable: { Localised: [{ label: 'Postcode', kind: 'Localised' }], Personalised: [{ label: 'Visitor Segments', kind: 'Personalised', personalisationType: 'Audience' }] },
      usesEverySharedVariable: false
    };
  }
  // Display types the advertiser's deals and campaigns are on (the endpoint is filter-options).
  function filterOptions() { return { displayTypes: [{ id: 'queue', name: 'Queue Screen' }, { id: 'window', name: 'Window Portrait' }] }; }

  var EMPTY = {
    'delivery': { dateFrom: iso(0), dateTo: iso(DAYS - 1), dealId: null, totals: { playsWon: 0, spend: 0 }, dealOptions: [], days: [], pacing: [] },
    'deals-by-display-type': { slotsWon: { complete: true, retentionDays: 90 }, totals: { playsWon: 0, assumedViews: 0, spend: 0 }, groups: [] },
    'audience': { assumedViews: 0, trend: [] },
    'my-targeting': { variablesUsed: [], scheduling: { uses: false, scheduledCampaigns: 0, campaigns: 0, schedules: 0 }, otherVariablesAvailable: { Localised: [], Personalised: [] }, usesEverySharedVariable: false }
  };

  function fetchJson(endpoint, params, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (opts.state === 'error') return reject(new Error('Fixture error'));
        if (opts.state === 'empty' && EMPTY[endpoint]) return resolve(EMPTY[endpoint]);
        if (endpoint === 'delivery') return resolve(delivery(params));
        if (endpoint === 'deals-by-display-type') return resolve(dealsByDisplayType());
        if (endpoint === 'audience') return resolve(audience());
        if (endpoint === 'my-targeting') return resolve(myTargeting());
        if (endpoint === 'filter-options') return resolve(filterOptions());
        reject(new Error('Unknown endpoint ' + endpoint));
      }, opts.delay == null ? 120 : opts.delay);
    });
  }
  return { delivery: delivery, dealsByDisplayType: dealsByDisplayType, audience: audience, myTargeting: myTargeting, filterOptions: filterOptions, fetchJson: fetchJson };
});
