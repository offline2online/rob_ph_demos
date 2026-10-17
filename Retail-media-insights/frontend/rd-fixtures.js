// Fixture responses for Revenue and Deals, in the shapes of the `revenue` and `deals` endpoints
// (src/routes/revenue.js, src/routes/deals.js). 12 Sep – 11 Oct 2026, today = 11 Oct.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RDFixtures = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['Programmatic Guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
  var DSPS = ['DV360', 'The Trade Desk', 'Amazon DSP'];
  var BASE = { 'DV360': [210, 120, 90, 60], 'The Trade Desk': [150, 100, 80, 50], 'Amazon DSP': [90, 70, 60, 40] };
  var DAYS = 30;

  function iso(i) { var d = new Date(Date.UTC(2026, 8, 12 + i)); return d.toISOString().slice(0, 10); }
  function periodStart(date, g) {
    if (g === 'day') return date;
    if (g === 'month') return date.slice(0, 7) + '-01';
    var d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10);
  }
  function revenue(p) {
    var g = (p && p.granularity) || 'day';
    var dsps = (p && p.dsps) || DSPS, types = (p && p.dealTypes) || null;
    var acc = {}, keys = [];
    for (var i = 0; i < DAYS; i++) {
      var date = iso(i), wobble = 1 + 0.15 * Math.sin(i * 1.3);
      DSPS.forEach(function (dsp, di) {
        if (dsps.indexOf(dsp) < 0) return;
        TYPES.forEach(function (t, ti) {
          if (types && types.indexOf(t) < 0 && types.indexOf(t === 'Programmatic Guaranteed' ? 'Programmatic guaranteed' : t) < 0) return;
          var k = periodStart(date, g) + '|' + dsp + '|' + t;
          if (!acc[k]) { acc[k] = { period: periodStart(date, g), dsp: dsp, dealType: t, earned: 0, estimated: 0 }; keys.push(k); }
          acc[k].earned += Math.round(BASE[dsp][ti] * wobble * (di === 0 ? 1 : 0.9));
          acc[k].estimated += ti === 0 && i > DAYS - 6 ? Math.round(BASE[dsp][0] * 0.4) : 0;
        });
      });
    }
    return { granularity: g, rows: keys.map(function (k) { return acc[k]; }) };
  }

  var SLOTS = [
    { displayTypeId: 'window', displayType: 'Window Portrait', playlist: 'Window loop', zone: 'Zone A', playlistZone: 'Window loop · Zone A', iabZone: 'Entrance & out of category', advertiserSlot: 2, loopSlot: 3, playsPerWindow: 12 },
    { displayTypeId: 'queue', displayType: 'Queue Screen', playlist: 'Queue loop', zone: 'Zone B', playlistZone: 'Queue loop · Zone B', iabZone: 'Checkout', advertiserSlot: 1, loopSlot: 1, playsPerWindow: 8 }
  ];
  function pacing(startsIn) {
    if (startsIn) return { flightStart: '2026-10-18', flightEnd: '2026-11-18', flightDays: 32, daysElapsed: 0, daysRemaining: 32, startsInDays: startsIn, flightEnded: false,
      forecast: 300000, buffer: 0.1, guaranteedForFlight: 270000, guaranteedToDate: 0, delivered: 0, percent: null };
    return { flightStart: '2026-09-15', flightEnd: '2026-11-15', flightDays: 62, daysElapsed: 27, daysRemaining: 35, startsInDays: null, flightEnded: false,
      forecast: 400000, buffer: 0.1, guaranteedForFlight: 360000, guaranteedToDate: 156774, delivered: 149000, percent: 95 };
  }
  var DEALS = [
    { id: 'd1', name: 'Wellness PG', description: 'Guaranteed wellness reach on windows and queue screens.', dealType: 'Programmatic Guaranteed',
      dealIds: [{ dsp: 'DV360', dealId: 'PH-A595WKW5P3' }, { dsp: 'The Trade Desk', dealId: 'PH-9ANQZ5XWMD' }], slots: SLOTS,
      advertisers: [{ advertiserId: 'a1', name: 'Blackmores', dsp: 'DV360' }, { advertiserId: 'a2', name: 'Haleon', dsp: 'The Trade Desk' }],
      fill: { percent: 82 }, pacing: pacing(), revenue: 18420, cpm: { value: 22, kind: 'fixed' } },
    { id: 'd2', name: 'Spring Launch PG', description: 'Upcoming guaranteed flight.', dealType: 'Programmatic Guaranteed',
      dealIds: [{ dsp: 'Amazon DSP', dealId: 'PH-WPCHN2JC8Q' }], slots: SLOTS.slice(0, 1),
      advertisers: [{ advertiserId: 'a3', name: 'Bayer Consumer Health', dsp: 'Amazon DSP' }],
      fill: { percent: 0 }, pacing: pacing(7), revenue: 0, cpm: { value: 20, kind: 'fixed' } },
    { id: 'd3', name: 'Everyday Preferred', description: 'Fixed-CPM preferred access.', dealType: 'Preferred deal',
      dealIds: [{ dsp: 'DV360', dealId: 'PH-3K2M9QXT7B' }], slots: SLOTS.slice(1),
      advertisers: [{ advertiserId: 'a1', name: 'Blackmores', dsp: 'DV360' }], fill: { percent: 64 }, pacing: null, revenue: 9210, cpm: { value: 17.5, kind: 'fixed' } },
    { id: 'd4', name: 'Pharmacy Auction', description: 'Private auction at floor CPM.', dealType: 'Private auction',
      dealIds: [{ dsp: 'The Trade Desk', dealId: 'PH-ZX84N2LQ6D' }], slots: [],
      advertisers: [{ advertiserId: 'a2', name: 'Haleon', dsp: 'The Trade Desk' }, { advertiserId: 'a3', name: 'Bayer Consumer Health', dsp: 'Amazon DSP' }],
      fill: { percent: 41 }, pacing: null, revenue: 4380, cpm: { value: 9, kind: 'floor' } }
  ];
  function deals(p) {
    var t = p && p.dealType;
    return { dealType: t || null, rows: DEALS.filter(function (d) { return !t || d.dealType === t || (t === 'Programmatic guaranteed' && d.dealType === 'Programmatic Guaranteed'); }) };
  }

  function fetchJson(endpoint, params, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (opts.state === 'error') return reject(new Error('Fixture error'));
        var empty = opts.state === 'empty';
        if (endpoint === 'revenue') return resolve(empty ? { granularity: 'day', rows: [] } : revenue(params));
        if (endpoint === 'deals') return resolve(empty ? { dealType: null, rows: [] } : deals(params));
        reject(new Error('Unknown endpoint ' + endpoint));
      }, opts.delay == null ? 120 : opts.delay);
    });
  }
  return { revenue: revenue, deals: deals, fetchJson: fetchJson };
});
