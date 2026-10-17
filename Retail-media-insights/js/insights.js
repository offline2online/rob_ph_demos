(function () {
  var q = new URLSearchParams(location.search);
  var advertiser = q.get("role") === "advertiser";
  var state = q.get("state");
  var $ = function (id) { return document.getElementById(id); };
  var ids = ["f-date", "f-store", "f-display", "f-adv"];
  var DEFAULTS = { "f-date": "30", "f-store": "all", "f-display": "all", "f-adv": "all" };
  var applied = Object.assign({}, DEFAULTS);
  var isApplied = false;

  // Sample data until the summary endpoint (Qp4J0XfMbspHUd2uEtLh) lands.
  var SAMPLE = {
    all: { earned: 48210, estimated: 55900, sold: 912, available: 144 },
    s2: { earned: 36864, estimated: 42580, sold: 824, available: 232 },
    s1: { earned: 29415, estimated: 34120, sold: 701, available: 355 }
  };
  var fmt = function (n) { return "$" + n.toLocaleString("en-US"); };

  function tile(label, val, sub, extra) {
    return '<div class="tile"><div class="lbl">' + label + '</div><div class="val">' + val + '</div>' + (extra || "") + '<div class="sub">' + sub + '</div></div>';
  }
  function render() {
    var el = $("strip");
    if (state === "loading") { el.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>'; return; }
    if (state === "error") { el.innerHTML = '<div class="msg err"><span class="material-symbols-outlined">error</span><p>We couldn\'t load retail media performance. Try again shortly.</p></div>'; return; }
    if (state === "empty") { el.innerHTML = '<div class="msg"><span class="material-symbols-outlined">monitoring</span><p>No retail media activity for these filters.</p></div>'; return; }
    var d = SAMPLE[applied["f-store"]] || SAMPLE.all;
    var pct = Math.round(d.sold / (d.sold + d.available) * 100);
    el.innerHTML =
      tile("Earned revenue", fmt(d.earned), "Delivered and billed") +
      tile("Estimated revenue", fmt(d.estimated), "Including booked, not yet delivered") +
      tile("Inventory sold", pct + "%", d.sold.toLocaleString("en-US") + " sold · " + d.available.toLocaleString("en-US") + " available",
        '<div class="bar"><i style="width:' + pct + '%"></i></div>');
  }
  // Revenue and Deals read the revenue / deals endpoints (?api=<base>/insights/v1/retail-media);
  // without ?api they read the offline fixtures, and ?state=empty|error previews those states.
  var api = q.get("api");
  function fetchJson(endpoint, params) {
    if (!api) return RDFixtures.fetchJson(endpoint, params, { state: state === "empty" || state === "error" ? state : null, delay: state === "loading" ? 3600000 : 120 });
    var qs = new URLSearchParams();
    Object.keys(params).forEach(function (k) {
      [].concat(params[k]).forEach(function (v) { qs.append(Array.isArray(params[k]) ? k + "[]" : k, v); });
    });
    return fetch(api + "/" + endpoint + "?" + qs).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }
  // The advertiser view (?role=advertiser) replaces the retailer charts; the server pins every response to the
  // signed-in advertiser, so the page never sends advertiserIds and its Display type filter is only their own.
  function avFetchJson(endpoint, params) {
    if (!api) return AVFixtures.fetchJson(endpoint, params, { state: state === "empty" || state === "error" ? state : null, delay: state === "loading" ? 3600000 : 120 });
    return fetchJson(endpoint, params);
  }
  var rd = advertiser ? null : RevenueDeals.mount($("rd"), { fetchJson: fetchJson });
  var av = advertiser ? AdvertiserView.mount($("av"), { fetchJson: avFetchJson }) : null;
  if (advertiser) {
    // The summary strip is retailer revenue and inventory; an advertiser login never sees it.
    $("rd").hidden = true; $("av").hidden = false; $("strip").hidden = true;
    avFetchJson("filter-options", {}).then(function (o) {
      var sel = $("f-display"), cur = sel.value;
      sel.innerHTML = '<option value="all">All display types</option>' + o.displayTypes.map(function (t) { return '<option value="' + t.id + '">' + t.name + '</option>'; }).join("");
      sel.value = cur;
    }, function () {});
  }
  function setFilters(f) { if (advertiser) av.setFilters(f); else rd.setFilters(f); }
  function pageFilters() {
    var days = +applied["f-date"], to = new Date(Date.UTC(2026, 9, 11)), from = new Date(to.getTime() - (days - 1) * 864e5);
    var f = { dateFrom: from.toISOString().slice(0, 10), dateTo: to.toISOString().slice(0, 10) };
    if (applied["f-store"] !== "all") f.storeIds = [applied["f-store"]];
    if (applied["f-display"] !== "all") f.displayTypeIds = [applied["f-display"]];
    if (!advertiser && applied["f-adv"] !== "all") f.advertiserIds = [applied["f-adv"]];
    return f;
  }
  function dirty() { return ids.some(function (i) { return $(i).value !== applied[i]; }); }
  function sync() {
    var d = dirty();
    $("apply").hidden = !d; $("cancel").hidden = !d;
    $("reset").hidden = !isApplied || d;
  }
  if (advertiser) { $("f-adv").hidden = true; $("adv-chip").hidden = false; }
  ids.forEach(function (i) { $(i).addEventListener("change", sync); });
  $("apply").onclick = function () {
    ids.forEach(function (i) { applied[i] = $(i).value; });
    isApplied = true; render(); sync(); setFilters(pageFilters());
  };
  $("cancel").onclick = function () { ids.forEach(function (i) { $(i).value = applied[i]; }); sync(); };
  $("reset").onclick = function () {
    ids.forEach(function (i) { $(i).value = DEFAULTS[i]; applied[i] = DEFAULTS[i]; });
    isApplied = false; render(); sync(); setFilters(pageFilters());
  };
  render(); sync(); setFilters(pageFilters());
})();
