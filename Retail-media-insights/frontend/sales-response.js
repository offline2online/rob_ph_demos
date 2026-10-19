// Sales response after personalised plays: one chart for the Targeting & scheduling maturity section (retailer) and the
// advertiser's Your targeting & scheduling. A content-frame module (no header, sidebar or position:fixed): the tab shell calls
//   var sr = SalesResponse.mount(el, { filters: {...}, fetchJson: function (endpoint, params) { return Promise } });
//   sr.setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds });
// The pure builders are exported for the offline tests; only mount() touches the DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SalesResponse = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WINDOWS = [5, 10, 15, 30, 60];
  var STEPS = [1, 5, 15];
  var MAX_WINDOW = 120;
  var DEFAULT_WINDOW = 10;
  var NO_CONTROL = 'Control stores — none set for this campaign.';
  var COLOURS = { personalised: '#174a8c', localised: '#6aa7e0', control: '#8c8c8c' };
  // One colour per personalised variation, in the order the server lists them.
  var VARIATION_COLOURS = ['#174a8c', '#5b3fa0', '#0b7a75'];

  var TIPS = {
    title: 'Shows sales of this campaign’s product in the minutes after it played on your in-store displays. Each personalised play is a moment one identified shopper saw a personalised variant. ' +
      'We count sales of the campaign’s products in the same store in each minute after that play, and compare them with the minutes after localised plays and with control stores at the same clock time. ' +
      'Sales are shown per 1,000 transactions in the same store in the same minutes — the share of all baskets that included this product. This means larger stores and busy times of day don’t look better just because more people are buying. Each sale counts once, against the nearest play before it. ' +
      'Products come from the SKU or product name on the campaign; play times come from campaign playback analytics; sale times come from your POS through the Personalisation Hub Transaction API, which needs a custom POS integration. ' +
      'A gap between the personalised line and the other two lines in the first few minutes is the personalised effect.',
    personalised: 'Sales of this product per 1,000 transactions in the minutes after a personalised variant played to an identified shopper in that store.',
    localised: 'The same measure after a localised variant of this campaign played, at similar times of day. Localised variants play to everyone in front of the display when a store-level condition is met.',
    control: 'Sales of this product per 1,000 transactions in your Control stores segment, in the same clock minutes as each personalised play. Control stores don’t run this campaign, so this line shows normal sales at that time of day.',
    axis: 'Out of every 1,000 transactions at the till, how many included this campaign’s product. Total transactions and product sales both come from your POS through the Personalisation Hub Transaction API.',
    window: 'How long after each play to look for sales. Short windows suit impulse products; longer windows suit considered purchases.',
    step: 'The width of each point on the chart.',
    view: 'Per step shows when sales happen after a play. Running total adds them up across the window.',
    variation: 'Sales of this product per 1,000 transactions in the minutes after this variation of the campaign played to an identified shopper.',
    hour: 'Limit the plays shown to a band of hours, to see whether the response differs by time of day.'
  };
  var LINE_LABELS = { personalised: 'After a personalised play', localised: 'After a localised play', control: 'Control stores, same clock time' };

  var TIER_NAMES = { default: 'Default', localised: 'Localised', personalised: 'Personalised' };
  function isVariation(l) { return l.key.indexOf('personalised:') === 0; }
  function lineLabel(l) { return isVariation(l) ? l.label : LINE_LABELS[l.key]; }
  function colourOf(data, l) {
    if (!isVariation(l)) return COLOURS[l.key];
    var i = data.lines.filter(isVariation).indexOf(l);
    return VARIATION_COLOURS[i % VARIATION_COLOURS.length];
  }
  // Hover on a variation (legend item): its name, tier, targeting rules, plays and the stores it played in.
  function variationHover(l) {
    var rows = [['Tier', TIER_NAMES[l.tier] || l.tier]];
    (l.rules || []).forEach(function (r, i) { rows.push([i ? '' : 'Targeting', r]); });
    if (!(l.rules || []).length) rows.push(['Targeting', 'No targeting rules']);
    rows.push(['Plays', fmtInt(l.plays || 0)]);
    var stores = l.stores || { count: 0, names: [] };
    rows.push(['Stores played in', fmtInt(stores.count)]);
    if (stores.names.length) rows.push(['Store names', stores.names.join(', ')]);
    if (l.audienceNote) rows.push(['Audience', l.audienceNote]);
    return { title: l.label, rows: rows };
  }
  // Keep the legend toggles across loads: new lines start on, lines that are gone drop out, and at least one stays on.
  function syncOn(on, seen, lines) {
    var keys = lines.filter(function (l) { return l.available; }).map(function (l) { return l.key; });
    var next = keys.filter(function (k) { return seen.indexOf(k) < 0 || on.indexOf(k) >= 0; });
    keys.forEach(function (k) { if (seen.indexOf(k) < 0) seen.push(k); });
    return next.length ? next : keys;
  }

  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtRate(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : ''; }
  function hourText(h) { return (h < 10 ? '0' : '') + h + ':00'; }

  // Steps that are not larger than the window.
  function stepOptions(window) { return STEPS.filter(function (s) { return s <= window; }); }
  // A custom window: whole minutes, 1 to 120. Anything else is refused (null).
  function parseCustomWindow(text) {
    if (!/^\d+$/.test(String(text).trim())) return null;
    var n = Number(text);
    return n >= 1 && n <= MAX_WINDOW ? n : null;
  }
  function campaignLabel(c) {
    var who = has(c.advertiserName) ? c.advertiserName + (has(c.dsp) ? ' (' + c.dsp + ')' : '') + ' — ' : '';
    return who + c.name;
  }

  // Legend items that are on; at least one stays on.
  function toggleLine(on, key) {
    var next = on.indexOf(key) < 0 ? on.concat([key]) : on.filter(function (k) { return k !== key; });
    return next.length ? next : on;
  }

  // Point hover: the minute, each visible line's value, plays, sales, transactions, and the stores and dates covered.
  function pointHover(data, index, visible) {
    var rows = [];
    var sections = [];
    data.lines.forEach(function (l) {
      if (!l.available || visible.indexOf(l.key) < 0) return;
      var p = l.points[index];
      if (!p) return;
      sections.push({ head: lineLabel(l), rows: [
        ['Sales per 1,000 transactions', fmtRate(p.value)],
        ['Plays', fmtInt(p.plays)],
        ['Sales counted', fmtInt(p.sales)],
        ['Transactions (all baskets) behind the rate', fmtInt(p.transactions)]
      ] });
    });
    var c = data.coverage || {};
    rows.push(['Stores', fmtInt(c.stores || 0) + (c.controlStores ? ' (+ ' + fmtInt(c.controlStores) + ' control)' : '')]);
    if (c.dateFrom) rows.push(['Dates', fmtDay(c.dateFrom) + (c.dateTo !== c.dateFrom ? ' – ' + fmtDay(c.dateTo) : '')]);
    var first = data.lines.filter(function (l) { return l.available && l.points[index]; })[0];
    return { title: first ? first.points[index].label : '', sections: sections, rows: rows };
  }

  var pure = {
    TIPS: TIPS, WINDOWS: WINDOWS, STEPS: STEPS, MAX_WINDOW: MAX_WINDOW, NO_CONTROL: NO_CONTROL, LINE_LABELS: LINE_LABELS, COLOURS: COLOURS,
    stepOptions: stepOptions, parseCustomWindow: parseCustomWindow, campaignLabel: campaignLabel, toggleLine: toggleLine, syncOn: syncOn, variationHover: variationHover, isVariation: isVariation, colourOf: colourOf, lineLabel: lineLabel, pointHover: pointHover, fmtRate: fmtRate, hourText: hourText
  };

  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('SalesResponse.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var state = { campaignId: '', window: DEFAULT_WINDOW, custom: false, step: 1, view: 'step', hourFrom: '', hourTo: '', on: ['personalised', 'localised', 'control'], seen: [] };
    var data = null, gen = 0, alive = true, resizeTimer = null;
    var NS = 'http://www.w3.org/2000/svg';

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
    function s(tag, attrs, kids) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
      return e;
    }
    function icon(name) { return h('span', { class: 'material-symbols-outlined sr-icon', 'aria-hidden': 'true', text: name }); }

    container.classList.add('sr-root');
    container.innerHTML = '';
    var tip = h('div', { class: 'sr-tip', role: 'tooltip', hidden: '' });

    function renderTip(m) {
      tip.innerHTML = '';
      if (m.text) { tip.appendChild(h('p', { class: 'sr-tip-text', text: m.text })); return; }
      if (m.title) tip.appendChild(h('div', { class: 'sr-tip-title', text: m.title }));
      (m.sections || []).concat(m.rows ? [{ rows: m.rows }] : []).forEach(function (sec) {
        var el = h('div', { class: 'sr-tip-sec' });
        if (sec.head) el.appendChild(h('div', { class: 'sr-tip-head', text: sec.head }));
        var dl = h('dl', { class: 'sr-tip-rows' });
        sec.rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); });
        el.appendChild(dl); tip.appendChild(el);
      });
    }
    function placeTip(x, y) {
      var vw = document.documentElement.clientWidth, vh = window.innerHeight;
      var w = Math.min(340, vw - 16);
      tip.style.width = w + 'px';
      var rr = container.getBoundingClientRect(), hgt = tip.offsetHeight;
      var left = Math.max(8, Math.min(x + 12, vw - w - 8));
      var top = y + 14;
      if (top + hgt > vh - 8) top = y - hgt - 10;
      top = Math.max(8, Math.min(top, vh - hgt - 8));
      tip.style.left = (left - rr.left) + 'px';
      tip.style.top = (top - rr.top) + 'px';
    }
    function showTip(model, x, y) { renderTip(model); tip.hidden = false; placeTip(x, y); }
    function hideTip() { tip.hidden = true; }
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
    function info(text, label) {
      return hoverable(h('span', { class: 'sr-info', 'aria-label': label || 'More information' }, [icon('info')]), function () { return { text: text }; });
    }

    // ----- controls -----
    function selectEl(label, onChange) {
      var sel = h('select', { class: 'sr-select', 'aria-label': label });
      sel.addEventListener('change', function () { onChange(sel.value); });
      return sel;
    }
    function fill(sel, options, value) {
      sel.innerHTML = '';
      options.forEach(function (o) { sel.appendChild(h('option', { value: String(o[0]), text: o[1] })); });
      sel.value = String(value);
    }
    function field(label, tipText, control) {
      return h('div', { class: 'sr-field' }, [h('span', { class: 'sr-field-label' }, [h('span', { text: label }), info(tipText, 'About ' + label)]), control]);
    }

    var campaignSel = selectEl('Campaign', function (v) { state.campaignId = v; load(false); });
    var windowSel = selectEl('Window', function (v) {
      if (v === 'custom') { state.custom = true; customIn.hidden = false; customIn.focus(); return; }
      state.custom = false; customIn.hidden = true; setWindow(Number(v));
    });
    var customIn = h('input', { class: 'sr-input', type: 'number', min: '1', max: String(MAX_WINDOW), step: '1', 'aria-label': 'Custom window in whole minutes (1 to 120)', placeholder: 'minutes', hidden: '' });
    customIn.addEventListener('change', function () {
      var n = parseCustomWindow(customIn.value);
      customIn.classList.toggle('sr-bad', n === null);
      if (n !== null) setWindow(n);
    });
    var stepSel = selectEl('Step', function (v) { state.step = Number(v); load(false); });
    var viewWrap = h('div', { class: 'sr-seg', role: 'radiogroup', 'aria-label': 'View' });
    var viewBtns = {};
    [['step', 'Per step'], ['running', 'Running total']].forEach(function (o) {
      var b = h('button', { type: 'button', class: 'sr-seg-btn', role: 'radio', text: o[1] });
      b.addEventListener('click', function () { state.view = o[0]; syncView(); load(false); });
      viewBtns[o[0]] = b; viewWrap.appendChild(b);
    });
    function syncView() { Object.keys(viewBtns).forEach(function (k) { var on = state.view === k; viewBtns[k].classList.toggle('on', on); viewBtns[k].setAttribute('aria-checked', String(on)); }); }
    var hourSel = selectEl('Hour of day', function (v) {
      if (v === 'all') { state.hourFrom = ''; state.hourTo = ''; } else { var p = v.split('-'); state.hourFrom = p[0]; state.hourTo = p[1]; }
      load(false);
    });

    function setWindow(n) {
      state.window = n;
      if (state.step > n) state.step = 1;
      load(false);
    }

    var head = h('div', { class: 'sr-head' }, [h('div', { class: 'sr-title' }, [h('h3', { text: 'Sales response after personalised plays' }), info(TIPS.title)])]);
    var controls = h('div', { class: 'sr-controls' }, [
      field('Campaign', 'The campaign whose plays and product sales are shown. Only campaigns with personalised variants are listed.', campaignSel),
      field('Window', TIPS.window, h('span', { class: 'sr-inline' }, [windowSel, customIn])),
      field('Step', TIPS.step, stepSel),
      field('View', TIPS.view, viewWrap),
      field('Hour of day', TIPS.hour, hourSel)
    ]);
    var legend = h('div', { class: 'sr-legend', role: 'group', 'aria-label': 'Lines' });
    var body = h('div', { class: 'sr-body' });
    var panel = h('section', { class: 'sr-panel', 'aria-label': 'Sales response after personalised plays' }, [head, controls, legend, body]);
    container.appendChild(panel); container.appendChild(tip);

    function stateBox(kind, text, retry) {
      body.removeAttribute('aria-busy'); body.innerHTML = ''; legend.innerHTML = '';
      if (kind === 'loading') {
        body.setAttribute('aria-busy', 'true');
        var sk = h('div', { class: 'sr-skel', role: 'status', 'aria-label': 'Loading' });
        for (var i = 0; i < 4; i++) sk.appendChild(h('div', { class: 'sr-skel-row' }));
        body.appendChild(sk); return;
      }
      if (kind === 'error') {
        var btn = h('button', { type: 'button', class: 'sr-btn', text: 'Retry' });
        btn.addEventListener('click', retry);
        body.appendChild(h('div', { class: 'sr-state sr-err', role: 'alert' }, [icon('error'), h('div', { text: 'Couldn’t load this chart' }), btn])); return;
      }
      body.appendChild(h('div', { class: 'sr-state' }, [icon(kind === 'pos' ? 'point_of_sale' : 'bar_chart'), h('div', { text: text })]));
    }

    function drawControls(d) {
      var camps = d.campaigns || [];
      // With no campaign selected the chart stays at tier level; choosing one splits the personalised line by variation.
      fill(campaignSel, camps.length ? [['', 'No campaign selected']].concat(camps.map(function (c) { return [c.id, campaignLabel(c)]; })) : [['', 'No campaigns']], state.campaignId || '');
      campaignSel.disabled = !camps.length;
      var opts = WINDOWS.map(function (w) { return [w, w + ' minutes']; }).concat([['custom', 'Custom']]);
      fill(windowSel, opts, state.custom || WINDOWS.indexOf(state.window) < 0 ? 'custom' : state.window);
      if (windowSel.value === 'custom') { state.custom = true; customIn.hidden = false; if (document.activeElement !== customIn) customIn.value = String(state.window); } else customIn.hidden = true;
      fill(stepSel, stepOptions(state.window).map(function (x) { return [x, x + (x === 1 ? ' minute' : ' minutes')]; }), state.step);
      var hrs = d.hours || [];
      var hopts = [['all', 'All hours']];
      hrs.forEach(function (x) { hopts.push([x + '-' + x, hourText(x) + '–' + hourText(x + 1)]); });
      [[hrs[0], hrs[0] + 3], [12, 14], [hrs[hrs.length - 1] - 3, hrs[hrs.length - 1]]].forEach(function (b) {
        if (hrs.length && hrs.indexOf(b[0]) >= 0 && hrs.indexOf(b[1]) >= 0 && b[1] > b[0]) hopts.push([b[0] + '-' + b[1], hourText(b[0]) + '–' + hourText(b[1] + 1)]);
      });
      var cur = state.hourFrom === '' ? 'all' : state.hourFrom + '-' + state.hourTo;
      if (!hopts.some(function (o) { return o[0] === cur; })) hopts.push([cur, hourText(+state.hourFrom) + '–' + hourText(+state.hourTo + 1)]);
      fill(hourSel, hopts, cur);
      hourSel.disabled = !hrs.length;
      syncView();
    }

    function drawLegend(d) {
      legend.innerHTML = '';
      d.lines.forEach(function (l) {
        var swatch = function (dash) {
          var i = h('i', { class: 'sr-swatch ' + (isVariation(l) ? '' : 'sr-c-' + l.key) + (dash ? ' sr-dash' : '') });
          if (isVariation(l)) i.style.backgroundColor = colourOf(d, l);
          return i;
        };
        if (!l.available) {
          var offText = isVariation(l) ? l.label + ' — ' + l.note : l.note;
          var off = h('span', { class: 'sr-legend-item sr-off' }, [swatch(false), h('span', { text: offText })]);
          legend.appendChild(isVariation(l) ? hoverable(off, function () { return variationHover(l); }) : off);
          return;
        }
        var on = state.on.indexOf(l.key) >= 0;
        var b = h('button', { type: 'button', class: 'sr-legend-btn' + (on ? ' on' : ''), 'aria-pressed': String(on) }, [
          swatch(l.key === 'control'), h('span', { text: lineLabel(l) })
        ]);
        b.addEventListener('click', function () { state.on = toggleLine(state.on, l.key); draw(); });
        var item = h('span', { class: 'sr-legend-item' }, [b, info(isVariation(l) ? TIPS.variation : TIPS[l.key], 'About ' + lineLabel(l))]);
        if (isVariation(l)) hoverable(b, function () { return variationHover(l); });
        legend.appendChild(item);
      });
    }

    function drawChart(d) {
      var lines = d.lines.filter(function (l) { return l.available && state.on.indexOf(l.key) >= 0; });
      var n = (lines[0] && lines[0].points.length) || 0;
      if (!lines.length) { body.removeAttribute('aria-busy'); body.innerHTML = ''; return; }
      var max = 0;
      lines.forEach(function (l) { l.points.forEach(function (p) { if (p.value > max) max = p.value; }); });
      var top = niceMax(max);
      var W = Math.max(300, Math.min(1400, Math.round(body.clientWidth || 560))), H = W < 500 ? 220 : 260, L = 44, R = 12, T = 8, B = 44;
      var iw = W - L - R, ih = H - T - B;
      var x = function (i) { return L + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
      var y = function (v) { return T + ih * (1 - v / top); };
      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'sr-svg', role: 'img', 'aria-label': 'Sales of the campaign’s product per 1,000 transactions by minutes after a play', preserveAspectRatio: 'none' });
      svg.style.aspectRatio = W + ' / ' + H;
      for (var g = 0; g <= 4; g++) {
        var v = top * g / 4;
        svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'sr-grid-line' }));
        var t = s('text', { x: L - 6, y: y(v) + 4, class: 'sr-axis', 'text-anchor': 'end' }); t.textContent = fmtTick(v); svg.appendChild(t);
      }
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 44))));
      (lines[0] ? lines[0].points : []).forEach(function (p, i) {
        if (i % every && i !== n - 1) return;
        var tx = s('text', { x: x(i), y: H - B + 16, class: 'sr-axis', 'text-anchor': 'middle' }); tx.textContent = String(p.from); svg.appendChild(tx);
      });
      var ax = s('text', { x: L + iw / 2, y: H - 6, class: 'sr-axis sr-axis-title', 'text-anchor': 'middle' }); ax.textContent = 'Minutes after a play'; svg.appendChild(ax);
      lines.forEach(function (l) {
        var pts = l.points.map(function (p, i) { return x(i) + ',' + y(p.value); }).join(' ');
        svg.appendChild(s('polyline', { points: pts, class: 'sr-line', fill: 'none', stroke: colourOf(d, l), 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-dasharray': l.key === 'control' ? '5 4' : 'none' }));
        l.points.forEach(function (p, i) { svg.appendChild(s('circle', { cx: x(i), cy: y(p.value), r: '3', fill: colourOf(d, l) })); });
      });
      var hits = h('div', { class: 'sr-hits' });
      for (var i = 0; i < n; i++) (function (i) {
        var step = n === 1 ? iw : iw / (n - 1);
        var lo = Math.max(0, x(i) - step / 2), hi = Math.min(W, x(i) + step / 2);
        var hit = h('button', { type: 'button', class: 'sr-hit', 'aria-label': lines[0].points[i].label });
        hit.style.left = (100 * lo / W) + '%'; hit.style.width = (100 * (hi - lo) / W) + '%';
        hoverable(hit, function () { return pointHover(d, i, state.on); });
        hits.appendChild(hit);
      })(i);
      body.removeAttribute('aria-busy'); body.innerHTML = '';
      body.appendChild(h('div', { class: 'sr-unit' }, [h('span', { text: (state.view === 'running' ? 'Running total: sales' : 'Sales') + ' per 1,000 transactions' }), info(TIPS.axis, 'About the Y axis')]));
      body.appendChild(h('div', { class: 'sr-chart' }, [svg, hits]));
      if (d.matchedOnProductName) body.appendChild(h('div', { class: 'sr-flag', text: 'Matched on product name' }));
    }
    function niceMax(v) {
      if (v <= 0) return 1;
      var p = Math.pow(10, Math.floor(Math.log(v) / Math.LN10)), f = v / p;
      return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    }
    function fmtTick(v) { return v >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100); }

    function draw() {
      if (!data) return;
      drawControls(data);
      if (data.emptyReason) {
        stateBox(data.emptyReason === 'no-pos' ? 'pos' : 'empty', data.emptyText);
        // The legend still explains a missing control line.
        return;
      }
      drawLegend(data);
      drawChart(data);
    }

    function params() {
      var p = Object.assign({}, filters, { window: state.window, step: state.step, view: state.view });
      if (state.campaignId) p.campaignId = state.campaignId;
      if (state.hourFrom !== '') { p.hourFrom = state.hourFrom; p.hourTo = state.hourTo; }
      return p;
    }
    function load(full) {
      var g = ++gen;
      hideTip();
      if (full || !data) stateBox('loading');
      fetchJson('sales-response', params()).then(function (d) {
        if (!alive || g !== gen) return;
        data = d; state.on = syncOn(state.on, state.seen, d.lines || []);
        draw();
      }, function () {
        if (!alive || g !== gen) return;
        // A stale campaign or hour band after a page-filter change: start over once.
        if (state.campaignId || state.hourFrom !== '') { state.campaignId = ''; state.hourFrom = ''; state.hourTo = ''; return load(true); }
        data = null; stateBox('error', '', function () { load(true); });
      });
    }
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (alive && data && !data.emptyReason) drawChart(data); }, 150);
    }
    window.addEventListener('resize', onResize);
    load(true);
    return {
      setFilters: function (f) { filters = f || {}; state.campaignId = ''; state.seen = []; state.hourFrom = ''; state.hourTo = ''; load(true); },
      destroy: function () { alive = false; clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); container.innerHTML = ''; container.classList.remove('sr-root'); }
    };
  }

  return Object.assign({ mount: mount }, pure);
});
