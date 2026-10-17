// The Retail Media Performance tab: page filters, tabs, summary strip, and the four modules, all on LocalApi (the real
// route handlers, in the browser, over the one test retailer). Prototype stand-in for the real login: the principal is chosen
// here, from the URL (?role=advertiser&advertiser=<id>), and no token is ever read from or put in a URL.
// Every data-bearing node is built with createElement/textContent; there is no innerHTML.
(function () {
  'use strict';
  var q = new URLSearchParams(location.search);
  var state = q.get('state'); // loading | error: preview those states
  var $ = function (id) { return document.getElementById(id); };
  var NS_SCOPES = ['insights:read'];
  var TABS = ['Retail Media Performance', 'Campaign Performance', 'Visitor Insights', 'Store Insights'];
  var DAY_OPTIONS = [[30, 'Last 30 days'], [7, 'Last 7 days'], [90, 'Last 90 days']];
  var DEFAULTS = { days: '30', store: 'all', type: 'all', adv: 'all' };
  var SUMMARY_TIPS = {
    earned: 'Delivered and billed.',
    estimated: 'Including booked, not yet delivered.',
    sold: 'Share of all advertiser slots across your displays that were sold in the selected period.'
  };

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') el.textContent = attrs[k]; else if (k === 'class') el.className = attrs[k]; else if (k === 'style') el.style.cssText = attrs[k]; else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function icon(name) { return h('span', { class: 'material-symbols-outlined', 'aria-hidden': 'true', text: name }); }
  function fmtMoney(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

  // ---------- hover for the ⓘ icons: absolute in the frame, clamped to the viewport ----------
  var tip = h('div', { class: 'pg-tip', role: 'tooltip', hidden: '' });
  $('frame').appendChild(tip);
  function showTip(text, anchor) {
    tip.textContent = text; tip.hidden = false;
    var fr = $('frame').getBoundingClientRect(), ar = anchor.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var w = Math.min(320, vw - 16);
    tip.style.width = w + 'px';
    var left = Math.max(8, Math.min(ar.left, vw - w - 8));
    var top = ar.bottom + 6;
    if (top + tip.offsetHeight > window.innerHeight - 8) top = Math.max(8, ar.top - tip.offsetHeight - 6);
    tip.style.left = (left - fr.left) + 'px'; tip.style.top = (top - fr.top) + 'px';
  }
  function info(text, label) {
    var el = h('span', { class: 'pg-info', tabindex: '0', role: 'img', 'aria-label': label || text }, [icon('info')]);
    el.addEventListener('mouseenter', function () { showTip(text, el); });
    el.addEventListener('focus', function () { showTip(text, el); });
    el.addEventListener('click', function () { showTip(text, el); });
    el.addEventListener('mouseleave', function () { tip.hidden = true; });
    el.addEventListener('blur', function () { tip.hidden = true; });
    return el;
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') tip.hidden = true; });

  // ---------- who is asking (prototype stand-in for the login) ----------
  var isAdvertiser = q.get('role') === 'advertiser';
  var ADMIN = { principalType: 'admin', principalId: 'hq', scopes: NS_SCOPES };
  var principal = ADMIN;
  function api(endpoint, params) {
    if (state === 'error') return Promise.reject({ status: 500, error: 'preview' });
    if (state === 'loading') return new Promise(function () {});
    return LocalApi.get('/' + endpoint, params || {}, principal);
  }

  var options = null;
  var staged = Object.assign({}, DEFAULTS);
  var applied = Object.assign({}, DEFAULTS);
  var modules = {};
  var els = {};

  function option(value, label, selected) { var o = h('option', { value: String(value), text: label }); if (selected) o.selected = true; return o; }
  function field(label, control) { return h('label', { class: 'field' }, [h('span', { text: label }), control]); }

  function buildFilters() {
    var f = $('filters');
    clear(f);
    els.days = h('select', { id: 'f-date' }, DAY_OPTIONS.map(function (d) { return option(d[0], d[1]); }));
    els.store = h('select', { id: 'f-store' }, [option('all', 'All Stores')].concat((options.stores || []).map(function (s) { return option(s.id, s.name); })));
    els.type = h('select', { id: 'f-display' }, [option('all', 'All Display Types (' + options.displayTypes.length + ')')].concat(options.displayTypes.map(function (t) { return option(t.id, t.name); })));
    var advControl;
    if (isAdvertiser) {
      var me = options.advertiser;
      advControl = h('span', { class: 'chip', id: 'adv-chip' }, [icon('lock'), h('span', { text: me.dsp ? me.name + ' (' + me.dsp + ')' : me.name })]);
    } else {
      els.adv = h('select', { id: 'f-adv' }, [option('all', 'All Advertisers')].concat((options.advertisers || []).map(function (a) { return option(a.id, a.dsp ? a.name + ' (' + a.dsp + ')' : a.name); })));
      advControl = els.adv;
    }
    els.apply = h('button', { class: 'btn primary', id: 'apply', type: 'button', text: 'Apply', hidden: '' });
    els.cancel = h('button', { class: 'btn', id: 'cancel', type: 'button', text: 'Cancel', hidden: '' });
    els.reset = h('button', { class: 'btn primary', id: 'reset', type: 'button', text: 'Reset Filters', hidden: '' });
    f.appendChild(field('Date range', els.days));
    f.appendChild(field('Store', els.store));
    f.appendChild(field('Display type', els.type));
    f.appendChild(h('div', { class: 'field' }, [h('span', { text: 'Advertiser' }), advControl]));
    f.appendChild(h('div', { class: 'actions' }, [els.apply, els.cancel, els.reset]));
    [['days', els.days], ['store', els.store], ['type', els.type], ['adv', els.adv]].forEach(function (p) {
      if (p[1]) p[1].addEventListener('change', function () { staged[p[0]] = p[1].value; syncButtons(); });
    });
    els.apply.addEventListener('click', function () { applied = Object.assign({}, staged); applyFilters(); });
    els.cancel.addEventListener('click', function () { staged = Object.assign({}, applied); syncControls(); syncButtons(); });
    els.reset.addEventListener('click', function () { staged = Object.assign({}, DEFAULTS); applied = Object.assign({}, DEFAULTS); syncControls(); applyFilters(); });
  }
  function differs(a, b) { return Object.keys(DEFAULTS).some(function (k) { return a[k] !== b[k]; }); }
  function syncControls() {
    els.days.value = staged.days; els.store.value = staged.store; els.type.value = staged.type; if (els.adv) els.adv.value = staged.adv;
  }
  // Apply/Cancel only while the staged choice differs from what is applied; Reset Filters only while what is APPLIED differs from the defaults.
  function syncButtons() {
    var dirty = differs(staged, applied);
    els.apply.hidden = !dirty; els.cancel.hidden = !dirty;
    els.reset.hidden = !differs(applied, DEFAULTS);
  }

  function pageFilters() {
    var to = new Date(options.lastDataDay + 'T00:00:00Z');
    var from = new Date(to.getTime() - (+applied.days - 1) * 864e5);
    var f = { dateFrom: from.toISOString().slice(0, 10), dateTo: options.lastDataDay };
    if (applied.store !== 'all') f.storeIds = [applied.store];
    if (applied.type !== 'all') f.displayTypeIds = [applied.type];
    if (!isAdvertiser && applied.adv !== 'all') f.advertiserIds = [applied.adv];
    return f;
  }

  function applyFilters() {
    syncButtons();
    var f = pageFilters();
    tip.hidden = true;
    loadSummary(f);
    Object.keys(modules).forEach(function (k) { modules[k].setFilters(f); });
  }

  // ---------- summary strip ----------
  function tile(key, label, tipText, value, sub, extra) {
    return h('div', { class: 'tile', 'data-tile': key }, [
      h('div', { class: 'lbl' }, [h('span', { text: label }), info(tipText, label + ': ' + tipText)]),
      h('div', { class: 'val', 'data-value': String(value.raw) }, [h('span', { text: value.text }), value.after ? h('span', { class: 'val-after', text: value.after }) : null]),
      extra || null,
      sub ? h('div', { class: 'sub', text: sub }) : null
    ]);
  }
  var summarySeq = 0;
  function loadSummary(f) {
    var strip = $('strip'), my = ++summarySeq;
    clear(strip);
    strip.appendChild(h('div', { class: 'skel' })); strip.appendChild(h('div', { class: 'skel' })); strip.appendChild(h('div', { class: 'skel' }));
    api('summary', f).then(function (d) {
      if (my !== summarySeq) return;
      clear(strip);
      var s = d.inventorySold;
      if (!d.earnedRevenue && !d.estimatedRevenue && !s.slotsSold && !s.slotsAvailable) {
        strip.appendChild(h('div', { class: 'msg wide' }, [icon('monitoring'), h('p', { text: 'No retail media activity for these filters.' })]));
        return;
      }
      strip.appendChild(tile('earned', 'Earned revenue', SUMMARY_TIPS.earned, { raw: d.earnedRevenue, text: fmtMoney(d.earnedRevenue) }));
      strip.appendChild(tile('estimated', 'Estimated revenue', SUMMARY_TIPS.estimated, { raw: d.estimatedRevenue, text: fmtMoney(d.estimatedRevenue) }));
      var bar = h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.min(100, s.percent) + '%' })]);
      strip.appendChild(tile('sold', 'Inventory sold', SUMMARY_TIPS.sold, { raw: s.percent, text: s.percent + '% sold' }, fmtInt(s.slotsSold) + ' sold · ' + fmtInt(s.slotsAvailable) + ' available', bar));
    }, function () {
      if (my !== summarySeq) return;
      clear(strip);
      var retry = h('button', { class: 'btn', type: 'button', text: 'Try again' });
      retry.addEventListener('click', function () { loadSummary(pageFilters()); });
      strip.appendChild(h('div', { class: 'msg wide err', role: 'alert' }, [icon('error'), h('p', { text: 'We couldn’t load retail media performance. Try again shortly.' }), retry]));
    });
  }

  // ---------- tabs ----------
  var selectedTab = 0;
  function buildTabs() {
    var tabs = $('tabs');
    clear(tabs);
    TABS.forEach(function (name, i) {
      var b = h('button', { class: 'tab' + (i === 0 ? ' active' : ''), role: 'tab', type: 'button', 'aria-selected': i === 0 ? 'true' : 'false', text: name });
      b.addEventListener('click', function () { selectTab(i); });
      tabs.appendChild(b);
    });
    drawCrumb();
  }
  function drawCrumb() {
    var c = $('crumb');
    clear(c);
    c.appendChild(document.createTextNode('Home'));
    c.appendChild(h('span', { class: 'sep', text: '>' }));
    c.appendChild(document.createTextNode('Insights / Analytics'));
    c.appendChild(h('span', { class: 'sep', text: '>' }));
    c.appendChild(h('span', { class: 'current', text: TABS[selectedTab] }));
  }
  function selectTab(i) {
    selectedTab = i;
    Array.prototype.forEach.call($('tabs').children, function (b, k) { b.classList.toggle('active', k === i); b.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    $('tab-rmp').hidden = i !== 0;
    var other = $('tab-other');
    other.hidden = i === 0;
    clear(other);
    if (i !== 0) other.appendChild(h('p', { text: TABS[i] + ' is part of the platform’s Insights page and is not in this prototype.' }));
    drawCrumb();
  }

  // ---------- start ----------
  function fail(message) {
    var m = $('msg');
    m.hidden = false; m.classList.add('err');
    clear(m); m.appendChild(icon('error')); m.appendChild(h('p', { text: message }));
    $('strip').hidden = true;
  }

  function start() {
    buildTabs();
    var first = LocalApi.firstAdvertiserId();
    if (isAdvertiser) {
      var wanted = q.get('advertiser') || first;
      // The advertiser must be one of the test advertisers; anything else falls back to the first.
      return LocalApi.get('/filter-options', {}, ADMIN).then(function (o) {
        var ids = o.advertisers.map(function (a) { return a.id; });
        principal = { principalType: 'advertiser', principalId: ids.indexOf(wanted) >= 0 ? wanted : first, scopes: NS_SCOPES };
      });
    }
    return Promise.resolve();
  }

  function fetchJson(endpoint, params) { return api(endpoint, params); }

  start().then(function () { return api('filter-options'); }).then(function (o) {
    options = o;
    buildFilters(); syncControls(); syncButtons();
    var f = pageFilters();
    if (isAdvertiser) {
      $('strip').hidden = true; $('rd').hidden = true; $('sc').hidden = true; $('dc').hidden = true; $('av').hidden = false;
      modules.av = AdvertiserView.mount($('av'), { fetchJson: fetchJson });
      modules.av.setFilters(f);
    } else {
      loadSummary(f);
      modules.rd = RevenueDeals.mount($('rd'), { fetchJson: fetchJson });
      modules.rd.setFilters(f);
      modules.sc = SlotCharts.mount($('sc'), { fetchJson: fetchJson, filters: f });
      modules.dc = DemandCharts.mount($('dc'), { fetchJson: fetchJson, filters: f });
    }
  }, function () { fail('We couldn’t load the page filters. Try again shortly.'); });
})();
