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
    demand: 'Which advertisers are on which deals (programmatic guaranteed, preferred, private auction) and over which slots, plus pacing for programmatic guaranteed. ' +
      'Data: deals and buyers lists (deal type, guaranteed volume, buffer), billing line items, reservations (won impressions), unsold slot records, display type slot configuration, display operating hours.',
    maturity: 'How advertisers use targeting and scheduling on your displays, and exactly who sits where, so you can coach them from Default only to Localised to Personalised, and to schedule their campaigns. ' +
      'Better targeting and scheduling mean better campaigns, more spend and more inventory sold.',
    advertisers: 'Top 10 by revenue. Deals on = deals the advertiser is on (buyers lists), any deal type; hover to list them. Slots covered = slots across those deals. ' +
      'Slots won = share of covered slot opportunities the advertiser won. Effective CPM is per 1,000 assumed views (VAC-d).',
    seats: 'The DSP seats that bought this advertiser\u2019s plays. A seat is the buying account inside a DSP, usually held by the advertiser\u2019s agency or trading desk. Seats come from each connected DSP when it syncs, and every winning bid names its seat, so spend is attributed exactly. Expand the row to see each seat\u2019s spend. Direct advertisers buy without a DSP, so they have no seat.',
    seatExpand: 'Show spend by DSP seat.',
    seatGone: 'This seat no longer appears in the DSP\u2019s account list. Its past spend is still shown.',
    iroas: 'Incremental return on ad spend. For each advertiser, the extra sales of their campaigns\u2019 products in stores where the campaigns played, compared with your Control stores segment, divided by what they spent on those campaigns. 2.5 means every $1 of spend drove $2.50 of extra sales. ' +
      'Only campaigns that excluded the Control stores segment are measured; others are left out of both sales and spend. Products come from the SKU or product name on each campaign, via campaign playback analytics. ' +
      'Sales come from your POS through the Personalisation Hub Transaction API, which needs a custom POS integration. Same calculation as the Sales uplift chart.',
    iroasNoPos: ' No POS data received for this period.',
    iroasEmpty: 'No campaigns measured in this period \u2014 needs the Control stores exclusion on a campaign and a POS integration into the Personalisation Hub Transaction API.',
    ladder: 'Advertisers at each level. An advertiser’s level is the highest level used by any of its campaigns in the date range. Hover a bar to see every advertiser at that level; click it to filter the Advertiser targeting & scheduling table.',
    scheduling: 'Advertisers whose campaigns in the date range use scheduling (dayparting or schedules from the Scheduling tab) compared with those that do not. Hover a bar to see who; click it to filter the table.',
    progress: 'Share of campaigns at each level, by when they were running. Shows the whole history, so the date filter doesn’t apply.',
    variables: 'Shared Targeting Variables ranked by the number of advertisers using them in the date range. Hover a bar to see who uses it; click it to filter the Advertiser targeting & scheduling table. ' +
      'Daypart is not a targeting variable: it is a campaign scheduling feature, shown in Scheduling.',
    table: 'Who is most sophisticated: sorted by Revenue, highest first; click any heading to sort by it. Scheduling = campaigns using dayparting or schedules from the campaign’s Scheduling tab, separate from targeting variables. ' +
      'Targeted versions = targeted versions submitted in the date range, beyond the default.'
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

  // "Jun 2026 – Oct 2026 · by month" — the span the Progress over time chart covers, so it is clear what period it shows.
  function progressPeriodText(rows, granularity) {
    if (!rows || !rows.length) return '';
    var fmt = function (iso) {
      var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
      return !m ? '' : granularity === 'week' ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : MONTHS[+m[2] - 1] + ' ' + m[1];
    };
    var a = fmt(rows[0].period), b = fmt(rows[rows.length - 1].period);
    return (a === b ? a : a + ' – ' + b) + ' · by ' + (granularity === 'week' ? 'week' : 'month') + (granularity === 'week' ? ' (week starting)' : '') + ' · whole history';
  }

  // ---------- models ----------
  // "Perrigo (The Trade Desk)" — every advertiser named anywhere shows its DSP.
  function advName(a) { return has(a.dsp) ? a.name + ' (' + a.dsp + ')' : a.name; }

  // Daypart is scheduling, never a targeting variable, whatever the back end returns.
  function isDaypart(v) { return /^daypart$/i.test(String(v && (v.label || v.variable || v))); }
  function targetingVars(list) { return (list || []).filter(function (v) { return !isDaypart(v); }); }

  function dealRank(t) { var i = DEAL_TYPES.indexOf(t); return i < 0 ? DEAL_TYPES.length : i; }

  // Sum of the back end's rounded revenue figures, in whole cents, so the total never drifts from the rows above it.
  function revenueTotal(rows) { return rows.reduce(function (n, a) { return n + Math.round(a.revenue * 100); }, 0) / 100; }

  // One DSP seat under an advertiser: the parent's columns with that seat's figures. iROAS is measured per campaign, not per seat.
  function seatRow(x, a) {
    return {
      seatId: x.seatId, label: x.name + (has(x.dsp) ? ' \u00b7 ' + x.dsp : ''), synced: x.synced !== false,
      revenue: fmtMoney(x.revenue), share: pct(x.share), dealsText: plural(x.dealsOn ? x.dealsOn.length : 0, 'deal'),
      dealsOn: x.dealsOn ? x.dealsOn.length : 0, playsText: plural(x.plays || 0, 'play'),
      effectiveCpm: has(x.effectiveCpm) ? fmtMoney(x.effectiveCpm, 2) : '\u2013', src: x, advertiser: a
    };
  }
  // Hover on a seat sub-row: who and where it is, how many advertisers it bought for, when it won, and its share of the advertiser's spend.
  function seatHover(r) {
    var x = r.src;
    var rows = [['Seat', x.name], ['DSP', has(x.dsp) ? x.dsp : '\u2013'], ['Seat ID', x.seatId],
      ['Advertisers bought for', fmtInt(x.advertisersBought || 0)], ['First win', x.firstWin], ['Last win', x.lastWin],
      ['Share of ' + r.advertiser.name + '\u2019s spend', pct(x.share)]];
    var sections = [{ rows: rows }];
    if ((x.advertiserNames || []).length) sections.push({ rows: x.advertiserNames.map(function (n) { return [n, '']; }) });
    return { title: r.label, sections: sections };
  }

  // The seats of one advertiser, their whole-dollar spend adjusted (largest remainder) so the sub-rows add up to the row above.
  function seatRows(a) {
    var seats = a.seats || [];
    var whole = seats.map(function (x) { return Math.floor(x.revenue); });
    var left = Math.round(a.revenue) - whole.reduce(function (n, v) { return n + v; }, 0);
    seats.map(function (x, i) { return [x.revenue - whole[i], i]; }).sort(function (p, q) { return q[0] - p[0] || p[1] - q[1]; })
      .forEach(function (e) { if (left > 0) { whole[e[1]] += 1; left -= 1; } });
    return seats.map(function (x, i) { var r = seatRow(x, a); r.revenue = fmtMoney(whole[i]); return r; });
  }

  function advertiserRows(data, showAll) {
    var rows = (showAll ? data.all : data.top) || [];
    return rows.map(function (a) {
      return {
        advertiserId: a.advertiserId, name: a.name, dsp: a.dsp, label: a.name,
        revenue: fmtMoney(a.revenue),
        share: pct(a.share),
        seatsText: a.direct ? 'Direct' : fmtInt(a.seatCount || 0),
        seatCount: a.direct ? null : (a.seatCount || 0),
        seats: seatRows(a),
        dealsOn: a.dealsOn ? a.dealsOn.length : 0,
        dealsText: plural(a.dealsOn ? a.dealsOn.length : 0, 'deal'),
        slotsCovered: has(a.slotsCovered) ? fmtInt(a.slotsCovered) : '–',
        slotsWon: has(a.slotsWonPercent) ? pct(a.slotsWonPercent) : '–',
        effectiveCpm: has(a.effectiveCpm) ? fmtMoney(a.effectiveCpm, 2) : '–',
        iroas: a.iroas && has(a.iroas.value) ? a.iroas.value.toFixed(1) : '\u2014',
        src: a
      };
    });
  }

  // Advertisers table columns: header text, the raw value each sorts by, and the direction a first click uses.
  var ADV_COLS = [
    { key: 'name', label: 'Advertiser', first: 'asc', value: function (r) { return r.name; } },
    { key: 'seats', label: 'Seats', first: 'desc', info: 'seats', value: function (r) { return r.seatCount; } },
    { key: 'revenue', label: 'Revenue', first: 'desc', value: function (r) { return r.src.revenue; } },
    { key: 'share', label: 'Share of total revenue', first: 'desc', value: function (r) { return r.src.share; } },
    { key: 'dealsOn', label: 'Deals on', first: 'desc', value: function (r) { return r.dealsOn; } },
    { key: 'slotsCovered', label: 'Slots covered', first: 'desc', value: function (r) { return r.src.slotsCovered; } },
    { key: 'slotsWon', label: 'Slots won', first: 'desc', value: function (r) { return r.src.slotsWonPercent; } },
    { key: 'effectiveCpm', label: 'Effective CPM', first: 'desc', value: function (r) { return r.src.effectiveCpm; } },
    { key: 'iroas', label: 'iROAS', first: 'desc', info: 'iroas', value: function (r) { return r.src.iroas ? r.src.iroas.value : null; } }
  ];
  // Rows ordered by one column ('asc' = A–Z / lowest first); no key keeps the back end's order. Blank values always sit last.
  function sortAdvertiserRows(rows, key, dir, cols) {
    var col = (cols || ADV_COLS).filter(function (c) { return c.key === key; })[0];
    if (!col) return rows;
    var sign = dir === 'asc' ? 1 : -1;
    return rows.map(function (r, i) { return { r: r, i: i, v: col.value(r) }; }).sort(function (a, b) {
      var an = !has(a.v), bn = !has(b.v);
      if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;
      var c = typeof a.v === 'string' ? a.v.localeCompare(b.v) : a.v - b.v;
      return c ? c * sign : a.i - b.i;
    }).map(function (x) { return x.r; });
  }

  // Hover headed "Blackmores (DV360): deals on", listing each deal with its type.
  function dealsOnHover(a) {
    var deals = (a.dealsOn || []).slice().sort(function (x, y) { return dealRank(x.dealType) - dealRank(y.dealType) || x.name.localeCompare(y.name); });
    return { title: advName(a) + ': deals on', sections: [{ rows: deals.map(function (d) { return [d.name, d.dealType]; }) }] };
  }
  // Hover on an iROAS cell: the division, how many campaigns were measured and why the rest were not.
  function iroasHover(a) {
    var m = a.iroas || {};
    if (!has(m.value)) return { text: TIPS.iroasEmpty };
    var rows = [
      ['iROAS', fmtMoney(m.incrementalSales) + ' \u00f7 ' + fmtMoney(m.measuredSpend) + ' = ' + m.value.toFixed(1)],
      ['Incremental sales', fmtMoney(m.incrementalSales)], ['Spend (measured campaigns)', fmtMoney(m.measuredSpend)],
      ['Campaigns measured', m.measuredCampaigns + ' of ' + m.totalCampaigns + ' campaigns measured'],
      ['Campaign stores', fmtInt(m.campaignStores)], ['Control stores', fmtInt(m.controlStores)]
    ];
    if (m.dateFrom) rows.push(['Date range covered', m.dateFrom + ' to ' + m.dateTo]);
    var sections = [{ rows: rows }];
    var left = (m.notMeasured || []).concat(m.flagged || []).map(function (c) { return [c.product, c.reason]; });
    if (left.length) sections.push({ rows: left, note: 'Not measured, or matched on product name.' });
    return { title: advName(a) + ': iROAS', sections: sections };
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
        ? a.scheduledCampaigns + ' of ' + plural(a.campaigns, 'campaign') + ', ' + plural(a.schedules || 0, 'schedule') : '';
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
      title: periodLabel(row.period, granularity),
      sections: [{ rows: LEVELS.map(function (l) {
        var x = (row.levels || []).filter(function (y) { return y.level === l; })[0] || { campaigns: 0, percent: 0 };
        return [l, pct(x.percent)];
      }) }]
    };
  }

  // Variable chip text: the personalisation sub-type is added unless the label already says it.
  function chipText(v) {
    if (v.kind === 'Personalised' && has(v.personalisationType) && v.label.toLowerCase().indexOf(v.personalisationType.toLowerCase()) < 0) return v.label + ' · ' + v.personalisationType;
    return v.label;
  }
  var NOT_USED = 'Not used';
  // Targeting & scheduling table columns, sorted the same way as the Advertisers table.
  var MAT_COLS = [
    { key: 'name', label: 'Advertiser', first: 'asc', value: function (r) { return r.name; } },
    { key: 'level', label: 'Maturity level', first: 'desc', value: function (r) { return LEVELS.indexOf(r.level); } },
    { key: 'variables', label: 'Variables used', first: 'desc', value: function (r) { return r.chips.length; } },
    { key: 'scheduling', label: 'Scheduling', first: 'desc', value: function (r) { return r.scheduledCampaigns; } },
    { key: 'versions', label: 'Targeted versions', first: 'desc', value: function (r) { return r.versionsRaw; } },
    { key: 'revenue', label: 'Revenue', first: 'desc', value: function (r) { return r.revenueRaw; } }
  ];
  function schedulingText(s) {
    if (!s || !s.uses) return NOT_USED;
    return 'Dayparted · ' + s.scheduledCampaigns + ' of ' + plural(s.campaigns, 'campaign');
  }
  function tableRows(data) {
    return ((data && data.table) || []).map(function (r) {
      return {
        advertiserId: r.advertiserId, label: advName(r), name: r.name, level: r.level,
        chips: targetingVars(r.variables).map(function (v) { return { text: chipText(v), kind: v.kind }; }),
        scheduling: schedulingText(r.scheduling), versions: has(r.targetedVersions) ? fmtInt(r.targetedVersions) : '–',
        scheduledCampaigns: r.scheduling && r.scheduling.uses ? r.scheduling.scheduledCampaigns : 0,
        versionsRaw: has(r.targetedVersions) ? r.targetedVersions : null, revenueRaw: r.revenue || 0,
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
    advertiserRows: advertiserRows, seatHover: seatHover, dealsOnHover: dealsOnHover, iroasHover: iroasHover, slotsWonHover: slotsWonHover, ladderHover: ladderHover,
    schedulingHover: schedulingHover, variableHover: variableHover, progressHover: progressHover, progressPeriodText: progressPeriodText, chipText: chipText,
    schedulingText: schedulingText, tableRows: tableRows, variableOptions: variableOptions, variableBars: variableBars,
    activeFilters: activeFilters, ADV_COLS: ADV_COLS, MAT_COLS: MAT_COLS, sortAdvertiserRows: sortAdvertiserRows, revenueTotal: revenueTotal, periodLabel: periodLabel, fmtMoney: fmtMoney, pct: pct
  };

  // ---------- DOM ----------
  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('DemandCharts.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = opts.filters || {};
    var state = { showAll: false, expanded: {}, advSort: { key: '', dir: 'desc' }, matSort: { key: 'revenue', dir: 'desc' }, granularity: 'month', kind: 'Localised', table: { level: '', variable: '', scheduling: '' } };
    var gen = { adv: 0, mat: 0 };
    var advData = null, matData = null, knownVars = [], resizeTimer = null;
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
        m.names.forEach(function (r) { ul.appendChild(h('li', {}, [h('span', { text: r[0] }), r[1] ? h('span', { class: 'dc-tip-detail', text: ' · ' + r[1] }) : null])); });
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
    function section(title, iconName, tipText, kids) {
      var head = h('div', { class: 'dc-sechead' }, [h('span', { class: 'material-symbols-outlined dc-icon dc-sec-icon', 'aria-hidden': 'true', text: iconName }), h('h2', { class: 'dc-h2', text: title }), info(tipText)]);
      return h('section', { class: 'dc-section', 'aria-label': title }, [head].concat(kids));
    }
    function emptyState(p, iconName, text) {
      p.body.removeAttribute('aria-busy');
      p.body.innerHTML = '';
      p.body.appendChild(h('div', { class: 'dc-state' }, [icon(iconName), h('div', { text: text })]));
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
    var kindSeg = segmented('Variable type', [['Localised', 'Localised'], ['Personalised', 'Personalised']], function () { return state.kind; }, function (v) { state.kind = v; loadMaturity(false); });

    var showBtn = h('button', { type: 'button', class: 'dc-btn dc-link', text: 'Show all', hidden: '' });
    showBtn.addEventListener('click', function () { state.showAll = !state.showAll; if (advData) drawAdvertisers(); });

    var pAdv = panel('Advertisers', TIPS.advertisers, null);
    var pLad = panel('Maturity ladder', TIPS.ladder, null);
    var pSch = panel('Scheduling', TIPS.scheduling, null);
    var pPro = panel('Progress over time', TIPS.progress, granSeg, 'dc-wide');
    var pVar = panel('Variables in use', TIPS.variables, kindSeg, 'dc-wide');

    // table panel with its own filters
    function select(label, key, getOptions) {
      var sel = h('select', { class: 'dc-select', 'aria-label': label });
      sel.addEventListener('change', function () { state.table[key] = sel.value; loadMaturity(false); });
      return { sel: sel, fill: function () {
        sel.innerHTML = '';
        getOptions().forEach(function (o) { sel.appendChild(h('option', { value: o[0], text: o[1] })); });
        sel.value = state.table[key];
      }, el: h('span', { class: 'dc-selwrap' }, [sel, icon('expand_more')]) };
    }
    var fLevel = select('Maturity level', 'level', function () { return [['', 'All levels']].concat(LEVELS.map(function (l) { return [l, l]; })); });
    var fVar = select('Variable', 'variable', function () { return [['', 'All variables']].concat(knownVars.map(function (v) { return [v, v]; })); });
    var fSch = select('Scheduling', 'scheduling', function () { return [['', 'All scheduling'], ['uses', 'Uses scheduling'], ['none', 'No scheduling']]; });
    var clearChip = h('button', { type: 'button', class: 'dc-chip dc-clear', hidden: '' }, [h('span', { text: 'Clear filter' }), icon('close')]);
    clearChip.addEventListener('click', function () { state.table = { level: '', variable: '', scheduling: '' }; loadMaturity(false); });
    var tableControls = h('div', { class: 'dc-filters' }, [clearChip, fLevel.el, fVar.el, fSch.el]);
    var pTab = panel('Advertiser targeting & scheduling', TIPS.table, tableControls, 'dc-wide');

    container.appendChild(section('Demand health', 'handshake', TIPS.demand, [pAdv.el]));
    container.appendChild(section('Targeting & scheduling maturity', 'stairs', TIPS.maturity, [
      h('div', { class: 'dc-grid' }, [pLad.el, pSch.el]),
      pVar.el,
      pTab.el,
      pPro.el
    ]));
    container.appendChild(tip);

    // ----- Advertisers -----
    function totalRow(d, rows) {
      var shown = rows.map(function (r) { return r.src; });
      var partial = !state.showAll && (d.all || []).length > TOP_N;
      var total = revenueTotal(shown);
      return h('tr', { class: 'dc-total', 'data-total': String(total) }, [
        h('th', { scope: 'row', class: 'dc-name', text: partial ? 'Total (top ' + TOP_N + ')' : 'Total' }),
        h('td'), h('td', { class: 'dc-num', text: fmtMoney(total) }),
        h('td', { class: 'dc-num', text: partial ? '' : '100%' }), h('td'), h('td'), h('td'), h('td'), h('td')
      ]);
    }
    function drawAdvertisers() {
      var d = advData;
      var rows = sortAdvertiserRows(advertiserRows(d, state.showAll), state.advSort.key, state.advSort.dir);
      var more = (d.all || []).length > TOP_N;
      showBtn.hidden = !more;
      showBtn.textContent = state.showAll ? 'Show top ' + TOP_N : 'Show all ' + fmtInt((d.all || []).length) + ' advertisers';
      showBtn.setAttribute('aria-pressed', String(state.showAll));
      function sortHead(c) {
        var on = state.advSort.key === c.key, dir = state.advSort.dir;
        var btn = h('button', { type: 'button', class: 'dc-sort' + (on ? ' on' : ''), title: 'Sort by ' + c.label }, [
          h('span', { text: c.label }), icon(on ? (dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more')
        ]);
        var tipEl = c.info ? info(TIPS[c.info] + (c.info === 'iroas' && d.posData === false ? TIPS.iroasNoPos : '')) : null;
        btn.addEventListener('click', function () {
          state.advSort = on ? { key: c.key, dir: dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.first };
          drawAdvertisers();
        });
        return h('th', { scope: 'col', 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }, tipEl ? [btn, tipEl] : [btn]);
      }
      var table = h('table', { class: 'dc-table dc-adv' }, [
        h('thead', {}, [h('tr', {}, ADV_COLS.map(sortHead))]),
        h('tbody', {}, [].concat.apply([], rows.map(function (r) {
          var a = r.src;
          var dealsTd = h('td', { class: 'dc-num', text: r.dealsText });
          if (r.dealsOn) { dealsTd.classList.add('dc-dotted'); hoverable(dealsTd, function () { return dealsOnHover(a); }); }
          var wonTd = h('td', { class: 'dc-num', text: r.slotsWon });
          if (d.slotsWon && d.slotsWon.complete === false) hoverable(wonTd, function () { return slotsWonHover(a, d.slotsWon); });
          var iroasTd = h('td', { class: 'dc-num dc-dotted', text: r.iroas });
          hoverable(iroasTd, function () { return iroasHover(a); });
          var open = !!state.expanded[r.advertiserId] && r.seats.length > 0;
          var nameKids = [];
          if (r.seats.length) {
            var chev = h('button', { type: 'button', class: 'dc-expand', 'aria-expanded': String(open), 'aria-label': 'Show spend by DSP seat for ' + r.name }, [icon(open ? 'expand_more' : 'chevron_right')]);
            chev.addEventListener('click', function () { state.expanded[r.advertiserId] = !open; drawAdvertisers(); });
            hoverable(chev, function () { return { text: TIPS.seatExpand }; });
            nameKids.push(chev);
          }
          nameKids.push(document.createTextNode(r.label));
          var parent = h('tr', { 'data-advertiser': r.advertiserId }, [
            h('th', { scope: 'row', class: 'dc-name' }, nameKids), h('td', { class: 'dc-num', text: r.seatsText }),
            h('td', { class: 'dc-num', text: r.revenue }), h('td', { class: 'dc-num', text: r.share }),
            dealsTd, h('td', { class: 'dc-num', text: r.slotsCovered }), wonTd, h('td', { class: 'dc-num', text: r.effectiveCpm }), iroasTd
          ]);
          var out = [parent];
          if (open) r.seats.forEach(function (x) {
            var nameTh = h('th', { scope: 'row', class: 'dc-name dc-seat-name' }, [document.createTextNode(x.label)]);
            hoverable(nameTh, function () { return seatHover(x); });
            if (!x.synced) {
              var gone = h('span', { class: 'dc-seat-gone', text: ' (no longer synced)' });
              hoverable(gone, function () { return { text: TIPS.seatGone }; });
              nameTh.appendChild(gone);
            }
            out.push(h('tr', { class: 'dc-seat', 'data-seat': x.seatId }, [
              nameTh, h('td'), h('td', { class: 'dc-num', text: x.revenue }), h('td', { class: 'dc-num', text: x.share }),
              h('td', { class: 'dc-num', text: x.dealsText }), h('td', { class: 'dc-num', text: '\u2013' }), h('td', { class: 'dc-num', text: x.playsText }),
              h('td', { class: 'dc-num', text: x.effectiveCpm }), h('td', { class: 'dc-num', text: '\u2014' })
            ]));
          });
          return out;
        }))),
        h('tfoot', {}, [totalRow(d, rows)])
      ]);
      pAdv.body.removeAttribute('aria-busy');
      pAdv.body.innerHTML = '';
      pAdv.body.appendChild(h('div', { class: 'dc-scroll' }, [table]));
      pAdv.body.appendChild(showBtn);
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
          h('span', { class: 'dc-value' }, [h('b', { text: fmtInt(e.advertisers) }), e.advertisers === 1 ? ' advertiser' : ' advertisers'])
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
      // Personalised on top, Default only at the bottom (the ladder reads upwards).
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
      if (!bars.length) return emptyState(pVar, 'filter_alt_off', 'No advertiser uses these variables in range.');
      pVar.body.removeAttribute('aria-busy');
      barRows(pVar, bars, {
        filter: 'variable', key: function (e) { return e.variable; }, cls: function (e) { return e.kind === 'Personalised' ? 'dc-l2' : 'dc-l1'; },
        label: function (e) { return e.variable; }, value: function (e) { return plural(e.advertisers, 'advertiser'); }, hover: variableHover
      });
    }

    // ----- Progress over time: stacked area, three bands -----
    function drawProgress(d) {
      var rows = d.overTime || [];
      pPro.body.removeAttribute('aria-busy');
      pPro.body.innerHTML = '';
      if (!rows.length) return setState(pPro, 'empty');
      var W = Math.max(300, Math.min(1400, Math.round(pPro.body.clientWidth || 560))), H = W < 500 ? 200 : 240, L = 36, R = 12, T = 8, B = 28;
      var iw = W - L - R, ih = H - T - B;
      var n = rows.length;
      var x = function (i) { return L + (n === 1 ? iw / 2 : iw * i / (n - 1)); };
      var y = function (v) { return T + ih * (1 - v / 100); };
      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'dc-svg', role: 'img', 'aria-label': 'Share of campaigns at each targeting level over time', preserveAspectRatio: 'none' });
      svg.style.aspectRatio = W + ' / ' + H;
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
      pPro.body.appendChild(h('div', { class: 'dc-period', text: 'Showing ' + progressPeriodText(rows, d.granularity || state.granularity) }));
      pPro.body.appendChild(legend);
      pPro.body.appendChild(h('div', { class: 'dc-chart' }, [svg, hits]));
    }

    // ----- Advertiser targeting & scheduling table -----
    function drawTable(d) {
      var rows = sortAdvertiserRows(tableRows(d), state.matSort.key, state.matSort.dir, MAT_COLS);
      pTab.body.removeAttribute('aria-busy');
      pTab.body.innerHTML = '';
      if (!rows.length) {
        return emptyState(pTab, 'table_rows', activeFilters(state.table) ? 'No advertisers match this filter.' : 'No data for the selected filters');
      }
      function sortHead(c) {
        var on = state.matSort.key === c.key, dir = state.matSort.dir;
        var btn = h('button', { type: 'button', class: 'dc-sort' + (on ? ' on' : ''), title: 'Sort by ' + c.label }, [
          h('span', { text: c.label }), icon(on ? (dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more')
        ]);
        var tipEl = c.info ? info(TIPS[c.info] + (d.posData === false ? TIPS.iroasNoPos : '')) : null;
        btn.addEventListener('click', function () {
          state.matSort = on ? { key: c.key, dir: dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.first };
          drawTable(d);
        });
        return h('th', { scope: 'col', 'aria-sort': on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none' }, tipEl ? [btn, tipEl] : [btn]);
      }
      var table = h('table', { class: 'dc-table dc-mat' }, [
        h('thead', {}, [h('tr', {}, MAT_COLS.map(sortHead))]),
        h('tbody', {}, rows.map(function (r) {
          return h('tr', {}, [
            h('th', { scope: 'row', class: 'dc-name', text: r.name }),
            h('td', {}, [h('span', { class: 'dc-chip dc-level' }, [h('i', { class: 'dc-swatch ' + LEVEL_CLS[r.level] }), r.level])]),
            h('td', {}, [r.chips.length
              ? h('div', { class: 'dc-chips' }, r.chips.map(function (c) { return h('span', { class: 'dc-chip ' + (c.kind === 'Personalised' ? 'dc-p' : 'dc-loc'), text: c.text }); }))
              : h('span', { class: 'dc-none', text: 'None' })]),
            h('td', {}, [r.scheduling === NOT_USED ? h('span', { class: 'dc-none', text: NOT_USED }) : h('span', { class: 'dc-chip dc-sched', text: r.scheduling })]),
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
      p.kind = state.kind;
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

    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { if (alive && matData && (matData.overTime || []).length) drawProgress(matData); }, 150);
    }
    window.addEventListener('resize', onResize);

    syncTableFilters();
    loadAll();
    return {
      setFilters: function (f) { filters = f || {}; hideTip(); loadAll(); },
      refresh: function () { hideTip(); loadAll(); },
      destroy: function () { alive = false; clearTimeout(resizeTimer); window.removeEventListener('resize', onResize); container.innerHTML = ''; container.classList.remove('dc-root'); }
    };
  }

  return Object.assign({ mount: mount }, pure);
});
