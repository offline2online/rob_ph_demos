(function () {
  "use strict";
  var KEY = "ph_industry_click";
  function dl(o) { try { (window.dataLayer = window.dataLayer || []).push(o); } catch (e) {} }
  function read() { try { var v = JSON.parse(localStorage.getItem(KEY) || "null"); return v && v.industry ? v : null; } catch (e) { return null; } }
  // A tile click on the home page: record which industry the visitor chose (kept for 30 days) so a later lead can be attributed to it.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest(".ph-home-ind a[data-ph-industry]") : null;
    if (!a) return;
    var ind = a.getAttribute("data-ph-industry");
    dl({event: "ph_industry_tile", ph_industry: ind, ph_section: "home-industries"});
    try { localStorage.setItem(KEY, JSON.stringify({industry: ind, ts: Date.now()})); } catch (err) {}
  }, true);
  // When a calculator, tour or form lead is captured on an industry page, push which home-page tile that visitor came through.
  window.addEventListener("ph:lead", function () {
    var c = read();
    if (!c || Date.now() - c.ts > 30 * 864e5) return;
    dl({event: "ph_lead_industry_attribution", ph_industry_tile: c.industry, ph_industry: window.PH_IND_PAGE || ""});
  });
})();
