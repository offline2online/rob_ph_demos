// TEMPORARY — Staff Kanban tap diagnostic (iPad: tapping "Staff Kanban" in
// the sidebar does nothing, 21 Oct 2026; not reproducible in Chromium or
// WebKit). Remove this file, its <script> tag in index.html and the
// window.__kbDiag calls in app.js once the cause is known.
//
// A classic script loaded before everything else, so it sees start-up errors
// too. Errors are buffered quietly; the banner appears only once someone taps
// Staff Kanban, then lists every step the tap got through and every error.
// Taps pass through the banner (only its close button takes them), so it never
// blocks the controls underneath.
(function () {
  "use strict";
  var lines = [];
  var errors = [];
  var shown = false;
  var box = null;
  var t0 = 0;

  function stamp() { return t0 ? "+" + Math.round(performance.now() - t0) + "ms " : ""; }
  function describe(el) {
    if (!el || !el.tagName) return String(el);
    var s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.classList && el.classList.length) s += "." + Array.prototype.slice.call(el.classList, 0, 3).join(".");
    return s;
  }
  // Drawn only once the tap has been quiet for a while: drawing during the
  // tap is itself a visible change, which iPad WebKit answers by dropping the
  // tap's click (the first build of this file did exactly that).
  var drawTimer = 0;
  function render() {
    if (!shown) return;
    clearTimeout(drawTimer);
    drawTimer = setTimeout(draw, 1500);
  }
  function draw() {
    if (!box) {
      box = document.createElement("div");
      box.id = "kb-diag";
      box.setAttribute("role", "status");
      box.style.cssText = "position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483647;max-height:45vh;overflow:auto;" +
        "background:var(--bg,#fff);color:var(--text,#232628);border:1px solid var(--border,#d9d9d9);border-left:4px solid var(--primary,#169bc2);" +
        "border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);padding:10px 40px 10px 12px;" +
        "pointer-events:none;font:12px/1.45 Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif;white-space:pre-wrap;word-break:break-word;";
      var close = document.createElement("button");
      close.type = "button";
      close.setAttribute("aria-label", "Close diagnostic");
      close.style.cssText = "position:absolute;top:6px;right:6px;width:32px;height:32px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;pointer-events:auto;";
      close.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true" style="font-size:20px">close</span>';
      close.addEventListener("click", function () { box.hidden = true; });
      box.appendChild(close);
      box.appendChild(document.createElement("div"));
      (document.body || document.documentElement).appendChild(box);
    }
    box.hidden = false;
    var body = "Staff Kanban diagnostic — screenshot this\n" + navigator.userAgent + "\n" +
      "viewport " + window.innerWidth + "×" + window.innerHeight + "\n\n" + lines.join("\n");
    if (errors.length) body += "\n\nErrors:\n" + errors.join("\n");
    box.lastChild.textContent = body;
  }
  function step(text) { lines.push(stamp() + text); if (lines.length > 60) lines.shift(); render(); }
  function error(text) { errors.push(stamp() + text); if (errors.length > 30) errors.shift(); render(); }

  window.addEventListener("error", function (e) {
    if (e && e.target && e.target !== window && e.target.tagName) { error("resource failed: " + describe(e.target) + " " + (e.target.src || e.target.href || "")); return; }
    error((e && e.message) + (e && e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ":" + e.colno + ")" : ""));
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    error("unhandled rejection: " + (r && (r.stack || r.message) ? String(r.message || r) + (r.code ? " [" + r.code + "]" : "") : String(r)));
  });

  // What the finger actually lands on: any touch/click on the button, or
  // inside its box but landing on something else (an overlay above it).
  function onButton(e) {
    var btn = document.getElementById("staff-kanban-btn");
    if (!btn) return false;
    if (e.target && btn.contains(e.target)) return true;
    var p = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
    if (typeof p.clientX !== "number") return false;
    var r = btn.getBoundingClientRect();
    return p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom;
  }
  ["pointerdown", "touchstart", "touchend", "pointerup", "click"].forEach(function (type) {
    document.addEventListener(type, function (e) {
      if (!onButton(e)) return;
      if (type === "pointerdown" || (type === "touchstart" && !t0)) { t0 = performance.now(); lines = []; }
      shown = true;
      var p = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : e;
      var top = typeof p.clientX === "number" ? document.elementFromPoint(p.clientX, p.clientY) : null;
      step(type + " on " + describe(e.target) + (top && top !== e.target ? " · top element " + describe(top) : "") +
        (e.defaultPrevented ? " · defaultPrevented" : "") + (e.pointerType ? " · " + e.pointerType : "") +
        (type === "click" ? (e.isTrusted ? " · from the browser" : " · sent by the console's touch fallback") : ""));
      if (type === "click") {
        setTimeout(function () {
          var page = document.getElementById("staff-kanban-page");
          var board = document.getElementById("projects-root");
          var view = document.getElementById("kb-view");
          step("after 2s: hash=" + (location.hash || "(none)") + " · kanban page " + (page ? (page.hidden ? "HIDDEN" : "shown") : "missing") +
            " · agent board " + (board ? (board.hidden ? "hidden" : "SHOWN") : "missing") +
            " · board cards " + document.querySelectorAll(".kb-card").length + " · kb-view children " + (view ? view.children.length : "missing"));
        }, 2000);
      }
    }, true);
  });

  window.__kbDiag = step;
  window.__kbDiagError = error;
})();
