// Advertiser view of the Retail Media Performance tab: Delivery, Your deals by display type, Audience, and
// Your targeting & scheduling. A content-frame module (no header, sidebar or position:fixed): the tab shell calls
//   var av = AdvertiserView.mount(el, { fetchJson: function (endpoint, params) { return Promise } });
//   av.setFilters({ dateFrom, dateTo, storeIds, displayTypeIds });
// Endpoints: 'delivery' (dealId), 'deals-by-display-type', 'audience', 'my-targeting'. The server pins every
// response to the signed-in advertiser; this module never names another advertiser, shows downtime, or sends
// advertiserIds. The pure model builders (toggles, hover content, formatting) are exported for the offline tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AdvertiserView = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COLOURS = { plays: '#169bc2', spend: '#eb6834', guaranteed: '#8c8c8c', delivered: '#169bc2' };
  var OPEN_AUCTION = 'open-auction';

  // The shared VAC-d explanation and worked example, appended to every ⓘ that mentions assumed views.
  var VACD = [
    'Assumed views is the VAC-d (Visibility Adjusted Contacts, digital) score from the OMA MOVE out-of-home standard, and CPM is cost per thousand assumed views. ' +
    'Average assumed views per slot per day = average footfall past a display per day × average visibility adjustment × the slot’s share of loop time (slot length ÷ loop length), averaged across the display type’s connected displays. ' +
    'Billing uses the VAC-d actually realised over the billing window. ' +
    'Example: 4,000 footfall × 0.5 visibility × 1/10 of the loop = 200 average assumed views; at a $20 CPM that slot earns $4 per day on average.'
  ];
  var TIPS = {
    delivery: ['Plays you won (left axis) and what you spent (right axis) per day, both shown by default. Click the Plays won or Spend total to turn its line off or on. Hover a day to see what drove it: for each private auction and the open auction, the plays you won out of all plays, your CPM against the winning CPM (average and highest across all winning buyers, never named) and the floor CPM; plays on fixed-price deals; and the change on the previous day. Stores and screens that played are in Campaign Performance. For a programmatic guaranteed deal, Pacing shows assumed views (VAC-d) delivered against the guaranteed line over the flight. Other deal types carry no commitment, so they have no guaranteed line.'].concat(VACD),
    deals: function (range) {
      return ['Every display type your deals are active on, in shopper-journey order, with each deal’s performance on it in ' + (range || 'the selected range') + '. Open auction plays are not included. Hover a display type for its details, a deal for its description and your deal ID, and Slots for the slots the deal is assigned to. Share: on a display type row, its share of your deal spend; on a deal row, the share of the deal’s plays on that display type that you won (100% when you are the only buyer).'].concat(VACD);
    },
    targeting: ['Your highest targeting level across your campaigns in the date range: Default only, Localised or Personalised. Scheduling = campaigns you schedule (dayparting and multiple schedules) from the campaign’s Scheduling tab, separately from targeting. Other variables available to use = the Shared Targeting Variables the retailer has made available to your DSP seat that your campaigns don’t use yet.']
  };
  var LEVELS = [['Personalised', '#174a8c'], ['Localised', '#6aa7e0'], ['Default only', '#d9d9d9']];
  var ORIENTATIONS = ['Not set', '90°', '180°', '270°'];

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
  function has(v) { return v != null && v !== ''; }
  function fmtNum(n) { return (Math.round(n * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  // 551k, 17.7k, 1.2M: one decimal under 100k, none above.
  function fmtCompact(n) {
    if (n >= 1e6) return (Math.round(n / 1e5) / 10) + 'M';
    if (n >= 1e5) return Math.round(n / 1e3) + 'k';
    if (n >= 1e3) return (Math.round(n / 100) / 10) + 'k';
    return fmtInt(n);
  }
  // The artifact's big(): one decimal for thousands (322.8k), two for millions (1.31m).
  function fmtBig(n) {
    if (n >= 1e6) return (Math.round(n / 1e4) / 100) + 'm';
    if (n >= 1e3) return (Math.round(n / 100) / 10) + 'k';
    return fmtInt(n);
  }
  function rangeText(from, to) { return from && to ? fmtDay(from) + ' – ' + fmtDay(to) : ''; }
  function plural(n, word) { return fmtInt(n) + ' ' + word + (n === 1 ? '' : 's'); }
  function typeName(t) { return t === 'Programmatic Guaranteed' ? 'Programmatic guaranteed' : t; }
  function isPg(t) { return typeName(t) === 'Programmatic guaranteed'; }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // ---------- Delivery model ----------
  // Both metric tiles start on; at least one stays on.
  function initialMetrics() { return { plays: true, spend: true }; }
  function toggleMetric(m, key) {
    var next = { plays: m.plays, spend: m.spend };
    if (next[key] && !(next.plays && next.spend)) return next; // the last one on stays on
    next[key] = !next[key];
    return next;
  }
  // The deal drop-down: All deals, Open auction, then each deal as "name (type)".
  function dealOptions(data) {
    var opts = [{ value: '', label: 'All deals' }, { value: OPEN_AUCTION, label: 'Open auction' }];
    ((data && data.dealOptions) || []).forEach(function (d) {
      if (d.dealId !== OPEN_AUCTION) opts.push({ value: d.dealId, label: d.name + ' (' + typeName(d.dealType) + ')' });
    });
    return opts;
  }
  // The Pacing switch exists only when the chosen deal is a Programmatic guaranteed deal with pacing data.
  function pacingFor(data, dealId) {
    var list = (data && data.pacing) || [];
    if (dealId) return list.filter(function (p) { return p.dealId === dealId; })[0] || null;
    return null;
  }
  function showPacingSwitch(data, dealId) {
    var opt = ((data && data.dealOptions) || []).filter(function (d) { return d.dealId === dealId; })[0];
    return !!(opt && isPg(opt.dealType) && pacingFor(data, dealId));
  }
  function seriesPoints(days, key) { return days.map(function (d) { return d[key] || 0; }); }

  function cpmRange(r) {
    if (!r || r.min == null) return null;
    return r.min === r.max ? fmtMoney(r.min, 2) : fmtMoney(r.min, 2) + '–' + fmtMoney(r.max, 2);
  }
  // Day-on-day change as an arrow and a percent ("▲ 2%"); null when the previous day had nothing to compare with.
  function changeText(c) {
    if (!c || c.percent == null) return null;
    if (c.percent === 0) return '0%';
    return (c.percent > 0 ? '▲ ' : '▼ ') + Math.abs(c.percent) + '%';
  }
  // One block per deal in scope; facts only. Other buyers appear only as aggregates (winning CPM), never by name.
  function dealBlockRows(b) {
    var rows = [[b.name + ' · ' + typeName(b.dealType), '', 'head']];
    var auction = b.dealType === 'Private auction' || b.dealType === 'Open auction' || b.allPlays != null;
    if (auction) {
      var plays = b.allPlays != null ? fmtInt(b.playsWon) + ' of ' + fmtInt(b.allPlays) + (b.sharePercent != null ? ' (' + b.sharePercent + '%)' : '') : fmtInt(b.playsWon);
      rows.push(['Plays won', plays]);
      rows.push(['Your CPM', b.yourCpm != null ? fmtMoney(b.yourCpm, 2) : 'No plays won']);
      if (b.winningCpm) rows.push(['Winning CPM', fmtMoney(b.winningCpm.average, 2) + ' avg · ' + fmtMoney(b.winningCpm.highest, 2) + ' high']);
      var floor = cpmRange(b.floorCpm);
      if (floor) rows.push(['Floor CPM', floor]);
    } else {
      rows.push(['Plays won', fmtInt(b.playsWon)]);
      if (b.fixedCpm != null) rows.push(['Fixed CPM', fmtMoney(b.fixedCpm, 2)]);
      rows.push(['Other buyers', b.otherBuyers || 'None']);
    }
    return rows;
  }
  // The day hover: the day's totals, one block per deal, then day-on-day change. No downtime, no advice.
  function dayTooltip(day) {
    var rows = [['Plays won', fmtInt(day.playsWon)], ['Spend', fmtMoney(day.spend, 2)]];
    (day.deals || []).forEach(function (b) { rows = rows.concat(dealBlockRows(b)); });
    var v = day.vsPreviousDay || {};
    rows.push(['Plays won vs previous day', changeText(v.playsWon) || 'No plays the previous day']);
    rows.push(['Spend vs previous day', changeText(v.spend) || 'No spend the previous day']);
    return { title: fmtDay(day.date), rows: rows };
  }
  // The Pacing view's four KPIs, read at the last day of the range.
  function pacingKpis(p) {
    var last = p && p.series && p.series.length ? p.series[p.series.length - 1] : null;
    if (!last) return [];
    return [['Delivered', fmtInt(last.delivered)], ['Guaranteed to date', fmtInt(last.guaranteed)],
      ['Guaranteed whole flight', p.guaranteedForFlight != null ? fmtInt(p.guaranteedForFlight) : '–'],
      ['Pacing', last.guaranteed > 0 ? Math.round(last.delivered / last.guaranteed * 100) + '%' : '–']];
  }
  function pacingTooltip(date, pt, p) {
    var rows = [['Delivered', fmtInt(pt.delivered) + ' assumed views'], ['Guaranteed to date', fmtInt(pt.guaranteed)]];
    if (p && p.guaranteedForFlight != null) rows.push(['Guaranteed for flight', fmtInt(p.guaranteedForFlight)]);
    if (p && p.flightStart) rows.push(['Flight', fmtDay(p.flightStart) + ' – ' + fmtDay(p.flightEnd) + ' (' + plural(p.flightDays, 'day') + ')']);
    return { title: fmtDay(date), rows: rows };
  }

  // ---------- Your deals by display type model ----------
  // Hover rows are [key, value, kind]: kind 'head' = bold with a rule above, 'para' = a full-width paragraph,
  // 'sect' = a rule above (new section), 'note' = muted small footer, 'line' = a plain full-width line.
  function hoursText(v) {
    if (/^\s*24 hours\s*$/i.test(v || '')) return '24 hours';
    if (/^\s*store opening hours\s*$/i.test(v || '')) return 'Store opening hours';
    return null; // anything else could be a specific time, so it is never shown
  }
  // The same card as the retailer view's display type hover; facts only, and only fields that are stored.
  function displayTypeTooltip(t) {
    var rows = [];
    if (has(t.description)) rows.push([t.description, '', 'para']);
    var cd = t.connectedDisplays;
    if (cd && has(cd.displays)) rows.push(['Connected displays', fmtInt(cd.displays) + (has(cd.stores) ? ' across ' + plural(cd.stores, 'store') : '')]);
    if (has(t.iabZone)) rows.push(['IAB store zone', t.iabZone]);
    var hrs = hoursText(t.operatingHours);
    if (hrs) rows.push(['Operating hours', hrs]);
    if (has(t.touchPoint)) rows.push(['Touch Point', t.touchPoint]);
    if (t.canvas && has(t.canvas.width) && has(t.canvas.height)) rows.push(['Display canvas size (resolution)', t.canvas.width + ' × ' + t.canvas.height + ' px']);
    if (has(t.displayOrientation)) rows.push(['Display orientation', ORIENTATIONS.indexOf(String(t.displayOrientation)) >= 0 ? String(t.displayOrientation) : 'Not set']);
    var cf = Array.isArray(t.creativeFormats) ? t.creativeFormats.filter(has).join('; ') : t.creativeFormats;
    if (has(cf)) rows.push(['Creative formats', cf]);
    var a = t.averages || {}, vac = [];
    if (has(a.averageAssumedViewsPerSlotPerDay)) vac.push(['Average assumed views (VAC-d) per slot per day', fmtInt(a.averageAssumedViewsPerSlotPerDay)]);
    if (has(a.averageFootfallPerDay)) vac.push(['Average footfall past a display per day', fmtInt(a.averageFootfallPerDay)]);
    if (has(a.averageVisibility)) vac.push(['Average visibility adjustment', Number(a.averageVisibility).toFixed(2)]);
    var sl = a.shareOfLoopTime;
    if (sl && has(sl.advertiserSlotSeconds) && has(sl.loopSeconds) && has(sl.percent)) vac.push(['Share of loop time', sl.advertiserSlotSeconds + 's advertiser slot ÷ ' + sl.loopSeconds + 's loop = ' + Math.round(sl.percent) + '%']);
    if (vac.length) {
      vac[0] = vac[0].concat('sect');
      rows = rows.concat(vac);
      if (a.averagesCover && a.averagesCover.label) rows.push([a.averagesCover.label, '', 'note']);
    }
    return { title: t.name, rows: rows };
  }
  // Only the advertiser's own DSP deal ID is returned by the API; list it as "Google DSP (DV360): PH-…".
  function dealNameTooltip(deal) {
    var rows = [];
    if (deal.description) rows.push([deal.description, '', 'para']);
    (deal.dealIds || []).forEach(function (d, i) { rows.push([i ? '' : 'Deal ID', (d.dspLabel || d.dsp) + ': ' + d.dealId, i ? '' : 'sect']); });
    return { title: deal.name, rows: rows };
  }
  function slotsLabel(deal) { return deal.slots && deal.slots.count ? plural(deal.slots.count, 'slot') : 'Not assigned'; }
  // One block per assigned slot: display type (description), playlist · zone, IAB zone, then the slot and its plays per window.
  function slotsTooltip(deal, displayType) {
    var rows = [], dt = displayType || {};
    ((deal.slots && deal.slots.assigned) || []).forEach(function (s) {
      var desc = has(dt.description) ? String(dt.description).replace(/\.\s*$/, '') : '';
      var first = (dt.name || '') + (desc ? ' (' + desc + ')' : '');
      if (first) rows.push([first, '', 'head']);
      if (s.playlistZone) rows.push([s.playlistZone, '', 'line']);
      var iab = s.iabZone || dt.iabZone;
      if (has(iab)) rows.push(['IAB zone: ' + iab, '', 'line']);
      var pos = 'Advertiser slot ' + s.advertiserSlot;
      if (s.loopSlot) pos += ' (slot ' + s.loopSlot + (s.loopSlotCount ? ' of ' + s.loopSlotCount : ' of the loop') + ')';
      if (s.playsPerWindow != null) pos += ' · ' + fmtInt(s.playsPerWindow) + ' plays per window';
      rows.push([pos, '', 'line']);
    });
    return { title: 'Assigned slots', rows: rows };
  }
  // Hover on a deal's Share: plays won, all plays on the deal there, and how many advertisers are on it — never who.
  // allPlays and the percent are omitted by the back end when a share would identify another buyer; they are never computed here.
  function shareTooltip(deal, typeName_) {
    var s = deal.share || {};
    var rows = [['Plays you won', fmtInt(s.playsWon || 0)]];
    if (s.allPlays != null) rows.push(['All plays on this deal here', fmtInt(s.allPlays)]);
    if (s.advertisersOnDeal != null) rows.push(['Advertisers on the deal', fmtInt(s.advertisersOnDeal)]);
    return { title: deal.name + (typeName_ ? ' · ' + typeName_ : ''), rows: rows };
  }
  // Flatten groups to table rows: a display type row, then its deals indented beneath.
  function tableRows(data) {
    var out = [];
    ((data && data.groups) || []).forEach(function (g) {
      out.push({ kind: 'type', name: g.displayType.name, deals: g.dealCount, slots: g.slots, playsWon: g.playsWon, views: g.assumedViews, spend: g.spend, cpm: g.effectiveCpm, share: g.sharePercent, tip: displayTypeTooltip(g.displayType) });
      g.deals.forEach(function (d) {
        out.push({ kind: 'deal', name: d.name, dealType: typeName(d.dealType), slotsText: slotsLabel(d), playsWon: d.playsWon, views: d.assumedViews, spend: d.spend, cpm: d.effectiveCpm,
          share: d.share && d.share.percent, nameTip: dealNameTooltip(d), slotsTip: slotsTooltip(d, g.displayType), shareTip: shareTooltip(d, g.displayType.name) });
      });
    });
    return out;
  }

  // ---------- Audience and targeting models ----------
  function sparkline(trend, w, h) {
    var vals = (trend || []).map(function (t) { return t.assumedViews; });
    if (vals.length < 2) return '';
    var max = Math.max.apply(null, vals), min = Math.min.apply(null, vals), span = max - min || 1;
    return vals.map(function (v, i) {
      return (i ? 'L' : 'M') + (i / (vals.length - 1) * w).toFixed(1) + ' ' + (h - 2 - (v - min) / span * (h - 4)).toFixed(1);
    }).join(' ');
  }
  function variableLabel(v) {
    var sub = v.personalisationType && String(v.label).toLowerCase().indexOf(String(v.personalisationType).toLowerCase()) < 0 ? ' · ' + v.personalisationType : '';
    return v.label + sub;
  }
  // The scheduling chip, e.g. "Dayparted · 3 of 4 campaigns · 5 schedules"; null when scheduling is not used.
  function schedulingText(s) {
    if (!s || !s.uses) return null;
    return 'Dayparted · ' + s.scheduledCampaigns + ' of ' + plural(s.campaigns, 'campaign') + (s.schedules != null ? ' · ' + plural(s.schedules, 'schedule') : '');
  }
  var NO_SCHEDULING = 'Not used yet. Set dayparts and schedules on a campaign’s Scheduling tab.';
  // The three-rung ladder, highest first: the advertiser's rung, the one above it ("Next step") and the muted rungs above.
  function ladderRungs(level) {
    var at = LEVELS.map(function (l) { return l[0]; }).indexOf(level);
    return LEVELS.map(function (l, i) {
      return { name: l[0], colour: l[1], here: i === at, next: at > 0 && i === at - 1, above: at >= 0 && i < at };
    });
  }
  // The Audience hero, caption and ⓘ: the peak day is computed from the trend.
  function peakOf(trend) {
    var best = null;
    (trend || []).forEach(function (t) { if (!best || t.assumedViews > best.assumedViews) best = t; });
    return best;
  }
  function audienceModel(data, filters) {
    var tr = (data && data.trend) || [];
    var from = (filters && filters.dateFrom) || (tr[0] && tr[0].date), to = (filters && filters.dateTo) || (tr.length && tr[tr.length - 1].date);
    var peak = peakOf(tr);
    var tip = ['Assumed views (VAC-d) delivered to you, from PH Core playback analytics. The line is the daily trend' + (peak ? '; the peak was ' + fmtBig(peak.assumedViews) + ' on ' + fmtDay(peak.date) : '') + '.'].concat(VACD);
    return { hero: fmtBig(data.assumedViews), caption: 'Assumed views (VAC-d) delivered' + (from && to ? ', ' + rangeText(from, to) : ''), tip: tip };
  }
  function sparkArea(trend, w, h) {
    var line = sparkline(trend, w, h);
    return line ? line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z' : '';
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
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }
  function icon(name) { return h('span', { class: 'av-icon', 'aria-hidden': 'true', text: name }); }

  function mount(container, opts) {
    if (typeof document === 'undefined') throw new Error('AdvertiserView.mount needs a DOM');
    var fetchJson = opts.fetchJson;
    var filters = {};
    var sel = { metrics: initialMetrics(), dealId: '', view: 'delivery' };
    var delivery = null;
    var seq = { delivery: 0, deals: 0, audience: 0, targeting: 0 };

    var root = h('div', { class: 'av-root' });
    var tip = h('div', { class: 'av-tip', role: 'tooltip', hidden: '' });
    container.appendChild(root); root.appendChild(tip);

    // One floating hover card, kept inside the root horizontally and inside the viewport vertically, so a long
    // hover is never clipped by its card and stays on-screen on a phone.
    function showTip(model, anchor, point) {
      if (!model || !model.rows.length) return hideTip();
      tip.textContent = '';
      if (model.title) tip.appendChild(h('div', { class: 'av-tip-title', text: model.title }));
      model.rows.forEach(function (r) {
        var kind = r[2] || '';
        if (kind === 'para' || kind === 'note' || kind === 'line') { tip.appendChild(h('div', { class: 'av-tip-' + kind, text: r[0] })); return; }
        tip.appendChild(h('div', { class: 'av-tip-row' + (kind === 'head' ? ' head' : kind === 'sect' ? ' sect' : '') }, [h('span', { class: 'av-tip-k', text: r[0] }), r[1] ? h('span', { class: 'av-tip-v', text: r[1] }) : null]));
      });
      tip.hidden = false;
      var rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect();
      var w = Math.min(tip.offsetWidth, rr.width), hgt = tip.offsetHeight;
      var cx = point != null ? point : ar.left + ar.width / 2;
      var left = Math.max(0, Math.min(cx - rr.left - w / 2, rr.width - w));
      var top = ar.bottom - rr.top + 6;
      var vh = window.innerHeight;
      if (ar.bottom + hgt + 12 > vh) top = Math.max(ar.top - rr.top - hgt - 6, 12 - rr.top);
      if (rr.top + top + hgt > vh - 8) top = Math.max(8 - rr.top, vh - 8 - hgt - rr.top);
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }
    function hideTip() { tip.hidden = true; }
    function hover(el, modelFn) {
      el.setAttribute('tabindex', '0');
      el.addEventListener('mouseenter', function () { showTip(modelFn(), el); });
      el.addEventListener('focus', function () { showTip(modelFn(), el); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('blur', hideTip);
      el.addEventListener('click', function () { showTip(modelFn(), el); }); // touch
    }
    // The ⓘ takes a paragraph, a list of paragraphs, or a function returning either (evaluated on hover).
    function infoRows(t) { return [].concat(typeof t === 'function' ? t() : t).map(function (x) { return [x, '', 'para']; }); }
    function info(text) {
      var el = h('span', { class: 'av-info', 'aria-label': 'More information' }, [icon('info')]);
      hover(el, function () { return { title: '', rows: infoRows(text) }; });
      return el;
    }
    function panel(title, tipText, controls) {
      var head = h('div', { class: 'av-head' }, [h('div', { class: 'av-title' }, [h('h2', { text: title }), info(tipText)]), controls]);
      var body = h('div', { class: 'av-body' });
      return { el: h('section', { class: 'av-panel' }, [head, body]), body: body };
    }
    function stateBox(kind, text, retry) {
      var box = h('div', { class: 'av-state ' + kind }, [icon(kind === 'error' ? 'error' : 'monitoring'), h('p', { text: text })]);
      if (retry) { var b = h('button', { class: 'av-btn', type: 'button', text: 'Try again' }); b.onclick = retry; box.appendChild(b); }
      return box;
    }
    function params(extra) {
      var p = {};
      ['dateFrom', 'dateTo', 'storeIds', 'displayTypeIds'].forEach(function (k) { if (filters[k] != null) p[k] = filters[k]; });
      return Object.assign(p, extra);
    }
    function load(key, endpoint, extra, panelBody, draw, emptyText, isEmpty) {
      var n = ++seq[key];
      panelBody.textContent = ''; panelBody.appendChild(h('div', { class: 'av-skel' }));
      fetchJson(endpoint, params(extra)).then(function (data) {
        if (n !== seq[key]) return;
        panelBody.textContent = '';
        if (isEmpty(data)) panelBody.appendChild(stateBox('empty', emptyText));
        else draw(data);
      }, function () {
        if (n !== seq[key]) return;
        panelBody.textContent = '';
        panelBody.appendChild(stateBox('error', 'We couldn’t load this. Try again shortly.', function () { load(key, endpoint, extra, panelBody, draw, emptyText, isEmpty); }));
      });
    }

    // ----- Delivery -----
    var dealSelectWrap = h('span', { class: 'av-ctl' });
    var pacingSwitchWrap = h('span', { class: 'av-ctl' });
    var dealCtl = h('div', { class: 'av-controls' }, [pacingSwitchWrap, dealSelectWrap]);
    var del = panel('Delivery', TIPS.delivery, dealCtl);
    var tiles = h('div', { class: 'av-tiles', role: 'group', 'aria-label': 'Chart metrics' });
    var plot = h('div', { class: 'av-plot' });
    del.body.appendChild(tiles); del.body.appendChild(plot);

    function drawDealSelect() {
      dealSelectWrap.textContent = '';
      var sl = h('select', { class: 'av-select', 'aria-label': 'Deal' });
      dealOptions(delivery).forEach(function (o) { var op = h('option', { value: o.value, text: o.label }); if (o.value === sel.dealId) op.selected = true; sl.appendChild(op); });
      sl.onchange = function () { sel.dealId = sl.value; sel.view = 'delivery'; loadDelivery(); };
      dealSelectWrap.appendChild(sl);
    }
    function drawPacingSwitch() {
      pacingSwitchWrap.textContent = '';
      if (!showPacingSwitch(delivery, sel.dealId)) { sel.view = 'delivery'; return; }
      var seg = h('div', { class: 'av-seg', role: 'group', 'aria-label': 'Chart view' });
      [['delivery', 'Plays won & spend'], ['pacing', 'Pacing']].forEach(function (v) {
        var b = h('button', { type: 'button', class: 'av-seg-btn' + (sel.view === v[0] ? ' on' : ''), 'aria-pressed': sel.view === v[0] ? 'true' : 'false', text: v[1] });
        b.onclick = function () { sel.view = v[0]; drawTiles(); drawChart(); drawPacingSwitch(); };
        seg.appendChild(b);
      });
      pacingSwitchWrap.appendChild(seg);
    }
    function drawTiles() {
      tiles.textContent = '';
      if (sel.view === 'pacing') {
        pacingKpis(pacingFor(delivery, sel.dealId)).forEach(function (k) {
          tiles.appendChild(h('div', { class: 'av-kpi' }, [h('span', { class: 'av-tile-lbl', text: k[0] }), h('span', { class: 'av-tile-val', text: k[1] })]));
        });
        return;
      }
      var t = delivery.totals;
      [['plays', 'Plays won', fmtInt(t.playsWon)], ['spend', 'Spend', fmtMoney(t.spend)]].forEach(function (m) {
        var on = sel.metrics[m[0]];
        var b = h('button', { type: 'button', class: 'av-tile' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false', style: '--av-line:' + COLOURS[m[0]] }, [
          h('span', { class: 'av-tile-top' }, [icon(on ? 'check_box' : 'check_box_outline_blank'), h('span', { class: 'av-tile-lbl', text: m[1] })]),
          h('span', { class: 'av-tile-val', text: m[2] }), h('span', { class: 'av-tile-bar' })]);
        b.onclick = function () { sel.metrics = toggleMetric(sel.metrics, m[0]); drawTiles(); drawChart(); };
        tiles.appendChild(b);
      });
    }
    var W = 720, H = 240, PL = 52, PR = 56, PT = 12, PB = 24;
    function axis(svg, side, max, fmt, colour) {
      for (var i = 0; i <= 4; i++) {
        var y = PT + (H - PT - PB) * (1 - i / 4);
        if (side === 'left') svg.appendChild(s('line', { x1: PL, x2: W - PR, y1: y, y2: y, class: 'av-grid' }));
        var t = s('text', { x: side === 'left' ? PL - 6 : W - PR + 6, y: y + 4, 'text-anchor': side === 'left' ? 'end' : 'start', class: 'av-axis', fill: colour || '' });
        t.textContent = fmt(max * i / 4); svg.appendChild(t);
      }
    }
    function drawChart() {
      plot.textContent = '';
      if (!delivery) return;
      var days = sel.view === 'pacing' ? (pacingFor(delivery, sel.dealId).series || []) : delivery.days;
      if (!days.length) { plot.appendChild(stateBox('empty', 'No delivery for these filters.')); return; }
      var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'av-svg', role: 'img', 'aria-label': 'Delivery chart', preserveAspectRatio: 'none' });
      var n = days.length, iw = W - PL - PR, ih = H - PT - PB;
      var x = function (i) { return PL + (n === 1 ? iw / 2 : i / (n - 1) * iw); };
      var lines = sel.view === 'pacing'
        ? [{ key: 'guaranteed', colour: COLOURS.guaranteed, fmt: fmtInt, side: 'left', dash: true }, { key: 'delivered', colour: COLOURS.delivered, fmt: fmtInt, side: 'left' }]
        : [].concat(sel.metrics.plays ? [{ key: 'playsWon', colour: COLOURS.plays, fmt: fmtInt, side: 'left' }] : [], sel.metrics.spend ? [{ key: 'spend', colour: COLOURS.spend, fmt: function (v) { return fmtMoney(v); }, side: 'right' }] : []);
      // With one metric on it takes the left axis; with both, plays are left and spend right.
      if (lines.length === 1) lines[0].side = 'left';
      var maxFor = function (side) {
        var m = 0; lines.forEach(function (l) { if (l.side === side) days.forEach(function (d) { m = Math.max(m, d[l.key] || 0); }); });
        return niceMax(m);
      };
      var maxes = { left: maxFor('left'), right: maxFor('right') };
      var fmtFor = function (side) { return lines.filter(function (l) { return l.side === side; })[0]; };
      axis(svg, 'left', maxes.left, fmtFor('left') ? fmtFor('left').fmt : fmtInt, '');
      if (fmtFor('right')) axis(svg, 'right', maxes.right, fmtFor('right').fmt, '');
      var xs = Math.max(1, Math.ceil(n / 8));
      days.forEach(function (d, i) {
        if (i % xs) return;
        var t = s('text', { x: x(i), y: H - 6, 'text-anchor': 'middle', class: 'av-axis' }); t.textContent = fmtDay(d.date); svg.appendChild(t);
      });
      lines.forEach(function (l) {
        var pts = days.map(function (d, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + (PT + ih * (1 - (d[l.key] || 0) / maxes[l.side])).toFixed(1); }).join(' ');
        svg.appendChild(s('path', { d: pts, fill: 'none', stroke: l.colour, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-dasharray': l.dash ? '5 4' : '', 'vector-effect': 'non-scaling-stroke' }));
      });
      var cursor = s('line', { y1: PT, y2: H - PB, class: 'av-cursor', visibility: 'hidden' });
      svg.appendChild(cursor);
      if (sel.view === 'pacing') {
        // The range ends today: a dashed marker on the last day, labelled.
        var tx = x(n - 1);
        svg.appendChild(s('line', { x1: tx, x2: tx, y1: PT, y2: H - PB, class: 'av-today' }));
        var tl = s('text', { x: tx - 4, y: PT + 10, 'text-anchor': 'end', class: 'av-axis' }); tl.textContent = 'Today'; svg.appendChild(tl);
      }
      plot.appendChild(svg);
      if (sel.view === 'pacing') {
        plot.appendChild(h('div', { class: 'av-legend' }, [h('span', { class: 'av-key', style: '--av-line:' + COLOURS.delivered, text: 'Delivered assumed views (VAC-d)' }), h('span', { class: 'av-key dashed', style: '--av-line:' + COLOURS.guaranteed, text: 'Guaranteed' })]));
      }
      // One transparent column per day carries the hover, so each day is a real focus/touch target.
      var hit = h('div', { class: 'av-hits', style: 'left:' + (PL / W * 100) + '%;right:' + (PR / W * 100) + '%' });
      days.forEach(function (d, i) {
        var col = h('div', { class: 'av-hit', 'aria-label': fmtDay(d.date) });
        var model = function () { return sel.view === 'pacing' ? pacingTooltip(d.date, d, pacingFor(delivery, sel.dealId)) : dayTooltip(d); };
        var on = function () { cursor.setAttribute('x1', x(i)); cursor.setAttribute('x2', x(i)); cursor.setAttribute('visibility', 'visible'); showTip(model(), col); };
        var off = function () { cursor.setAttribute('visibility', 'hidden'); hideTip(); };
        col.setAttribute('tabindex', '0');
        col.addEventListener('mouseenter', on); col.addEventListener('focus', on); col.addEventListener('click', on);
        col.addEventListener('mouseleave', off); col.addEventListener('blur', off);
        hit.appendChild(col);
      });
      plot.appendChild(hit);
    }
    function loadDelivery() {
      var extra = sel.dealId ? { dealId: sel.dealId } : {};
      var n = ++seq.delivery;
      plot.textContent = ''; tiles.textContent = ''; plot.appendChild(h('div', { class: 'av-skel' }));
      fetchJson('delivery', params(extra)).then(function (data) {
        if (n !== seq.delivery) return;
        delivery = data;
        plot.textContent = '';
        drawDealSelect(); drawPacingSwitch(); drawTiles(); drawChart();
      }, function () {
        if (n !== seq.delivery) return;
        plot.textContent = ''; plot.appendChild(stateBox('error', 'We couldn’t load delivery. Try again shortly.', loadDelivery));
      });
    }

    // ----- Your deals by display type -----
    var dl = panel('Your deals by display type', function () { return TIPS.deals(rangeText(filters.dateFrom, filters.dateTo)); }, null);
    var COLS = [['Display type / deal', ''], ['Deal type', ''], ['Slots', 'num'], ['Plays won', 'num'], ['Assumed views (VAC-d)', 'num'], ['Spend', 'num'], ['Effective CPM', 'num'], ['Share', 'num']];
    function td(text, cls) { return h('td', { class: cls || '', text: text == null ? '' : text }); }
    function drawDeals(data) {
      var tbl = h('table', { class: 'av-table' });
      tbl.appendChild(h('thead', {}, [h('tr', {}, COLS.map(function (c) { return h('th', { class: c[1], scope: 'col', text: c[0] }); }))]));
      var tb = h('tbody');
      tableRows(data).forEach(function (r) {
        var tr = h('tr', { class: 'av-' + r.kind });
        var name = h('td', { class: 'av-name' }, [h('span', { class: 'av-name-in', text: r.name })]);
        if (r.kind === 'type') {
          hover(name.firstChild, function () { return r.tip; });
          tr.appendChild(name); tr.appendChild(td(plural(r.deals, 'deal'), 'av-muted')); tr.appendChild(td(plural(r.slots, 'slot'), 'num'));
        } else {
          hover(name.firstChild, function () { return r.nameTip; });
          tr.appendChild(name); tr.appendChild(td(r.dealType));
          var sl = td(r.slotsText, 'num'); if (r.slotsTip.rows.length) { sl.className = 'num hov'; hover(sl, function () { return r.slotsTip; }); }
          tr.appendChild(sl);
        }
        tr.appendChild(td(fmtInt(r.playsWon), 'num')); tr.appendChild(td(fmtInt(r.views), 'num')); tr.appendChild(td(fmtMoney(r.spend, 2), 'num'));
        tr.appendChild(td(r.cpm != null ? fmtMoney(r.cpm, 2) : '', 'num'));
        var sh = h('td', { class: 'num' });
        if (r.share != null) {
          sh.appendChild(h('span', { class: 'av-share-bar' }, [h('i', { style: 'width:' + Math.min(100, r.share) + '%' })]));
          var pc = h('span', { text: r.share + '%' });
          sh.appendChild(pc);
          if (r.kind === 'deal') {
            pc.className = 'av-name-in'; hover(pc, function () { return r.shareTip; });
            sh.appendChild(h('span', { class: 'av-small', text: ' of deal plays' }));
          }
        }
        tr.appendChild(sh);
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      dl.body.appendChild(h('div', { class: 'av-scroll' }, [tbl]));
    }

    // ----- Audience -----
    var audTip = [];
    var aud = panel('Audience', function () { return audTip; }, null);
    function drawAudience(data) {
      var m = audienceModel(data, filters);
      audTip = m.tip;
      var W2 = 240, H2 = 56;
      var svg = s('svg', { viewBox: '0 0 ' + W2 + ' ' + H2, class: 'av-spark', role: 'img', 'aria-label': 'Assumed views per day', preserveAspectRatio: 'none' });
      var area = sparkArea(data.trend, W2, H2), line = sparkline(data.trend, W2, H2);
      if (area) {
        svg.appendChild(s('path', { d: area, fill: COLOURS.plays, 'fill-opacity': '0.08', stroke: 'none' }));
        svg.appendChild(s('path', { d: line, fill: 'none', stroke: COLOURS.plays, 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
      }
      aud.body.appendChild(h('div', { class: 'av-metric' }, [h('div', { class: 'av-metric-val', text: m.hero }), h('div', { class: 'av-metric-lbl', text: m.caption }), svg]));
    }

    // ----- Your targeting & scheduling -----
    var tg = panel('Your targeting & scheduling', TIPS.targeting, null);
    function chips(list) { return h('div', { class: 'av-chips' }, list.map(function (v) { return h('span', { class: 'av-var ' + String(v.kind).toLowerCase(), text: variableLabel(v) }); })); }
    function block(label, child) { return h('div', { class: 'av-block' }, [h('div', { class: 'av-block-lbl', text: label }), child]); }
    function muted(text) { return h('div', { class: 'av-muted', text: text }); }
    function drawTargeting(data) {
      var ladder = h('div', { class: 'av-ladder', role: 'list', 'aria-label': 'Targeting level' });
      ladderRungs(data.level).forEach(function (r) {
        var cls = 'av-rung' + (r.here ? ' here' : '') + (r.above ? ' above' : '');
        var row = h('div', { class: cls, role: 'listitem' }, [h('i', { class: 'av-swatch', style: 'background:' + r.colour }), h('span', { class: 'av-rung-name', text: r.name })]);
        if (r.here) row.appendChild(h('span', { class: 'av-tag here', text: 'You are here' }));
        else if (r.next) row.appendChild(h('span', { class: 'av-tag next', text: 'Next step' }));
        ladder.appendChild(row);
      });
      var used = data.variablesUsed && data.variablesUsed.length ? chips(data.variablesUsed) : muted('Default creative only');
      var sched = schedulingText(data.scheduling);
      var schedEl = sched ? h('div', { class: 'av-chips' }, [h('span', { class: 'av-var', text: sched })]) : muted(NO_SCHEDULING);
      var o = data.otherVariablesAvailable || {};
      var avail = h('div', { class: 'av-avail' });
      LEVELS.slice(0, 2).reverse().forEach(function (l) {
        var k = l[0];
        if (o[k] && o[k].length) avail.appendChild(h('div', { class: 'av-group' }, [h('span', { class: 'av-lvl' }, [h('i', { class: 'av-swatch', style: 'background:' + l[1] }), h('span', { text: k })]), chips(o[k])]));
      });
      if (!avail.firstChild) avail.appendChild(muted('You use every available variable'));
      tg.body.appendChild(h('div', { class: 'av-target' }, [ladder, h('div', { class: 'av-blocks' }, [block('Variables you use', used), block('Scheduling', schedEl), block('Other variables available to use', avail)])]));
    }

    root.appendChild(del.el); root.appendChild(dl.el); root.appendChild(aud.el); root.appendChild(tg.el);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideTip(); });

    return {
      setFilters: function (f) {
        filters = f || {};
        loadDelivery();
        load('deals', 'deals-by-display-type', {}, dl.body, drawDeals, 'None of your deals run on this display type.', function (d) { return !d.groups || !d.groups.length; });
        load('audience', 'audience', {}, aud.body, drawAudience, 'No audience delivered for these filters.', function () { return false; });
        load('targeting', 'my-targeting', {}, tg.body, drawTargeting, 'No campaigns in range.', function () { return false; });
      },
      destroy: function () { container.removeChild(root); }
    };
  }

  return {
    mount: mount, OPEN_AUCTION: OPEN_AUCTION,
    initialMetrics: initialMetrics, toggleMetric: toggleMetric, dealOptions: dealOptions, pacingFor: pacingFor, showPacingSwitch: showPacingSwitch,
    dayTooltip: dayTooltip, dealBlockRows: dealBlockRows, pacingTooltip: pacingTooltip, cpmRange: cpmRange, changeText: changeText,
    displayTypeTooltip: displayTypeTooltip, pacingKpis: pacingKpis, ladderRungs: ladderRungs, audienceModel: audienceModel, sparkArea: sparkArea, fmtCompact: fmtCompact, fmtBig: fmtBig, peakOf: peakOf, NO_SCHEDULING: NO_SCHEDULING, dealNameTooltip: dealNameTooltip, slotsLabel: slotsLabel, slotsTooltip: slotsTooltip, shareTooltip: shareTooltip,
    tableRows: tableRows, sparkline: sparkline, variableLabel: variableLabel, schedulingText: schedulingText, seriesPoints: seriesPoints, fmtMoney: fmtMoney, fmtInt: fmtInt, niceMax: niceMax
  };
});
