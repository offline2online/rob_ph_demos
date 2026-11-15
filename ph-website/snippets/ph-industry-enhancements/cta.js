/* PH floating CTA (cta.php, 15 Nov 2026): one call to action fixed bottom right on every page, in place of the header's "Arrange a Demo".
   window.PH_FLOATING_CTA (printed by cta.php) names the variant decided server-side; this confirms it once the page has loaded, for blocks
   that mount later:
   - request: "Request further information", an <a> to #request-info (the Run Your Own RMN form). Without that form on the page it falls
     back to the page's tour;
   - tour: "Take the guided tour", an <a> to the tour band (.ph-ind-tour, id ph-tour; on the Run Your Own RMN page its #tour section),
     scrolls there and focuses the tour's gate or start button;
   - demo: "Arrange a demo", a <button> opening the header's demo pop-up: window.PH_SITE_DEMO (site.js), else Elementor Pro popup
     PH_FLOATING_CTA.popup, else PH_FLOATING_CTA.href in a new tab.
   A config changed by the ph_floating_cta filter is `locked` and kept as it is. Hidden while its target section is in view
   (IntersectionObserver), in the Elementor editor or preview, and while a tour is full screen; it sits above the cookie banner while that
   is open. Each click pushes dataLayer {event: "ph_floating_cta", variant}: no personal data. */
