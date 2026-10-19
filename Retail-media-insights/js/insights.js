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
  var PRESETS = [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [90, 'Last 90 days']];
  var DEFAULT_DAYS = 30;
  var MAX_RANGE_DAYS = 366; // the API's cap
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var VACD_TIP = 'Assumed views is the VAC-d (Visibility Adjusted Contacts, digital) score from the OMA MOVE out-of-home standard, and CPM is cost per thousand assumed views. ' +
    'Average assumed views per slot per day = average footfall past a display per day × average visibility adjustment × the slot’s share of loop time (slot length ÷ loop length), averaged across the display type’s connected displays. ' +
    'Billing uses the VAC-d actually realised over the billing window. ' +
    'Example: 4,000 footfall × 0.5 visibility × 1/10 of the loop = 200 average assumed views; at a $20 CPM that slot earns $4 per day on average.';
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
    var th = Math.min(tip.offsetHeight, window.innerHeight - 16);
    if (top + th > window.innerHeight - 8) top = Math.max(8, ar.top - th - 6);
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
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

  var WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  var FULL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // First day of the month `n` months from the month of `iso`.
  function monthShift(iso, n) { var d = toUtc(iso); return isoOf(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1))); }
  function inData(iso) { return iso <= options.lastDataDay && (!options.firstDataDay || iso >= options.firstDataDay); }

  // The platform's range picker: presets down the left, two months side by side, start and end picked with two clicks.
  function buildDatePicker() {
    var label = h('span', { class: 'dr-text' });
    var sep = h('span', { class: 'dr-arrow', text: '→' });
    var label2 = h('span', { class: 'dr-text' });
    var btn = h('button', { class: 'dr-btn', id: 'f-date', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': 'Date range' }, [label, sep, label2, icon('calendar_month')]);
    var presetList = h('div', { class: 'dr-presets' });
    var months = h('div', { class: 'dr-months' });
    var err = h('p', { class: 'dr-err', id: 'dr-err', role: 'alert', hidden: '' });
    var panel = h('div', { class: 'dr-panel', id: 'dr-panel', role: 'dialog', 'aria-label': 'Date range', hidden: '' }, [
      presetList, h('div', { class: 'dr-cal' }, [months, err])
    ]);
    var wrap = h('div', { class: 'dr' }, [btn, panel]);
    var view = null; // first of the left-hand month
    var anchor = null; // a start picked and waiting for its end
    function setOpen(open) { panel.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { anchor = null; showStaged(); } }
    function showStaged() { view = monthShift(staged.from || options.lastDataDay, 0); renderMonths(); }
    btn.addEventListener('click', function () { setOpen(panel.hidden); });
    document.addEventListener('click', function (e) { if (!panel.hidden && !wrap.contains(e.target) && document.body.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });
    PRESETS.forEach(function (p) {
      var r = presetRange(p[0]);
      var b = h('button', { class: 'dr-preset', type: 'button', 'data-days': String(p[0]), text: p[1] });
      b.addEventListener('click', function () { staged.from = r.from; staged.to = r.to; syncControls(); syncButtons(); setOpen(false); });
      presetList.appendChild(b);
    });
    function navBtn(name, aria, n) {
      var b = h('button', { class: 'dr-nav', type: 'button', 'aria-label': aria }, [icon(name)]);
      b.addEventListener('click', function () { view = monthShift(view, n); renderMonths(); });
      return b;
    }
    function monthGrid(first) {
      var d = toUtc(first), dow = d.getUTCDay(), grid = h('div', { class: 'dr-grid', role: 'grid' });
      WEEKDAYS.forEach(function (w) { grid.appendChild(h('span', { class: 'dr-wd', text: w })); });
      for (var i = 0; i < 42; i++) {
        var iso = addDays(first, i - dow), inMonth = iso.slice(0, 7) === first.slice(0, 7);
        var lo = staged.from, hi = staged.to;
        var cls = 'dr-day' + (inMonth ? '' : ' out') + (!inData(iso) ? ' off' : '');
        if (lo && hi && iso >= lo && iso <= hi) cls += ' in' + (iso === lo ? ' start' : '') + (iso === hi ? ' end' : '');
        if (iso === options.lastDataDay) cls += ' last';
        var b = h('button', { class: cls, type: 'button', 'data-date': iso, text: String(toUtc(iso).getUTCDate()) });
        if (!inData(iso) || !inMonth) b.disabled = true;
        if (iso === staged.from || iso === staged.to) b.setAttribute('aria-pressed', 'true');
        grid.appendChild(b);
      }
      return grid;
    }
    function renderMonths() {
      clear(months);
      [0, 1].forEach(function (n) {
        var first = monthShift(view, n), d = toUtc(first);
        var head = h('div', { class: 'dr-head' }, [
          n === 0 ? navBtn('keyboard_double_arrow_left', 'Previous year', -12) : null, n === 0 ? navBtn('chevron_left', 'Previous month', -1) : null,
          h('span', { class: 'dr-title', text: FULL_MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear() }),
          n === 1 ? navBtn('chevron_right', 'Next month', 1) : null, n === 1 ? navBtn('keyboard_double_arrow_right', 'Next year', 12) : null
        ]);
        months.appendChild(h('div', { class: 'dr-month' }, [head, monthGrid(first)]));
      });
    }
    months.addEventListener('click', function (e) {
      var t = e.target.closest ? e.target.closest('.dr-day') : null;
      if (!t || t.disabled) return;
      var iso = t.getAttribute('data-date');
      if (!anchor) { anchor = iso; staged.from = iso; staged.to = iso; syncControls(true); syncButtons(); renderMonths(); return; }
      staged.from = iso < anchor ? iso : anchor; staged.to = iso < anchor ? anchor : iso; anchor = null;
      syncControls(); syncButtons(); setOpen(false); btn.focus();
    });
    els.dateBtn = btn; els.dateText = label; els.dateText2 = label2; els.dateErr = err; els.presets = presetList; els.renderCal = renderMonths;
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
    var ok = staged.from && staged.to && !err;
    els.dateText.textContent = ok ? fmtFull(staged.from) : 'Select dates'; els.dateText2.textContent = ok ? fmtFull(staged.to) : '';
    if (!els.dateBtn.nextElementSibling.hidden) els.renderCal();
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
  // Up/down against the previous period: green up, red down, grey when unchanged or there is nothing to compare with.
  // `unit` 'pct' compares as a % change; 'pts' (inventory sold) as percentage points.
  function delta(now, before, unit, versus) {
    if (now == null || before == null || (unit === 'pct' && before === 0 && now === 0)) {
      return h('div', { class: 'delta flat', 'data-delta': 'none' }, [h('span', { text: 'No data ' + versus })]);
    }
    var diff = now - before, dir = Math.abs(diff) < 0.005 ? 'flat' : diff > 0 ? 'up' : 'down', text;
    if (unit === 'pts') text = (diff > 0 ? '+' : diff < 0 ? '−' : '') + Math.abs(Math.round(diff)) + ' pts';
    else if (before === 0) text = 'new';
    else text = (diff > 0 ? '+' : diff < 0 ? '−' : '') + (Math.abs(diff / before) * 100).toFixed(1) + '%';
    if (dir === 'flat') text = 'No change';
    return h('div', { class: 'delta ' + dir, 'data-delta': dir }, [
      dir === 'flat' ? null : icon(dir === 'up' ? 'arrow_upward' : 'arrow_downward'),
      h('span', { text: text + ' ' + versus })
    ]);
  }
  function tile(key, label, value, sub, tipText, change) {
    return h('div', { class: 'tile', 'data-tile': key }, [
      h('div', { class: 'val', 'data-value': String(value.raw) }, [h('span', { text: value.text })]),
      h('div', { class: 'lbl' }, [h('span', { text: label }), tipText ? info(tipText, label + ': ' + tipText) : null]),
      sub ? h('div', { class: 'sub', text: sub }) : null,
      change || null
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
      var p = d.previous || {};
      var vsPeriod = 'vs previous period';
      grid.appendChild(tile('earned', 'Earned revenue', { raw: d.earnedRevenue, text: fmtMoneyK(d.earnedRevenue) }, 'via ' + dsps + ' connected DSP' + (dsps === 1 ? '' : 's'), null, delta(d.earnedRevenue, p.earnedRevenue, 'pct', vsPeriod)));
      grid.appendChild(tile('estimated', 'Estimated revenue', { raw: d.estimatedRevenue, text: fmtMoneyK(d.estimatedRevenue) }, 'booked for the next ' + days + ' days', null, delta(d.estimatedRevenue, p.estimatedRevenue, 'pct', 'vs previous ' + days + ' days')));
      grid.appendChild(tile('cpm', 'Effective CPM', { raw: d.effectiveCpm, text: d.effectiveCpm == null ? '–' : '$' + d.effectiveCpm.toFixed(2) }, d.effectiveCpm == null ? 'No delivery' : 'per 1,000 assumed views (VAC-d)', null, delta(d.effectiveCpm, p.effectiveCpm, 'pct', vsPeriod)));
      grid.appendChild(tile('sold', 'Inventory sold', { raw: s.percent, text: s.percent + '%' }, fmtInt(s.slotsSold) + ' sold · ' + fmtInt(s.slotsAvailable) + ' available', SOLD_TIP, delta(s.percent, p.inventorySoldPercent, 'pts', vsPeriod)));
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
