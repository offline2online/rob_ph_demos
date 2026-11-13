/* PH Be Your Own Boss page (/be-your-own-boss/, 13 Nov 2026): the calculator, info tooltips, anchors, the header's "Arrange A Demo" (goes to #tour
   here) and the product tour gate. A network operator lead posts to ph-site/v1/operator-lead; on success the real retail media tour is
   framed in place, unlocked from the stored ph_lead with no second form. */
(function () {
  "use strict";
  var SHARE = 0.5; // the calculator's share of ad revenue: code only, never shown.
  var BACKGROUNDS = ["Agency media or account management", "Ad-tech sales or partnerships", "Retail media", "Marketing", "Something else"];

  function calc(s) {
    var visitorsMonth = s.ven * s.vis * 365 / 12;
    var viewers = visitorsMonth * s.view / 100;
    var viewsMonth = viewers * s.dis;
    var adRevenue = viewsMonth * 12 / 1000 * s.cpm;
    return { venues: s.ven, displays: s.ven * s.dis, visitorsMonth: visitorsMonth, viewsMonth: viewsMonth, income: adRevenue * SHARE, extraSales: viewers * 12 * s.atv * s.up / 100 };
  }
  function money(n) {
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + Math.round(n / 1e3) + "K";
    return "$" + Math.round(n);
  }
  function count(n) { return Number(n).toLocaleString("en-US"); }
  function view(c) {
    return { yours: money(c.income), venues: count(c.venues), displays: count(c.displays), visitors: count(Math.round(c.visitorsMonth)), views: count(Math.round(c.viewsMonth)), extraSales: money(c.extraSales) };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { calc: calc, money: money, view: view, BACKGROUNDS: BACKGROUNDS }; return; }

  var root = document.getElementById("phf");
  if (!root) return;
  var $ = function (id) { return document.getElementById(id); };
  var CFG = window.PH_OPERATOR || { endpoint: "/wp-json/ph-site/v1/operator-lead", tour: "/industries/retail-media/tour/" };

  /* ---------- Calculator ---------- */
  var IDS = { ven: "c-ven", dis: "c-dis", vis: "c-vis", cpm: "c-cpm", atv: "c-atv", view: "c-view", up: "c-up" };
  function num(el) { var v = Number(el.value); return isNaN(v) || v < 0 ? 0 : v; }
  function update() {
    var s = {};
    Object.keys(IDS).forEach(function (k) { var el = $(IDS[k]); s[k] = el ? num(el) : 0; });
    ["view", "up"].forEach(function (k) { var o = $(IDS[k] + "-v"); if (o) o.textContent = s[k] + "%"; });
    var v = view(calc(s));
    Object.keys(v).forEach(function (k) { var o = root.querySelector('[data-out="' + k + '"]'); if (o) o.textContent = v[k]; });
  }
  Object.keys(IDS).forEach(function (k) {
    var el = $(IDS[k]); if (!el) return;
    el.addEventListener("input", update);
    el.addEventListener("change", function () { if (el.type === "number" && el.value !== "" && Number(el.value) < 0) el.value = "0"; update(); });
  });
  update();

  /* ---------- Info tooltips: hover and focus (CSS), tap toggles; Escape or a tap elsewhere closes ---------- */
  var tips = [].slice.call(root.querySelectorAll(".phf-tip"));
  function place(t) {
    var box = t.querySelector(".phf-tipbox"); t.classList.remove("phf-tip-l", "phf-tip-r");
    var r = t.getBoundingClientRect(), w = Math.min(250, window.innerWidth - 32), mid = r.left + r.width / 2;
    if (mid - w / 2 < 16) t.classList.add("phf-tip-l"); else if (mid + w / 2 > window.innerWidth - 16) t.classList.add("phf-tip-r");
    return box;
  }
  function closeAll(except) { tips.forEach(function (t) { if (t !== except) { t.classList.remove("open"); var b = t.querySelector("button"); if (b) b.setAttribute("aria-expanded", "false"); } }); }
  tips.forEach(function (t) {
    var b = t.querySelector("button");
    t.addEventListener("mouseenter", function () { place(t); });
    b.addEventListener("focus", function () { place(t); });
    b.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var on = !t.classList.contains("open"); closeAll(t); place(t);
      t.classList.toggle("open", on); b.setAttribute("aria-expanded", on ? "true" : "false");
    });
  });
  document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".phf-tip")) closeAll(null); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(null); });

  /* ---------- Storage ---------- */
  function read(k) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v && v.email ? v : null; } catch (e) { return null; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function testMode() {
    try {
      if (/[?&]ph_test=1(&|$)/.test(location.search)) sessionStorage.setItem("ph_test", "1");
      return sessionStorage.getItem("ph_test") === "1";
    } catch (e) { return /[?&]ph_test=1(&|$)/.test(location.search); }
  }
  function push(o) { try { (window.dataLayer = window.dataLayer || []).push(o); } catch (e) {} }
  function first(n) { return String(n || "").trim().split(/\s+/)[0] || ""; }

  /* ---------- Tour band ---------- */
  var form = $("phf-form"), box = $("phf-tbox"), btn = $("phf-unlock"), msg = $("phf-msg"), mount = $("phf-mount");
  var busy = false, mounted = false;
  function fields() { return form ? [form.elements.name, form.elements.email, form.elements.linkedin, form.elements.region, form.elements.background] : []; }
  function okEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function okLinkedin(v) { return v === "" || (v.length <= 300 && !/\s/.test(v) && /^(https?:\/\/)?([a-z0-9-]+\.)*linkedin\.com(\/|$|\?|#)/i.test(v)); }
  function valid() {
    if (!form) return false;
    var f = form.elements, n = f.name.value.trim(), e = f.email.value.trim(), r = f.region.value.trim();
    return !!(n && n.length <= 120 && okEmail(e) && e.length <= 120 && okLinkedin(f.linkedin.value.trim()) && r && r.length <= 120 && BACKGROUNDS.indexOf(f.background.value) > -1 && f.consent.checked);
  }
  function sync() { if (btn) btn.disabled = busy || !valid(); }
  function focusFirstEmpty() {
    if (!form || mounted) { var h = $("phf-in-h"); if (h && mounted) h.focus({ preventScroll: true }); return; }
    var f = fields().filter(function (x) { return x && !x.value.trim() && x.name !== "linkedin"; })[0] || (!form.elements.consent.checked ? form.elements.consent : null) || form.elements.name;
    try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
  }

  function tourSrc() { return CFG.tour + "?embed=1" + (testMode() ? "&ph_test=1" : ""); }
  function showIn(name) { var w = $("phf-in"), h = $("phf-in-h"); if (!w) return; h.textContent = "You’re in" + (first(name) ? ", " + first(name) : ""); w.hidden = false; }
  // Frame the real retail media tour, mounted the way enhance.js mounts the industry tours: same origin, height and full-screen messages, window.PH_TOUR.
  function mountTour() {
    if (mounted || !box || !mount) return;
    mounted = true;
    var fr = read("ph_operator"), lead = read("ph_lead");
    if (!lead && fr) { lead = { name: fr.name, email: fr.email, company: "", source: "Network operator inquiry", ts: Date.now() }; write("ph_lead", lead); }
    window.PH_TOUR = {
      endpoint: "/wp-json/ph-site/v1/tour-lead", nonce: "", brandEndpoint: "/wp-json/ph-site/v1/tour-brand",
      arrangeDemo: function () { try { box.scrollIntoView({ block: "start" }); } catch (e) {} }
    };
    var f = document.createElement("iframe");
    f.className = "phf-tour-frame"; f.title = "Interactive product tour"; f.src = tourSrc();
    f.setAttribute("scrolling", "no"); f.style.cssText = "width:100%;border:0";
    f.setAttribute("allow", "fullscreen"); f.setAttribute("allowfullscreen", ""); f.allowFullscreen = true;
    mount.appendChild(f);
    box.classList.add("phf-open");
    var gate = $("phf-gate"); if (gate) gate.setAttribute("aria-hidden", "true");
    var pinned = null, nativeFs = false;
    function pinFrame(on) {
      var de = document.documentElement, b = document.body;
      if (on && !pinned) {
        pinned = { css: f.style.cssText, html: de.style.overflow, body: b.style.overflow };
        f.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;width:100%;height:100%;max-height:none;min-height:0;border:0;z-index:2147483000;background:#0F1424";
        de.style.overflow = "hidden"; b.style.overflow = "hidden";
      } else if (!on && pinned) {
        f.style.cssText = pinned.css; de.style.overflow = pinned.html; b.style.overflow = pinned.body; pinned = null;
      }
    }
    function inView() { try { box.scrollIntoView({ block: "nearest" }); } catch (x) { box.scrollIntoView(); } }
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (e.origin !== location.origin || e.source !== f.contentWindow || !d) return;
      if (d.type === "ph-tour-fullscreen") { var on = d.on === true; pinFrame(on); if (!on) inView(); return; }
      if (d.type !== "ph-tour-height" || pinned) return;
      var h = Math.round(Number(d.h));
      if (h > 0 && h < 20000) f.style.height = h + "px";
    });
    document.addEventListener("fullscreenchange", function () {
      var on = document.fullscreenElement === f;
      if (nativeFs && !on) inView();
      nativeFs = on;
    });
  }

  if (form) {
    form.addEventListener("input", sync); form.addEventListener("change", sync);
    form.addEventListener("submit", function (e) {
      e.preventDefault(); if (busy || !valid()) { sync(); return; }
      var f = form.elements;
      var body = { name: f.name.value.trim(), email: f.email.value.trim(), linkedin: f.linkedin.value.trim(), region: f.region.value.trim(), background: f.background.value, consent: f.consent.checked, page: location.pathname, test: testMode(), website: f.website.value };
      busy = true; sync(); btn.textContent = "Unlocking…"; msg.className = "phf-msg"; msg.textContent = "";
      fields().forEach(function (x) { if (x) x.removeAttribute("aria-invalid"); });
      var done = function () { busy = false; btn.textContent = "Unlock the tour"; sync(); };
      fetch(CFG.endpoint, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j || {} }; }); })
        .then(function (o) {
          done();
          if (!o.ok) {
            msg.className = "phf-msg err"; msg.textContent = o.j.error || "Something went wrong. Please try again.";
            var bad = o.j.field && f[o.j.field]; if (bad && bad.focus) { bad.setAttribute("aria-invalid", "true"); bad.focus(); }
            return;
          }
          push({ event: "ph_lead_captured", source: "Network operator inquiry" });
          write("ph_operator", { name: body.name, email: body.email, ts: Date.now() });
          var lead = read("ph_lead");
          if (!lead) { lead = { name: body.name, email: body.email, company: "", source: "Network operator inquiry", ts: Date.now() }; write("ph_lead", lead); }
          try { window.dispatchEvent(new CustomEvent("ph:lead", { detail: lead })); } catch (x) {}
          showIn(body.name); mountTour();
          var h = $("phf-in-h"); if (h) h.focus({ preventScroll: true });
        })
        .catch(function () { done(); msg.className = "phf-msg err"; msg.textContent = "Something went wrong. Please try again."; });
    });
    // Returning visitors: an inquiry already made (ph_operator) skips the gate; an industry lead pre-fills name and email.
    var fr = read("ph_operator"), il = read("ph_lead");
    if (fr) { showIn(fr.name); mountTour(); }
    else if (il) { if (il.name) form.elements.name.value = il.name; form.elements.email.value = il.email; }
    sync();
  }

  /* ---------- Anchors: #tour focuses the first empty field; the header's Arrange A Demo goes to #tour here ---------- */
  function headerDemo(a) {
    if (!a.closest(".elementor-location-header, header")) return false;
    return /arrange\s+a\s+demo/i.test(a.textContent || "");
  }
  [].slice.call(document.querySelectorAll("a")).forEach(function (a) {
    if (!root.contains(a) && headerDemo(a)) { a.setAttribute("href", "#tour"); a.removeAttribute("onclick"); a.removeAttribute("target"); a.setAttribute("data-phf-demo", "1"); }
  });
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a[href='#tour']") : null;
    if (!a) return;
    e.preventDefault();
    var t = $("tour"); if (!t) return;
    try { t.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }); } catch (x) { t.scrollIntoView(); }
    try { history.replaceState(null, "", "#tour"); } catch (x) {}
    focusFirstEmpty();
  });
  if (location.hash === "#tour") setTimeout(focusFirstEmpty, 0);
})();
