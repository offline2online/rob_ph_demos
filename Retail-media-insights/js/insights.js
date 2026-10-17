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
  var RETAIL_TABS = ['Retail Media Performance', 'Campaign Performance', 'Visitor Insights', 'Store Insights', 'Upcoming Appointments', 'Downloads'];
  var PRESETS = [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];
  var DEFAULT_DAYS = 30;
  var MAX_RANGE_DAYS = 366; // the API's cap
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var VACD_TIP = 'Assumed views (VAC-d, Visibility Adjusted Contacts) are what billing is based on. Average assumed views per slot per day = average footfall past a display per day × average visibility adjustment × the slot’s share of loop time. ' +
    'Example: 4,000 footfall × 0.5 visibility × 1/10 share of loop = 200 assumed views per slot per day; at a $20 CPM that slot earns $4 per day.';
  var SUMMARY_TIP = 'Earned revenue = cleared and billed. Estimated revenue = reservations booked ahead that have not played yet, mainly programmatic guaranteed. ' + VACD_TIP;
  var SOLD_TIP = 'Share of all advertiser slots across your displays that were sold in the selected period. Only slots inside each display’s operating hours count: screens outside the store, or at the entrance and visible from outside it, run 24 hours; screens inside the store, including endcaps, follow store opening hours. Slots outside operating hours play house content and are never unsold or missed revenue.';
  var SCOPE_TITLE = 'Scoped to your advertiser account. You only ever see your own data.';
  var TABS = RETAIL_TABS;

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
  // Under $10,000 whole dollars; from $10,000 one-decimal thousands.
  function fmtMoneyK(n) { return n < 10000 ? fmtMoney(n) : '$' + (Math.round(n / 100) / 10).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + 'k'; }
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
  var DEFAULTS = null; // { from, to, store, type, adv }, once /filter-options is known
  var staged = null;
  var applied = null;
  var modules = {};
  var els = {};

  // ---------- dates ----------
  var DAY = 864e5;
  function toUtc(iso) { return new Date(iso + 'T00:00:00Z'); }
  function isoOf(d) { return d.toISOString().slice(0, 10); }
  function addDays(iso, n) { return isoOf(new Date(toUtc(iso).getTime() + n * DAY)); }
  function dayCount(from, to) { return Math.round((toUtc(to) - toUtc(from)) / DAY) + 1; }
  function fmtShort(iso) { var d = toUtc(iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function fmtFull(iso) { var d = toUtc(iso); return ('0' + d.getUTCDate()).slice(-2) + ' ' + MONTHS[d.getUTCMonth()] + ', ' + d.getUTCFullYear(); }
  function rangeFull(r) { return fmtFull(r.from) + ' → ' + fmtFull(r.to); }
  function rangeShort(r) { return fmtShort(r.from) + ' – ' + fmtShort(r.to); }
  function presetRange(days) {
    var to = options.lastDataDay, from = addDays(to, -(days - 1));
    if (options.firstDataDay && from < options.firstDataDay) from = options.firstDataDay;
    return { from: from, to: to };
  }
  // '' when the staged range can be applied, otherwise why not.
  function rangeError(r) {
    if (!r.from || !r.to) return 'Choose a start and an end date.';
    if (r.to < r.from) return 'The end date must be on or after the start date.';
    if (dayCount(r.from, r.to) > MAX_RANGE_DAYS) return 'The range can be at most ' + MAX_RANGE_DAYS + ' days.';
    if (options.firstDataDay && r.from < options.firstDataDay) return 'Data starts on ' + fmtFull(options.firstDataDay) + '.';
    if (r.to > options.lastDataDay) return 'Data ends on ' + fmtFull(options.lastDataDay) + '.';
    return '';
  }

  function option(value, label, selected) { var o = h('option', { value: String(value), text: label }); if (selected) o.selected = true; return o; }
  // An unlabelled select with a trailing chevron.
  function selectBox(id, label, opts) {
    var sel = h('select', { id: id, 'aria-label': label }, opts);
    return { select: sel, wrap: h('span', { class: 'sel' }, [sel, icon('expand_more')]) };
  }

  function buildDatePicker() {
    var label = h('span', { class: 'dr-text' });
    var btn = h('button', { class: 'dr-btn', id: 'f-date', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Date range' }, [icon('calendar_month'), label, icon('expand_more')]);
    var presetList = h('div', { class: 'dr-presets' });
    var start = h('input', { type: 'date', id: 'f-start', 'aria-label': 'Start date' });
    var end = h('input', { type: 'date', id: 'f-end', 'aria-label': 'End date' });
    var err = h('p', { class: 'dr-err', id: 'dr-err', role: 'alert', hidden: '' });
    var done = h('button', { class: 'btn', id: 'dr-done', type: 'button', text: 'Done' });
    var panel = h('div', { class: 'dr-panel', id: 'dr-panel', role: 'dialog', 'aria-label': 'Date range', hidden: '' }, [
      presetList,
      h('div', { class: 'dr-custom' }, [
        h('label', { class: 'dr-field' }, [h('span', { text: 'Start date' }), start]),
        h('label', { class: 'dr-field' }, [h('span', { text: 'End date' }), end])
      ]),
      err,
      h('div', { class: 'dr-foot' }, [done])
    ]);
    [start, end].forEach(function (i) { i.min = options.firstDataDay || ''; i.max = options.lastDataDay; });
    var wrap = h('div', { class: 'dr' }, [btn, panel]);
    function setOpen(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    btn.addEventListener('click', function () { setOpen(panel.hidden); });
    done.addEventListener('click', function () { setOpen(false); btn.focus(); });
    document.addEventListener('click', function (e) { if (!panel.hidden && !wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
    PRESETS.forEach(function (p) {
      var r = presetRange(p[0]);
      var b = h('button', { class: 'dr-preset', type: 'button', 'data-days': String(p[0]) }, [h('span', { text: p[1] }), h('span', { class: 'dr-dates', text: rangeFull(r) })]);
      b.addEventListener('click', function () { staged.from = r.from; staged.to = r.to; syncControls(); syncButtons(); setOpen(false); });
      presetList.appendChild(b);
    });
    function onCustom() { staged.from = start.value; staged.to = end.value; syncControls(true); syncButtons(); }
    start.addEventListener('input', onCustom); end.addEventListener('input', onCustom);
    els.dateBtn = btn; els.dateText = label; els.start = start; els.end = end; els.dateErr = err; els.presets = presetList;
    return wrap;
  }

  function buildFilters() {
    var f = $('filters');
    clear(f);
    var storeBox = selectBox('f-store', 'Store', [option('all', 'All Stores (' + (options.stores || []).length + ')')].concat((options.stores || []).map(function (s) { return option(s.id, s.name); })));
    var typeBox = selectBox('f-display', 'Display type', [option('all', 'All Display Types (' + options.displayTypes.length + ')')].concat(options.displayTypes.map(function (t) { return option(t.id, t.name); })));
    els.store = storeBox.select; els.type = typeBox.select;
    var advControl;
    if (isAdvertiser) {
      advControl = h('span', { class: 'chip', id: 'adv-chip', title: SCOPE_TITLE }, [icon('lock'), h('span', { text: options.advertiser.name })]);
    } else {
      var advBox = selectBox('f-adv', 'Advertiser', [option('all', 'All Advertisers (' + (options.advertisers || []).length + ')')].concat((options.advertisers || []).map(function (a) { return option(a.id, a.name); })));
      els.adv = advBox.select; advControl = advBox.wrap;
    }
    els.apply = h('button', { class: 'btn primary', id: 'apply', type: 'button', text: 'Apply', hidden: '' });
    els.cancel = h('button', { class: 'btn', id: 'cancel', type: 'button', text: 'Cancel', hidden: '' });
    els.reset = h('button', { class: 'btn primary', id: 'reset', type: 'button', text: 'Reset Filters', hidden: '' });
    f.appendChild(buildDatePicker());
    f.appendChild(storeBox.wrap);
    f.appendChild(typeBox.wrap);
    f.appendChild(advControl);
    f.appendChild(h('div', { class: 'actions' }, [els.apply, els.cancel, els.reset]));
    [['store', els.store], ['type', els.type], ['adv', els.adv]].forEach(function (p) {
      if (p[1]) p[1].addEventListener('change', function () { staged[p[0]] = p[1].value; syncButtons(); });
    });
    els.apply.addEventListener('click', function () { if (rangeError(staged)) return; applied = Object.assign({}, staged); applyFilters(); });
    els.cancel.addEventListener('click', function () { staged = Object.assign({}, applied); syncControls(); syncButtons(); });
    els.reset.addEventListener('click', function () { staged = Object.assign({}, DEFAULTS); applied = Object.assign({}, DEFAULTS); syncControls(); applyFilters(); });
  }
  function differs(a, b) { return Object.keys(DEFAULTS).some(function (k) { return a[k] !== b[k]; }); }
  function syncControls(fromInputs) {
    var err = rangeError(staged);
    els.dateText.textContent = staged.from && staged.to && !err ? rangeFull(staged) : 'Select dates';
    if (!fromInputs) { els.start.value = staged.from; els.end.value = staged.to; }
    els.dateErr.hidden = !err; els.dateErr.textContent = err;
    Array.prototype.forEach.call(els.presets.children, function (b) {
      var r = presetRange(+b.getAttribute('data-days'));
      b.classList.toggle('on', r.from === staged.from && r.to === staged.to);
    });
    els.store.value = staged.store; els.type.value = staged.type; if (els.adv) els.adv.value = staged.adv;
  }
  // Apply/Cancel only while the staged choice differs from what is applied; Reset Filters only while what is APPLIED differs from the defaults.
  // An unusable range keeps Apply visible but disabled.
  function syncButtons() {
    var dirty = differs(staged, applied);
    els.apply.hidden = !dirty; els.cancel.hidden = !dirty;
    els.apply.disabled = !!rangeError(staged);
    els.reset.hidden = !differs(applied, DEFAULTS);
  }

  function pageFilters() {
    var f = { dateFrom: applied.from, dateTo: applied.to };
    if (applied.store !== 'all') f.storeIds = [applied.store];
    if (applied.type !== 'all') f.displayTypeIds = [applied.type];
    if (!isAdvertiser && applied.adv !== 'all') f.advertiserIds = [applied.adv];
    return f;
  }

  function applyFilters() {
    syncButtons();
    var f = pageFilters();
    tip.hidden = true;
    if (isAdvertiser) loadMySummary(f); else loadSummary(f);
    Object.keys(modules).forEach(function (k) { modules[k].setFilters(f); });
  }

  // ---------- summary cards: a bordered card, a title (with an ⓘ on the retailer's) and grey tiles ----------
  function card(host, title, tipText) {
    clear(host);
    var head = h('div', { class: 'card-head' }, [h('h2', { class: 'card-title', text: title }), tipText ? info(tipText, 'Retail Media Summary') : null]);
    var grid = h('div', { class: 'tiles' });
    host.appendChild(head); host.appendChild(grid);
    return grid;
  }
  function tile(key, label, value, sub, tipText) {
    return h('div', { class: 'tile', 'data-tile': key }, [
      h('div', { class: 'val', 'data-value': String(value.raw) }, [h('span', { text: value.text })]),
      h('div', { class: 'lbl' }, [h('span', { text: label }), tipText ? info(tipText, label + ': ' + tipText) : null]),
      sub ? h('div', { class: 'sub', text: sub }) : null
    ]);
  }
  function skeletons(grid, n) { for (var i = 0; i < n; i++) grid.appendChild(h('div', { class: 'skel' })); }
  var summarySeq = 0;
  function loadSummary(f) {
    var strip = $('strip'), my = ++summarySeq;
    var grid = card(strip, 'Retail Media Summary (' + rangeShort(applied) + ')', SUMMARY_TIP);
    skeletons(grid, 4);
    api('summary', f).then(function (d) {
      if (my !== summarySeq) return;
      var s = d.inventorySold;
      clear(grid);
      if (!d.earnedRevenue && !d.estimatedRevenue && !s.slotsSold && !s.slotsAvailable) {
        grid.appendChild(h('div', { class: 'msg wide' }, [icon('monitoring'), h('p', { text: 'No retail media activity for these filters.' })]));
        return;
      }
      var w = d.estimatedWindow || {};
      var days = w.dateFrom && w.dateTo ? dayCount(w.dateFrom, w.dateTo) : 30;
      var dsps = d.connectedDsps;
      grid.appendChild(tile('earned', 'Earned revenue', { raw: d.earnedRevenue, text: fmtMoneyK(d.earnedRevenue) }, 'via ' + dsps + ' connected DSP' + (dsps === 1 ? '' : 's')));
      grid.appendChild(tile('estimated', 'Estimated revenue', { raw: d.estimatedRevenue, text: fmtMoneyK(d.estimatedRevenue) }, 'booked for the next ' + days + ' days'));
      grid.appendChild(tile('cpm', 'Effective CPM', { raw: d.effectiveCpm, text: d.effectiveCpm == null ? '–' : '$' + d.effectiveCpm.toFixed(2) }, d.effectiveCpm == null ? 'No delivery' : 'per 1,000 assumed views (VAC-d)'));
      grid.appendChild(tile('sold', 'Inventory sold', { raw: s.percent, text: s.percent + '%' }, fmtInt(s.slotsSold) + ' sold · ' + fmtInt(s.slotsAvailable) + ' available', SOLD_TIP));
    }, function () {
      if (my !== summarySeq) return;
      clear(grid);
      var retry = h('button', { class: 'btn', type: 'button', text: 'Try again' });
      retry.addEventListener('click', function () { loadSummary(pageFilters()); });
      grid.appendChild(h('div', { class: 'msg wide err', role: 'alert' }, [icon('error'), h('p', { text: 'We couldn’t load retail media performance. Try again shortly.' }), retry]));
    });
  }
  var mySeq = 0;
  function loadMySummary(f) {
    var host = $('mysum'), my = ++mySeq;
    var grid = card(host, 'Retail Media Summary · ' + options.advertiser.name + ' (' + rangeShort(applied) + ')');
    skeletons(grid, 3);
    api('my-summary', f).then(function (d) {
      if (my !== mySeq) return;
      clear(grid);
      grid.appendChild(tile('spend', 'Spend', { raw: d.spend, text: fmtMoneyK(d.spend) }));
      grid.appendChild(tile('plays', 'Plays won', { raw: d.playsWon, text: fmtInt(d.playsWon) }));
      grid.appendChild(tile('deals', 'Deals you’re on', { raw: d.dealsOn, text: fmtInt(d.dealsOn) }));
    }, function () {
      if (my !== mySeq) return;
      clear(grid);
      var retry = h('button', { class: 'btn', type: 'button', text: 'Try again' });
      retry.addEventListener('click', function () { loadMySummary(pageFilters()); });
      grid.appendChild(h('div', { class: 'msg wide err', role: 'alert' }, [icon('error'), h('p', { text: 'We couldn’t load your summary. Try again shortly.' }), retry]));
    });
  }

  // ---------- tabs ----------
  var selectedTab = 0;
  function buildTabs() {
    var tabs = $('tabs');
    clear(tabs);
    // An advertiser login has only the Retail Media Performance tab.
    TABS.slice(0, isAdvertiser ? 1 : TABS.length).forEach(function (name, i) {
      if (name === 'Downloads') tabs.appendChild(h('span', { class: 'tab-sep', role: 'separator', 'aria-orientation': 'vertical' }));
      var b = h('button', { class: 'tab' + (i === 0 ? ' active' : ''), role: 'tab', type: 'button', 'aria-selected': i === 0 ? 'true' : 'false', 'data-i': String(i), text: name });
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
    Array.prototype.forEach.call($('tabs').querySelectorAll('.tab'), function (b) { var on = +b.getAttribute('data-i') === i; b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $('tab-rmp').hidden = i !== 0;
    var other = $('tab-other');
    other.hidden = i === 0;
    clear(other);
    if (i !== 0) other.appendChild(h('p', { text: TABS[i] + ' is part of the platform’s Insights page and is not in this prototype.' }));
    drawCrumb();
  }

  // ---------- scope banner (advertiser login only) ----------
  function buildScopeBanner() {
    var b = $('scope');
    clear(b);
    b.hidden = false;
    b.appendChild(icon('lock'));
    b.appendChild(h('p', {}, [h('strong', { text: 'Signed in as ' + options.advertiser.name + '.' }), document.createTextNode(' Everything on this page is scoped to your advertiser account. Other advertisers’ data and the retailer’s inventory aren’t shown.')]));
  }

  // ---------- start ----------
  function fail(message) {
    var m = $('msg');
    m.hidden = false; m.classList.add('err');
    clear(m); m.appendChild(icon('error')); m.appendChild(h('p', { text: message }));
    $('strip').hidden = true;
  }

  function start() {
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

  buildTabs();
  start().then(function () { return api('filter-options'); }).then(function (o) {
    options = o;
    var range = presetRange(DEFAULT_DAYS);
    DEFAULTS = { from: range.from, to: range.to, store: 'all', type: 'all', adv: 'all' };
    staged = Object.assign({}, DEFAULTS); applied = Object.assign({}, DEFAULTS);
    buildFilters(); syncControls(); syncButtons();
    var f = pageFilters();
    if (isAdvertiser) {
      buildScopeBanner();
      $('strip').hidden = true; $('rd').hidden = true; $('sc').hidden = true; $('dc').hidden = true; $('av').hidden = false; $('mysum').hidden = false;
      loadMySummary(f);
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
