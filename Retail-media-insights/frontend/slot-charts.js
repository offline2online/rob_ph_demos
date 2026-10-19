// Slot value, Slot allocation, Missed revenue & fill and Yield — the four
// display-type charts of the Retail Media Performance tab. A content-frame
// module (no header, sidebar or position:fixed): the tab shell calls
//   var charts = SlotCharts.mount(el, { fetchJson: function (endpoint, params) { return Promise } });
//   charts.setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds });
// The pure model builders (hover cards, ordering, formatting) are exported
// for the offline tests; only mount() touches the DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SlotCharts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ZONE_ORDER = ['Exterior', 'Entrance & out of category', 'In aisles', 'Checkout', 'Other & connected store'];
  var DEAL_TYPES = ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
  var DSP_ORDER = ['DV360', 'The Trade Desk', 'Amazon DSP'];
  // Each DSP's Preferred shade, the same families as the Revenue chart.
  var DSP_COLOURS = { 'DV360': '#eb6834', 'The Trade Desk': '#2a78d6', 'Amazon DSP': '#1baf7a' };
  var ALL_DEAL_TYPES = 'All deal types';
  var AMBER_AT = 85;
  var ORIENTATIONS = ['Not set', '90°', '180°', '270°'];

  var VAC_TEXT = 'Assumed views is the VAC-d (Visibility Adjusted Contacts, digital) score from the OMA MOVE standard; CPM is cost per thousand assumed views. ' +
    'Average assumed views per slot per day = footfall past a display × visibility adjustment × the slot’s share of the loop, averaged across connected displays. ' +
    'Revenue per available slot counts every advertiser slot, sold or unsold: effective CPM × average assumed views ÷ 1,000 × fill. ' +
    'Example: 4,000 footfall × 0.5 visibility × 1/10 of the loop = 200 average assumed views; at a $20 CPM a sold slot earns $4 per day, and at 80% fill the revenue per available slot is $3.20 per day.';

  var TIPS = {
    slotValue: VAC_TEXT + ' The number in brackets is the display type’s connected displays across the selected stores (PH Core).',
    slotAllocation: 'Slots per loop: total slots in the display type’s loop. Advertiser slots + Own-content slots = Slots per loop. ' +
      'Advertiser slots sold: share of advertiser slot capacity inside operating hours sold over the date range; rows at ' + AMBER_AT + '% or more are highlighted amber.',
    missed: 'Fill = advertiser slots sold ÷ all advertiser slots, across all deal types (booking schedule and unsold real-time slot records). ' +
      'Only slots inside each display’s operating hours count (outside screens run 24 hours; in-store screens follow store opening hours); slots outside them play house content. ' +
      'Amber = unsold slots valued at floor CPM × their assumed views ÷ 1,000 (a minimum estimate). ' +
      'Red = revenue lost while displays were offline. The number in brackets is connected displays (PH Core). ' + VAC_TEXT,
    hourly: 'Fill = advertiser slots sold ÷ all advertiser slots in the hour, across all deal types (booking schedule and unsold real-time slot records). ' +
      'Effective CPM = revenue ÷ (assumed views (VAC-d) ÷ 1,000). Only hours inside each display type’s operating hours are inventory and shown: outside screens and windows run 24 hours, in-store screens follow store opening hours. ' +
      'Until the hourly impression multiplier ships, assumed views per hour = the day’s assumed views spread by each hour’s share of the day’s slots played, and revenue is spread the same way. ' +
      'The number in brackets is connected displays (PH Core).',
    yield: 'Effective CPM for each connected DSP: cleared revenue per 1,000 assumed views (VAC-d), from billing line items and reservations. ' + VAC_TEXT
  };
  // Column definitions for the Slot allocation table (an ⓘ beside each heading).
  var COLUMN_TIPS = {
    'Display type': 'The kind of screen, in shopper-journey order. Hover the name for its facts.',
    'Slots per loop': 'All slots in one pass of the display type’s playlist loop: advertiser slots plus own-content slots.',
    'Advertiser slots': 'Slots in the loop that advertisers can buy. Hover for their duration and share of the loop.',
    'Own-content slots': 'Slots in the loop the retailer keeps for its own content. They are never sold to advertisers.',
    'Advertiser slots sold': 'Share of advertiser slots, inside operating hours, that were sold in the selected period. ' + AMBER_AT + '% or more is highlighted amber.'
  };

  // ---------- formatting ----------
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMoney(n, dp) {
    dp = dp == null ? 0 : dp;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  // CPM labels are always to the cent.
  function fmtLabelMoney(n) { return fmtMoney(n, 2); }
  function fmtCompact(n) {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e3) return (Math.round(n / 100) / 10) + 'k';
    return String(Math.round(n));
  }
  function fmtNum(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function pct(n) { return Math.round(n) + '%'; }
  function plural(n, word) { return fmtInt(n) + ' ' + word + (n === 1 ? '' : 's'); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
  }
  // meta is the page's date filter: { dateFrom, dateTo }.
  function dateRange(meta) {
    return meta && meta.dateFrom && meta.dateTo ? fmtDay(meta.dateFrom) + ' – ' + fmtDay(meta.dateTo) : '';
  }
  function orientationText(v) { return ORIENTATIONS.indexOf(String(v)) >= 0 ? String(v) : 'Not set'; }
  function displaysOf(dt) { return dt && dt.connectedDisplays ? dt.connectedDisplays.displays : null; }
  function storesOf(dt) { return dt && dt.connectedDisplays ? dt.connectedDisplays.stores : null; }

  // ---------- ordering ----------
  function zoneRank(zone) { var i = ZONE_ORDER.indexOf(zone); return i < 0 ? ZONE_ORDER.length : i; }
  // Shopper-journey order; a type with no zone goes last; ties keep input order.
  function journeyOrder(rows, typeOf) {
    return rows.map(function (r, i) { return { r: r, i: i, z: zoneRank((typeOf(r) || {}).iabZone) }; })
      .sort(function (a, b) { return a.z - b.z || a.i - b.i; })
      .map(function (x) { return x.r; });
  }
  // Slot value order: the selected metric, highest first; a missing value goes last; ties keep journey order.
  function metricOrder(rows, mode) {
    var key = mode === 'per' ? 'perSlotPerDay' : 'effectiveCpm';
    function v(r) { return has(r[key]) ? r[key] : -Infinity; }
    return journeyOrder(rows, function (r) { return r; }).map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return v(b.r) - v(a.r) || a.i - b.i; }).map(function (x) { return x.r; });
  }
  // Slot allocation follows the Slot value order so the two charts compare row for row; types the value chart lacks go last in journey order.
  function followOrder(rows, leaders, typeOf) {
    var rank = {};
    (leaders || []).forEach(function (r, i) { rank[r.id] = i; });
    return journeyOrder(rows, typeOf).map(function (r, i) { return { r: r, i: i, k: rank[r.id] === undefined ? Infinity : rank[r.id] }; })
      .sort(function (a, b) { return a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1; }).map(function (x) { return x.r; });
  }
  function dspOrder(rows) {
    function rank(r) { var i = DSP_ORDER.indexOf(r.dsp); return i < 0 ? DSP_ORDER.length : i; }
    return rows.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return rank(a.r) - rank(b.r) || a.i - b.i; }).map(function (x) { return x.r; });
  }
  function typesById(payload) {
    var m = {};
    ((payload && payload.rows) || []).forEach(function (t) { m[t.id] = t; });
    return m;
  }
  function bracketed(name, n) { return has(n) ? name + ' (' + fmtInt(n) + ')' : name; }

  // ---------- hover models: { title, desc, sections: [{ rows: [[label, value]], note }], text } ----------
  // The shared display type card (the back end's hover card): the description and the labelled averages. Connected displays, IAB zone,
  // operating hours, Touch Point, canvas size, orientation and creative formats are deliberately not shown in these hovers.
  function displayTypeCard(dt, meta, opts) {
    opts = opts || {};
    var vac = [];
    var a = dt.averages || {};
    if (has(a.averageAssumedViewsPerSlotPerDay)) vac.push(['Average assumed views (VAC-d) per slot per day', fmtInt(a.averageAssumedViewsPerSlotPerDay)]);
    if (has(a.averageFootfallPerDay)) vac.push(['Average footfall past a display per day', fmtInt(a.averageFootfallPerDay)]);
    if (has(a.averageVisibility)) vac.push(['Average visibility adjustment', Number(a.averageVisibility).toFixed(2)]);
    var s = a.shareOfLoopTime;
    if (s && has(s.advertiserSlotSeconds) && has(s.loopSeconds) && has(s.percent)) {
      vac.push(['Share of loop time', s.advertiserSlotSeconds + 's advertiser slot ÷ ' + s.loopSeconds + 's loop = ' + pct(s.percent)]);
    }
    var sections = [];
    if (vac.length) sections.push({ rows: vac, note: a.averagesCover && a.averagesCover.label ? a.averagesCover.label : null });
    return { title: dt.name, desc: has(dt.description) ? dt.description : null, sections: sections.filter(function (x) { return x.rows.length; }) };
  }

  // The value hovers (over a number) carry the figures only, under the display type's name; the description and averages are the
  // name's own hover (displayTypeCard).
  function valuesOnly(name, extra) {
    return { title: name || null, desc: null, sections: extra };
  }

  // row is a /slot-value row: the card facts plus effectiveCpm, floorCpm, perSlotPerDay, totals{…}, advertiserSlotsSoldShare.
  function slotValueHover(row, meta) {
    var t = row.totals || {};
    var range = dateRange(meta);
    var rows = [['Effective CPM', fmtMoney(row.effectiveCpm, 2) + ' (total ' + fmtMoney(t.earnedRevenue, 2) + ' earned on ' + fmtCompact(t.assumedViews) + ' assumed views' + (range ? ', ' + range : '') + ')']];
    if (has(row.floorCpm)) rows.push(['Floor CPM', fmtMoney(row.floorCpm, 2)]);
    rows.push(['Revenue per available slot', fmtMoney(row.perSlotPerDay, 2) + ' (total ' + fmtMoney(t.perDay, 0) + ' per day across ' + plural(t.advertiserSlots, 'advertiser slot') + ' on ' + plural(displaysOf(row), 'display') + ')']);
    if (has(row.averageAssumedViewsPerSlotPerDay) && has(row.advertiserSlotsSoldShare)) {
      // The share is the settled (earned) VAC-d over the range as a share of slot capacity, not the Slot allocation "sold" figure
      // (booked-ahead days are not settled), so it is labelled as what it is. Whole-number percentage, and the result is
      // computed from the displayed factors so the line adds up as shown.
      var cpm = Math.round(row.effectiveCpm * 100) / 100;
      var views = Math.round(row.averageAssumedViewsPerSlotPerDay * 100) / 100;
      var share = Math.round(row.advertiserSlotsSoldShare * 100);
      rows.push(['How it adds up', fmtMoney(cpm, 2) + ' CPM × ' + fmtNum(views) + ' average assumed views ÷ 1,000 × ' +
        share + '% of advertiser slot capacity earned (settled billing) = ' + fmtMoney(cpm * views / 1000 * share / 100, 2)]);
    }
    if (has(row.advertiserSlotsSoldShare)) rows.push(['Fill', Math.round(row.advertiserSlotsSoldShare * 100) + '% of advertiser slot capacity earned (settled billing)']);
    var sec = { rows: rows, note: 'Revenue per available slot = effective CPM × average assumed views per slot per day ÷ 1,000 × fill.' };
    return valuesOnly(row.name, [sec]);
  }

  function loopLine(part) {
    return part.count + ' × ' + part.avgSeconds + 's = ' + part.totalSeconds + 's (' + pct(part.percentOfLoop) + ' of the loop)';
  }
  // kind: 'loop' | 'advertiser' | 'own'. row is a /slot-allocation row; every percentage is the back end's.
  // A row's third element marks the value as emphasised.
  function allocationHover(row, kind) {
    var rows = [];
    var title = row.name ? row.name + ': ' + (kind === 'loop' ? 'loop' : kind === 'advertiser' ? 'advertiser slots' : 'own-content slots') : null;
    if (kind === 'loop') {
      rows.push(['Total loop length', row.loopSeconds + 's', true]);
      rows.push(['Slots per loop', fmtInt(row.slotsPerLoop)]);
      rows.push(['Average slot duration', (Math.round(row.averageSlotSeconds * 10) / 10).toFixed(1) + 's']);
      rows.push(['Advertiser slots', loopLine(row.advertiserSlots)]);
      if (row.ownContentSlots.count > 0) rows.push(['Own-content slots', loopLine(row.ownContentSlots)]);
    } else {
      var part = kind === 'advertiser' ? row.advertiserSlots : row.ownContentSlots;
      rows.push([kind === 'advertiser' ? 'Advertiser slots' : 'Own-content slots', fmtInt(part.count)]);
      rows.push(['Average slot duration', fmtNum(part.avgSeconds) + 's', true]);
      rows.push(['Time in the loop', part.count + ' × ' + part.avgSeconds + 's = ' + part.totalSeconds + 's of the ' + row.loopSeconds + 's loop (' + pct(part.percentOfLoop) + ')']);
      rows.push(['Share of loop per slot', part.avgSeconds + 's ÷ ' + row.loopSeconds + 's = ' + pct(part.slotShareOfLoopPercent)]);
    }
    return { title: title, desc: null, sections: [{ rows: rows }] };
  }

  // Display type rows by unsold value (unsold slots at floor CPM), highest first; ties by total missed, then input order.
  function missedOrder(rows) {
    return rows.map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { var pa = missedParts(a.r), pb = missedParts(b.r); return pb.unsold - pa.unsold || pb.total - pa.total || a.i - b.i; }).map(function (x) { return x.r; });
  }
  // One 100%-wide stack: sold, unsold and offline shares of all advertiser slots, from the back end's counts.
  function missedShares(r) {
    var t = r.slotsTotal || 0;
    function share(n) { return t > 0 ? 100 * n / t : 0; }
    return { filled: share(r.slotsSold), unsold: share(r.slotsUnsold), down: share(r.slotsOffline) };
  }
  function missedAria(name, r) {
    var p = missedParts(r);
    return name + ': ' + pct(r.fillPercent) + ' filled, ' + fmtMoney(p.unsold) + ' unsold, ' + fmtMoney(p.downtime) + ' lost to downtime';
  }

  // The back end rounds the parts once; they are shown and added as returned.
  function missedParts(r) {
    return { unsold: r.unsoldValueAtFloor, downtime: r.downtimeLostRevenue, total: r.totalMissed };
  }

  function floorText(f) {
    if (!f || !has(f.min) || !has(f.max)) return null;
    return f.min === f.max ? fmtMoney(f.min, 2) : fmtMoney(f.min, 2) + '–' + fmtMoney(f.max, 2) + ' by display type';
  }

  // row is a /missed-revenue row or its `total`; dt is the display type's card (rows only). Store counts come from the row itself.
  function missedHover(row, dt, meta, isTotal) {
    var range = dateRange(meta);
    var p = missedParts(row);
    var cd = row.connectedDisplays || {};
    var rows = [];
    var floor = isTotal ? floorText(row.floorCpm) : (has(row.floorCpm) ? fmtMoney(row.floorCpm, 2) + ' per 1,000 assumed views (VAC-d)' : null);
    if (floor) rows.push(['Floor CPM', floor]);
    rows.push(['Fill', pct(row.fillPercent) + ' (total ' + fmtInt(row.slotsSold) + ' of ' + fmtInt(row.slotsTotal) + ' advertiser slots sold)']);
    rows.push(['Unsold slots', fmtInt(row.slotsUnsold) + ' (total ' + fmtMoney(p.unsold) + ' at floor CPM)']);
    rows.push(['Display downtime', fmtMoney(p.downtime) + ' (total lost revenue; ' + fmtInt(row.slotsOffline) + ' slots offline)']);
    rows.push(['Total missed revenue', fmtMoney(p.total) + ' (' + fmtMoney(p.unsold) + ' unsold + ' + fmtMoney(p.downtime) + ' downtime)']);
    var note = 'Totals across all ' + fmtInt(cd.displays) + ' connected ' + (isTotal ? '' : (dt ? dt.name + ' ' : '')) + 'displays' +
      (has(cd.stores) ? ' in ' + plural(cd.stores, 'store') : '') + (range ? ', ' + range : '') + '.';
    var sec = { rows: rows, note: note };
    if (isTotal || !dt) return { title: isTotal ? 'All display types' : null, desc: null, sections: [sec] };
    return valuesOnly(dt.name, [sec]);
  }

  function hourLabel(h) { return (h < 10 ? '0' : '') + h + ':00'; }
  function hourRange(h) { return hourLabel(h) + '–' + hourLabel((h + 1) % 24); }

  // Cell shade: the primary colour at an opacity of the cell's value against the largest value in the grid.
  function hourlyShade(value, max) {
    if (!has(value) || !(max > 0)) return { bg: 'transparent', dark: false };
    var a = Math.max(0.08, Math.min(1, value / max));
    return { bg: 'rgba(22,155,194,' + a.toFixed(2) + ')', dark: a > 0.55 };
  }
  function hourlyCellText(cell, mode) {
    if (mode === 'fill') return pct(cell.fillPercent);
    return has(cell.effectiveCpm) ? fmtMoney(cell.effectiveCpm, 2) : '–';
  }
  function hourlyMax(rows, mode) {
    var max = 0;
    rows.forEach(function (r) { r.hours.forEach(function (c) { var v = mode === 'fill' ? c.fillPercent : c.effectiveCpm; if (has(v) && v > max) max = v; }); });
    return max;
  }

  // row is a /hourly row, cell one of its hours; dt is the display type's card. Facts only.
  function hourlyHover(row, cell, dt, meta) {
    var range = dateRange(meta);
    var cd = row.connectedDisplays || {};
    var rows = [
      ['Hour', hourRange(cell.hour)],
      ['Fill', pct(cell.fillPercent) + ' (total ' + fmtInt(cell.slotsSold) + ' of ' + fmtInt(cell.slotsTotal) + ' advertiser slots sold; ' + fmtInt(cell.slotsUnsold) + ' unsold, ' + fmtInt(cell.slotsOffline) + ' offline)'],
      ['Effective CPM', has(cell.effectiveCpm)
        ? fmtMoney(cell.effectiveCpm, 2) + ' (total revenue ' + fmtMoney(cell.revenue, 2) + ' over ' + fmtInt(cell.views) + ' assumed views)'
        : 'No delivery']
    ];
    var note = 'Totals across all ' + fmtInt(cd.displays) + ' connected ' + (dt ? dt.name + ' ' : '') + 'displays' +
      (has(cd.stores) ? ' in ' + plural(cd.stores, 'store') : '') + (range ? ', ' + range : '') + '.';
    return valuesOnly(dt ? dt.name : row.name, [{ rows: rows, note: note }]);
  }

  // Only DSPs with delivery, highest effective CPM first (ties keep the DSP order).
  function yieldRows(rows) {
    return dspOrder(rows.filter(function (r) { return r.effectiveCpm !== null && r.effectiveCpm !== undefined; }))
      .map(function (r, i) { return { r: r, i: i }; })
      .sort(function (a, b) { return b.r.effectiveCpm - a.r.effectiveCpm || a.i - b.i; }).map(function (x) { return x.r; });
  }

  function yieldHover(row, dealType, meta) {
    if (row.effectiveCpm === null || row.effectiveCpm === undefined) {
      return { title: row.dsp, desc: null, sections: [{ rows: [['Deal type', dealType], ['Effective CPM', 'No delivery']], note: 'No settled billing for this DSP and deal type in the selected period.' }] };
    }
    var rows = [['Deal type', dealType], ['Effective CPM', fmtMoney(row.effectiveCpm, 2)]];
    if (has(row.earnedRevenue) && has(row.assumedViews)) {
      rows.push(['Earned', fmtMoney(row.earnedRevenue, 2) + ' on ' + fmtCompact(row.assumedViews) + ' assumed views' + (dateRange(meta) ? ', ' + dateRange(meta) : '')]);
    }
    return { title: row.dsp, desc: null, sections: [{ rows: rows }] };
  }

  var pure = {
    ZONE_ORDER: ZONE_ORDER, DEAL_TYPES: DEAL_TYPES, DSP_ORDER: DSP_ORDER, AMBER_AT: AMBER_AT, TIPS: TIPS, COLUMN_TIPS: COLUMN_TIPS,
    fmtMoney: fmtMoney, fmtLabelMoney: fmtLabelMoney, fmtCompact: fmtCompact, dateRange: dateRange, pct: pct, orientationText: orientationText,
    journeyOrder: journeyOrder, metricOrder: metricOrder, followOrder: followOrder, dspOrder: dspOrder, yieldRows: yieldRows, missedOrder: missedOrder, missedShares: missedShares, missedAria: missedAria,
    DSP_COLOURS: DSP_COLOURS, ALL_DEAL_TYPES: ALL_DEAL_TYPES, typesById: typesById, missedParts: missedParts,
    displayTypeCard: displayTypeCard, slotValueHover: slotValueHover, allocationHover: allocationHover,
    missedHover: missedHover, yieldHover: yieldHover,
    hourlyHover: hourlyHover, hourlyShade: hourlyShade, hourlyCellText: hourlyCellText, hourlyMax: hourlyMax, hourRange: hourRange
  };

  // ---------- DOM ----------
  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('SlotCharts.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var state = { mode: 'cpm', dealType: '', hourly: 'fill' };
    var gen = { all: 0, yield: 0 };
    var cache = { types: null, typeMap: {} };
    var alive = true;

    function h(tag, attrs, kids) {
      var e = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
        else if (k === 'style') e.style.cssText = attrs[k]; // CSSOM, not a style attribute: allowed under style-src 'self'
        else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
      });
      (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
      return e;
    }
    function icon(name) { return h('span', { class: 'material-symbols-outlined sc-icon', 'aria-hidden': 'true', text: name }); }

    container.classList.add('sc-root');
    container.innerHTML = '';
    var tip = h('div', { class: 'sc-tip', role: 'tooltip', hidden: '' });
    var tipTimer = null;

    function renderTip(m) {
      tip.innerHTML = '';
      if (m.text) { tip.appendChild(h('p', { class: 'sc-tip-text', text: m.text })); return; }
      if (m.title) tip.appendChild(h('div', { class: 'sc-tip-title', text: m.title }));
      if (m.desc) tip.appendChild(h('div', { class: 'sc-tip-desc', text: m.desc }));
      (m.sections || []).forEach(function (s) {
        var dl = h('dl', { class: 'sc-tip-rows' });
        s.rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', {}, [r[2] ? h('strong', { text: r[1] }) : r[1]])); });
        var sec = h('div', { class: 'sc-tip-sec' }, [dl]);
        if (s.note) sec.appendChild(h('div', { class: 'sc-tip-note', text: s.note }));
        tip.appendChild(sec);
      });
    }
    function placeTip(x, y) {
      var vw = document.documentElement.clientWidth, vh = window.innerHeight;
      var w = Math.min(340, vw - 16);
      tip.style.width = w + 'px';
      var rr = container.getBoundingClientRect();
      var hgt = Math.min(tip.offsetHeight, vh - 16);
      var left = Math.max(8, Math.min(x + 12, vw - w - 8));
      var top = y + 14;
      if (top + hgt > vh - 8) top = y - hgt - 10;
      top = Math.max(8, Math.min(top, vh - hgt - 8));
      tip.style.left = (left - rr.left) + 'px';
      tip.style.top = (top - rr.top) + 'px';
    }
    function showTip(model, x, y) { renderTip(model); tip.hidden = false; placeTip(x, y); }
    function hideTip() { tip.hidden = true; }
    // getModel is called lazily so a hover never builds what isn't shown.
    function hoverable(el, getModel) {
      el.setAttribute('tabindex', '0');
      el.addEventListener('mouseenter', function (e) { showTip(getModel(), e.clientX, e.clientY); });
      el.addEventListener('mousemove', function (e) { if (!tip.hidden) placeTip(e.clientX, e.clientY); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip(getModel(), r.left, r.bottom); });
      el.addEventListener('blur', hideTip);
      el.addEventListener('touchstart', function (e) { var t = e.touches[0]; showTip(getModel(), t.clientX, t.clientY); }, { passive: true });
      el.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
      return el;
    }
    document.addEventListener('touchstart', function onDoc(e) {
      if (!alive) return document.removeEventListener('touchstart', onDoc);
      if (!e.target.closest || !e.target.closest('[tabindex]')) hideTip();
    }, { passive: true });

    function info(text) {
      var b = h('span', { class: 'sc-info', 'aria-label': 'More information' }, [icon('info')]);
      return hoverable(b, function () { return { text: text }; });
    }

    // ----- panels -----
    function panel(title, tipText, controlEl, legendEl) {
      var body = h('div', { class: 'sc-body' });
      var head = h('div', { class: 'sc-head' }, [
        h('div', { class: 'sc-title' }, [h('h2', { text: title }), info(tipText)]),
        controlEl
      ]);
      var el = h('section', { class: 'sc-panel', 'aria-label': title }, [head, legendEl, body]);
      return { el: el, body: body, legend: legendEl };
    }
    function legendItem(cls, text) { return h('span', { class: 'sc-legend-item' }, [h('i', { class: 'sc-swatch ' + cls }), text]); }

    // slot value control: segmented toggle
    var segBtns = {};
    var seg = h('div', { class: 'sc-seg', role: 'radiogroup', 'aria-label': 'Slot value metric' });
    [['cpm', 'Effective CPM'], ['per', 'Revenue per available slot']].forEach(function (o) {
      var b = h('button', { type: 'button', class: 'sc-seg-btn', role: 'radio', 'data-mode': o[0], text: o[1] });
      b.addEventListener('click', function () { state.mode = o[0]; syncSeg(); if (svData) drawSlotValue(); if (saData) drawAllocation(saData); });
      segBtns[o[0]] = b; seg.appendChild(b);
    });
    function syncSeg() {
      Object.keys(segBtns).forEach(function (k) {
        segBtns[k].setAttribute('aria-checked', String(state.mode === k));
        segBtns[k].classList.toggle('on', state.mode === k);
      });
      svLegend.innerHTML = '';
      svLegend.appendChild(legendItem('sc-primary', state.mode === 'cpm' ? 'Effective CPM' : 'Earned revenue per advertiser slot per day'));
      if (state.mode === 'cpm') svLegend.appendChild(legendItem('sc-floor', 'Floor CPM'));
    }
    var svLegend = h('div', { class: 'sc-legend' });
    var pSV = panel('Slot value', TIPS.slotValue, seg, svLegend);
    var pSA = panel('Slot allocation', TIPS.slotAllocation, null, null);
    var pMR = panel('Missed revenue & fill', TIPS.missed, null, h('div', { class: 'sc-legend' }, [legendItem('sc-primary', 'Filled'), legendItem('sc-unsold', 'Unsold slots (at floor CPM)'), legendItem('sc-down', 'Display downtime')]));

    var sel = h('select', { class: 'sc-select', 'aria-label': 'Deal type' });
    [ALL_DEAL_TYPES].concat(DEAL_TYPES).forEach(function (d) { sel.appendChild(h('option', { value: d === ALL_DEAL_TYPES ? '' : d, text: d })); });
    sel.addEventListener('change', function () { state.dealType = sel.value; loadYield(); });
    var pY = panel('Yield', TIPS.yield, h('label', { class: 'sc-field' }, [h('span', { text: 'Deal type' }), sel]), null);

    // Fill and effective CPM by hour: full width under Missed revenue & fill and Yield.
    var hSegBtns = {};
    var hSeg = h('div', { class: 'sc-seg', role: 'radiogroup', 'aria-label': 'Hourly metric' });
    [['fill', 'Fill'], ['cpm', 'Effective CPM']].forEach(function (o) {
      var b = h('button', { type: 'button', class: 'sc-seg-btn', role: 'radio', 'data-mode': o[0], text: o[1] });
      b.addEventListener('click', function () { state.hourly = o[0]; syncHSeg(); if (hData) drawHourly(hData); });
      hSegBtns[o[0]] = b; hSeg.appendChild(b);
    });
    function syncHSeg() {
      Object.keys(hSegBtns).forEach(function (k) {
        hSegBtns[k].setAttribute('aria-checked', String(state.hourly === k));
        hSegBtns[k].classList.toggle('on', state.hourly === k);
      });
    }
    var pH = panel('Fill and effective CPM by hour', TIPS.hourly, hSeg, null);
    pH.el.classList.add('sc-wide');

    container.appendChild(h('div', { class: 'sc-grid' }, [pSV.el, pSA.el, pMR.el, pY.el, pH.el]));
    container.appendChild(tip);

    function setState(p, kind, retry) {
      p.body.innerHTML = '';
      if (kind === 'loading') {
        p.body.setAttribute('aria-busy', 'true');
        var sk = h('div', { class: 'sc-skel', role: 'status', 'aria-label': 'Loading' });
        for (var i = 0; i < 4; i++) sk.appendChild(h('div', { class: 'sc-skel-row' }));
        p.body.appendChild(sk);
        return;
      }
      p.body.setAttribute('aria-busy', 'false'); // empty and error are results too: a screen reader must stop announcing "busy"
      if (kind === 'empty') {
        p.body.appendChild(h('div', { class: 'sc-state' }, [icon('bar_chart'), h('div', { text: 'No data for the selected filters' })]));
      } else if (kind === 'error') {
        var btn = h('button', { type: 'button', class: 'sc-btn', text: 'Retry' });
        btn.addEventListener('click', retry);
        p.body.appendChild(h('div', { class: 'sc-state sc-err', role: 'alert' }, [icon('error'), h('div', { text: 'Couldn’t load this chart' }), btn]));
      }
    }

    // The display type's name, hoverable for its description and averages when it has a card.
    function nameLabel(name, displays, dt, attrs) {
      var el = h('div', Object.assign({ class: 'sc-label', text: bracketed(name, displays) }, attrs || {}));
      return dt ? hoverable(el, function () { return displayTypeCard(dt, filters); }) : el;
    }

    // ----- slot value -----
    var svData = null;
    function drawSlotValue() {
      var d = svData;
      var rows = metricOrder(d.rows, state.mode);
      var cpm = state.mode === 'cpm';
      var vals = rows.map(function (r) { return cpm ? r.effectiveCpm : r.perSlotPerDay; });
      var max = Math.max.apply(null, vals.concat(cpm ? rows.map(function (r) { return r.floorCpm || 0; }) : [0])) * 1.08 || 1;
      var list = h('div', { class: 'sc-rows', role: 'list' });
      rows.forEach(function (r, i) {
        var bar = h('div', { class: 'sc-bar sc-primary', style: 'width:' + (100 * vals[i] / max).toFixed(2) + '%' });
        var track = h('div', { class: 'sc-track-in' }, [bar]);
        if (cpm && has(r.floorCpm)) track.appendChild(h('i', { class: 'sc-floor-mark', style: 'left:' + (100 * r.floorCpm / max).toFixed(2) + '%' }));
        var row = h('div', { class: 'sc-row', role: 'listitem' }, [
          nameLabel(r.name, displaysOf(r), cache.typeMap[r.id]),
          h('div', { class: 'sc-track' }, [track]),
          hoverable(h('div', { class: 'sc-value' }, [h('strong', { text: fmtLabelMoney(vals[i]) }), cpm ? ' CPM' : ' per available slot per day']), function () { return slotValueHover(r, filters); })
        ]);
        list.appendChild(row);
      });
      pSV.body.innerHTML = ''; pSV.body.setAttribute('aria-busy', 'false'); pSV.body.appendChild(list);
    }

    // ----- slot allocation -----
    var saData = null;
    function drawAllocation(d) {
      saData = d;
      var rows = followOrder(d.rows, svData && metricOrder(svData.rows, state.mode), function (r) { return cache.typeMap[r.id]; });
      var heads = ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots', 'Advertiser slots sold'];
      var thead = h('thead', {}, [h('tr', {}, heads.map(function (t) { return h('th', { scope: 'col' }, [h('span', { text: t }), info(COLUMN_TIPS[t])]); }))]);
      var tbody = h('tbody');
      rows.forEach(function (r) {
        var dt = cache.typeMap[r.id];
        var sold = r.advertiserSlotsSoldPercent;
        var amber = sold >= AMBER_AT;
        var nameTd = h('td', { class: 'sc-name', text: r.name });
        if (dt) hoverable(nameTd, function () { return displayTypeCard(dt, filters); });
        // The count, with the time it covers in brackets: the whole loop for slots per loop, the slots' total duration otherwise.
        function numTd(v, kind) {
          var secs = kind === 'loop' ? r.loopSeconds : kind === 'advertiser' ? r.advertiserSlots.totalSeconds : r.ownContentSlots.totalSeconds;
          var td = h('td', { class: 'sc-num', text: String(v) + ' (' + secs + 's)' });
          return hoverable(td, function () { return allocationHover(r, kind); });
        }
        var soldTd = h('td', { class: 'sc-sold' }, [
          h('span', { class: 'sc-sold-n', text: pct(sold) }),
          h('span', { class: 'sc-mini' }, [h('i', { class: 'sc-mini-fill ' + (amber ? 'sc-amber' : 'sc-primary'), style: 'width:' + Math.min(100, sold) + '%' })])
        ]);
        tbody.appendChild(h('tr', { class: amber ? 'sc-hot' : '', 'data-amber': amber ? 'true' : 'false' }, [nameTd, numTd(r.slotsPerLoop, 'loop'), numTd(r.advertiserSlots.count, 'advertiser'), numTd(r.ownContentSlots.count, 'own'), soldTd]));
      });
      pSA.body.innerHTML = ''; pSA.body.setAttribute('aria-busy', 'false');
      pSA.body.appendChild(h('div', { class: 'sc-scroll' }, [h('table', { class: 'sc-table' }, [thead, tbody])]));
    }

    // ----- missed revenue / fill -----
    function drawMissed(d) {
      var rows = missedOrder(d.rows);
      var all = rows.concat(rows.length > 1 && d.total ? [d.total] : []);
      var list = h('div', { class: 'sc-rows', role: 'list' });
      all.forEach(function (r) {
        var isTotal = r === d.total;
        var dt = isTotal ? null : cache.typeMap[r.id];
        var p = missedParts(r);
        var sh = missedShares(r);
        var name = isTotal ? 'All display types' : r.name;
        if (isTotal) list.appendChild(h('hr', { class: 'sc-divider' }));
        var track = h('div', { class: 'sc-track-in' }, [
          h('div', { class: 'sc-stack', role: 'img', 'aria-label': missedAria(name, r) }, [
            h('i', { class: 'sc-primary', style: 'width:' + sh.filled.toFixed(2) + '%' }),
            h('i', { class: 'sc-unsold', style: 'width:' + sh.unsold.toFixed(2) + '%' }),
            h('i', { class: 'sc-down', style: 'width:' + sh.down.toFixed(2) + '%' })
          ])
        ]);
        var row = h('div', { class: 'sc-row sc-row-missed' + (isTotal ? ' sc-total' : ''), role: 'listitem', 'data-fill': String(r.fillPercent) }, [
          nameLabel(name, displaysOf(r), dt),
          h('div', { class: 'sc-track' }, [track]),
          hoverable(h('div', { class: 'sc-value' }, [
            h('strong', { text: pct(r.fillPercent) }), ' filled · ',
            h('span', { class: 'sc-m-unsold', text: fmtMoney(p.unsold) }), ' + ',
            h('span', { class: 'sc-m-down', text: fmtMoney(p.downtime) }), ' missed'
          ]), function () { return missedHover(r, dt, filters, isTotal); })
        ]);
        list.appendChild(row);
      });
      pMR.body.innerHTML = ''; pMR.body.setAttribute('aria-busy', 'false'); pMR.body.appendChild(list);
    }

    // ----- yield -----
    function drawYield(d) {
      var rows = yieldRows(d.rows);
      pY.body.innerHTML = ''; pY.body.setAttribute('aria-busy', 'false');
      if (!rows.length) {
        pY.body.appendChild(h('div', { class: 'sc-state' }, [icon('bar_chart_off'), h('div', { text: 'Nothing cleared on this deal type in scope.' })]));
        return;
      }
      var max = Math.max.apply(null, rows.map(function (r) { return r.effectiveCpm; })) * 1.08 || 1;
      var list = h('div', { class: 'sc-rows', role: 'list' });
      rows.forEach(function (r) {
        var bar = h('div', { class: 'sc-bar sc-primary', style: 'width:' + (100 * r.effectiveCpm / max).toFixed(2) + '%' + (DSP_COLOURS[r.dsp] ? ';background:' + DSP_COLOURS[r.dsp] : '') });
        var row = h('div', { class: 'sc-row', role: 'listitem' }, [
          h('div', { class: 'sc-label', text: r.dsp }),
          h('div', { class: 'sc-track' }, [h('div', { class: 'sc-track-in' }, [bar])]),
          h('div', { class: 'sc-value' }, [h('strong', { text: fmtLabelMoney(r.effectiveCpm) }), ' eCPM'])
        ]);
        hoverable(row, function () { return yieldHover(r, d.dealType || ALL_DEAL_TYPES, filters); });
        list.appendChild(row);
      });
      pY.body.appendChild(list);
    }

    // ----- fill and effective CPM by hour -----
    var hData = null;
    function drawHourly(d) {
      var rows = journeyOrder(d.rows, function (r) { return cache.typeMap[r.id]; });
      var max = hourlyMax(rows, state.hourly);
      var grid = h('div', { class: 'sc-heat', role: 'table', 'aria-label': 'Fill and effective CPM by hour' });
      var head = h('div', { class: 'sc-heat-row', role: 'row' }, [h('div', { class: 'sc-heat-label', role: 'columnheader', text: 'Display type' })]);
      for (var hr = 0; hr < 24; hr++) head.appendChild(h('div', { class: 'sc-heat-hour', role: 'columnheader', text: (hr < 10 ? '0' : '') + hr }));
      grid.appendChild(head);
      rows.forEach(function (r) {
        var dt = cache.typeMap[r.id];
        var byHour = {};
        r.hours.forEach(function (c) { byHour[c.hour] = c; });
        var line = h('div', { class: 'sc-heat-row', role: 'row' }, [nameLabel(r.name, displaysOf(r), dt, { class: 'sc-heat-label', role: 'rowheader' })]);
        for (var i = 0; i < 24; i++) {
          var c = byHour[i];
          if (!c) { line.appendChild(h('div', { class: 'sc-heat-cell sc-heat-none', role: 'cell', 'aria-label': r.name + ' ' + hourRange(i) + ': not inventory' })); continue; }
          var v = state.hourly === 'fill' ? c.fillPercent : c.effectiveCpm;
          var shade = hourlyShade(v, max);
          var cell = h('div', { class: 'sc-heat-cell' + (shade.dark ? ' sc-heat-dark' : ''), role: 'cell', style: 'background:' + shade.bg, 'data-hour': String(i), 'data-value': hourlyCellText(c, state.hourly), text: hourlyCellText(c, state.hourly) });
          (function (cc) { hoverable(cell, function () { return hourlyHover(r, cc, dt, filters); }); })(c);
          line.appendChild(cell);
        }
        grid.appendChild(line);
      });
      pH.body.innerHTML = ''; pH.body.setAttribute('aria-busy', 'false');
      pH.body.appendChild(h('div', { class: 'sc-heat-scroll' }, [grid]));
    }

    // ----- loading -----
    function loadYield() {
      var g = ++gen.yield;
      setState(pY, 'loading');
      fetchJson('yield', state.dealType ? Object.assign({}, filters, { dealType: state.dealType }) : filters).then(function (d) {
        if (!alive || g !== gen.yield) return;
        if (!d || !d.rows) return setState(pY, 'empty');
        drawYield(d);
      }, function () { if (alive && g === gen.yield) setState(pY, 'error', loadYield); });
    }
    function loadAll() {
      var g = ++gen.all;
      [pSV, pSA, pMR, pH].forEach(function (p) { setState(p, 'loading'); });
      svData = null; saData = null; hData = null;
      var current = function () { return alive && g === gen.all; };
      var typesP = fetchJson('display-types', filters).then(function (t) {
        cache.types = t; cache.typeMap = typesById(t); return t;
      }, function () { cache.types = null; cache.typeMap = {}; return null; }); // charts still draw, without the display type cards
      function run(p, endpoint, draw, onData) {
        Promise.all([fetchJson(endpoint, filters), typesP]).then(function (res) {
          if (!current()) return;
          var d = res[0];
          if (!d || !d.rows || !d.rows.length) return setState(p, 'empty');
          if (onData) onData(d);
          draw(d);
        }, function () { if (current()) setState(p, 'error', loadAll); });
      }
      run(pSV, 'slot-value', function () { drawSlotValue(); if (saData) drawAllocation(saData); }, function (d) { svData = d; });
      run(pSA, 'slot-allocation', drawAllocation);
      run(pMR, 'missed-revenue', drawMissed);
      run(pH, 'hourly', drawHourly, function (d) { hData = d; });
      loadYield();
    }

    syncSeg(); syncHSeg();
    loadAll();
    return {
      setFilters: function (f) { filters = f || {}; hideTip(); loadAll(); },
      refresh: function () { hideTip(); loadAll(); },
      destroy: function () { alive = false; container.innerHTML = ''; container.classList.remove('sc-root'); }
    };
  }

  return Object.assign({ mount: mount }, pure);
});
