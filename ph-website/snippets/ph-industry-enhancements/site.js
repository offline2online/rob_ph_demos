(function () {
  "use strict";
  var CAL = "https://calendly.com/rob-offline2online/30min" + "?" + "hide_gdpr_banner=1" + "&" + "primary_color=179bc2";
  function isDemo(a) {
    var h = a.getAttribute("href") || "", oc = a.getAttribute("onclick") || "";
    if (oc.indexOf("Calendly.initPopupWidget") > -1) return true;
    return h.indexOf("elementor-action") > -1 && h.indexOf("eyJpZCI6IjI2NTgi") > -1 && !!a.closest(".ph-ind-sec, .ph-ind-sec-hero, .ph-blog-band, .elementor-location-footer, .elementor-location-header");
  }
  window.addEventListener("click", function (e) {
    var a = e.target && e.target.closest ? e.target.closest("a") : null;
    if (!a || !isDemo(a)) return;
    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    var sec = a.closest(".ph-ind-sec, .ph-ind-sec-hero");
    if (sec) { try { (window.dataLayer = window.dataLayer || []).push({event: "ph_ind_cta", ph_industry: window.PH_IND_PAGE || "", ph_cta: "demo", ph_section: [].indexOf.call(document.querySelectorAll(".ph-ind-sec, .ph-ind-sec-hero"), sec)}); } catch (err) {} }
    if (window.Calendly && typeof window.Calendly.initPopupWidget === "function") { window.Calendly.initPopupWidget({url: CAL}); }
    else { window.open(CAL, "_blank", "noopener"); }
  }, true);
})();
