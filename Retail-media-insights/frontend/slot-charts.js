// Slot value, Slot allocation, Missed revenue / fill and Yield — the four
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
  var AMBER_AT = 85;

  var VAC_TEXT = 'Assumed views is the VAC-d (Visibility Adjusted Contacts, digital) score from the OMA MOVE out-of-home standard, and CPM is cost per thousand assumed views. ' +
    'Average assumed views per slot per day = average footfall past a display per day × average visibility adjustment × the slot’s share of loop time (slot length ÷ loop length), averaged across the display type’s connected displays. ' +
    'Billing uses the VAC-d actually realised over the billing window. ' +
    'Example: 4,000 footfall × 0.5 visibility × 1/10 of the loop = 200 average assumed views; at a $20 CPM that slot earns $4 per day on average.';

  var TIPS = {
    slotValue: VAC_TEXT + ' The number in brackets is the display type’s connected displays across the selected stores (PH Core).',
    slotAllocation: 'Slots per loop: total slots in the display type’s loop. Advertiser slots + Own-content slots = Slots per loop. ' +
      'Advertiser slots sold: share of advertiser slot capacity inside operating hours sold over the date range; rows at ' + AMBER_AT + '% or more are highlighted amber.',
    missed: 'Unsold value is an estimate at floor CPM, i.e. the minimum those slots could have earned. Slots outside operating hours are not counted. ' +
      'The number in brackets is connected displays (PH Core). The last row totals all display types.',
    yield: 'Effective CPM per connected DSP: revenue per thousand assumed views (VAC-d). Use the Deal type filter to compare deal types.'
  };

  // ---------- formatting ----------
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMoney(n, dp) {
    dp = dp == null ? 0 : dp;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  // Labels on bars: "$18", "$3.60" — whole dollars once past $10.
  function fmtLabelMoney(n) { return n >= 10 ? fmtMoney(n, 0) : fmtMoney(n, 2); }
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
  function dateRange(meta) {
    return meta && meta.dateFrom && meta.dateTo ? fmtDay(meta.dateFrom) + ' – ' + fmtDay(meta.dateTo) : '';
  }

  // ---------- ordering ----------
  function zoneRank(zone) { var i = ZONE_ORDER.indexOf(zone); return i < 0 ? ZONE_ORDER.length : i; }
  // Shopper-journey order; a type with no zone goes last; ties keep input order.
  function journeyOrder(rows, typeOf) {
    return rows.map(function (r, i) { return { r: r, i: i, z: zoneRank((typeOf(r) || {}).zone) }; })
      .sort(function (a, b) { return a.z - b.z || a.i - b.i; })
      .map(function (x) { return x.r; });
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
  function typeName(t, id) { return (t && t.name) || id; }
  function bracketed(name, n) { return has(n) ? name + ' (' + fmtInt(n) + ')' : name; }

  // ---------- hover models: { title, desc, sections: [{ rows: [[label, value]], note }], text } ----------
  function hoursText(v) {
    if (/^\s*24 hours\s*$/i.test(v || '')) return '24 hours';
    if (/^\s*store opening hours\s*$/i.test(v || '')) return 'Store opening hours';
    return null; // anything else could be a specific time — never shown
  }

  // The shared display type card: facts only, and only fields that are stored.
  function displayTypeCard(dt, meta, opts) {
    opts = opts || {};
    var rows = [];
    if (!opts.omitConnected && has(dt.connectedDisplays)) {
      rows.push(['Connected displays', fmtInt(dt.connectedDisplays) + (has(dt.storeCount) ? ' across ' + plural(dt.storeCount, 'store') : '')]);
    }
    if (has(dt.zone)) rows.push(['IAB store zone', dt.zone]);
    var hrs = hoursText(dt.operatingHours);
    if (hrs) rows.push(['Operating hours', hrs]);
    if (has(dt.touchPoint)) rows.push(['Touch Point', dt.touchPoint]);
    if (dt.resolution && has(dt.resolution.width) && has(dt.resolution.height)) {
      rows.push(['Display canvas size', dt.resolution.width + ' × ' + dt.resolution.height + ' px']);
    }
    if (has(dt.orientation)) rows.push(['Display orientation', String(dt.orientation)]);
    var cf = Array.isArray(dt.creativeFormats) ? dt.creativeFormats.filter(has).join('; ') : dt.creativeFormats;
    if (has(cf)) rows.push(['Creative formats', cf]);
    var vac = [];
    if (has(dt.avgAssumedViewsPerSlotPerDay)) vac.push(['Average assumed views (VAC-d) per slot per day', fmtNum(dt.avgAssumedViewsPerSlotPerDay)]);
    if (has(dt.avgFootfallPerDay)) vac.push(['Average footfall past a display per day', fmtInt(dt.avgFootfallPerDay)]);
    if (has(dt.avgVisibilityAdjustment)) vac.push(['Average visibility adjustment', fmtNum(dt.avgVisibilityAdjustment)]);
    var s = dt.shareOfLoopTime;
    if (s && has(s.slotSeconds) && has(s.loopSeconds) && s.loopSeconds > 0) {
      vac.push(['Share of loop time', s.slotSeconds + 's advertiser slot ÷ ' + s.loopSeconds + 's loop = ' + pct(100 * s.slotSeconds / s.loopSeconds)]);
    }
    var sections = [{ rows: rows }];
    if (vac.length) {
      var note = null;
      if (has(dt.connectedDisplays)) {
        note = 'Averages across all ' + fmtInt(dt.connectedDisplays) + ' connected ' + dt.name + ' displays' +
          (has(dt.storeCount) ? ' in ' + plural(dt.storeCount, 'store') : '') + (dateRange(meta) ? ', ' + dateRange(meta) : '') + '.';
      }
      sections.push({ rows: vac, note: note });
    }
    return { title: dt.name, desc: has(dt.description) ? dt.description : null, sections: sections.filter(function (x) { return x.rows.length; }) };
  }

  function cardPlus(dt, meta, extra, opts) {
    var m = dt ? displayTypeCard(dt, meta, opts) : { title: null, desc: null, sections: [] };
    m.sections = m.sections.concat(extra);
    return m;
  }

  function slotValueHover(row, dt, meta) {
    var range = dateRange(meta);
    var rows = [['Effective CPM', fmtMoney(row.effectiveCpm, 2) + ' (total ' + fmtMoney(row.earnedRevenue) + ' earned on ' + fmtCompact(row.assumedViews) + ' assumed views' + (range ? ', ' + range : '') + ')']];
    if (has(row.floorCpm)) rows.push(['Floor CPM', fmtMoney(row.floorCpm, 2)]);
    var totalPerDay = row.perSlotPerDay * row.advertiserSlots;
    rows.push(['Per slot per day', fmtMoney(row.perSlotPerDay, 2) + ' (total ' + fmtMoney(totalPerDay) + ' per day across ' + plural(row.advertiserSlots, 'advertiser slot') + ' on ' + plural(row.connectedDisplays, 'display') + ')']);
    var sec = { rows: rows, note: 'Per slot per day = Effective CPM × average assumed views per slot per day ÷ 1,000.' };
    var m = cardPlus(dt || { name: row.displayTypeId }, meta, [sec], { omitConnected: false });
    return m;
  }

  function loopLine(count, secs, loop) {
    var t = count * secs;
    return count + ' × ' + secs + 's = ' + t + 's (' + pct(100 * t / loop) + ' of the loop)';
  }
  // kind: 'loop' | 'advertiser' | 'own'
  function allocationHover(row, kind) {
    var loop = row.loopSeconds;
    var rows = [];
    if (kind === 'loop') {
      rows.push(['Total loop length', loop + 's']);
      if (row.slotsPerLoop > 0) rows.push(['Average slot duration', fmtNum(loop / row.slotsPerLoop) + 's']);
      rows.push(['Advertiser slots', loopLine(row.advertiserSlots, row.advertiserSlotSeconds, loop)]);
      if (row.ownContentSlots > 0) rows.push(['Own-content slots', loopLine(row.ownContentSlots, row.ownContentSlotSeconds, loop)]);
    } else {
      var n = kind === 'advertiser' ? row.advertiserSlots : row.ownContentSlots;
      var d = kind === 'advertiser' ? row.advertiserSlotSeconds : row.ownContentSlotSeconds;
      var label = kind === 'advertiser' ? 'advertiser' : 'own-content';
      rows.push(['Average ' + label + ' slot duration', d + 's']);
      rows.push(['Time in the loop', loopLine(n, d, loop)]);
      rows.push(['Share of the loop per slot', d + 's ÷ ' + loop + 's = ' + pct(100 * d / loop)]);
    }
    return { title: null, desc: null, sections: [{ rows: rows }] };
  }

  function missedParts(r) {
    // Parts are added as shown, never re-rounded from a fresh sum.
    return { unsold: r.unsoldValue, downtime: r.downtimeLostRevenue, total: r.unsoldValue + r.downtimeLostRevenue };
  }
  function fillPct(r) { return r.slotsTotal > 0 ? 100 * r.slotsSold / r.slotsTotal : 0; }

  function missedHover(row, dt, meta, isTotal, allDisplays) {
    var range = dateRange(meta);
    var p = missedParts(row);
    var rows = [];
    rows.push(['Connected displays', fmtInt(row.connectedDisplays) + (has(meta && meta.storeCount) ? ' across ' + plural(meta.storeCount, 'store') : '')]);
    if (isTotal) {
      if (has(row.floorCpmMin) && has(row.floorCpmMax)) rows.push(['Floor CPM', row.floorCpmMin === row.floorCpmMax ? fmtMoney(row.floorCpmMin, 2) : fmtMoney(row.floorCpmMin, 2) + '–' + fmtMoney(row.floorCpmMax, 2) + ' by display type']);
    } else if (has(row.floorCpm)) rows.push(['Floor CPM', fmtMoney(row.floorCpm, 2)]);
    rows.push(['Fill', pct(fillPct(row)) + ' (total ' + fmtInt(row.slotsSold) + ' of ' + fmtInt(row.slotsTotal) + ' advertiser slots sold)']);
    rows.push(['Unsold slots', fmtInt(row.slotsUnsold) + ' (total ' + fmtMoney(p.unsold) + ' at floor CPM)']);
    rows.push(['Display downtime', fmtMoney(p.downtime) + ' (total lost revenue; ' + fmtInt(row.slotsOffline) + ' slots offline)']);
    rows.push(['Total missed revenue', fmtMoney(p.total) + ' (' + fmtMoney(p.unsold) + ' unsold + ' + fmtMoney(p.downtime) + ' downtime)']);
    var note = 'Totals across all ' + fmtInt(row.connectedDisplays) + ' connected ' + (isTotal ? '' : (dt ? dt.name : '') + ' ') + 'displays' +
      (has(meta && meta.storeCount) ? ' in ' + plural(meta.storeCount, 'store') : '') + (range ? ', ' + range : '') + '.';
    var sec = { rows: rows, note: note.replace('connected  displays', 'connected displays') };
    if (isTotal || !dt) return { title: isTotal ? 'All display types' : null, desc: null, sections: [sec] };
    return cardPlus(dt, meta, [sec], { omitConnected: true });
  }

  function yieldHover(row, dealType, meta) {
    var rows = [['Deal type', dealType], ['Effective CPM', fmtMoney(row.effectiveCpm, 2)]];
    if (has(row.earnedRevenue) && has(row.assumedViews)) {
      rows.push(['Earned', fmtMoney(row.earnedRevenue) + ' on ' + fmtCompact(row.assumedViews) + ' assumed views' + (dateRange(meta) ? ', ' + dateRange(meta) : '')]);
    }
    return { title: row.dsp, desc: null, sections: [{ rows: rows }] };
  }

  var pure = {
    ZONE_ORDER: ZONE_ORDER, DEAL_TYPES: DEAL_TYPES, DSP_ORDER: DSP_ORDER, AMBER_AT: AMBER_AT, TIPS: TIPS,
    fmtMoney: fmtMoney, fmtLabelMoney: fmtLabelMoney, fmtCompact: fmtCompact, dateRange: dateRange, pct: pct,
    journeyOrder: journeyOrder, dspOrder: dspOrder, typesById: typesById, missedParts: missedParts, fillPct: fillPct,
    displayTypeCard: displayTypeCard, slotValueHover: slotValueHover, allocationHover: allocationHover,
    missedHover: missedHover, yieldHover: yieldHover
  };

  // ---------- DOM ----------
  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('SlotCharts.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var state = { mode: 'cpm', dealType: DEAL_TYPES[0] };
    var gen = { all: 0, yield: 0 };
    var cache = { types: null, typeMap: {} };
    var alive = true;

    function h(tag, attrs, kids) {
      var e = document.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === 'class') e.className = attrs[k];
        else if (k === 'text') e.textContent = attrs[k];
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
        s.rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); });
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
      var hgt = tip.offsetHeight;
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
    [['cpm', 'Effective CPM'], ['per', 'Per slot per day']].forEach(function (o) {
      var b = h('button', { type: 'button', class: 'sc-seg-btn', role: 'radio', 'data-mode': o[0], text: o[1] });
      b.addEventListener('click', function () { state.mode = o[0]; syncSeg(); if (svData) drawSlotValue(); });
      segBtns[o[0]] = b; seg.appendChild(b);
    });
    function syncSeg() {
      Object.keys(segBtns).forEach(function (k) {
        segBtns[k].setAttribute('aria-checked', String(state.mode === k));
        segBtns[k].classList.toggle('on', state.mode === k);
      });
      svLegend.hidden = state.mode !== 'cpm';
    }
    var svLegend = h('div', { class: 'sc-legend' }, [legendItem('sc-floor', 'Floor CPM')]);
    var pSV = panel('Slot value', TIPS.slotValue, seg, svLegend);
    var pSA = panel('Slot allocation', TIPS.slotAllocation, null, null);
    var pMR = panel('Missed revenue / fill', TIPS.missed, null, h('div', { class: 'sc-legend' }, [legendItem('sc-unsold', 'Unsold slots'), legendItem('sc-down', 'Display downtime')]));

    var sel = h('select', { class: 'sc-select', 'aria-label': 'Deal type' });
    DEAL_TYPES.forEach(function (d) { sel.appendChild(h('option', { value: d, text: d })); });
    sel.addEventListener('change', function () { state.dealType = sel.value; loadYield(); });
    var pY = panel('Yield', TIPS.yield, h('label', { class: 'sc-field' }, [h('span', { text: 'Deal type' }), sel]), null);

    container.appendChild(h('div', { class: 'sc-grid' }, [pSV.el, pSA.el, pMR.el, pY.el]));
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
      p.body.removeAttribute('aria-busy');
      if (kind === 'empty') {
        p.body.appendChild(h('div', { class: 'sc-state' }, [icon('bar_chart'), h('div', { text: 'No data for the selected filters' })]));
      } else if (kind === 'error') {
        var btn = h('button', { type: 'button', class: 'sc-btn', text: 'Retry' });
        btn.addEventListener('click', retry);
        p.body.appendChild(h('div', { class: 'sc-state sc-err', role: 'alert' }, [icon('error'), h('div', { text: 'Couldn’t load this chart' }), btn]));
      }
    }

    // ----- slot value -----
    var svData = null;
    function drawSlotValue() {
      var d = svData, meta = d.meta;
      var rows = journeyOrder(d.rows, function (r) { return cache.typeMap[r.displayTypeId]; });
      var cpm = state.mode === 'cpm';
      var vals = rows.map(function (r) { return cpm ? r.effectiveCpm : r.perSlotPerDay; });
      var max = Math.max.apply(null, vals.concat(cpm ? rows.map(function (r) { return r.floorCpm || 0; }) : [0])) * 1.08 || 1;
      var list = h('div', { class: 'sc-rows', role: 'list' });
      rows.forEach(function (r, i) {
        var dt = cache.typeMap[r.displayTypeId];
        var bar = h('div', { class: 'sc-bar sc-primary', style: 'width:' + (100 * vals[i] / max).toFixed(2) + '%' });
        var track = h('div', { class: 'sc-track-in' }, [bar]);
        if (cpm && has(r.floorCpm)) track.appendChild(h('i', { class: 'sc-floor-mark', style: 'left:' + (100 * r.floorCpm / max).toFixed(2) + '%' }));
        var valueText = cpm ? fmtLabelMoney(vals[i]) + ' CPM' : fmtLabelMoney(vals[i]) + ' per slot per day';
        var row = h('div', { class: 'sc-row', role: 'listitem' }, [
          h('div', { class: 'sc-label', text: bracketed(typeName(dt, r.displayTypeId), r.connectedDisplays) }),
          h('div', { class: 'sc-track' }, [track]),
          h('div', { class: 'sc-value', text: valueText })
        ]);
        hoverable(row, function () { return slotValueHover(r, dt, meta); });
        list.appendChild(row);
      });
      pSV.body.innerHTML = ''; pSV.body.appendChild(list);
    }

    // ----- slot allocation -----
    function drawAllocation(d) {
      var rows = journeyOrder(d.rows, function (r) { return cache.typeMap[r.displayTypeId]; });
      var thead = h('thead', {}, [h('tr', {}, ['Display type', 'Slots per loop', 'Advertiser slots', 'Own-content slots', 'Advertiser slots sold'].map(function (t) { return h('th', { scope: 'col', text: t }); }))]);
      var tbody = h('tbody');
      rows.forEach(function (r) {
        var dt = cache.typeMap[r.displayTypeId];
        var amber = r.advertiserSlotsSoldPct >= AMBER_AT;
        var nameTd = h('td', { class: 'sc-name', text: typeName(dt, r.displayTypeId) });
        hoverable(nameTd, function () { return displayTypeCard(dt || { name: r.displayTypeId }, d.meta); });
        function numTd(v, kind) {
          var td = h('td', { class: 'sc-num', text: String(v) });
          return hoverable(td, function () { return allocationHover(r, kind); });
        }
        var sold = h('td', { class: 'sc-sold' }, [
          h('span', { class: 'sc-sold-n', text: pct(r.advertiserSlotsSoldPct) }),
          h('span', { class: 'sc-mini' }, [h('i', { class: 'sc-mini-fill ' + (amber ? 'sc-amber' : 'sc-primary'), style: 'width:' + Math.min(100, r.advertiserSlotsSoldPct) + '%' })])
        ]);
        tbody.appendChild(h('tr', { class: amber ? 'sc-hot' : '' }, [nameTd, numTd(r.slotsPerLoop, 'loop'), numTd(r.advertiserSlots, 'advertiser'), numTd(r.ownContentSlots, 'own'), sold]));
      });
      pSA.body.innerHTML = '';
      pSA.body.appendChild(h('table', { class: 'sc-table' }, [thead, tbody]));
    }

    // ----- missed revenue / fill -----
    function drawMissed(d) {
      var rows = journeyOrder(d.rows, function (r) { return cache.typeMap[r.displayTypeId]; });
      var all = rows.concat(rows.length > 1 && d.total ? [d.total] : []);
      var max = Math.max.apply(null, all.map(function (r) { return missedParts(r).total; })) * 1.04 || 1;
      var list = h('div', { class: 'sc-rows', role: 'list' });
      all.forEach(function (r) {
        var isTotal = r === d.total;
        var dt = isTotal ? null : cache.typeMap[r.displayTypeId];
        var p = missedParts(r);
        if (isTotal) list.appendChild(h('hr', { class: 'sc-divider' }));
        var track = h('div', { class: 'sc-track-in' }, [
          h('div', { class: 'sc-stack', style: 'width:' + (100 * p.total / max).toFixed(2) + '%' }, [
            h('i', { class: 'sc-unsold', style: 'flex:' + p.unsold }), h('i', { class: 'sc-down', style: 'flex:' + p.downtime })
          ])
        ]);
        var name = isTotal ? bracketed('All display types', r.connectedDisplays) : bracketed(typeName(dt, r.displayTypeId), r.connectedDisplays);
        var row = h('div', { class: 'sc-row' + (isTotal ? ' sc-total' : ''), role: 'listitem' }, [
          h('div', { class: 'sc-label', text: name }),
          h('div', { class: 'sc-track' }, [track]),
          h('div', { class: 'sc-value' }, [fmtMoney(p.total) + ' missed', h('span', { class: 'sc-sub', text: pct(fillPct(r)) + ' fill' })])
        ]);
        hoverable(row, function () { return missedHover(r, dt, d.meta, isTotal); });
        list.appendChild(row);
      });
      pMR.body.innerHTML = ''; pMR.body.appendChild(list);
    }

    // ----- yield -----
    function drawYield(d) {
      var rows = dspOrder(d.rows);
      var max = Math.max.apply(null, rows.map(function (r) { return r.effectiveCpm; })) * 1.08 || 1;
      var list = h('div', { class: 'sc-rows', role: 'list' });
      rows.forEach(function (r) {
        var row = h('div', { class: 'sc-row', role: 'listitem' }, [
          h('div', { class: 'sc-label', text: r.dsp }),
          h('div', { class: 'sc-track' }, [h('div', { class: 'sc-track-in' }, [h('div', { class: 'sc-bar sc-primary', style: 'width:' + (100 * r.effectiveCpm / max).toFixed(2) + '%' })])]),
          h('div', { class: 'sc-value', text: fmtLabelMoney(r.effectiveCpm) + ' CPM' })
        ]);
        hoverable(row, function () { return yieldHover(r, d.dealType || state.dealType, d.meta); });
        list.appendChild(row);
      });
      pY.body.innerHTML = ''; pY.body.appendChild(list);
    }

    // ----- loading -----
    function loadYield() {
      var g = ++gen.yield;
      setState(pY, 'loading');
      fetchJson('yield', Object.assign({}, filters, { dealType: state.dealType })).then(function (d) {
        if (!alive || g !== gen.yield) return;
        if (!d || !d.rows || !d.rows.length) return setState(pY, 'empty');
        drawYield(d);
      }, function () { if (alive && g === gen.yield) setState(pY, 'error', loadYield); });
    }
    function loadAll() {
      var g = ++gen.all;
      [pSV, pSA, pMR].forEach(function (p) { setState(p, 'loading'); });
      svData = null;
      var current = function () { return alive && g === gen.all; };
      var typesP = fetchJson('display-types', filters).then(function (t) {
        cache.types = t; cache.typeMap = typesById(t); return t;
      }, function () { cache.types = null; cache.typeMap = {}; return null; }); // charts still draw, names fall back to ids
      function run(p, endpoint, draw, onData) {
        Promise.all([fetchJson(endpoint, filters), typesP]).then(function (res) {
          if (!current()) return;
          var d = res[0];
          if (!d || !d.rows || !d.rows.length) return setState(p, 'empty');
          if (onData) onData(d);
          draw(d);
        }, function () { if (current()) setState(p, 'error', loadAll); });
      }
      run(pSV, 'slot-value', function (d) { drawSlotValue(); }, function (d) { svData = d; });
      run(pSA, 'slot-allocation', drawAllocation);
      run(pMR, 'missed-revenue', drawMissed);
      loadYield();
    }

    syncSeg();
    loadAll();
    return {
      setFilters: function (f) { filters = f || {}; hideTip(); loadAll(); },
      refresh: function () { hideTip(); loadAll(); },
      destroy: function () { alive = false; container.innerHTML = ''; container.classList.remove('sc-root'); }
    };
  }

  return Object.assign({ mount: mount }, pure);
});
