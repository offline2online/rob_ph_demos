/* PH Run Your Own RMN page (/run-your-own-rmn/, 13 Nov 2026; renamed 14 Nov 2026; an Elementor page from 14 Nov 2026): drives the three
   Shortcode widget blocks on the Elementor page (each a .phf element: [ph_operator_calculator], [ph_operator_tour], [ph_operator_faq]),
   wherever Elementor puts them. The calculator, info tooltips, anchors, the header's "Arrange A Demo" (goes to #tour here), the product
   tour gate and the estimate_rmn_earnings WebMCP tool. A network operator lead posts to ph-site/v1/operator-lead; on success the Run Your
   Own RMN tour (a golf club, /run-your-own-rmn/tour/) is framed in place, unlocked from the stored ph_lead with no second form. The FAQ
   is native <details> and needs no script. Each part runs only when its block is on the page. */
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

  if (!document.querySelector(".phf")) return;
  var $ = function (id) { return document.getElementById(id); };
  var out = function (k) { return document.querySelector('.phf [data-out="' + k + '"]'); };
  var CFG = window.PH_OPERATOR || { endpoint: "/wp-json/ph-site/v1/operator-lead", tour: "/run-your-own-rmn/tour/" };

  /* ---------- Calculator ---------- */
  var IDS = { ven: "c-ven", dis: "c-dis", vis: "c-vis", cpm: "c-cpm", atv: "c-atv", view: "c-view", up: "c-up" };
  function num(el) { var v = Number(el.value); return isNaN(v) || v < 0 ? 0 : v; }
  function update() {
    var s = {};
    Object.keys(IDS).forEach(function (k) { var el = $(IDS[k]); s[k] = el ? num(el) : 0; });
    ["view", "up"].forEach(function (k) { var o = $(IDS[k] + "-v"); if (o) o.textContent = s[k] + "%"; });
    var v = view(calc(s));
    Object.keys(v).forEach(function (k) { var o = out(k); if (o) o.textContent = v[k]; });
  }
  Object.keys(IDS).forEach(function (k) {
    var el = $(IDS[k]); if (!el) return;
    el.addEventListener("input", update);
    el.addEventListener("change", function () { if (el.type === "number" && el.value !== "" && Number(el.value) < 0) el.value = "0"; update(); });
  });
  update();

  /* ---------- Info tooltips: hover and focus (CSS), tap toggles; Escape or a tap elsewhere closes ---------- */
  var tips = [].slice.call(document.querySelectorAll(".phf .phf-tip"));
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
  // Frame the Run Your Own RMN tour (a golf club sells its screens to a golf brand; PH_OPERATOR.tour), mounted the way enhance.js mounts the industry tours: same origin, height and full-screen messages, window.PH_TOUR.
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
  if ($("tour")) [].slice.call(document.querySelectorAll("a")).forEach(function (a) {
    if (!a.closest(".phf") && headerDemo(a)) { a.setAttribute("href", "#tour"); a.removeAttribute("onclick"); a.removeAttribute("target"); a.setAttribute("data-phf-demo", "1"); }
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

  /* ---------- WebMCP: estimate_rmn_earnings (navigator.modelContext.registerTool) ----------
     Drives this page's own calculator inputs and returns exactly the figures the page then shows (never the share constant). It
     submits the tour gate only with the person's own details and their agreement to be contacted, the same rules as the industry
     pages' run_business_model_calculator: it can never do more than the person could on the page. Registered on the page whenever
     the browser offers WebMCP; llms.txt and the twin only point agents at it once the page is live. */
  var LABELS = { yours: "Your potential income a year", venues: "Venues in your network", displays: "Displays in your network", visitors: "Visitors a month across your network", views: "Ad views a month", extraSales: "Extra sales for your venues a year" };
  var RANGES = { ven: [0, 100000], dis: [0, 1000], vis: [0, 1000000], cpm: [0, 1000], atv: [0, 100000], view: [5, 100], up: [0, 50] };
  var INPUT_LABELS = { ven: "Venues", dis: "Displays per venue", vis: "Visitors per venue per day", cpm: "Average CPM (USD)", atv: "Average transaction value (USD)", view: "Visitors who view the ads (%)", up: "Uplift from personalised offers (%)" };
  function figures() { var o = {}; Object.keys(LABELS).forEach(function (k) { var e = out(k); o[k] = e ? e.textContent.trim() : ""; }); return o; }
  function inputs() { var o = {}; Object.keys(IDS).forEach(function (k) { var el = $(IDS[k]); if (el) o[k] = Number(el.value); }); return o; }
  function fire(el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); }
  function toolText(t, extra) { var r = { content: [{ type: "text", text: t }] }; if (extra) r.structuredContent = extra; return r; }
  function toolFail(t) { return { isError: true, content: [{ type: "text", text: t }] }; }
  function estimate(args) {
    args = args || {};
    try { (window.dataLayer = window.dataLayer || []).push({ event: "ph_agent_tool", tool: "estimate_rmn_earnings", source: "webmcp", page_path: location.pathname, referrer: (document.referrer.split("/")[2] || "none").toLowerCase(), at: new Date().toISOString() }); } catch (e) {}
    Object.keys(IDS).forEach(function (k) {
      if (args[k] === undefined || args[k] === null) return;
      var v = Number(args[k]), el = $(IDS[k]); if (!el || !isFinite(v)) return;
      v = Math.max(RANGES[k][0], Math.min(RANGES[k][1], v));
      el.value = String(v); fire(el, "input");
    });
    update();
    var fig = figures(), data = { inputs: inputs(), figures: fig };
    var base = "Calculator filled in on the page. " + Object.keys(LABELS).map(function (k) { return LABELS[k] + ": " + fig[k]; }).join("; ") + ".";
    var wants = ["name", "email", "linkedin", "region", "background", "consent"].some(function (k) { return args[k] !== undefined && args[k] !== "" && args[k] !== false; });
    if (!wants) return Promise.resolve(toolText(base + " To request further information and unlock the product tour, ask the person for their full name, email, where they plan to operate, their background and whether they agree to be contacted, then call again with name, email, region, background and consent. Or they can use the form in the tour section.", data));
    if (args.consent !== true) return Promise.resolve(toolText(base + " Requesting information needs the person's agreement to be contacted (consent=true). Ask them first; nothing was submitted.", data));
    if (!form || mounted) return Promise.resolve(toolText(base + (mounted ? " The product tour is already unlocked on the page." : ""), data));
    var f = form.elements;
    ["name", "email", "linkedin", "region"].forEach(function (k) { if (typeof args[k] === "string") { f[k].value = args[k]; fire(f[k], "input"); } });
    if (typeof args.background === "string") { f.background.value = args.background; fire(f.background, "change"); }
    f.consent.checked = true; fire(f.consent, "change");
    if (!valid() || btn.disabled) return Promise.resolve(toolText(base + " The details were not accepted (check the full name, a valid email, where they plan to operate, a background from the list and an optional LinkedIn address), so nothing was submitted.", data));
    btn.click();
    return new Promise(function (resolve) {
      var n = 0, t = setInterval(function () {
        var err = /\berr\b/.test(msg.className) && msg.textContent;
        if (mounted || err || ++n > 100) {
          clearInterval(t);
          if (mounted) { data.tourUnlocked = true; resolve(toolText(base + " The request was sent and the product tour is unlocked on the page. Our team will follow up with more on becoming a network operator.", data)); }
          else resolve(toolFail(err || "The request did not go through. The person can use the form in the tour section."));
        }
      }, 100);
    });
  }
  var mc = navigator.modelContext;
  if (mc && mc.registerTool && !window.__phRmnMcp && $(IDS.ven)) { // only where the calculator block is on the page
    window.__phRmnMcp = 1;
    var props = {};
    Object.keys(IDS).forEach(function (k) { var el = $(IDS[k]); props[k] = { type: "number", minimum: RANGES[k][0], maximum: RANGES[k][1], description: INPUT_LABELS[k] + " (default " + (el ? el.defaultValue : "") + ")" }; });
    props.name = { type: "string", maxLength: 120, description: "The person's full name, only if they gave it to you to request information" };
    props.email = { type: "string", maxLength: 120, description: "The person's email, only if they gave it to you" };
    props.linkedin = { type: "string", maxLength: 300, description: "Optional: their LinkedIn profile address" };
    props.region = { type: "string", maxLength: 120, description: "Where they plan to operate, only if they told you" };
    props.background = { type: "string", enum: BACKGROUNDS, description: "Their background, only if they told you" };
    props.consent = { type: "boolean", description: "true only if the person has said they agree to be contacted (see the privacy policy). Never assume it." };
    try {
      mc.registerTool({
        name: "estimate_rmn_earnings",
        description: "Estimate what running your own retail media network (RMN) on Personalisation Hub's white-label platform could earn. Fills in this page's benefits calculator (venues, displays per venue, visitors per venue per day, average CPM, average transaction value, the visitors who view the ads and the uplift from personalised offers) and returns the figures the page shows: potential income a year, venues, displays, visitors and ad views a month, and extra sales for the venues. Give any figures you know; the rest keep the page's values. To also request further information and unlock the product tour, pass the person's own full name, email, where they plan to operate, their background and consent=true, only when they have given them to you and agreed to be contacted.",
        inputSchema: { type: "object", properties: props, additionalProperties: false },
        annotations: { readOnlyHint: false },
        execute: estimate
      });
    } catch (e) {}
  }
})();
