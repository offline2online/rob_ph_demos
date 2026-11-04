/* PH Support Centre: the Help Centre's interactions on the server-rendered pages.
   Ports of search-box.js (live dropdown), copy-block.js (one-click copy, long blocks collapsed)
   and page-article.js's section picker. Pages work without this file; it only enhances them. */
(function () {
  "use strict";
  var root = document.querySelector("main.ph-sc");
  if (!root) return;
  var ICONS = {"content_copy":"M360-240q-33 0-56.5-23.5T280-320v-480q0-33 23.5-56.5T360-880h360q33 0 56.5 23.5T800-800v480q0 33-23.5 56.5T720-240H360Zm0-80h360v-480H360v480ZM200-80q-33 0-56.5-23.5T120-160v-560h80v560h440v80H200Zm160-240v-480 480Z","check":"M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z","expand_more":"M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z","expand_less":"m296-345-56-56 240-240 240 240-56 56-184-184-184 184Z","chevron_right":"M530-481 332-679l43-43 241 241-241 241-43-43 198-198Z"};
  var icon = function (n, s) { return '<svg class="icon" width="' + s + '" height="' + s + '" viewBox="0 -960 960 960" aria-hidden="true" focusable="false"><path fill="currentColor" d="' + ICONS[n] + '"/></svg>'; };
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); };
  function track(name, params) {
    window.dataLayer = window.dataLayer || [];
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
    else window.dataLayer.push(Object.assign({ event: name }, params || {}));
  }

  /* ---------- search: same scoring as the server (title, keywords, question variants, summary) ---------- */
  /* Question words and filler are dropped ("how do I add a store" searches "add store"); a query of only such words is searched as typed. */
  var STOP = {};
  "a an the and or of to in on for with at by from about into is are am be do does did can could should would will how what when where which who why i my me we our us you your it its this that these those there please".split(" ").forEach(function (w) { STOP[w] = 1; });
  function searchTerms(q) {
    var terms = String(q || "").toLowerCase().split(/\s+/).map(function (t) { return t.replace(/^[\s?!.,;:"'()]+|[\s?!.,;:"'()]+$/g, ""); }).filter(function (t) { return t.length > 1; });
    var kept = terms.filter(function (t) { return !STOP[t]; });
    return kept.length ? kept : terms;
  }
  function searchArticles(articles, q) {
    var terms = searchTerms(q);
    if (!terms.length) return [];
    var scored = [];
    articles.forEach(function (a, i) {
      var title = (a.t || "").toLowerCase(), summary = (a.s || "").toLowerCase();
      var kws = (a.k || []).map(function (k) { return String(k).toLowerCase(); });
      var qs = (a.q || []).map(function (k) { return String(k).toLowerCase(); });
      var score = 0, all = true;
      for (var j = 0; j < terms.length; j++) {
        var t = terms[j], s = 0;
        if (title.indexOf(t) >= 0) s += title.indexOf(t) === 0 ? 12 : 8;
        if (kws.some(function (k) { return k.indexOf(t) >= 0; })) s += 5;
        if (qs.some(function (k) { return k.indexOf(t) >= 0; })) s += 4;
        if (summary.indexOf(t) >= 0) s += 2;
        if (!s) { all = false; break; }
        score += s;
      }
      if (all) scored.push({ a: a, score: score, i: i });
    });
    return scored.sort(function (x, y) { return y.score - x.score || (x.a.o || 0) - (y.a.o || 0) || x.i - y.i; }).map(function (x) { return x.a; });
  }

  /* The search index (title, url, category, summary, keywords, question variants), fetched once per page. */
  var indexData = null, indexLoading = null;
  function load() {
    if (indexData) return Promise.resolve(indexData);
    if (indexLoading) return indexLoading;
    var u = root.getAttribute("data-index") || "", rel = root.getAttribute("data-release"), h = {};
    if (rel) u += (u.indexOf("?") < 0 ? "?" : "&") + "release=" + encodeURIComponent(rel);
    if (root.getAttribute("data-nonce")) h["X-WP-Nonce"] = root.getAttribute("data-nonce");
    indexLoading = fetch(u, { credentials: "same-origin", headers: h })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (j) { indexData = Array.isArray(j) ? j : []; return indexData; })
      .catch(function () { indexData = []; return indexData; });
    return indexLoading;
  }

  (function initSearch() {
    var input = document.getElementById("faq-search"), results = document.getElementById("faq-search-results");
    if (!input || !results) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", results.id);
    input.setAttribute("aria-autocomplete", "list");
    results.setAttribute("role", "listbox");
    var active = -1, debounce = 0;
    function searchUrl(q) { return (root.getAttribute("data-search") || "") + "?q=" + encodeURIComponent(q.trim()); }
    function close() { results.hidden = true; results.innerHTML = ""; input.setAttribute("aria-expanded", "false"); active = -1; }
    function render(q) {
      if (!q.trim()) { close(); return; }
      load().then(function (articles) {
        if (input.value !== q) return;
        var matches = searchArticles(articles, q);
        active = -1;
        if (!matches.length) {
          results.innerHTML = '<div class="sr-empty">No articles match "' + esc(q) + '".</div>';
        } else {
          var top = matches.slice(0, 8);
          results.innerHTML = top.map(function (a) {
            return '<a role="option" href="' + esc(a.u) + '"><div class="sr-title">' + esc(a.t) + '</div><div class="sr-cat">' + esc(a.c) + "</div></a>";
          }).join("") + (matches.length > top.length ? '<a class="sr-more" href="' + esc(searchUrl(q)) + '">See all ' + matches.length + " results</a>" : "");
        }
        results.hidden = false;
        input.setAttribute("aria-expanded", "true");
      });
    }
    function highlight(delta) {
      var items = [].slice.call(results.querySelectorAll("a"));
      if (!items.length) return;
      active = (active + delta + items.length) % items.length;
      items.forEach(function (el, i) { el.classList.toggle("sr-active", i === active); });
      items[active].scrollIntoView({ block: "nearest" });
    }
    input.addEventListener("input", function () { clearTimeout(debounce); debounce = setTimeout(function () { render(input.value); }, 60); });
    input.addEventListener("focus", function () { load(); if (input.value.trim()) render(input.value); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); highlight(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); highlight(-1); }
      else if (e.key === "Enter") {
        var items = results.querySelectorAll("a");
        if (active >= 0 && items[active]) { e.preventDefault(); window.location.href = items[active].getAttribute("href"); }
        else { e.preventDefault(); if (input.value.trim()) showInline(input.value); }
      }
      else if (e.key === "Escape") { close(); input.blur(); }
    });
    /* Enter (or the form submitting some other way) shows the full results on this page; it never navigates away. Without JavaScript the form still goes to /search/?q=. */
    var inline = null, hidden = [];
    function inlineBox() {
      if (inline) return inline;
      var anchor = input.closest("section") || input.closest(".search-wrap");
      inline = document.createElement("div");
      inline.className = "wrap";
      inline.id = "inline-results";
      inline.hidden = true;
      anchor.parentNode.insertBefore(inline, anchor.nextSibling);
      return inline;
    }
    function restore() {
      if (!inline || inline.hidden) return;
      inline.hidden = true; inline.innerHTML = "";
      hidden.forEach(function (el) { el.hidden = false; });
      hidden = [];
    }
    function showInline(q) {
      q = q.trim();
      if (!q) { restore(); return; }
      load().then(function (articles) {
        if (input.value.trim() !== q) return;
        var matches = searchArticles(articles, q), box = inlineBox(), n = matches.length;
        close();
        if (inline.hidden) {
          hidden = [].slice.call(box.parentNode.children).filter(function (el) { return el !== box && el.classList.contains("wrap") && !el.hidden; });
          hidden.forEach(function (el) { el.hidden = true; });
        }
        box.innerHTML = '<h1 id="results-heading" class="results-heading" aria-live="polite" tabindex="-1">' + n + " result" + (n === 1 ? "" : "s") + ' for "' + esc(q) + '"</h1>' +
          (n ? '<div class="article-list" id="results-list">' + matches.map(function (a) {
            return '<a class="article-row" href="' + esc(a.u) + '"><span class="row-main"><h3>' + esc(a.t) + '</h3><p><span class="row-cat">' + esc(a.c) + "</span>" + (a.s ? " &middot; " + esc(a.s) : "") + '</p></span><span class="row-chevron">' + icon("chevron_right", 20) + "</span></a>";
          }).join("") + "</div>" : '<p class="empty-hint" id="results-empty">No articles matched your search. Try different words.</p>');
        box.hidden = false;
        try { history.replaceState(null, "", searchUrl(q)); } catch (err) { /* ignore */ }
        track("faq_search", { query: q, results: n });
      });
    }
    if (input.form) input.form.addEventListener("submit", function (e) { e.preventDefault(); if (input.value.trim()) showInline(input.value); });
    input.addEventListener("input", function () { if (!input.value.trim()) restore(); });
    /* The search box is ready to type in as soon as the page loads (front page and results page). */
    if (/^ph-sc-(front|search)$/.test([].slice.call(root.classList).filter(function (c) { return /^ph-sc-/.test(c) && c !== "ph-sc"; })[0] || "") && !location.hash) {
      try { input.focus({ preventScroll: true }); var l = input.value.length; input.setSelectionRange(l, l); } catch (err) { /* ignore */ }
    }
    document.addEventListener("click", function (e) { if (!results.contains(e.target) && e.target !== input) close(); });
    /* Load the index in the background, as the Help Centre preloads index.json, so the first keystroke is instant. */
    (window.requestIdleCallback || function (f) { return setTimeout(f, 300); })(function () { load(); });
  })();

  /* ---------- one-click copy on code blocks, long blocks collapsed behind Show more ---------- */
  var seq = 0;
  function blockText(pre) { var code = pre.querySelector("code"); return (code || pre).textContent.replace(/\n$/, ""); }
  function copyText(text, sourceEl) {
    var fallback = function () {
      try {
        var ta = document.createElement("textarea");
        ta.value = text; ta.setAttribute("readonly", ""); ta.setAttribute("aria-hidden", "true"); ta.className = "ph-sc-scratch";
        document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
        var ok = document.execCommand && document.execCommand("copy");
        ta.remove();
        if (ok) return true;
      } catch (err) { /* fall through */ }
      try {
        var range = document.createRange(); range.selectNodeContents(sourceEl);
        var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
      } catch (err) { /* ignore */ }
      return false;
    };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return Promise.resolve(fallback());
  }
  function initCollapse(wrap, pre) {
    if ((pre.getAttribute("data-collapse") || "").trim().toLowerCase() === "false") return;
    var lines = parseInt(pre.getAttribute("data-collapse-lines"), 10) || 4;
    var cs = getComputedStyle(pre);
    var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
    var maxPx = Math.round(lines * lh + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom));
    pre.style.setProperty("--copy-collapsed-max", maxPx + "px");
    if (!pre.id) pre.id = "copy-block-" + (++seq);
    var foot = document.createElement("div"); foot.className = "copy-block-foot";
    var toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "copy-btn copy-toggle"; toggle.setAttribute("aria-controls", pre.id);
    foot.appendChild(toggle); wrap.appendChild(foot);
    var expanded = false;
    var paint = function () {
      wrap.classList.toggle("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.innerHTML = icon(expanded ? "expand_less" : "expand_more", 16) + '<span class="copy-btn-label">' + (expanded ? "Show less" : "Show more") + "</span>";
    };
    var measure = function () {
      if (expanded) return;
      wrap.classList.remove("is-collapsible");
      wrap.classList.toggle("is-collapsible", pre.scrollHeight > maxPx + 2);
    };
    toggle.addEventListener("click", function () {
      expanded = !expanded; paint();
      if (!expanded) { measure(); if (wrap.getBoundingClientRect().top < 0) wrap.scrollIntoView({ block: "start" }); }
    });
    paint(); measure();
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(wrap); else window.addEventListener("resize", measure);
  }
  var body = root.querySelector(".article-body");
  if (body) {
    body.querySelectorAll("pre").forEach(function (pre) {
      if (pre.closest(".copy-block") || !blockText(pre).trim()) return;
      var label = (pre.getAttribute("data-copy-label") || "").trim() || "Copy";
      var wrap = document.createElement("div"); wrap.className = "copy-block";
      var bar = document.createElement("div"); bar.className = "copy-block-bar";
      var btn = document.createElement("button"); btn.type = "button"; btn.className = "copy-btn"; btn.setAttribute("aria-label", label + " to clipboard");
      var idle = function () { btn.innerHTML = icon("content_copy", 16) + '<span class="copy-btn-label" aria-live="polite">' + esc(label) + "</span>"; };
      idle();
      bar.appendChild(btn);
      var inner = document.createElement("div"); inner.className = "copy-block-body";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(bar); wrap.appendChild(inner); inner.appendChild(pre);
      initCollapse(wrap, pre);
      var timer = null;
      btn.addEventListener("click", function () {
        copyText(blockText(pre), pre).then(function (ok) {
          btn.classList.toggle("is-copied", ok); btn.classList.toggle("is-manual", !ok);
          btn.innerHTML = icon(ok ? "check" : "content_copy", 16) + '<span class="copy-btn-label" aria-live="polite">' + (ok ? "Copied" : "Selected — press Ctrl+C or ⌘C") + "</span>";
          clearTimeout(timer);
          timer = setTimeout(function () { btn.classList.remove("is-copied", "is-manual"); idle(); }, ok ? 2000 : 6000);
          track("faq_copy_block", { article_id: root.getAttribute("data-article") || "", label: label, ok: ok });
        });
      });
    });

    /* ---------- editor-controlled section picker (one block per H2, Related and Next step stay visible) ---------- */
    if (body.getAttribute("data-picker") === "1") {
      var skip = { "related": 1, "next step": 1 };
      var h2s = [].slice.call(body.querySelectorAll("h2")).filter(function (h) { return !skip[h.textContent.trim().toLowerCase()]; });
      if (h2s.length >= 2) {
        h2s.forEach(function (h) {
          var wrap = document.createElement("div"); wrap.className = "faq-section"; wrap.setAttribute("data-section", h.textContent.trim());
          h.parentNode.insertBefore(wrap, h);
          var node = h;
          while (node && !(node !== h && node.nodeType === 1 && node.tagName === "H2")) { var next = node.nextSibling; wrap.appendChild(node); node = next; }
        });
        var picker = document.createElement("div"); picker.className = "faq-section-picker";
        picker.innerHTML = '<label for="faq-section-select">' + esc(body.getAttribute("data-picker-label") || "Choose your industry:") + '</label><select id="faq-section-select"><option value="">Show all</option>' +
          h2s.map(function (h) { var o = esc(h.textContent.trim()); return '<option value="' + o + '">' + o + "</option>"; }).join("") + "</select>";
        body.insertBefore(picker, h2s[0].closest(".faq-section"));
        picker.querySelector("select").addEventListener("change", function (e) {
          var chosen = e.target.value;
          body.querySelectorAll(".faq-section").forEach(function (sec) { sec.hidden = !!chosen && sec.getAttribute("data-section") !== chosen; });
          if (chosen) track("faq_section_selected", { article_id: root.getAttribute("data-article") || "", section: chosen });
        });
      }
    }
  }
})();
