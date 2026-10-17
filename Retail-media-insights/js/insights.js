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
    isApplied = true; render(); sync();
  };
  $("cancel").onclick = function () { ids.forEach(function (i) { $(i).value = applied[i]; }); sync(); };
  $("reset").onclick = function () {
    ids.forEach(function (i) { $(i).value = DEFAULTS[i]; applied[i] = DEFAULTS[i]; });
    isApplied = false; render(); sync();
  };
  render(); sync();
})();