(function () {
  "use strict";
  var LABELS = { request: "Request further information", tour: "Take the guided tour", demo: "Arrange a demo" };

  function tourEl(doc) {
    var m = doc.querySelector(".ph-ind-tour") || doc.querySelector(".ph-ind-tour-mount"), band = m && (m.closest(".ph-ind-tour") || m);
    if (band) { if (!band.id) band.id = "ph-tour"; return band; } // the same anchor enhance.js gives the band
    var op = doc.getElementById("tour");
    return op && op.classList.contains("phf-sec") ? op : null; // the Run Your Own RMN page's own tour section
  }
  // The variant to show, given the server's config and the page as it is now.
  function resolve(cfg, doc) {
    if (cfg.locked) return { variant: cfg.variant, label: cfg.label, action: cfg.action, target: cfg.target || "" };
    if (cfg.variant === "request" && doc.getElementById("request-info")) return { variant: "request", label: LABELS.request, action: "scroll", target: "#request-info" };
    var t = tourEl(doc);
    if (t) return { variant: "tour", label: LABELS.tour, action: "scroll", target: "#" + t.id };
    return { variant: "demo", label: LABELS.demo, action: "demo", target: "" };
  }
  if (typeof module === "object" && module.exports) { module.exports = { resolve: resolve, LABELS: LABELS }; return; }

  var CFG = window.PH_FLOATING_CTA;
  if (!CFG || CFG.hidden) return;
  function inEditor() {
    var b = document.body;
    if (b && (b.classList.contains("elementor-editor-active") || b.classList.contains("elementor-editor-preview"))) return true;
    if (/[?&](elementor-preview|preview_id|elementor_library)=/.test(location.search)) return true;
    try { if (window.elementorFrontend && window.elementorFrontend.isEditMode && window.elementorFrontend.isEditMode()) return true; } catch (e) {}
    try { return window.self !== window.top && /[?&]elementor-preview=/.test(window.top.location.search); } catch (e) { return false; }
  }
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wrap = null, ctl = null, cur = null, io = null, targetVisible = false, fullScreen = false;

  function push(v) { try { (window.dataLayer = window.dataLayer || []).push({ event: "ph_floating_cta", variant: v }); } catch (e) {} }
  function sync() { if (wrap) wrap.classList.toggle("ph-fcta-off", targetVisible || fullScreen); }

  function focusTour(el) {
    var f = el.querySelector("iframe");
    if (f) {
      var go = function () {
        var d = null; try { d = f.contentDocument; } catch (e) {}
        var g = d && d.getElementById("gate"), shown = g && !g.hidden && g.getClientRects().length > 0;
        var c = d && (shown ? g.querySelector("input:not([type=hidden]), select, button") : (d.getElementById("start") || d.getElementById("play")));
        try { if (c) { f.focus(); c.focus({ preventScroll: true }); return; } } catch (e) {}
        try { f.focus({ preventScroll: true }); } catch (e) { f.focus(); }
      };
      if (f.contentDocument && f.contentDocument.readyState === "complete" && f.contentDocument.body && f.contentDocument.body.childNodes.length) go();
      else { f.addEventListener("load", go, { once: true }); try { f.focus({ preventScroll: true }); } catch (e) {} }
      return;
    }
    focusIn(el);
  }
  function focusIn(el) {
    var c = [].slice.call(el.querySelectorAll("input:not([type=hidden]), select, textarea")).filter(function (x) { return !x.disabled && x.getClientRects().length && !String(x.value || "").trim(); })[0]
      || el.querySelector("input:not([type=hidden]), select, textarea, button, a[href]");
    if (!c) { if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1"); c = el; }
    try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); }
  }
  function scrollTo(e) {
    var id = cur.target.slice(1), t = document.getElementById(id);
    push(cur.variant);
    if (!t) return; // the link's own jump
    if (id === "tour" && t.classList.contains("phf-sec")) return; // operator.js scrolls to #tour and focuses its gate
    e.preventDefault();
    try { t.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }); } catch (x) { t.scrollIntoView(); }
    try { history.replaceState(null, "", cur.target); } catch (x) {}
    if (cur.variant === "tour" || t.querySelector("iframe")) focusTour(t); else focusIn(t);
  }
  function openDemo() {
    push(cur.variant);
    if (typeof window.PH_SITE_DEMO === "function") { window.PH_SITE_DEMO(null); return; } // the header's pop-up (site.js)
    var pop = null;
    try { pop = window.elementorProFrontend && window.elementorProFrontend.modules && window.elementorProFrontend.modules.popup; } catch (e) {}
    if (pop && typeof pop.showPopup === "function") { try { pop.showPopup({ id: CFG.popup }); return; } catch (e) {} }
    window.open(CFG.href, "_blank", "noopener");
  }

  function observe(t) {
    if (io) { io.disconnect(); io = null; }
    targetVisible = false;
    if (t && "IntersectionObserver" in window) {
      io = new IntersectionObserver(function (es) { targetVisible = es[es.length - 1].isIntersecting; sync(); }, { threshold: 0 });
      io.observe(t);
    }
    sync();
  }
  function render(r) {
    if (cur && cur.variant === r.variant && cur.target === r.target && cur.label === r.label && cur.action === r.action) return;
    cur = r;
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ph-fcta";
      wrap.id = "ph-fcta";
      document.body.appendChild(wrap);
    }
    var scroll = r.action === "scroll";
    ctl = document.createElement(scroll ? "a" : "button");
    ctl.className = "ph-fcta-b";
    ctl.textContent = r.label;
    ctl.setAttribute("data-variant", r.variant);
    if (scroll) { ctl.href = r.target; ctl.addEventListener("click", scrollTo); }
    else { ctl.type = "button"; ctl.setAttribute("aria-haspopup", "dialog"); ctl.addEventListener("click", openDemo); }
    wrap.textContent = ""; wrap.appendChild(ctl);
    wrap.setAttribute("data-variant", r.variant);
    observe(scroll ? document.getElementById(r.target.slice(1)) : null);
  }

  // Above the cookie banner (PH Consent's .ph-cc, fixed to the bottom) while it is open; back down once it is gone.
  var ccSeen = null, ro = "ResizeObserver" in window ? new ResizeObserver(function () { lift(); }) : null;
  function lift() {
    if (!wrap) return;
    var cc = document.querySelector(".ph-cc"), h = 0;
    if (cc && cc.getClientRects().length) { var rc = cc.getBoundingClientRect(); h = Math.max(0, Math.round(window.innerHeight - rc.top)); }
    wrap.style.setProperty("--ph-fcta-lift", h + "px");
    if (ro && cc !== ccSeen) { if (ccSeen) ro.unobserve(ccSeen); if (cc) ro.observe(cc); ccSeen = cc; }
  }

  function start() {
    if (inEditor()) return;
    render(resolve(CFG, document));
    lift();
    if ("MutationObserver" in window) new MutationObserver(lift).observe(document.body, { childList: true });
    window.addEventListener("resize", lift);
    // A tour band or form mounted after DOMContentLoaded (enhance.js, a lazy Elementor block): confirm once everything has loaded.
    var again = function () { render(resolve(CFG, document)); lift(); };
    if (document.readyState === "complete") setTimeout(again, 0); else window.addEventListener("load", again);
    // Hidden while a tour is full screen: the Fullscreen API, or the in-page fallback a tour asks for (ph-tour-fullscreen).
    document.addEventListener("fullscreenchange", function () { fullScreen = !!document.fullscreenElement; sync(); });
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (e.origin !== location.origin || !d || d.type !== "ph-tour-fullscreen") return;
      fullScreen = d.on === true; sync();
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
