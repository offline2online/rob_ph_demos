(function () {
  "use strict";
  var body = document.body;
  if (!body || !body.classList.contains("ph-blog")) return;

  /* reading progress */
  var prog = document.createElement("div");
  prog.className = "ph-blog-prog";
  prog.setAttribute("aria-hidden", "true");
  body.appendChild(prog);
  var art = document.querySelector(".ph-blog-body");
  function onScroll() {
    if (!art) return;
    var r = art.getBoundingClientRect();
    var p = Math.min(1, Math.max(0, (window.innerHeight * 0.4 - r.top) / Math.max(1, r.height)));
    prog.style.width = (p * 100) + "%";
  }
  window.addEventListener("scroll", onScroll, {passive: true});
  window.addEventListener("resize", onScroll);
  onScroll();

  /* sticky menu sits below whatever fixed or sticky header covers the top of the page */
  var lastTop = -1;
  function setTop() {
    var top = 0;
    for (var n = 0; n < 4; n++) {
      var el = document.elementFromPoint(window.innerWidth / 2, top + 2), hit = 0;
      while (el && el !== document.body && el !== document.documentElement) {
        var p = getComputedStyle(el).position;
        if (p === "fixed" || p === "sticky") { hit = el.getBoundingClientRect().bottom; break; }
        el = el.parentElement;
      }
      if (hit <= top) break;
      top = hit;
    }
    top = Math.round(top + 16);
    if (top !== lastTop) { lastTop = top; document.documentElement.style.setProperty("--ph-blog-top", top + "px"); }
  }
  var tq = false;
  window.addEventListener("scroll", function () { if (tq) return; tq = true; requestAnimationFrame(function () { tq = false; setTop(); }); }, {passive: true});
  window.addEventListener("resize", setTop);
  window.addEventListener("load", setTop);
  setTop();

  /* article menu: section filter */
  var menu = document.querySelector(".ph-blog-menu");
  if (menu) {
    var list = menu.querySelector(".ph-blog-mlist");
    var items = [].slice.call(list.querySelectorAll(".ph-blog-mi"));
    var sec = menu.querySelector("#ph-blog-section");
    var empty = menu.querySelector(".ph-blog-empty");
    var count = menu.querySelector(".ph-blog-count");
    var KEY = "phblog-menu";
    var save = function () { try { sessionStorage.setItem(KEY, JSON.stringify({d: sec.value})); } catch (e) {} };
    var apply = function () {
      var d = sec.value, shown = 0;
      items.sort(function (a, b) { return a.dataset.i - b.dataset.i; }).forEach(function (it) {
        var on = d === "all" || it.dataset.desk === d;
        it.hidden = !on;
        if (on) shown++;
        list.appendChild(it);
      });
      empty.hidden = shown > 0;
      if (count) count.textContent = shown + (shown === 1 ? " article" : " articles");
    };
    var has = function (el, v) { return !!el.querySelector('option[value="' + String(v).replace(/[^a-z]/g, "") + '"]'); };
    try { var st = JSON.parse(sessionStorage.getItem(KEY) || "null"); if (st) { if (has(sec, st.d)) sec.value = st.d; } } catch (e) {}
    var q = new URLSearchParams(location.search).get("section");
    if (q && has(sec, q)) sec.value = q;
    var showCur = function () {
      var cur = list.querySelector('[aria-current="page"]');
      if (cur && !cur.hidden && list.scrollHeight > list.clientHeight) list.scrollTop = Math.max(0, cur.offsetTop - list.clientHeight / 3);
      else list.scrollTop = 0;
    };
    sec.addEventListener("change", function () { apply(); save(); showCur(); });
    apply();
    showCur();

    /* thin custom scroll indicator, as in the mock-up */
    var bar = menu.querySelector(".ph-blog-sbar");
    if (bar) {
      var th = bar.firstElementChild, t;
      var max = function () { return list.scrollHeight - list.clientHeight; };
      var room = function () { return bar.clientHeight - th.offsetHeight; };
      var upd = function (show) {
        var m = max(); bar.hidden = m <= 1; if (m <= 1) return;
        th.style.top = (list.scrollTop / m) * room() + "px";
        if (show) { bar.classList.add("on"); clearTimeout(t); t = setTimeout(function () { bar.classList.remove("on"); }, 900); }
      };
      var to = function (y) { var r = bar.getBoundingClientRect(); list.scrollTop = Math.min(1, Math.max(0, (y - r.top - th.offsetHeight / 2) / room())) * max(); };
      list.addEventListener("scroll", function () { upd(true); }, {passive: true});
      bar.addEventListener("pointerdown", function (e) { e.preventDefault(); bar.setPointerCapture(e.pointerId); bar.classList.add("drag"); to(e.clientY); });
      bar.addEventListener("pointermove", function (e) { if (bar.hasPointerCapture(e.pointerId)) to(e.clientY); });
      var end = function (e) { bar.classList.remove("drag"); try { bar.releasePointerCapture(e.pointerId); } catch (err) {} };
      bar.addEventListener("pointerup", end); bar.addEventListener("pointercancel", end);
      window.addEventListener("resize", function () { upd(false); });
      sec.addEventListener("change", function () { upd(false); });
      requestAnimationFrame(function () { upd(false); });
    }
  }

  /* copy-prompt buttons */
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".ph-blog-copy") : null;
    if (!b) return;
    var pre = b.closest(".ph-blog-prompt").querySelector("pre");
    var done = function () { var t = b.textContent; b.textContent = "Copied"; setTimeout(function () { b.textContent = t; }, 1800); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(pre.innerText).then(done, function () {});
  });

  /* RevOps: series and read-next clicks */
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest(".ph-blog-series a, .ph-blog-snav a, .ph-blog-rn a, .ph-blog-mi") : null;
    if (!a) return;
    try { (window.dataLayer = window.dataLayer || []).push({event: "ph_blog_nav", ph_blog_target: a.getAttribute("href"), ph_blog_from: location.pathname, ph_blog_block: a.closest(".ph-blog-series, .ph-blog-snav") ? "series" : a.closest(".ph-blog-rn") ? "read_next" : "menu"}); } catch (err) {}
  }, true);
})();
