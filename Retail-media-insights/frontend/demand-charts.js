// Demand health (Advertisers table) and Targeting & scheduling maturity — the two
// advertiser sections of the Retail Media Performance tab. A content-frame module
// (no header, sidebar or position:fixed): the tab shell calls
//   var demand = DemandCharts.mount(el, { fetchJson: function (endpoint, params) { return Promise } });
//   demand.setFilters({ dateFrom, dateTo, storeIds, displayTypeIds, advertiserIds });
// The pure model builders are exported for the offline tests; only mount() touches the DOM.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DemandCharts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEVELS = ['Default only', 'Localised', 'Personalised'];
  var DEAL_TYPES = ['Programmatic guaranteed', 'Preferred deal', 'Private auction', 'Open auction'];
  var TOP_N = 10;

  var TIPS = {
    advertisers: 'Which advertisers are on which deals and over which slots, top ten by revenue. Deals on: deals the advertiser is on via buyers lists. Slots covered: slots assigned to those deals. ' +
      'Slots won: share of covered slot opportunities the advertiser won. Effective CPM: revenue per thousand assumed views (VAC-d) from settled billing.',
    ladder: 'Default only → Localised (uses Localisation Variables) → Personalised (uses any personalisation variable). An advertiser’s level is the highest level used by any of its campaigns in the date range. Select a bar to filter the table.',
    scheduling: 'Advertisers whose campaigns in the date range use scheduling (dayparting or schedules from the Scheduling tab) compared with those that do not. Select a bar to filter the table.',
    progress: 'Share of campaigns at each targeting level, per week or month. A campaign counts in every period it is live.',
    variables: 'Shared Targeting Variables in use, ranked by number of advertisers using them. Daypart is scheduling, not a targeting variable. Select a bar to filter the table.',
    table: 'One row per advertiser, most sophisticated first (Personalised first, then revenue). Select a bar in any chart above, or use the filters, to narrow the rows.'
  };

  // ---------- formatting ----------
  function has(v) { return v !== undefined && v !== null && v !== ''; }
  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtMoney(n, dp) {
    dp = dp == null ? 0 : dp;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  }
  function pct(n) { return Math.round(n) + '%'; }
  function plural(n, word) { return fmtInt(n) + ' ' + word + (n === 1 ? '' : 's'); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDay(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] : '';
  }
  function periodLabel(iso, granularity) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return granularity === 'week' ? fmtDay(iso) : MONTHS[+m[2] - 1] + ' ' + m[1];
  }
  function shortPeriod(iso, granularity) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    if (!m) return '';
    return granularity === 'week' ? fmtDay(iso) : MONTHS[+m[2] - 1];
  }

  // ---------- models ----------
  // "Perrigo (The Trade Desk)" — every advertiser named anywhere shows its DSP.
  function advName(a) { return has(a.dsp) ? a.name + ' (' + a.dsp + ')' : a.name; }

  // Daypart is scheduling, never a targeting variable, whatever the back end returns.
  function isDaypart(v) { return /^daypart$/i.test(String(v && (v.label || v.variable || v))); }
  function targetingVars(list) { return (list || []).filter(function (v) { return !isDaypart(v); }); }

  function dealRank(t) { var i = DEAL_TYPES.indexOf(t); return i < 0 ? DEAL_TYPES.length : i; }

  function advertiserRows(data, showAll) {
    var rows = (showAll ? data.all : data.top) || [];
    return rows.map(function (a) {
      return {
        advertiserId: a.advertiserId, name: a.name, dsp: a.dsp, label: a.name,
        revenue: fmtMoney(a.revenue),
        share: pct(a.share),
        dealsOn: a.dealsOn ? a.dealsOn.length : 0,
        slotsCovered: has(a.slotsCovered) ? fmtInt(a.slotsCovered) : '–',
        slotsWon: has(a.slotsWonPercent) ? pct(a.slotsWonPercent) : '–',
        effectiveCpm: has(a.effectiveCpm) ? fmtMoney(a.effectiveCpm, 2) : '–',
        src: a
      };
    });
  }

  // Hover headed "Blackmores (DV360): deals on", listing each deal with its type.
  function dealsOnHover(a) {
    var deals = (a.dealsOn || []).slice().sort(function (x, y) { return dealRank(x.dealType) - dealRank(y.dealType) || x.name.localeCompare(y.name); });
    return { title: advName(a) + ': deals on', sections: [{ rows: deals.map(function (d) { return [d.name, d.dealType]; }) }] };
  }
  function slotsWonHover(a, slotsWon) {
    var rows = [['Slots covered', has(a.slotsCovered) ? fmtInt(a.slotsCovered) : '–'], ['Slots won', has(a.slotsWonPercent) ? pct(a.slotsWonPercent) : '–']];
    var note = slotsWon && slotsWon.complete === false
      ? 'Settled bids are kept for ' + slotsWon.retentionDays + ' days; the selected range is longer, so this covers the most recent ' + slotsWon.retentionDays + ' days.' : null;
    return { title: advName(a) + ': slots won', sections: [{ rows: rows, note: note }] };
  }

  function ladderHover(entry) {
    var rows = (entry.list || []).map(function (a) {
      return [advName(a), a.personalisationTypes && a.personalisationTypes.length ? a.personalisationTypes.join(', ') : ''];
    });
    return { title: entry.level + ' · ' + plural(entry.advertisers, 'advertiser'), names: rows };
  }
  function schedulingHover(entry) {
    var rows = (entry.list || []).map(function (a) {
      var detail = entry.key === 'uses' && has(a.campaigns)
        ? a.scheduledCampaigns + ' of ' + plural(a.campaigns, 'campaign') + ' scheduled · ' + plural(a.schedules || 0, 'schedule') : '';
      return [advName(a), detail];
    });
    return { title: entry.label + ' · ' + plural(entry.advertisers, 'advertiser'), names: rows };
  }
  function variableHover(entry) {
    return {
      title: entry.variable + ' · ' + plural(entry.advertisers, 'advertiser'),
      desc: entry.kind + (entry.personalisationType ? ' · ' + entry.personalisationType : ''),
      names: (entry.list || []).map(function (a) { return [advName(a), '']; })
    };
  }
  function progressHover(row, granularity) {
    return {
      title: periodLabel(row.period, granularity) + ' · ' + plural(row.campaigns, 'campaign'),
      sections: [{ rows: LEVELS.map(function (l) {
        var x = (row.levels || []).filter(function (y) { return y.level === l; })[0] || { campaigns: 0, percent: 0 };
        return [l, pct(x.percent) + ' · ' + plural(x.campaigns, 'campaign')];
      }) }]
    };
  }

  // Variable chip text: the personalisation sub-type is added unless the label already says it.
  function chipText(v) {
    if (v.kind === 'Personalised' && has(v.personalisationType) && v.label.toLowerCase().indexOf(v.personalisationType.toLowerCase()) < 0) return v.label + ' · ' + v.personalisationType;
    return v.label;
  }
  function schedulingText(s) {
    if (!s || !s.uses) return 'Not used';
    return 'Scheduled · ' + s.scheduledCampaigns + ' of ' + plural(s.campaigns, 'campaign');
  }
  function tableRows(data) {
    return ((data && data.table) || []).map(function (r) {
      return {
        advertiserId: r.advertiserId, label: advName(r), level: r.level,
        chips: targetingVars(r.variables).map(function (v) { return { text: chipText(v), kind: v.kind }; }),
        scheduling: schedulingText(r.scheduling), versions: has(r.targetedVersions) ? fmtInt(r.targetedVersions) : '–',
        revenue: fmtMoney(r.revenue || 0)
      };
    });
  }
  function variableOptions(data, extra) {
    var seen = {};
    var add = function (v) { if (v && !isDaypart(v)) seen[v.label || v.variable] = true; };
    ((data && data.variablesInUse) || []).forEach(add);
    ((data && data.table) || []).forEach(function (r) { (r.variables || []).forEach(add); });
    if (extra) seen[extra] = true;
    return Object.keys(seen).sort();
  }
  function variableBars(data) {
    return targetingVars((data && data.variablesInUse) || []);
  }
  function activeFilters(f) { return !!(f.level || f.variable || f.scheduling); }

  var pure = {
    LEVELS: LEVELS, TOP_N: TOP_N, TIPS: TIPS, advName: advName, isDaypart: isDaypart, targetingVars: targetingVars,
    advertiserRows: advertiserRows, dealsOnHover: dealsOnHover, slotsWonHover: slotsWonHover, ladderHover: ladderHover,
    schedulingHover: schedulingHover, variableHover: variableHover, progressHover: progressHover, chipText: chipText,
    schedulingText: schedulingText, tableRows: tableRows, variableOptions: variableOptions, variableBars: variableBars,
    activeFilters: activeFilters, periodLabel: periodLabel, fmtMoney: fmtMoney, pct: pct
  };

  // ---------- DOM ----------
  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('DemandCharts.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var state = { showAll: false, granularity: 'month', kind: 'all', table: { level: '', variable: '', scheduling: '' } };
    var gen = { adv: 0, mat: 0 };
    var advData = null, matData = null, knownVars = [];
    var alive = true;
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
    function icon(name) { return h('span', { class: 'material-symbols-outlined dc-icon', 'aria-hidden': 'true', text: name }); }

    container.classList.add('dc-root');
    container.innerHTML = '';
    var tip = h('div', { class: 'dc-tip', role: 'tooltip', hidden: '' });

    function renderTip(m) {
      tip.innerHTML = '';
      if (m.text) { tip.appendChild(h('p', { class: 'dc-tip-text', text: m.text })); return; }
      if (m.title) tip.appendChild(h('div', { class: 'dc-tip-title', text: m.title }));
      if (m.desc) tip.appendChild(h('div', { class: 'dc-tip-desc', text: m.desc }));
      if (m.names) {
        var ul = h('ul', { class: 'dc-tip-names' });
        m.names.forEach(function (r) { ul.appendChild(h('li', {}, [h('span', { text: r[0] }), r[1] ? h('span', { class: 'dc-tip-detail', text: r[1] }) : null])); });
        tip.appendChild(ul);
      }
      (m.sections || []).forEach(function (sec) {
        var dl = h('dl', { class: 'dc-tip-rows' });
        sec.rows.forEach(function (r) { dl.appendChild(h('dt', { text: r[0] })); dl.appendChild(h('dd', { text: r[1] })); });
        var el = h('div', { class: 'dc-tip-sec' }, [dl]);
        if (sec.note) el.appendChild(h('div', { class: 'dc-tip-note', text: sec.note }));
        tip.appendChild(el);
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
    function hoverable(el, getModel, onSelect) {
      el.setAttribute('tabindex', '0');
      el.addEventListener('mouseenter', function (e) { showTip(getModel(), e.clientX, e.clientY); });
      el.addEventListener('mousemove', function (e) { if (!tip.hidden) placeTip(e.clientX, e.clientY); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focus', function () { var r = el.getBoundingClientRect(); showTip(getModel(), r.left, r.bottom); });
      el.addEventListener('blur', hideTip);
      el.addEventListener('touchstart', function (e) { var t = e.touches[0]; showTip(getModel(), t.clientX, t.clientY); }, { passive: true });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') hideTip();
        if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(); }
      });
      if (onSelect) el.addEventListener('click', onSelect);
      return el;
    }
    document.addEventListener('touchstart', function onDoc(e) {
      if (!alive) return document.removeEventListener('touchstart', onDoc);
      if (!e.target.closest || !e.target.closest('[tabindex]')) hideTip();
    }, { passive: true });

    function info(text) {
      var b = h('span', { class: 'dc-info', 'aria-label': 'More information' }, [icon('info')]);
      return hoverable(b, function () { return { text: text }; });
    }

    function panel(title, tipText, controlEl, extra) {
      var body = h('div', { class: 'dc-body' });
      var head = h('div', { class: 'dc-head' }, [h('div', { class: 'dc-title' }, [h('h3', { text: title }), info(tipText)]), controlEl]);
      return { el: h('section', { class: 'dc-panel' + (extra ? ' ' + extra : ''), 'aria-label': title }, [head, body]), body: body };
    }
    function section(title, kids) {
      return h('section', { class: 'dc-section', 'aria-label': title }, [h('h2', { class: 'dc-h2', text: title })].concat(kids));
    }
    function setState(p, kind, retry) {
      p.body.innerHTML = '';
      if (kind === 'loading') {
        p.body.setAttribute('aria-busy', 'true');
        var sk = h('div', { class: 'dc-skel', role: 'status', 'aria-label': 'Loading' });
        for (var i = 0; i < 4; i++) sk.appendChild(h('div', { class: 'dc-skel-row' }));
        p.body.appendChild(sk);
        return;
      }
      p.body.removeAttribute('aria-busy');
      if (kind === 'empty') p.body.appendChild(h('div', { class: 'dc-state' }, [icon('bar_chart'), h('div', { text: 'No data for the selected filters' })]));
      else if (kind === 'error') {
        var btn = h('button', { type: 'button', class: 'dc-btn', text: 'Retry' });
        btn.addEventListener('click', retry);
        p.body.appendChild(h('div', { class: 'dc-state dc-err', role: 'alert' }, [icon('error'), h('div', { text: 'Couldn’t load this chart' }), btn]));
      }
    }

    // ----- controls -----
    function segmented(label, options, get, set) {
      var btns = {};
      var wrap = h('div', { class: 'dc-seg', role: 'radiogroup', 'aria-label': label });
      options.forEach(function (o) {
        var b = h('button', { type: 'button', class: 'dc-seg-btn', role: 'radio', text: o[1] });
        b.addEventListener('click', function () { set(o[0]); sync(); });
        btns[o[0]] = b; wrap.appendChild(b);
      });
      function sync() { Object.keys(btns).forEach(function (k) { btns[k].setAttribute('aria-checked', String(get() === k)); btns[k].classList.toggle('on', get() === k); }); }
      sync();
      return wrap;
    }
    var granSeg = segmented('Progress period', [['week', 'Week'], ['month', 'Month']], function () { return state.granularity; }, function (v) { state.granularity = v; loadMaturity(false); });
    var kindSeg = segmented('Variable type', [['all', 'All'], ['Localised', 'Localised'], ['Personalised', 'Personalised']], function () { return state.kind; }, function (v) { state.kind = v; loadMaturity(false); });

    var showBtn = h('button', { type: 'button', class: 'dc-btn', text: 'Show all', hidden: '' });
    showBtn.addEventListener('click', function () { state.showAll = !state.showAll; if (advData) drawAdvertisers(); });

    var pAdv = panel('Advertisers', TIPS.advertisers, showBtn);
    var pLad = panel('Maturity ladder', TIPS.ladder, null);
    var pSch = panel('Scheduling', TIPS.scheduling, null);
    var pPro = panel('Progress over time', TIPS.progress, granSeg);
    var pVar = panel('Variables in use', TIPS.variables, kindSeg);

    // table panel with its own filters
    function select(label, key, getOptions) {
      var sel = h('select', { class: 'dc-select', 'aria-label': label });
      sel.addEventListener('change', function () { state.table[key] = sel.value; loadMaturity(false); });
      return { sel: sel, fill: function () {
        sel.innerHTML = '';
        getOptions().forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
        sel.value = state.table[key];
      }, el: h('label', { class: 'dc-field' }, [h('span', { text: label }), sel]) };
    }
    var fLevel = select('Maturity level', 'level', function () { return [['', 'All levels']].concat(LEVELS.slice().reverse().map(function (l) { return [l, l]; })); });
    var fVar = select('Variable', 'variable', function () { return [['', 'All variables']].concat(knownVars.map(function (v) { return [v, v]; })); });
    var fSch = select('Scheduling', 'scheduling', function () { return [['', 'All'], ['uses', 'Uses scheduling'], ['none', 'No scheduling']]; });
    var clearChip = h('button', { type: 'button', class: 'dc-chip dc-clear', hidden: '' }, [h('span', { text: 'Clear filter' }), icon('close')]);
    clearChip.addEventListener('click', function () { state.table = { level: '', variable: '', scheduling: '' }; loadMaturity(false); });
    var tableControls = h('div', { class: 'dc-filters' }, [fLevel.el, fVar.el, fSch.el, clearChip]);
    var pTab = panel('Advertiser targeting & scheduling', TIPS.table, tableControls, 'dc-wide');

    container.appendChild(section('Demand health', [pAdv.el]));
    container.appendChild(section('Targeting & scheduling maturity', [
      h('div', { class: 'dc-grid' }, [pLad.el, pSch.el]),
      h('div', { class: 'dc-grid' }, [pPro.el, pVar.el]),
      pTab.el
    ]));
    container.appendChild(tip);

    // ----- Advertisers -----
    function drawAdvertisers() {
      var d = advData;
      var rows = advertiserRows(d, state.showAll);
      var more = (d.all || []).length > TOP_N;
      showBtn.hidden = !more;
      showBtn.textContent = state.showAll ? 'Show top ' + TOP_N : 'Show all';
      showBtn.setAttribute('aria-pressed', String(state.showAll));
      var cols = ['Advertiser', 'Revenue', 'Share of total revenue', 'Deals on', 'Slots covered', 'Slots won', 'Effective CPM'];
      var table = h('table', { class: 'dc-table dc-adv' }, [
        h('thead', {}, [h('tr', {}, cols.map(function (c) { return h('th', { scope: 'col', text: c }); }))]),
        h('tbody', {}, rows.map(function (r) {
          var a = r.src;
          var dealsTd = h('td', { class: 'dc-num', text: String(r.dealsOn) });
          if (r.dealsOn) hoverable(dealsTd, function () { return dealsOnHover(a); });
          var wonTd = h('td', { class: 'dc-num', text: r.slotsWon });
          if (d.slotsWon && d.slotsWon.complete === false) hoverable(wonTd, function () { return slotsWonHover(a, d.slotsWon); });
          return h('tr', {}, [
            h('th', { scope: 'row', class: 'dc-name' }, [r.label, has(r.dsp) ? h('span', { class: 'dc-dsp', text: ' (' + r.dsp + ')' }) : null]),
            h('td', { class: 'dc-num', text: r.revenue }), h('td', { class: 'dc-num', text: r.share }),
            dealsTd, h('td', { class: 'dc-num', text: r.slotsCovered }), wonTd, h('td', { class: 'dc-num', text: r.effectiveCpm })
          ]);
        }))
      ]);
      pAdv.body.removeAttribute('aria-busy');
      pAdv.body.innerHTML = '';
      pAdv.body.appendChild(h('div', { class: 'dc-scroll' }, [table]));
    }

    // ----- Maturity: horizontal count bars (ladder, scheduling, variables) -----
    function selected(kind, key) { return state.table[kind] === key; }
    function barRows(p, entries, spec) {
      var max = Math.max.apply(null, entries.map(function (e) { return e.advertisers; }).concat([1]));
      p.body.removeAttribute('aria-busy');
      p.body.innerHTML = '';
      var wrap = h('div', { class: 'dc-rows' });
      entries.forEach(function (e) {
        var key = spec.key(e), on = selected(spec.filter, key);
        var bar = h('i', { class: 'dc-bar ' + spec.cls(e) });
        bar.style.width = (100 * e.advertisers / max) + '%';
        var row = h('div', { class: 'dc-row' + (on ? ' on' : ''), 'aria-pressed': String(on) }, [
          h('span', { class: 'dc-label', text: spec.label(e) }),
          h('span', { class: 'dc-track' }, [bar]),
          h('span', { class: 'dc-value', text: spec.value(e) })
        ]);
        row.setAttribute('role', 'button');
        hoverable(row, function () { return spec.hover(e); }, function () {
          state.table[spec.filter] = on ? '' : key;
          loadMaturity(false);
        });
        wrap.appendChild(row);
      });
      p.body.appendChild(wrap);
    }
    var LEVEL_CLS = { 'Default only': 'dc-l0', Localised: 'dc-l1', Personalised: 'dc-l2' };

    function drawLadder(d) {
      // Highest level on top, as a ladder reads.
      var entries = (d.ladder || []).slice().sort(function (a, b) { return LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level); });
      barRows(pLad, entries, {
        filter: 'level', key: function (e) { return e.level; }, cls: function (e) { return LEVEL_CLS[e.level]; },
        label: function (e) { return e.level; }, value: function (e) { return plural(e.advertisers, 'advertiser'); }, hover: ladderHover
      });
    }
    function drawScheduling(d) {
      barRows(pSch, d.scheduling || [], {
        filter: 'scheduling', key: function (e) { return e.key; }, cls: function (e) { return e.key === 'uses' ? 'dc-l1' : 'dc-l0'; },
        label: function (e) { return e.label; }, value: function (e) { return plural(e.advertisers, 'advertiser'); }, hover: schedulingHover
      });
    }
    function drawVariables(d) {
      var bars = variableBars(d);
      if (!bars.length) return setState(pVar, 'empty');
      pVar.body.removeAttribute('aria-busy');
      barRows(pVar, bars, {
        filter: 'variable', key: function (e) { return e.variable; }, cls: function (e) { return e.kind === 'Personalised' ? 'dc-l2' : 'dc-l1'; },
        label: function (e) { return e.variable; }, value: function (e) { return plural(e.advertisers, 'advertiser'); }, hover: variableHover
      });
      pVar.body.insertBefore(h('div', { class: 'dc-legend' }, [
        h('span', { class: 'dc-legend-item' }, [h('i', { class: 'dc-swatch dc-l1' }), 'Localised']),
        h('span', { class: 'dc-legend-item' }, [h('i', { class: 'dc-swatch dc-l2' }), 'Personalised'])
      ]), pVar.body.firstChild);
    }

    // ----- Progress over time: stacked area, three bands -----
    function drawProgress(d) {
      var rows = d.overTime || [];
      pPro.body.removeAttribute('aria-busy');
      pPro.body.innerHTML = '';
      if (!rows.length) return setState(pPro, 'empty');
      var W = 560, H = 220, L = 36, R = 12, T = 8, B = 28;
      var iw = W - L - R, ih = H - T - B;
      var n = rows.length;
      var x = function (i) { return L + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
      var y = function (v) { return T + ih * (1 - v / 100); };
      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'dc-svg', role: 'img', 'aria-label': 'Share of campaigns at each targeting level over time', preserveAspectRatio: 'none' });
      [0, 25, 50, 75, 100].forEach(function (g) {
        svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: 'dc-grid-line' }));
        var t = s('text', { x: L - 6, y: y(g) + 4, class: 'dc-axis', 'text-anchor': 'end' }); t.textContent = g + '%'; svg.appendChild(t);
      });
      // Stack bottom-up: Default only, Localised, Personalised.
      var lower = rows.map(function () { return 0; });
      LEVELS.forEach(function (lvl, li) {
        var upper = rows.map(function (r, i) {
          var part = (r.levels.filter(function (z) { return z.level === lvl; })[0] || { percent: 0 }).percent;
          return lower[i] + part;
        });
        var pts = rows.map(function (r, i) { return x(i) + ',' + y(upper[i]); })
          .concat(rows.map(function (r, i) { var k = n - 1 - i; return x(k) + ',' + y(lower[k]); }));
        if (n === 1) pts = [L + ',' + y(upper[0]), (W - R) + ',' + y(upper[0]), (W - R) + ',' + y(lower[0]), L + ',' + y(lower[0])];
        svg.appendChild(s('polygon', { points: pts.join(' '), class: 'dc-area ' + LEVEL_CLS[lvl] }));
        lower = upper;
      });
      rows.forEach(function (r, i) {
        var t = s('text', { x: x(i), y: H - 8, class: 'dc-axis', 'text-anchor': i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle' });
        t.textContent = shortPeriod(r.period, d.granularity || state.granularity);
        svg.appendChild(t);
      });
      // Hover/focus targets, one column per period.
      var hits = h('div', { class: 'dc-hits' });
      rows.forEach(function (r, i) {
        var hit = h('button', { type: 'button', class: 'dc-hit', 'aria-label': periodLabel(r.period, d.granularity || state.granularity) });
        var step = n === 1 ? iw : iw / (n - 1);
        var lo = Math.max(0, x(i) - step / 2), hi = Math.min(W, x(i) + step / 2);
        hit.style.left = (100 * lo / W) + '%';
        hit.style.width = (100 * (hi - lo) / W) + '%';
        hoverable(hit, function () { return progressHover(r, d.granularity || state.granularity); });
        hits.appendChild(hit);
      });
      var legend = h('div', { class: 'dc-legend' }, LEVELS.map(function (l) { return h('span', { class: 'dc-legend-item' }, [h('i', { class: 'dc-swatch ' + LEVEL_CLS[l] }), l]); }));
      pPro.body.appendChild(legend);
      pPro.body.appendChild(h('div', { class: 'dc-chart' }, [svg, hits]));
    }

    // ----- Advertiser targeting & scheduling table -----
    function drawTable(d) {
      var rows = tableRows(d);
      pTab.body.removeAttribute('aria-busy');
      pTab.body.innerHTML = '';
      if (!rows.length) {
        pTab.body.appendChild(h('div', { class: 'dc-state' }, [icon('table_rows'), h('div', { text: activeFilters(state.table) ? 'No advertisers match this filter' : 'No data for the selected filters' })]));
        return;
      }
      var cols = ['Advertiser', 'Maturity level', 'Variables used', 'Scheduling', 'Targeted versions', 'Revenue'];
      var table = h('table', { class: 'dc-table dc-mat' }, [
        h('thead', {}, [h('tr', {}, cols.map(function (c) { return h('th', { scope: 'col', text: c }); }))]),
        h('tbody', {}, rows.map(function (r) {
          return h('tr', {}, [
            h('th', { scope: 'row', class: 'dc-name', text: r.label }),
            h('td', {}, [h('span', { class: 'dc-level' }, [h('i', { class: 'dc-swatch ' + LEVEL_CLS[r.level] }), r.level])]),
            h('td', {}, [h('div', { class: 'dc-chips' }, r.chips.map(function (c) { return h('span', { class: 'dc-chip ' + (c.kind === 'Personalised' ? 'dc-p' : 'dc-loc'), text: c.text }); }))]),
            h('td', { text: r.scheduling }),
            h('td', { class: 'dc-num', text: r.versions }),
            h('td', { class: 'dc-num', text: r.revenue })
          ]);
        }))
      ]);
      pTab.body.appendChild(h('div', { class: 'dc-scroll' }, [table]));
    }
    function syncTableFilters() {
      fLevel.fill(); fVar.fill(); fSch.fill();
      clearChip.hidden = !activeFilters(state.table);
    }

    // ----- loading -----
    function matParams() {
      var p = Object.assign({}, filters, { granularity: state.granularity });
      if (state.kind !== 'all') p.kind = state.kind;
      ['level', 'variable', 'scheduling'].forEach(function (k) { if (state.table[k]) p[k] = state.table[k]; });
      return p;
    }
    function drawMaturity() {
      var d = matData;
      if (!d || !(d.ladder || []).length) {
        [pLad, pSch, pPro, pVar, pTab].forEach(function (p) { setState(p, 'empty'); });
        return;
      }
      knownVars = variableOptions({ variablesInUse: d.variablesInUse, table: d.table }, state.table.variable)
        .concat(knownVars).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
      syncTableFilters();
      drawLadder(d); drawScheduling(d); drawProgress(d); drawVariables(d); drawTable(d);
    }
    // full=true on first load and page-filter changes (skeletons); false when only a chart control or table filter moved.
    function loadMaturity(full) {
      var g = ++gen.mat;
      hideTip();
      if (full || !matData) [pLad, pSch, pPro, pVar, pTab].forEach(function (p) { setState(p, 'loading'); });
      fetchJson('maturity', matParams()).then(function (d) {
        if (!alive || g !== gen.mat) return;
        matData = d; drawMaturity();
      }, function () {
        if (!alive || g !== gen.mat) return;
        matData = null;
        [pLad, pSch, pPro, pVar, pTab].forEach(function (p) { setState(p, 'error', function () { loadMaturity(true); }); });
      });
    }
    function loadAdvertisers() {
      var g = ++gen.adv;
      advData = null;
      setState(pAdv, 'loading');
      showBtn.hidden = true;
      fetchJson('advertisers', filters).then(function (d) {
        if (!alive || g !== gen.adv) return;
        if (!d || !d.all || !d.all.length) return setState(pAdv, 'empty');
        advData = d; drawAdvertisers();
      }, function () { if (alive && g === gen.adv) setState(pAdv, 'error', loadAdvertisers); });
    }
    function loadAll() { loadAdvertisers(); loadMaturity(true); }

    syncTableFilters();
    loadAll();
    return {
      setFilters: function (f) { filters = f || {}; hideTip(); loadAll(); },
      refresh: function () { hideTip(); loadAll(); },
      destroy: function () { alive = false; container.innerHTML = ''; container.classList.remove('dc-root'); }
    };
  }

  return Object.assign({ mount: mount }, pure);
});
