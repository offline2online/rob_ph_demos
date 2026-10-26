// Revenue (stacked bar) and Deals (table) of the Retail Media Performance tab.
// A content-frame module (no header, sidebar or position:fixed): the tab shell calls
//   var rd = RevenueDeals.mount(el, { fetchJson: function (endpoint, params) { return Promise } });
//   rd.setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds });
// Endpoints: 'revenue' (dsps[], dealTypes[], granularity) and 'deals' (dealType). The pure model
// builders (ordering, hover content, formatting) are exported for the offline tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RevenueDeals = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The sources of revenue: Direct first (the retailer's own direct advertisers, billed through PH with no DSP), then the connected DSPs.
  var DSP_ORDER = ['Direct', 'DV360', 'The Trade Desk', 'Amazon DSP'];
  var DIRECT = 'Direct';
  var DIRECT_TYPE = 'Direct advertiser';
  var DSP_DEAL_TYPES = ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
  var DEAL_TYPES = [DIRECT_TYPE].concat(DSP_DEAL_TYPES);
  // One colour family per DSP, four shades each: darkest = Programmatic guaranteed, lightest = Open auction. Direct has one shade: it only has direct deals.
  var DSP_SHADES = {
    'Direct': ['#6b3fa0'],
    'DV360': ['#9c3d14', '#eb6834', '#f29a74', '#f9cfbb'],
    'The Trade Desk': ['#174a8c', '#2a78d6', '#6aa7e0', '#b3d1f2'],
    'Amazon DSP': ['#0d6b49', '#1baf7a', '#5fcaa3', '#b0e6d1']
  };
  var AHEAD_LABEL = 'Estimated (booked ahead, not yet played)';
  var AHEAD_DAYS = { day: 14, week: 42 };
  var GRANULARITIES = [['day', 'Day'], ['week', 'Week'], ['month', 'Month']];

  var TIPS = {
    revenue: 'Earned revenue from billing line items, stacked by source and deal type. Each connected DSP has four shades: darkest = programmatic guaranteed, then preferred deal, private auction, and lightest = open auction. ' +
      'Direct (purple) = direct advertisers the retailer sells to straight through PH, with no DSP; it has the one deal type, Direct advertiser. ' +
      'Estimated = reservations booked ahead that have not played yet, mainly programmatic guaranteed.',
    deals: 'One row per deal. Hover a deal name for its description and its deal ID on each DSP (as on Deals & buyers lists). ' +
      'Slots = the slots the deal is assigned to (Available Inventory’s Assigned to column); hover for each slot’s display type, playlist, IAB zone, position and plays per window. ' +
      'Hover an advertiser count to see who is on the deal. Fill = slots sold ÷ all slots on the deal inside operating hours (unsold slot records). ' +
      'Pacing (programmatic guaranteed only) = assumed views (VAC-d) delivered ÷ guaranteed to date. Guaranteed volume = forecast × (1 − buffer). Hover the bar for the numbers. ' +
      'CPM = floor CPM for private auctions; fixed CPM for preferred deals and programmatic guaranteed.',
    pacing: 'Pacing = assumed views (VAC-d) delivered ÷ guaranteed to date. Guaranteed volume = forecast × (1 − buffer).'
  };

  // ---------- formatting ----------
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMoney(n, dp) {
    dp = dp == null ? 0 : dp;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
  }
  function plural(n, word) { return fmtInt(n) + ' ' + word + (n === 1 ? '' : 's'); }
  function periodLabel(period, granularity) {
    if (granularity === 'month') { var m = /^(\d{4})-(\d{2})/.exec(period); return MONTHS[+m[2] - 1]; }
    if (granularity === 'week') return 'w/c ' + fmtDay(period);
    return fmtDay(period);
  }
  // The API names the type "Programmatic Guaranteed"; the page says "Programmatic guaranteed".
  function typeName(t) { return t === 'Programmatic Guaranteed' ? 'Programmatic guaranteed' : t; }
  function isPg(t) { return typeName(t) === 'Programmatic guaranteed'; }

  // ---------- ordering ----------
  function dspRank(d) { var i = DSP_ORDER.indexOf(d); return i < 0 ? DSP_ORDER.length : i; }
  function typeRank(t) { var i = DEAL_TYPES.indexOf(typeName(t)); return i < 0 ? DEAL_TYPES.length : i; }
  // The deal types a source can have: Direct only has direct deals; a DSP has the four deal types.
  function dealTypesFor(dsp) { return dsp === DIRECT ? [DIRECT_TYPE] : DSP_DEAL_TYPES; }
  function sortDsps(list) { return list.slice().sort(function (a, b) { return dspRank(a) - dspRank(b) || (a < b ? -1 : a > b ? 1 : 0); }); }

  // ---------- Revenue model ----------
  // rows → one bar per period: stacks (DSP × deal type, DSP order then PG→Open), estimated total, earned total.
  function revenueBars(data) {
    var by = {}; var order = [];
    ((data && data.rows) || []).forEach(function (r) {
      var b = by[r.period];
      if (!b) { b = by[r.period] = { period: r.period, stacks: [], earned: 0, estimated: 0, ahead: false }; order.push(r.period); }
      if (r.ahead) b.ahead = true;
      if (r.earned) b.stacks.push({ dsp: r.dsp, dealType: typeName(r.dealType), amount: r.earned, advertisers: r.advertisers });
      b.earned += r.earned; b.estimated += r.estimated;
    });
    var lastYear = data && data.lastDataDay ? data.lastDataDay.slice(0, 4) : null;
    return order.sort().filter(function (p) { return !lastYear || p.slice(0, 4) <= lastYear; }).map(function (p) {
      var b = by[p];
      b.stacks.sort(function (x, y) { return dspRank(x.dsp) - dspRank(y.dsp) || typeRank(x.dealType) - typeRank(y.dealType); });
      return b;
    });
  }
  // Totals are the sum of the back end's rounded parts, added in whole cents so they never drift.
  function sumCents(list, pick) { return list.reduce(function (n, x) { return n + Math.round(pick(x) * 100); }, 0) / 100; }
  function revenueTotals(data) {
    var rows = (data && data.rows) || [];
    return { earned: sumCents(rows, function (r) { return r.earned; }) }; // estimated bars never count toward the total
  }
  // How many x-axis labels fit: one per `perLabel` px of plot width, never more than the bars.
  function labelStep(bars, width, perLabel) {
    var fit = Math.max(1, Math.floor((width || 600) / perLabel));
    return Math.max(1, Math.ceil(bars / fit));
  }
  // Tooltip per bar: total for the period, then each DSP × deal type amount with its number of advertisers in brackets.
  function barTooltip(bar, granularity) {
    if (bar.ahead) return { title: 'Estimated (booked ahead)', rows: [[periodLabel(bar.period, granularity), fmtMoney(bar.estimated)]] };
    var lines = [[periodLabel(bar.period, granularity), fmtMoney(bar.earned)]];
    bar.stacks.forEach(function (s) {
      lines.push([s.dsp + ' · ' + s.dealType, fmtMoney(s.amount) + (s.advertisers != null ? ' (' + fmtInt(s.advertisers) + ')' : '')]);
    });
    if (bar.estimated) lines.push(['Estimated (booked ahead)', fmtMoney(bar.estimated)]);
    return { title: 'Earned revenue', rows: lines };
  }
  function shadeColour(dsp, dealType) {
    var shades = DSP_SHADES[dsp];
    if (!shades) return '#8c8c8c';
    return shades[Math.max(0, dealTypesFor(dsp).indexOf(typeName(dealType)))] || shades[0];
  }
  // Days from `iso` to 31 Dec of its year (a month chart runs through December), within the API's 120-day ceiling.
  function daysToYearEnd(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return 120;
    var d = Math.round((Date.UTC(+m[1], 11, 31) - Date.UTC(+m[1], +m[2] - 1, +m[3])) / 86400000);
    return Math.max(1, Math.min(120, d));
  }
  function aheadDaysFor(granularity, dateTo) { return granularity === 'month' ? daysToYearEnd(dateTo) : AHEAD_DAYS[granularity]; }
  // Legend entries: one per selected DSP × deal type (narrowed by the deal type filter), then the estimated entry.
  function legendEntries(dsps, dealType) {
    var out = [];
    sortDsps(dsps).forEach(function (d) {
      dealTypesFor(d).forEach(function (t) { if (!dealType || dealType === t) out.push({ label: d + ' · ' + t, colour: shadeColour(d, t) }); });
    });
    return out;
  }

  // ---------- Deals model ----------
  function slotsLabel(deal) { return deal.slots && deal.slots.length ? plural(deal.slots.length, 'slot') : 'Not assigned'; }
  function nameTooltip(deal) {
    var rows = [];
    if (deal.description) rows.push([deal.description, '']);
    if ((deal.dealIds || []).length) rows.push(['Deal IDs', '', 'rd-tip-h']);
    (deal.dealIds || []).forEach(function (d) { rows.push([d.dspLabel || d.dsp, d.dealId, 'rd-tip-mono']); });
    return { title: deal.name, rows: rows };
  }
  // loopSizes: optional { displayTypeId: slots per loop } from slot-allocation, for "slot 1 of 12".
  function slotsTooltip(deal, loopSizes) {
    var rows = [];
    (deal.slots || []).forEach(function (s) {
      var of = loopSizes && loopSizes[s.displayTypeId] ? 'slot ' + s.loopSlot + ' of ' + loopSizes[s.displayTypeId] : 'slot ' + s.loopSlot + ' of the loop';
      var pos = 'Advertiser slot ' + s.advertiserSlot + (s.loopSlot ? ' (' + of + ')' : '');
      if (s.playsPerWindow != null) pos += ' · ' + fmtInt(s.playsPerWindow) + ' plays per window';
      var desc = (s.displayTypeDescription || '').replace(/\.$/, '');
      rows.push([s.displayType + (desc ? ' (' + desc + ')' : ''), [s.playlistZone || '', s.iabZone ? 'IAB zone: ' + s.iabZone : '', pos].filter(Boolean).join('\n'), 'rd-tip-stack']);
    });
    return { title: 'Assigned slots', rows: rows };
  }
  function advertisersTooltip(deal) {
    return { title: deal.name, rows: (deal.advertisers || []).map(function (a) { return [a.name + ' (' + a.dsp + ')', '']; }) };
  }
  function pacingTooltip(p) {
    var rows = [];
    if (p.delivered != null) rows.push(['Delivered', fmtInt(p.delivered) + ' assumed views']);
    if (p.guaranteedToDate != null) rows.push(['Guaranteed to date', fmtInt(p.guaranteedToDate)]);
    if (p.guaranteedForFlight != null) rows.push(['Guaranteed, whole flight', fmtInt(p.guaranteedForFlight)]);
    if (p.forecast != null) rows.push(['Forecast', fmtInt(p.forecast)]);
    if (p.buffer != null) rows.push(['Buffer', Math.round(p.buffer * (p.buffer <= 1 ? 100 : 1)) + '%']);
    if (p.flightStart) rows.push(['Flight', fmtDay(p.flightStart) + ' – ' + fmtDay(p.flightEnd) + ' (' + plural(p.flightDays, 'day') + ')']);
    if (p.startsInDays != null) rows.push(['Status', 'Starts in ' + plural(p.startsInDays, 'day')]);
    else {
      rows.push(['Days elapsed', p.daysElapsed + ' of ' + p.flightDays + ' (' + Math.round(p.daysElapsed / p.flightDays * 100) + '%)']);
      rows.push(['Days remaining', p.flightEnded ? '0 · flight ended' : String(p.daysRemaining)]);
    }
    return { title: 'Pacing', rows: rows };
  }
  function cpmText(c) {
    if (!c || c.value == null) return '';
    return fmtMoney(c.value, 2);
  }
  function cpmNote(c) { return !c || c.value == null ? '' : c.kind === 'floor' ? 'floor' : 'fixed'; }
  function advertisersLabel(deal) { return plural((deal.advertisers || []).length, 'advertiser'); }
  function cpmTooltip(c) { return c && c.value != null ? { title: 'CPM', rows: [[c.kind === 'floor' ? 'Floor CPM' : 'Fixed CPM', fmtMoney(c.value, 2)]] } : null; }

  // ---------- Deals sorting ----------
  // Every column sorts. The default view is Revenue, highest first; a column cycles highest → lowest, lowest → highest, default.
  var DEAL_COLS = [
    { key: 'name', label: 'Deal', value: function (d) { return d.name == null ? null : String(d.name).toLowerCase(); } },
    { key: 'dealType', label: 'Deal type', value: function (d) { return typeRank(d.dealType); } },
    { key: 'slots', label: 'Slots', value: function (d) { return (d.slots || []).length; } },
    { key: 'advertisers', label: 'Advertisers on deal', value: function (d) { return (d.advertisers || []).length; } },
    { key: 'fill', label: 'Fill', value: function (d) { return d.fill && d.fill.percent != null ? d.fill.percent : null; } },
    { key: 'pacing', label: 'Pacing', value: function (d) { return isPg(d.dealType) && d.pacing && d.pacing.percent != null ? d.pacing.percent : null; } },
    { key: 'revenue', label: 'Revenue', num: true, value: function (d) { return d.revenue == null ? null : d.revenue; } },
    { key: 'cpm', label: 'CPM', num: true, value: function (d) { return d.cpm && d.cpm.value != null ? d.cpm.value : null; } }
  ];
  var DEFAULT_DEAL_SORT = { key: 'revenue', dir: 'desc' };
  // sort: null = default, else { key, dir: 'asc' | 'desc' }. Rows with no value in that column always sit last.
  function sortDeals(rows, sort) {
    var s = sort || DEFAULT_DEAL_SORT;
    var col = DEAL_COLS.filter(function (c) { return c.key === s.key; })[0] || DEAL_COLS[6];
    var sign = s.dir === 'asc' ? 1 : -1;
    return rows.map(function (r, i) { return { r: r, i: i, v: col.value(r) }; }).sort(function (a, b) {
      if (a.v == null || b.v == null) return a.v == null && b.v == null ? a.i - b.i : a.v == null ? 1 : -1;
      return (a.v < b.v ? -1 : a.v > b.v ? 1 : 0) * sign || a.i - b.i;
    }).map(function (x) { return x.r; });
  }
  // The next sort when a column header is clicked. The default is Revenue highest first, so Revenue goes lowest first, then back.
  function nextDealSort(sort, key) {
    var isDefaultCol = key === DEFAULT_DEAL_SORT.key;
    var cur = sort && sort.key === key ? sort.dir : isDefaultCol && !sort ? 'desc' : null;
    if (isDefaultCol) return cur === 'asc' ? null : { key: key, dir: 'asc' };
    return cur === null ? { key: key, dir: 'desc' } : cur === 'desc' ? { key: key, dir: 'asc' } : null;
  }

  // ---------- DOM ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k]; else if (k === 'style') el.style.cssText = attrs[k]; else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(c); });
    return el;
  }
  function icon(name) { return h('span', { class: 'rd-icon', 'aria-hidden': 'true', text: name }); }

  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('RevenueDeals.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = {};
    var sel = { dsps: ['Direct', 'DV360'], dealType: '', granularity: 'day', dealsType: '', dealsSort: null };
    var lastDeals = null;
    var seq = { revenue: 0, deals: 0 };

    var root = h('div', { class: 'rd-root' });
    var tip = h('div', { class: 'rd-tip', role: 'tooltip', hidden: '' });
    container.appendChild(root); root.appendChild(tip);

    // One floating hover card, anchored to the element, kept inside the root (mobile-safe).
    function showTip(model, anchor) {
      if (!model || !model.rows.length) return hideTip();
      tip.textContent = '';
      tip.appendChild(h('div', { class: 'rd-tip-title', text: model.title }));
      model.rows.forEach(function (r) {
        tip.appendChild(h('div', { class: 'rd-tip-row' + (r[2] ? ' ' + r[2] : '') }, [h('span', { class: 'rd-tip-k', text: r[0] }), r[1] ? h('span', { class: 'rd-tip-v', text: r[1] }) : null]));
      });
      tip.hidden = false;
      var rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      var w = Math.min(tip.offsetWidth, rr.width);
      var left = Math.max(0, Math.min(ar.left - rr.left, rr.width - w));
      var top = ar.bottom - rr.top + 6;
      if (ar.bottom + tip.offsetHeight + 12 > window.innerHeight && ar.top - rr.top - tip.offsetHeight - 6 > 0) top = ar.top - rr.top - tip.offsetHeight - 6;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function hideTip() { tip.hidden = true; }
    function hover(el, modelFn) {
      el.setAttribute('tabindex', '0');
      el.addEventListener('mouseenter', function () { showTip(modelFn(), el); });
      el.addEventListener('focus', function () { showTip(modelFn(), el); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
    }
    function info(text) {
      var el = h('span', { class: 'rd-info', 'aria-label': text }, [icon('info')]);
      hover(el, function () { return { title: '', rows: [[text, '']] }; });
      return el;
    }
    function panel(title, tipText, controls) {
      var head = h('div', { class: 'rd-head' }, [h('div', { class: 'rd-title' }, [h('h2', { text: title }), info(tipText)]), controls]);
      var body = h('div', { class: 'rd-body' });
      return { el: h('section', { class: 'rd-panel' }, [head, body]), body: body };
    }
    function stateBox(kind, text, retry) {
      var box = h('div', { class: 'rd-state ' + kind }, [icon(kind === 'error' ? 'error' : 'monitoring'), h('p', { text: text })]);
      if (retry) { var b = h('button', { class: 'rd-btn', type: 'button', text: 'Try again' }); b.onclick = retry; box.appendChild(b); }
      return box;
    }
    function params(extra) {
      var p = {};
      ['dateFrom', 'dateTo', 'storeIds', 'displayTypeIds', 'advertiserIds'].forEach(function (k) { if (filters[k] != null) p[k] = filters[k]; });
      return Object.assign(p, extra);
    }
    function typeSelect(allLabel, types, value, onChange) {
      var s = h('select', { class: 'rd-select', 'aria-label': 'Deal type' });
      s.appendChild(h('option', { value: '', text: allLabel }));
      types.forEach(function (t) { var o = h('option', { value: t, text: t }); if (t === value) o.selected = true; s.appendChild(o); });
      s.onchange = function () { onChange(s.value); };
      return s;
    }

    // ----- Revenue -----
    var chips = h('div', { class: 'rd-chips', role: 'group', 'aria-label': 'DSP or direct' });
    var chipsRow = h('div', { class: 'rd-chips-row' }, [chips]);
    var seg = h('div', { class: 'rd-seg', role: 'group', 'aria-label': 'Granularity' });
    var revType = h('span', { class: 'rd-ctl' });
    var revControls = h('div', { class: 'rd-controls' }, [chipsRow, revType, seg]);
    var rev = panel('Revenue', TIPS.revenue, revControls);
    var legend = h('div', { class: 'rd-legend' });
    function drawControls() {
      chips.textContent = '';
      DSP_ORDER.forEach(function (d) {
        var on = sel.dsps.indexOf(d) >= 0;
        var b = h('button', { type: 'button', class: 'rd-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false' }, [h('span', { class: 'rd-swatch', style: 'background:' + shadeColour(d, d === DIRECT ? DIRECT_TYPE : 'Preferred deal') }), document.createTextNode(d)]);
        b.onclick = function () {
          sel.dsps = on ? sel.dsps.filter(function (x) { return x !== d; }) : sel.dsps.concat(d);
          drawControls(); loadRevenue();
        };
        chips.appendChild(b);
      });
      seg.textContent = '';
      GRANULARITIES.forEach(function (g) {
        var b = h('button', { type: 'button', class: 'rd-seg-btn' + (sel.granularity === g[0] ? ' on' : ''), 'aria-pressed': sel.granularity === g[0] ? 'true' : 'false', text: g[1] });
        b.onclick = function () { sel.granularity = g[0]; drawControls(); loadRevenue(); };
        seg.appendChild(b);
      });
      revType.textContent = '';
      revType.appendChild(typeSelect('All deal types', DEAL_TYPES, sel.dealType, function (v) { sel.dealType = v; loadRevenue(); }));
    }
    function drawLegend() {
      legend.textContent = '';
      legendEntries(sel.dsps, sel.dealType).forEach(function (e) {
        legend.appendChild(h('span', { class: 'rd-legend-item' }, [h('span', { class: 'rd-swatch', style: 'background:' + e.colour }), document.createTextNode(e.label)]));
      });
      legend.appendChild(h('span', { class: 'rd-legend-item' }, [h('span', { class: 'rd-swatch rd-est' }), document.createTextNode(AHEAD_LABEL)]));
    }
    function niceMax(v) {
      if (v <= 0) return 1;
      var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)); var n = v / p;
      return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
    }
    var lastRevenue = null;
    function drawRevenue(data) {
      rev.body.textContent = '';
      var bars = revenueBars(data);
      if (!bars.length) return rev.body.appendChild(stateBox('empty', 'No revenue for these filters.'));
      var max = niceMax(Math.max.apply(null, bars.map(function (b) { return b.earned + b.estimated; })));
      var plot = h('div', { class: 'rd-plot' });
      var axis = h('div', { class: 'rd-axis' });
      [1, 0.75, 0.5, 0.25, 0].forEach(function (f) { axis.appendChild(h('span', { text: fmtMoney(max * f) })); });
      var cols = h('div', { class: 'rd-cols' });
      rev.body.appendChild(plot);
      var every = labelStep(bars.length, plot.clientWidth - 60, data.granularity === 'week' ? 92 : data.granularity === 'month' ? 72 : 52);
      var markerDone = false;
      bars.forEach(function (b, i) {
        if (b.ahead && !markerDone && i > 0) {
          markerDone = true;
          cols.appendChild(h('div', { class: 'rd-today', 'aria-hidden': 'true' }, [h('span', { class: 'rd-today-label', text: 'Today' })]));
        }
        var stack = h('div', { class: 'rd-stack' });
        // Stack is column-reverse: first child is the bottom, so estimated goes last (on top).
        b.stacks.forEach(function (s) {
          stack.appendChild(h('div', { class: 'rd-seg-fill', style: 'height:' + (s.amount / max * 100) + '%;background:' + shadeColour(s.dsp, s.dealType) }));
        });
        if (b.estimated) stack.appendChild(h('div', { class: 'rd-seg-est', style: 'height:' + (b.estimated / max * 100) + '%' }));
        var col = h('div', { class: 'rd-col' }, [h('div', { class: 'rd-stack-wrap' }, [stack]),
          h('div', { class: 'rd-xlabel', text: i % every === 0 ? periodLabel(b.period, data.granularity) : '' })]);
        hover(col, function () { return barTooltip(b, data.granularity); });
        col.setAttribute('aria-label', barTooltip(b, data.granularity).rows.map(function (r) { return r[0] + ' ' + r[1]; }).join(', '));
        cols.appendChild(col);
      });
      plot.appendChild(axis); plot.appendChild(cols);
      drawLegend();
      var totals = revenueTotals(data);
      var line = h('div', { class: 'rd-total', 'data-earned': String(totals.earned), text: 'Total earned ' + fmtMoney(totals.earned) });
      rev.body.insertBefore(line, plot);
      rev.body.appendChild(legend);
      lastRevenue = data;
    }
    function loadRevenue() {
      var my = ++seq.revenue;
      hideTip();
      rev.body.textContent = ''; rev.body.appendChild(h('div', { class: 'rd-skel' }));
      if (!sel.dsps.length) { rev.body.textContent = ''; return rev.body.appendChild(stateBox('empty', 'Select a DSP to see revenue.')); }
      var extra = { dsps: sortDsps(sel.dsps), granularity: sel.granularity, aheadDays: aheadDaysFor(sel.granularity, filters.dateTo) };
      if (sel.dealType) extra.dealTypes = [sel.dealType];
      fetchJson('revenue', params(extra)).then(function (d) { if (my === seq.revenue) drawRevenue(d); })
        .catch(function () { if (my === seq.revenue) { rev.body.textContent = ''; rev.body.appendChild(stateBox('error', 'We couldn’t load revenue. Try again shortly.', loadRevenue)); } });
    }

    // ----- Deals -----
    var dealsTypeWrap = h('span', { class: 'rd-ctl' });
    var deals = panel('Deals', TIPS.deals, dealsTypeWrap);
    var loopSizes = null;
    function loadLoopSizes() {
      var p = params({}); delete p.displayTypeIds;
      fetchJson('slot-allocation', p).then(function (d) {
        loopSizes = {};
        ((d && d.rows) || []).forEach(function (r) { if (r.slotsPerLoop) loopSizes[r.id] = r.slotsPerLoop; });
      }).catch(function () { loopSizes = null; });
    }
    function barWithPercent(pct, cls, tail) {
      return [h('span', { class: 'rd-bar ' + cls }, [h('i', { style: 'width:' + Math.max(0, Math.min(pct || 0, 100)) + '%' })]),
        h('span', { class: 'rd-bar-val', text: pct == null ? '' : Math.round(pct) + '%' })].concat(tail || []);
    }
    function drawDeals(data) {
      deals.body.textContent = '';
      lastDeals = data;
      var rows = sortDeals((data && data.rows) || [], sel.dealsSort);
      if (!rows.length) return deals.body.appendChild(stateBox('empty', 'No deals match this filter.'));
      var eff = sel.dealsSort || DEFAULT_DEAL_SORT;
      var thead = h('thead', {}, [h('tr', {}, DEAL_COLS.map(function (c) {
        var active = eff.key === c.key;
        var th = h('th', { scope: 'col', class: c.num ? 'rd-num' : '', 'aria-sort': active ? (eff.dir === 'asc' ? 'ascending' : 'descending') : 'none' });
        var btn = h('button', { type: 'button', class: 'rd-sort' + (active ? ' rd-sort-on' : ''),
          'aria-label': 'Sort by ' + c.label + (active ? ', currently ' + (eff.dir === 'asc' ? 'lowest' : 'highest') + ' first' : '') }, [
          document.createTextNode(c.label), icon(active ? (eff.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more')]);
        btn.onclick = function () { sel.dealsSort = nextDealSort(sel.dealsSort, c.key); hideTip(); drawDeals(lastDeals); };
        th.appendChild(btn);
        if (c.key === 'pacing') th.appendChild(info(TIPS.pacing));
        return th;
      }))]);
      var tbody = h('tbody');
      rows.forEach(function (d) {
        var tr = h('tr');
        var nameBtn = h('span', { class: 'rd-name', text: d.name }); hover(nameBtn, function () { return nameTooltip(d); });
        tr.appendChild(h('td', {}, [nameBtn]));
        tr.appendChild(h('td', { text: typeName(d.dealType) }));
        var slots = h('span', { class: 'rd-hov', text: slotsLabel(d) });
        if (d.slots && d.slots.length) hover(slots, function () { return slotsTooltip(d, loopSizes); });
        tr.appendChild(h('td', {}, [slots]));
        var adv = h('span', { class: 'rd-hov', text: advertisersLabel(d) });
        if ((d.advertisers || []).length) hover(adv, function () { return advertisersTooltip(d); });
        tr.appendChild(h('td', {}, [adv]));
        var fillTd = h('td');
        if (d.fill && d.fill.percent != null) fillTd.appendChild(h('span', { class: 'rd-barcell' }, barWithPercent(d.fill.percent, 'rd-fill-bar')));
        tr.appendChild(fillTd);
        var pc = h('td');
        if (isPg(d.dealType) && d.pacing) {
          var cell = h('span', { class: 'rd-barcell rd-pace' }, barWithPercent(d.pacing.percent, 'rd-pace-bar',
            d.pacing.percent == null ? [] : [h('span', { class: 'rd-sub', text: 'of guaranteed' })]));
          hover(cell, function () { return pacingTooltip(d.pacing); });
          pc.appendChild(cell);
        }
        tr.appendChild(pc);
        tr.appendChild(h('td', { class: 'rd-num', text: fmtMoney(d.revenue) }));
        var cpm = h('td', { class: 'rd-num' }); var cm = cpmTooltip(d.cpm);
        var cs = h('span', { class: 'rd-hov', text: cpmText(d.cpm) }); if (cm) hover(cs, function () { return cm; });
        cpm.appendChild(cs);
        if (cpmNote(d.cpm)) cpm.appendChild(h('div', { class: 'rd-sub', text: cpmNote(d.cpm) }));
        tr.appendChild(cpm);
        tbody.appendChild(tr);
      });
      deals.body.appendChild(h('div', { class: 'rd-scroll' }, [h('table', { class: 'rd-table' }, [thead, tbody])]));
    }
    function loadDeals() {
      var my = ++seq.deals;
      hideTip();
      deals.body.textContent = ''; deals.body.appendChild(h('div', { class: 'rd-skel' }));
      var extra = sel.dealsType ? { dealType: sel.dealsType } : {};
      fetchJson('deals', params(extra)).then(function (d) { if (my === seq.deals) drawDeals(d); })
        .catch(function () { if (my === seq.deals) { deals.body.textContent = ''; deals.body.appendChild(stateBox('error', 'We couldn’t load deals. Try again shortly.', loadDeals)); } });
    }
    function drawDealsFilter() {
      dealsTypeWrap.textContent = '';
      dealsTypeWrap.appendChild(typeSelect('All deal types', DEAL_TYPES.filter(function (t) { return t !== 'Open auction'; }), sel.dealsType, function (v) { sel.dealsType = v; loadDeals(); }));
    }

    root.appendChild(rev.el); root.appendChild(deals.el);
    drawControls(); drawDealsFilter();
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });
    var resizeTimer = null, lastWidth = root.clientWidth;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (lastRevenue && root.clientWidth !== lastWidth) { lastWidth = root.clientWidth; drawRevenue(lastRevenue); } }, 150);
    });

    return {
      setFilters: function (f) { filters = f || {}; loadLoopSizes(); loadRevenue(); loadDeals(); },
      destroy: function () { container.removeChild(root); }
    };
  }

  return {
    mount: mount, DSP_ORDER: DSP_ORDER, DEAL_TYPES: DEAL_TYPES,
    revenueBars: revenueBars, revenueTotals: revenueTotals, labelStep: labelStep, barTooltip: barTooltip, shadeColour: shadeColour, periodLabel: periodLabel, typeName: typeName, legendEntries: legendEntries, aheadDaysFor: aheadDaysFor, advertisersLabel: advertisersLabel, cpmNote: cpmNote, DSP_SHADES: DSP_SHADES,
    nameTooltip: nameTooltip, slotsTooltip: slotsTooltip, slotsLabel: slotsLabel, advertisersTooltip: advertisersTooltip,
    sortDeals: sortDeals, nextDealSort: nextDealSort, DEAL_COLS: DEAL_COLS,
    pacingTooltip: pacingTooltip, cpmTooltip: cpmTooltip, fmtMoney: fmtMoney
  };
});
