// Sales uplift vs control stores: one outcome chart at the bottom of the Retail Media Performance tab, in both the retailer
// and the advertiser view. A content-frame module (no header, sidebar or position:fixed):
//   var up = UpliftChart.mount(el, { fetchJson: function (endpoint, params) { return Promise } });
//   up.setFilters({ advertiserIds });   // the page's Advertiser filter; only that one page filter applies
// Endpoint: 'sales-uplift' (campaignId). The campaign drop-down lives on the chart. The server pins an advertiser login to
// its own campaigns; this module never sends another advertiser's id on its behalf. The pure model builders are exported
// for the offline tests; only mount() touches the DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UpliftChart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLOURS = { campaign: '#169bc2', control: '#8c8c8c' };
  var MESSAGES = {
    'no-pos': 'Requires a POS integration into the Personalisation Hub Transaction API.',
    'no-control': 'No control stores set for this campaign.',
    'no-campaign': 'No campaigns to show.'
  };
  var TITLE_TIP = 'Compares sales of this campaign’s products in stores where it played with sales in your Control stores segment. ' +
    'Products come from the SKU or product name on the campaign, via campaign playback analytics. Sales come from your POS through the ' +
    'Personalisation Hub Transaction API, which needs a custom POS integration. Windows: 30 days before, during, 30 days after.';
  var TIPS = {
    uplift: 'Sales in the campaign stores compared with where the control stores’ trend would have put them, over the campaign flight.',
    incremental: 'Campaign-store sales during the flight minus what they would have been had they followed the control stores’ trend from the 30 days before.',
    iroas: 'Incremental sales ÷ campaign spend. Spend comes from billing line items in the campaign’s stores and display types, shared equally between the advertiser’s campaigns running on the same day.'
  };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---------- formatting (pure) ----------
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  // Under $10,000 whole dollars; from $10,000 one-decimal thousands.
  function fmtMoney(n) {
    var neg = n < 0 ? '-' : ''; var a = Math.abs(n);
    return neg + '$' + (a >= 10000 ? (Math.round(a / 100) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k' : fmtInt(a));
  }
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
  }
  function fmtDayYear(iso) { return fmtDay(iso) + ' ' + String(iso).slice(0, 4); }
  function has(v) { return v != null && v !== ''; }
  var TIER_LABELS = { default: 'default', localised: 'localised', personalised: 'personalised' };

  /** "Plays: 70% default · 25% localised · 5% personalised" (tiers with no plays are left out). */
  function tierMixText(mix) {
    var parts = (mix || []).filter(function (t) { return t.percent > 0; }).map(function (t) { return Math.round(t.percent) + '% ' + (TIER_LABELS[t.tier] || t.tier); });
    return parts.length ? 'Plays: ' + parts.join(' · ') : '';
  }
  function campaignLabel(c, showAdvertiser) {
    return (showAdvertiser ? c.advertiserName + ' · ' : '') + c.productName + ' · ' + fmtDay(c.start) + (c.end ? ' – ' + fmtDay(c.end) : ' –');
  }
  /** The three tiles above the chart. */
  function tiles(data) {
    var t = data && data.tiles; if (!t) return [];
    return [
      { key: 'uplift', label: 'Uplift', value: t.upliftPercent == null ? '–' : Math.round(t.upliftPercent) + '%', tip: TIPS.uplift, hover: tierMixText(data.tierMix) },
      { key: 'incremental', label: 'Incremental sales (USD)', value: fmtMoney(t.incrementalSales), tip: TIPS.incremental },
      { key: 'iroas', label: 'iROAS', value: t.iroas == null ? '–' : (Math.round(t.iroas * 100) / 100).toFixed(2) + 'x', tip: TIPS.iroas }
    ];
  }
  /** Legend labels with store counts; hovering one lists the stores. */
  function legend(data) {
    return [
      { key: 'campaign', label: 'Campaign stores (' + data.campaignStores.count + ')', stores: data.campaignStores.names },
      { key: 'control', label: 'Control stores (' + data.controlStores.count + ')', stores: data.controlStores.names }
    ];
  }
  /** Day hover rows: facts only. Sales are per store, because the two groups have different numbers of stores. */
  function dayRows(row) {
    var d = row.difference;
    return [
      ['Campaign stores, sales per store', fmtMoney(row.campaignPerStore)],
      ['Control stores, sales per store', fmtMoney(row.controlPerStore)],
      ['Difference', (d < 0 ? '-' : '') + fmtMoney(Math.abs(d))]
    ];
  }
  /** Geometry for the two index lines and the shaded flight: x by day, y by index over a padded range. */
  function geometry(series, w, h, pad) {
    var vals = [];
    series.forEach(function (r) { if (r.campaignIndex != null) vals.push(r.campaignIndex); if (r.controlIndex != null) vals.push(r.controlIndex); });
    var lo = Math.floor(Math.min.apply(null, vals) / 10) * 10; var hi = Math.ceil(Math.max.apply(null, vals) / 10) * 10;
    if (hi === lo) hi = lo + 10;
    var n = series.length;
    var x = function (i) { return pad.l + (n === 1 ? 0 : (i / (n - 1)) * (w - pad.l - pad.r)); };
    var y = function (v) { return pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b); };
    var during = series.map(function (r, i) { return r.phase === 'during' ? i : -1; }).filter(function (i) { return i >= 0; });
    return {
      lo: lo, hi: hi, x: x, y: y,
      campaign: series.map(function (r, i) { return [x(i), y(r.campaignIndex)]; }),
      control: series.map(function (r, i) { return [x(i), y(r.controlIndex)]; }),
      flight: during.length ? [x(during[0]), x(during[during.length - 1])] : null
    };
  }
  function path(points) { return points.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' '); }

  // ---------- DOM ----------
  var SVGNS = 'http://www.w3.org/2000/svg';
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] === '') el.setAttribute(k, ''); else if (attrs[k] != null) el.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (c) { el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function icon(name) { var i = h('span', { class: 'up-icon', 'aria-hidden': 'true' }); i.textContent = name; return i; }

  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('UpliftChart.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var campaignId = null; var seq = 0; var alive = true; var last = null; var lastWidth = 0; var resizeTimer = null;
    container.classList.add('up-root');
    var panel = h('section', { class: 'up-panel', 'aria-label': 'Sales uplift vs control stores' });
    var tip = h('div', { class: 'up-tip', role: 'tooltip', hidden: '' });
    var body = h('div', { class: 'up-body', 'aria-live': 'polite' });
    panel.appendChild(body); panel.appendChild(tip);
    container.appendChild(panel);

    function hideTip() { tip.hidden = true; }
    // Floats inside the panel (never position: fixed), clamped to it.
    function showTip(target, lines, x) {
      tip.innerHTML = '';
      lines.forEach(function (l) {
        if (typeof l === 'string') tip.appendChild(h('div', { class: 'up-tip-line' }, [l]));
        else if (l.title) tip.appendChild(h('div', { class: 'up-tip-title' }, [l.title]));
        else tip.appendChild(h('div', { class: 'up-tip-row' }, [h('span', {}, [l[0]]), h('span', { class: 'up-tip-v' }, [l[1]])]));
      });
      tip.hidden = false;
      var p = panel.getBoundingClientRect(); var t = target.getBoundingClientRect();
      var left = (x != null ? x : t.left + t.width / 2) - p.left - tip.offsetWidth / 2;
      left = Math.max(8, Math.min(left, p.width - tip.offsetWidth - 8));
      var top = t.bottom - p.top + 6;
      if (top + tip.offsetHeight > p.height) top = Math.max(8, t.top - p.top - tip.offsetHeight - 6);
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function withTip(el, lines) {
      el.addEventListener('mouseenter', function () { showTip(el, lines); });
      el.addEventListener('focus', function () { showTip(el, lines); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
      return el;
    }
    function info(text) { var el = h('span', { class: 'up-info', tabindex: '0', 'aria-label': 'More information' }, [icon('info')]); return withTip(el, [text]); }

    function head(data) {
      var showAdv = data && data.campaigns && new Set(data.campaigns.map(function (c) { return c.advertiserId; })).size > 1;
      var right = h('div', { class: 'up-controls' });
      if (data && data.campaigns && data.campaigns.length) {
        var sel = h('select', { class: 'up-select', 'aria-label': 'Campaign' });
        data.campaigns.forEach(function (c) {
          var o = h('option', { value: c.id }, [campaignLabel(c, showAdv)]);
          if (c.id === data.campaignId) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { campaignId = sel.value; load(); });
        right.appendChild(sel);
      }
      return h('div', { class: 'up-head' }, [h('div', { class: 'up-title' }, [h('h2', {}, ['Sales uplift vs control stores']), info(TITLE_TIP)]), right]);
    }

    function chart(data) {
      var W = Math.max(Math.round(body.clientWidth) || 720, 280); var H = 260; var pad = { l: 40, r: 12, t: 12, b: 28 };
      var g = geometry(data.series, W, H, pad);
      var svg = s('svg', { class: 'up-svg', viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Sales index, campaign stores against control stores' });
      for (var v = g.lo; v <= g.hi; v += (g.hi - g.lo) > 40 ? 20 : 10) {
        svg.appendChild(s('line', { class: 'up-grid', x1: pad.l, x2: W - pad.r, y1: g.y(v), y2: g.y(v) }));
        var tx = s('text', { class: 'up-axis', x: pad.l - 6, y: g.y(v) + 4, 'text-anchor': 'end' }); tx.textContent = v; svg.appendChild(tx);
      }
      if (g.flight) svg.appendChild(s('rect', { class: 'up-flight', x: g.flight[0], y: pad.t, width: Math.max(g.flight[1] - g.flight[0], 1), height: H - pad.t - pad.b }));
      var marks = [0, data.series.findIndex(function (r) { return r.phase === 'during'; }), data.series.length - 1];
      marks.forEach(function (i, k) {
        if (i < 0) return;
        var t = s('text', { class: 'up-axis', x: g.x(i), y: H - 8, 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }); t.textContent = fmtDay(data.series[i].date); svg.appendChild(t);
      });
      svg.appendChild(s('path', { class: 'up-line', d: path(g.control), stroke: COLOURS.control, fill: 'none' }));
      svg.appendChild(s('path', { class: 'up-line', d: path(g.campaign), stroke: COLOURS.campaign, fill: 'none' }));
      var cursor = s('line', { class: 'up-cursor', y1: pad.t, y2: H - pad.b, x1: 0, x2: 0, visibility: 'hidden' }); svg.appendChild(cursor);
      var plot = h('div', { class: 'up-plot' }, [svg]);
      var hits = h('div', { class: 'up-hits' });
      hits.style.left = (pad.l / W * 100) + '%'; hits.style.right = (pad.r / W * 100) + '%';
      data.series.forEach(function (r, i) {
        var hit = h('div', { class: 'up-hit', tabindex: '0', role: 'img', 'aria-label': fmtDayYear(r.date) + ', campaign stores ' + fmtMoney(r.campaignPerStore) + ' per store, control stores ' + fmtMoney(r.controlPerStore) + ' per store' });
        var show = function () {
          cursor.setAttribute('x1', g.x(i)); cursor.setAttribute('x2', g.x(i)); cursor.setAttribute('visibility', 'visible');
          showTip(hit, [{ title: fmtDayYear(r.date) }].concat(dayRows(r)));
        };
        hit.addEventListener('mouseenter', show); hit.addEventListener('focus', show);
        var off = function () { cursor.setAttribute('visibility', 'hidden'); hideTip(); };
        hit.addEventListener('mouseleave', off); hit.addEventListener('blur', off);
        hits.appendChild(hit);
      });
      plot.appendChild(hits);
      return plot;
    }

    function render(data) {
      if (!alive) return;
      last = data; lastWidth = Math.round(body.clientWidth);
      body.innerHTML = ''; hideTip();
      body.appendChild(head(data));
      if (data.state !== 'ok') {
        body.appendChild(h('div', { class: 'up-empty' }, [MESSAGES[data.state] || MESSAGES['no-campaign']]));
        if (data.matchedOn === 'product name') body.appendChild(h('div', { class: 'up-empty-sub' }, ['Matched on product name']));
        return;
      }
      var row = h('div', { class: 'up-tiles' });
      tiles(data).forEach(function (t) {
        var tile = h('div', { class: 'up-tile', tabindex: '0' }, [
          h('div', { class: 'up-tile-top' }, [h('span', { class: 'up-tile-lbl' }, [t.label]), info(t.tip)]),
          h('div', { class: 'up-tile-val' }, [t.value])
        ]);
        var lines = [t.hover].concat(t.key === 'uplift' && data.matchedOn === 'product name' ? ['Matched on product name'] : []).filter(Boolean);
        if (lines.length) withTip(tile, lines);
        row.appendChild(tile);
      });
      body.appendChild(row);
      body.appendChild(chart(data));
      var lg = h('div', { class: 'up-legend' });
      legend(data).forEach(function (l) {
        var item = h('span', { class: 'up-key up-key-' + l.key, tabindex: '0' }, [l.label]);
        withTip(item, [{ title: l.label }].concat(l.stores));
        lg.appendChild(item);
      });
      body.appendChild(lg);
    }

    function load() {
      var my = ++seq;
      var params = {};
      if (filters.advertiserIds && filters.advertiserIds.length) params.advertiserIds = filters.advertiserIds;
      if (campaignId) params.campaignId = campaignId;
      body.innerHTML = ''; body.appendChild(h('div', { class: 'up-empty' }, ['Loading…']));
      fetchJson('sales-uplift', params).then(function (data) {
        if (my !== seq) return;
        campaignId = data.campaignId;
        render(data);
      }, function () {
        if (my !== seq || !alive) return;
        body.innerHTML = ''; body.appendChild(head(null));
        body.appendChild(h('div', { class: 'up-empty up-err' }, ['We couldn’t load this chart. Try again shortly.']));
      });
    }

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (alive && last && last.state === 'ok' && Math.round(body.clientWidth) !== lastWidth) render(last); }, 150);
    }
    window.addEventListener('resize', onResize);
    load();
    return {
      setFilters: function (f) {
        var next = f || {};
        var before = JSON.stringify(filters.advertiserIds || null);
        filters = { advertiserIds: next.advertiserIds };
        if (JSON.stringify(filters.advertiserIds || null) !== before) campaignId = null; // the drop-down narrows to the new advertiser
        hideTip(); load();
      },
      refresh: load,
      destroy: function () { alive = false; clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); container.innerHTML = ''; container.classList.remove('up-root'); }
    };
  }

  return { mount: mount, tiles: tiles, tierMixText: tierMixText, legend: legend, dayRows: dayRows, geometry: geometry, campaignLabel: campaignLabel, fmtMoney: fmtMoney, MESSAGES: MESSAGES, TITLE_TIP: TITLE_TIP };
});
