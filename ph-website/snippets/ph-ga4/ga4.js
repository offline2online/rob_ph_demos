/* PH GA4 key events (snippet PH GA4, see main.php). No names, emails or company names are ever sent from here. */
(function () {
  "use strict";
  if (window.__phGa4) return;
  window.__phGa4 = 1;
  var CFG = window.PH_GA4 || {}, KEY = "ph_ga4_ind", fired = {};
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ""; localStorage.setItem(k, v); } catch (e) { return ""; } }
  if (CFG.industry) store(KEY, CFG.industry);
  function gtag() { (window.dataLayer = window.dataLayer || []).push(arguments); }
  var g = function () { (window.gtag || gtag).apply(window, arguments); };
  /* Every key event carries industry: the page's, else the last industry this browser viewed, else "none". */
  function ev(name, params, onceKey) {
    if (onceKey) { if (fired[onceKey]) return; fired[onceKey] = 1; }
    var p = { industry: CFG.industry || store(KEY) || "none", content_type: CFG.contentType || "other" };
    for (var k in params || {}) if (params[k] !== undefined && params[k] !== "") p[k] = params[k];
    g("event", name, p);
  }
  window.PH_GA4_EVENT = ev;

  /* industry_page_engaged: on /industries/<slug>/, 30 s of visible time or 75% scroll, once per page view. */
  if (CFG.industry && CFG.contentType === "industry page") {
    var seen = 0, done = false;
    var engaged = function (how) { if (done) return; done = true; ev("industry_page_engaged", { engagement_trigger: how }); };
    var tick = setInterval(function () { if (done) return clearInterval(tick); if (document.visibilityState === "visible" && ++seen >= 30) engaged("time"); }, 1000);
    window.addEventListener("scroll", function () {
      var d = document.documentElement, h = d.scrollHeight - window.innerHeight;
      if (h > 0 && (window.scrollY || d.scrollTop) / h >= 0.75) engaged("scroll");
    }, { passive: true });
  }

  /* The site's own dataLayer pushes (the tour, the calculator and Talk to us forms): there is no GTM to read them, so translate. */
  function handle(o) {
    if (!o || typeof o !== "object" || typeof o.event !== "string") return;
    if (o.event === "ph_tour") {
      var ind = o.industry || CFG.industry || "", base = { industry: ind || undefined, tour_flow: o.flow || undefined };
      if (o.action === "unlock" || o.action === "step") ev("product_tour_start", base, "start:" + ind);
      if (o.action === "complete") ev("product_tour_complete", base, "complete:" + ind + ":" + (o.flow || ""));
      if (o.action === "unlock" && o.via === "tour form") ev("lead_created", { industry: ind || undefined, lead_source: "interactive-product-tour" }, "lead:tour");
    } else if (o.event === "ph_ind_lead") {
      var src = o.ph_form === "business_model" ? "telco-business-model" : "industry-" + (o.ph_industry || CFG.industry || "page");
      ev("lead_created", { industry: o.ph_industry || undefined, lead_source: src }, "lead:" + src);
    }
  }
  var cursor = 0;
  function scan() {
    var dl = window.dataLayer || [];
    for (; cursor < dl.length; cursor++) { try { handle(dl[cursor]); } catch (e) {} }
  }
  scan();
  setInterval(scan, 500);
  document.addEventListener("visibilitychange", scan);

  /* demo_request: Calendly reports a booked meeting to the page that opened it. */
  window.addEventListener("message", function (e) {
    if (e.origin !== "https://calendly.com" || !e.data || e.data.event !== "calendly.event_scheduled") return;
    ev("demo_request", { lead_source: "calendly" }, "demo");
  });

  /* private_offer_request: any link to the AWS Marketplace private-offer request, or an element marked data-ph-cta="private-offer". */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[href*="private-offer"], [data-ph-cta="private-offer"]') : null;
    if (a) ev("private_offer_request", { lead_source: a.getAttribute("data-ph-source") || "aws-marketplace", transport_type: "beacon" });
  }, true);
})();
