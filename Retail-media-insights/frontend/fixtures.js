// Fixture responses for the four slot charts, in the shapes documented in
// SLOT-CHARTS.md. Five sample stores, 12 Sep – 11 Oct (30 days). Every figure
// is derived from the inputs below so the hover totals add up as displayed.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlotChartsFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var META = { dateFrom: '2026-09-12', dateTo: '2026-10-11', days: 30, storeCount: 5 };

  // Deliberately NOT in journey order, so the tests prove the component sorts.
  var BASE = [
    { id: 'queue', name: 'Queue Screen', description: 'Shopper-facing screen at the till queue.', displays: 15,
      zone: 'Checkout', hours: 'Store opening hours', touchPoint: 'Digital Signage', w: 1920, h: 1080, orientation: 'Not set',
      creative: 'Image + video, 1920×1080, max play 5s', footfall: 1800, visibility: 0.8,
      loop: 60, advN: 10, advS: 5, ownN: 2, ownS: 5, cpm: 22, floor: 9, soldPct: 91, sold: 0.8, offline: 0.03 },
    { id: 'dispensary', name: 'Dispensary Screen', description: 'Screen behind the pharmacy counter.', displays: 5,
      zone: 'Other & connected store', hours: 'Store opening hours', touchPoint: 'Digital Signage', w: 1920, h: 1080, orientation: 'Not set',
      creative: 'Image + video, 1920×1080, max play 6s', footfall: 1000, visibility: 0.5,
      loop: 60, advN: 4, advS: 6, ownN: 6, ownS: 6, cpm: 12, floor: 5.5, soldPct: 61, sold: 0.58, offline: 0.06 },
    { id: 'window', name: 'Window Portrait', description: 'Portrait screen in the shop window, visible from outside.', displays: 10,
      zone: 'Entrance & out of category', hours: '24 hours', touchPoint: 'Digital Signage', w: 1080, h: 1920, orientation: '90°',
      creative: 'Image + video, 1080×1920, max play 6s', footfall: 4000, visibility: 0.5,
      loop: 60, advN: 8, advS: 6, ownN: 4, ownS: 3, cpm: 18, floor: 8, soldPct: 78, sold: 0.72, offline: 0.04 },
    { id: 'endcap', name: 'Endcap Shelf-edge', description: 'Shelf-edge strip on gondola ends.', displays: 20,
      zone: 'Entrance & out of category', hours: 'Store opening hours', touchPoint: 'Digital Signage', w: 1920, h: 360, orientation: 'Not set',
      creative: 'Image + video, 1920×360, max play 5s', footfall: 2400, visibility: 0.4,
      loop: 60, advN: 6, advS: 5, ownN: 6, ownS: 5, cpm: 14, floor: 6, soldPct: 85, sold: 0.78, offline: 0.03 }
  ];

  function r2(n) { return Math.round(n * 100) / 100; }

  function derive(b) {
    var share = b.advS / b.loop;
    var views = r2(b.footfall * b.visibility * share);             // avg assumed views per slot per day
    var slots = b.advN * b.displays;                                // advertiser slots across displays
    var assumedViews = Math.round(views * slots * META.days);
    var earned = Math.round(b.cpm * assumedViews / 1000);
    var perSlot = r2(b.cpm * views / 1000);
    var total = slots * META.days;                                  // slot-days on offer
    var sold = Math.round(total * b.sold);
    var offline = Math.round(total * b.offline);
    var unsold = total - sold - offline;
    return { b: b, share: share, views: views, slots: slots, assumedViews: assumedViews, earned: earned, perSlot: perSlot,
      total: total, sold: sold, offline: offline, unsold: unsold,
      unsoldValue: Math.round(unsold * b.floor * views / 1000),
      downtime: Math.round(offline * b.cpm * views / 1000) };
  }

  var D = BASE.map(derive);

  var displayTypes = { meta: META, rows: D.map(function (d) {
    var b = d.b;
    return { id: b.id, name: b.name, description: b.description, connectedDisplays: b.displays, storeCount: META.storeCount,
      zone: b.zone, operatingHours: b.hours, touchPoint: b.touchPoint, resolution: { width: b.w, height: b.h },
      orientation: b.orientation, creativeFormats: [b.creative],
      avgAssumedViewsPerSlotPerDay: d.views, avgFootfallPerDay: b.footfall, avgVisibilityAdjustment: b.visibility,
      shareOfLoopTime: { slotSeconds: b.advS, loopSeconds: b.loop } };
  }) };

  var slotValue = { meta: META, rows: D.map(function (d) {
    return { displayTypeId: d.b.id, connectedDisplays: d.b.displays, effectiveCpm: d.b.cpm, floorCpm: d.b.floor,
      perSlotPerDay: d.perSlot, earnedRevenue: d.earned, assumedViews: d.assumedViews,
      advertiserSlotsPerLoop: d.b.advN, advertiserSlots: d.slots };
  }) };

  var slotAllocation = { meta: META, rows: D.map(function (d) {
    var b = d.b;
    return { displayTypeId: b.id, slotsPerLoop: b.advN + b.ownN, advertiserSlots: b.advN, ownContentSlots: b.ownN,
      loopSeconds: b.loop, advertiserSlotSeconds: b.advS, ownContentSlotSeconds: b.ownS, advertiserSlotsSoldPct: b.soldPct };
  }) };

  function sum(k) { return D.reduce(function (a, d) { return a + d[k]; }, 0); }
  var missedRows = D.map(function (d) {
    return { displayTypeId: d.b.id, connectedDisplays: d.b.displays, floorCpm: d.b.floor,
      slotsTotal: d.total, slotsSold: d.sold, slotsUnsold: d.unsold, slotsOffline: d.offline,
      unsoldValue: d.unsoldValue, downtimeLostRevenue: d.downtime };
  });
  var missedRevenue = { meta: META, rows: missedRows, total: {
    connectedDisplays: D.reduce(function (a, d) { return a + d.b.displays; }, 0),
    floorCpmMin: Math.min.apply(null, BASE.map(function (b) { return b.floor; })),
    floorCpmMax: Math.max.apply(null, BASE.map(function (b) { return b.floor; })),
    slotsTotal: sum('total'), slotsSold: sum('sold'), slotsUnsold: sum('unsold'), slotsOffline: sum('offline'),
    unsoldValue: sum('unsoldValue'), downtimeLostRevenue: sum('downtime') } };

  var yieldByDealType = {
    'Programmatic guaranteed': { 'DV360': 21.4, 'The Trade Desk': 19.8, 'Amazon DSP': 18.2 },
    'Preferred deal': { 'DV360': 17.9, 'The Trade Desk': 18.6, 'Amazon DSP': 15.1 },
    'Private auction': { 'DV360': 14.2, 'The Trade Desk': 15.7, 'Amazon DSP': 16.3 },
    'Open auction': { 'DV360': 9.8, 'The Trade Desk': 8.7, 'Amazon DSP': 10.4 }
  };
  function yieldFor(dealType) {
    var m = yieldByDealType[dealType] || {};
    // Returned in the order the back end happens to produce; the component imposes DSP order.
    return { meta: META, dealType: dealType, rows: ['Amazon DSP', 'The Trade Desk', 'DV360'].filter(function (k) { return k in m; })
      .map(function (k) { return { dsp: k, effectiveCpm: m[k] }; }) };
  }

  // fetchJson(endpoint, params) → Promise, as the tab shell supplies it.
  function fetchJson(endpoint, params, opts) {
    opts = opts || {};
    var delay = opts.delay == null ? 120 : opts.delay;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (opts.state === 'error') return reject(new Error('Fixture error'));
        var empty = opts.state === 'empty';
        switch (endpoint) {
          case 'display-types': return resolve(empty ? { meta: META, rows: [] } : displayTypes);
          case 'slot-value': return resolve(empty ? { meta: META, rows: [] } : slotValue);
          case 'slot-allocation': return resolve(empty ? { meta: META, rows: [] } : slotAllocation);
          case 'missed-revenue': return resolve(empty ? { meta: META, rows: [], total: null } : missedRevenue);
          case 'yield': return resolve(empty ? { meta: META, dealType: params && params.dealType, rows: [] } : yieldFor(params && params.dealType));
          default: return reject(new Error('Unknown endpoint ' + endpoint));
        }
      }, delay);
    });
  }

  return { META: META, displayTypes: displayTypes, slotValue: slotValue, slotAllocation: slotAllocation,
    missedRevenue: missedRevenue, yieldFor: yieldFor, fetchJson: fetchJson };
});
