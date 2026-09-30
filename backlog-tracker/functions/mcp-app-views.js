// MCP Apps views for the PH Agent Console — the HTML "Views" behind
// get_ready_for_testing_board and get_approved_for_deployment_board.
//
// WHAT THIS IS
// MCP Apps (SEP-1865, the MCP UI extension `io.modelcontextprotocol/ui`,
// spec 2026-01-26) is how an MCP tool gets interactive UI rendered inline in
// a conversation by Claude (claude.ai, Claude Desktop, the Claude mobile
// apps) and other hosts. The contract has three parts, and every one of
// them has to be right or the host silently shows text only:
//
//   1. The TOOL declares `_meta.ui.resourceUri` — a `ui://` URI (plus the
//      deprecated flat `_meta["ui/resourceUri"]` for older hosts).
//   2. The RESOURCE at that URI is served through `resources/list` and
//      `resources/read` with mimeType `text/html;profile=mcp-app` and its
//      sandbox settings under `_meta.ui` (csp, prefersBorder).
//   3. The HTML is a VIEW: the host loads it into a sandboxed iframe, the
//      view opens the postMessage JSON-RPC handshake (`ui/initialize` →
//      `ui/notifications/initialized`), and the host then pushes the tool's
//      CallToolResult to it as `ui/notifications/tool-result` — the view
//      renders from `structuredContent`. Nothing is rendered from a content
//      block in the tool result itself.
//
// WHY IT EXISTS (30 Sep 2026)
// The first cut of these two tools (tickets ZXmW4lHMKpQRlarlwK7z and
// f1yOqE2Sx2q8D7MSvfDu, PR #208, 24 Sep 2026) returned the column as an
// EMBEDDED RESOURCE content block — `{ type: "resource", resource: {
// mimeType: "text/html", text } }` inside the tool result — on the
// assumption that "a client that renders embedded HTML resources" would
// show it. No Claude surface does: a plain text/html embedded resource is
// not an MCP App, so claude.ai and Claude Desktop ignored it and Claude
// Code printed the raw markup as text. Nothing ever rendered. This module
// and the matching changes in mcp-server.js replace that with the real
// MCP Apps contract above.
//
// WHAT THE VIEW IS AND ISN'T
// Read-only, same as the two tools. It renders the column as cards (title,
// testSummary/desc, type/area, test link, testVersion, a link back to the
// ticket, and — for Approved for Deployment — train/PR context and the
// deploy-readiness line). Its only actions are opening links through the
// host (`ui/open-link`) and re-running the same read-only tool through the
// host (`tools/call`, only where the host offers `serverTools`) to refresh.
// It has no form, no write, and nothing that could change a ticket's
// status. Every user-authored string (title/desc/testSummary — recall
// backlogItems.desc is not privileged input) reaches the DOM via
// textContent, never innerHTML, and a URL becomes a clickable href only when
// it parses as https:// (the server already nulls anything else in
// structuredContent; the view checks again).
//
// SELF-CONTAINED ON PURPOSE
// One HTML document, inline CSS and inline script, no bundler, no SDK
// import: the MCP Apps default CSP allows inline script/style but no
// external origin unless declared, and a JS bundle served from somewhere
// would be one more thing to deploy and allow. The only external fetch is
// Roboto from Google Fonts (declared in UI_META.csp.resourceDomains, with the
// platform's own fallback stack if a host blocks it) — Roboto is the
// Personalisation Hub type face (ph-designer skill, references/tokens.md) and
// the colours below are its measured tokens, layered over the host's own
// style variables so the card follows Claude's light/dark theme.
"use strict";

const MCP_APP_MIME = "text/html;profile=mcp-app";
const MCP_APPS_PROTOCOL_VERSION = "2026-01-26";
const VIEW_VERSION = "1.4.0";

// Sandbox settings the host reads from the resource's _meta.ui (on the
// resources/read content item, resources/list entry as fallback).
//   csp.resourceDomains → img/script/style/font/media-src: Google Fonts only.
//   No connectDomains: the view never fetches anything itself — all data
//   arrives from the host as the tool result, and a refresh goes back
//   through the host as tools/call.
//   prefersBorder: the host draws the card border/background (Claude renders
//   borderless on web when unset) so the view reads as a card in chat.
const UI_META = {
  prefersBorder: true,
  csp: { resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] },
};

const BOARD_VIEWS = {
  "ready-for-testing": {
    kind: "ready-for-testing",
    uri: "ui://backlog-tracker/ready-for-testing",
    name: "ready_for_testing_board",
    title: "Ready for Testing board",
    description: "MCP App view for get_ready_for_testing_board: the Ready for Testing column as read-only ticket cards, rendered inline by a host that supports MCP Apps.",
    tool: "get_ready_for_testing_board",
    headline: "Ready for Testing",
    countNoun: "waiting on review",
    emptyText: "Nothing in Ready for Testing right now.",
    footnote: "Read-only — approve or reject on the board itself.",
  },
  "approved-for-deployment": {
    kind: "approved-for-deployment",
    uri: "ui://backlog-tracker/approved-for-deployment",
    name: "approved_for_deployment_board",
    title: "Approved for Deployment board",
    description: "MCP App view for get_approved_for_deployment_board: the Approved for Deployment column as read-only ticket cards with train/PR context, rendered inline by a host that supports MCP Apps.",
    tool: "get_approved_for_deployment_board",
    headline: "Approved for Deployment",
    countNoun: "waiting to ship",
    emptyText: "Nothing Approved for Deployment right now.",
    footnote: "Read-only — Deploy to Main stays on the board (or approve_deploy_to_main, admin only).",
  },
};

function viewByUri(uri) {
  return Object.values(BOARD_VIEWS).find((v) => v.uri === uri) || null;
}

// Material Symbols (Outlined) glyphs, inlined as SVG paths so the icon set
// stays the platform's without fetching the icon font.
const ICON_OPEN_IN_NEW = "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z";
const ICON_ARROW_OUTWARD = "M6 6v2h8.59L5 17.59 6.41 19 16 9.41V18h2V6z";
const ICON_REFRESH = "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z";

function boardViewHTML(kind) {
  const view = BOARD_VIEWS[kind];
  if (!view) throw new Error(`unknown board view: ${kind}`);
  const config = JSON.stringify({
    kind,
    tool: view.tool,
    headline: view.headline,
    countNoun: view.countNoun,
    emptyText: view.emptyText,
    footnote: view.footnote,
    version: VIEW_VERSION,
    protocolVersion: MCP_APPS_PROTOCOL_VERSION,
    icons: { open: ICON_OPEN_IN_NEW, arrow: ICON_ARROW_OUTWARD, refresh: ICON_REFRESH },
  }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${view.title} — PH Agent Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<style id="host-fonts"></style>
<style>
  :root {
    /* Personalisation Hub tokens (ph-designer references/tokens.md) */
    --ph-primary: #169bc2;
    --ph-primary-accent: #38b0cf;
    --ph-primary-tint: rgba(22, 155, 194, 0.10);
    --ph-font: Roboto, "Helvetica Neue", Helvetica, Arial, sans-serif;
    /* Structural colours follow the host's style variables when it provides
       them (light/dark), with the platform's measured light values as the
       fallback. */
    --bg: var(--color-background-primary, #ffffff);
    --bg-alt: var(--color-background-secondary, #f5f5f5);
    --text: var(--color-text-primary, #333333);
    --text-2: var(--color-text-secondary, rgba(0, 0, 0, 0.65));
    --muted: var(--color-text-tertiary, rgba(0, 0, 0, 0.45));
    --border: var(--color-border-tertiary, #d9d9d9);
    --ok-text: var(--color-text-success, #389e0d);
    --ok-bg: var(--color-background-success, #f6ffed);
    --ok-border: var(--color-border-success, #b7eb8f);
    --wait-text: var(--color-text-warning, #ad6800);
    --wait-bg: var(--color-background-warning, #fffbe6);
    --wait-border: var(--color-border-warning, #ffe58f);
    --err-text: var(--color-text-danger, #cf1322);
    --err-bg: var(--color-background-danger, #fff1f0);
    --err-border: var(--color-border-danger, #ffa39e);
    --radius-card: 8px;
    --radius-control: 6px;
    color-scheme: light;
  }
  :root[data-theme="dark"] {
    --bg: var(--color-background-primary, #30302e);
    --bg-alt: var(--color-background-secondary, #262624);
    --text: var(--color-text-primary, #faf9f5);
    --text-2: var(--color-text-secondary, #c2c0b6);
    --muted: var(--color-text-tertiary, #9c9a92);
    --border: var(--color-border-tertiary, rgba(222, 220, 209, 0.25));
    --ok-text: var(--color-text-success, #7ab948);
    --ok-bg: var(--color-background-success, #1b4614);
    --ok-border: var(--color-border-success, #599130);
    --wait-text: var(--color-text-warning, #d1a041);
    --wait-bg: var(--color-background-warning, #483a0f);
    --wait-border: var(--color-border-warning, #a87829);
    --err-text: var(--color-text-danger, #ee8884);
    --err-bg: var(--color-background-danger, #602a28);
    --err-border: var(--color-border-danger, #cd5c58);
    color-scheme: dark;
  }
  html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text); }
  body {
    font: 14px/1.45 var(--ph-font);
    -webkit-font-smoothing: antialiased;
    overflow-wrap: anywhere;
  }
  .board { padding: 2px 2px 6px; }
  .board-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .board-head h1 { font-size: 16px; font-weight: 700; margin: 0 0 2px; line-height: 1.3; }
  .count { margin: 0; font-size: 14px; color: var(--text); }
  .count b { font-weight: 700; }
  .count.muted { font-size: 13px; }
  .muted { color: var(--muted); }
  .btn-text {
    display: inline-flex; align-items: center; gap: 4px; flex: none;
    height: 32px; padding: 0 10px; border: 0; border-radius: var(--radius-control);
    background: transparent; color: var(--ph-primary); font: 500 13px/1 var(--ph-font);
    cursor: pointer;
  }
  .btn-text:hover { background: var(--ph-primary-tint); }
  .btn-text:disabled { opacity: 0.6; cursor: default; }
  .banner {
    font-size: 13px; font-weight: 500; line-height: 1.4;
    padding: 8px 12px; border-radius: var(--radius-control); margin-bottom: 12px;
    border: 1px solid transparent;
  }
  .banner.ok { color: var(--ok-text); background: var(--ok-bg); border-color: var(--ok-border); }
  .banner.wait { color: var(--wait-text); background: var(--wait-bg); border-color: var(--wait-border); }
  .banner.error { color: var(--err-text); background: var(--err-bg); border-color: var(--err-border); }
  .card {
    border: 1px solid var(--border); border-radius: var(--radius-card);
    padding: 12px 14px; margin-bottom: 10px; background: var(--bg);
  }
  .card h2 { font-size: 14px; font-weight: 700; margin: 0 0 4px; line-height: 1.35; }
  .card .meta { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
  .card .body { font-size: 13px; line-height: 1.45; white-space: pre-wrap; margin-bottom: 8px; color: var(--text); }
  .card details { margin-bottom: 8px; }
  .card summary { cursor: pointer; font-size: 12px; color: var(--ph-primary); }
  .card details .body { margin-top: 6px; margin-bottom: 0; }
  .pills { margin-bottom: 4px; }
  .pill {
    display: inline-block; font-size: 11px; font-weight: 500; line-height: 1;
    padding: 4px 8px; border-radius: 9999px; margin: 0 6px 6px 0;
    border: 1px solid transparent;
  }
  .pill.accent { background: var(--ph-primary-tint); color: var(--ph-primary); }
  .pill.primary { background: var(--ph-primary); color: #ffffff; }
  .pill.neutral { border-color: var(--border); color: var(--text-2); }
  .actions { display: flex; flex-wrap: wrap; gap: 0 14px; align-items: center; }
  .actions a {
    display: inline-flex; align-items: center; gap: 4px; min-height: 32px;
    text-decoration: none; font-weight: 500; font-size: 13px;
  }
  .actions a.primary { color: var(--ph-primary); }
  .actions a.quiet { color: var(--muted); font-size: 12px; font-weight: 400; }
  .actions a:hover { text-decoration: underline; }
  .icon { width: 16px; height: 16px; fill: currentColor; flex: none; }
  .empty { font-size: 13px; color: var(--muted); padding: 4px 0 8px; }
  .foot { font-size: 12px; color: var(--muted); margin: 2px 0 0; }
  .skeleton .line { height: 12px; border-radius: 4px; background: var(--bg-alt); margin: 8px 0; }
  .skeleton .line.title { width: 55%; height: 14px; }
  .skeleton .line.short { width: 35%; }
  @media (prefers-reduced-motion: no-preference) {
    .skeleton .line { animation: pulse 1.4s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
  }
</style>
</head>
<body data-kind="${kind}">
<main class="board" id="board">
  <header class="board-head">
    <div>
      <h1 id="headline">${view.headline}</h1>
      <p class="count muted" id="count">Loading the column…</p>
    </div>
    <button type="button" class="btn-text" id="refresh" hidden>Refresh</button>
  </header>
  <div id="banner" class="banner" hidden role="status"></div>
  <section id="cards" aria-live="polite">
    <div class="card skeleton" aria-hidden="true"><div class="line title"></div><div class="line short"></div><div class="line"></div><div class="line"></div></div>
    <div class="card skeleton" aria-hidden="true"><div class="line title"></div><div class="line short"></div><div class="line"></div></div>
  </section>
  <p class="foot" id="foot"></p>
</main>
<script id="view-config" type="application/json">${config}</script>
<script>
(function () {
  "use strict";
  var CONFIG = JSON.parse(document.getElementById("view-config").textContent);
  var SVG_NS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var nextId = 1;
  var pending = {};
  var hostCaps = {};
  var connected = false;
  var lastInput = {};
  var lastRender = null;

  // ── Host transport: JSON-RPC 2.0 over postMessage to the parent frame ──
  function send(msg) { window.parent.postMessage(msg, "*"); }
  function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }
  function request(method, params) {
    return new Promise(function (resolve, reject) {
      var id = nextId++;
      pending[id] = { resolve: resolve, reject: reject };
      send({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
    });
  }
  function respond(id, result) { send({ jsonrpc: "2.0", id: id, result: result }); }
  function respondError(id, code, message) { send({ jsonrpc: "2.0", id: id, error: { code: code, message: message } }); }

  window.addEventListener("message", function (ev) {
    if (ev.source !== window.parent) return;
    var msg = ev.data;
    if (!msg || msg.jsonrpc !== "2.0") return;
    if (typeof msg.method !== "string") {
      var p = msg.id != null ? pending[msg.id] : null;
      if (!p) return;
      delete pending[msg.id];
      if (msg.error) p.reject(msg.error); else p.resolve(msg.result);
      return;
    }
    var params = msg.params || {};
    switch (msg.method) {
      case "ui/notifications/tool-input":
      case "ui/notifications/tool-input-partial":
        if (params.arguments && typeof params.arguments === "object") lastInput = params.arguments;
        break;
      case "ui/notifications/tool-result":
        renderResult(params);
        break;
      case "ui/notifications/tool-cancelled":
        showBanner("error", "The tool call was cancelled" + (params.reason ? " (" + params.reason + ")" : "") + ".");
        break;
      case "ui/notifications/host-context-changed":
        applyHostContext(params);
        break;
      case "ui/resource-teardown":
        respond(msg.id, {});
        break;
      default:
        if (msg.id != null) respondError(msg.id, -32601, "Method not found: " + msg.method);
    }
  });

  // ── Host context: theme, style variables, fonts, safe areas ────────────
  function applyHostContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    if (ctx.theme === "dark" || ctx.theme === "light") document.documentElement.setAttribute("data-theme", ctx.theme);
    var styles = ctx.styles || {};
    var vars = styles.variables || {};
    Object.keys(vars).forEach(function (key) {
      if (key.indexOf("--") === 0 && typeof vars[key] === "string") document.documentElement.style.setProperty(key, vars[key]);
    });
    if (styles.css && typeof styles.css.fonts === "string") $("host-fonts").textContent = styles.css.fonts;
    var insets = ctx.safeAreaInsets;
    if (insets && typeof insets === "object") {
      $("board").style.padding = [insets.top, insets.right, insets.bottom, insets.left]
        .map(function (n) { return (Number(n) > 0 ? Number(n) : 0) + "px"; }).join(" ");
    }
    sendSize();
  }

  // ── Sizing: the host sizes the iframe to what we report ────────────────
  function sendSize() {
    if (!connected) return;
    var height = Math.ceil(document.documentElement.getBoundingClientRect().height);
    if (height > 0) notify("ui/notifications/size-changed", { height: height });
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(function () { sendSize(); }).observe(document.documentElement);

  // ── Rendering: DOM APIs only — textContent for every string, never markup ─
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }
  function icon(path) {
    var svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "icon");
    var p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", path);
    svg.appendChild(p);
    return svg;
  }
  function safeHref(url) { return typeof url === "string" && /^https:\\/\\//i.test(url) ? url : null; }
  function openLink(href) {
    if (hostCaps.openLinks) {
      request("ui/open-link", { url: href }).catch(function () { window.open(href, "_blank", "noopener"); });
      return true;
    }
    return false;
  }
  function link(href, label, cls, iconPath) {
    var a = el("a", cls, label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.appendChild(icon(iconPath));
    a.addEventListener("click", function (ev) { if (openLink(href)) ev.preventDefault(); });
    return a;
  }
  function pill(label, kind) { return el("span", "pill " + kind, label); }
  function showBanner(kind, text) {
    var b = $("banner");
    b.className = "banner " + kind;
    b.textContent = text;
    b.hidden = !text;
  }

  function card(item) {
    var c = el("article", "card");
    c.appendChild(el("h2", null, item.title || "(untitled)"));
    var meta = el("div", "meta");
    meta.textContent = (item.project ? item.project + " · " : "") + (item.id || "");
    c.appendChild(meta);
    var summary = item.testSummary || item.desc || "";
    c.appendChild(el("div", "body", summary));
    if (item.testSummary && item.desc && item.testSummary !== item.desc) {
      var d = el("details");
      d.appendChild(el("summary", null, "Show original request"));
      d.appendChild(el("div", "body", item.desc));
      c.appendChild(d);
    }
    var pills = el("div", "pills");
    if (item.type) pills.appendChild(pill(item.type === "bug" ? "Bug" : "Feature", "neutral"));
    if (item.category) pills.appendChild(pill(item.category, "neutral"));
    if (item.testVersion) pills.appendChild(pill("Test version: v" + item.testVersion, "accent"));
    if (CONFIG.kind === "approved-for-deployment") {
      if (item.onTrain) pills.appendChild(pill("On train: " + (item.deployBranch || "?"), "primary"));
      else if (item.prNumber) pills.appendChild(pill("PR #" + item.prNumber, "neutral"));
    }
    if (pills.childNodes.length) c.appendChild(pills);
    var actions = el("div", "actions");
    var testHref = safeHref(item.previewUrl);
    if (testHref) actions.appendChild(link(testHref, "Test this", "primary", CONFIG.icons.open));
    var boardHref = safeHref(item.board);
    if (boardHref) actions.appendChild(link(boardHref, "View ticket", "quiet", CONFIG.icons.arrow));
    if (actions.childNodes.length) c.appendChild(actions);
    return c;
  }

  function payloadFrom(result) {
    if (result && result.structuredContent && typeof result.structuredContent === "object") return result.structuredContent;
    // A host that forwards content only: the tool also puts the same JSON
    // in its last text block, so fall back to parsing that.
    var blocks = (result && result.content) || [];
    for (var i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i] && blocks[i].type === "text") {
        try { var parsed = JSON.parse(blocks[i].text); if (parsed && Array.isArray(parsed.items)) return parsed; } catch (e) { /* not JSON */ }
      }
    }
    return null;
  }

  function renderResult(result) {
    var cards = $("cards");
    while (cards.firstChild) cards.removeChild(cards.firstChild);
    if (result && result.isError) {
      var errText = ((result.content || []).filter(function (b) { return b && b.type === "text"; })[0] || {}).text || "The tool returned an error.";
      $("count").textContent = "";
      showBanner("error", errText);
      $("foot").textContent = "";
      sendSize();
      return;
    }
    var data = payloadFrom(result);
    if (!data) {
      showBanner("error", "The tool result carried no board data to render.");
      sendSize();
      return;
    }
    lastRender = data;
    $("headline").textContent = CONFIG.headline + (data.projectLabel ? " — " + data.projectLabel : "");
    var items = Array.isArray(data.items) ? data.items : [];
    var count = $("count");
    count.className = "count";
    while (count.firstChild) count.removeChild(count.firstChild);
    if (items.length) {
      count.appendChild(el("b", null, String(items.length)));
      count.appendChild(document.createTextNode(" " + (items.length === 1 ? "ticket" : "tickets") + " " + CONFIG.countNoun));
    } else {
      count.className = "count muted";
      count.textContent = CONFIG.emptyText;
    }
    if (CONFIG.kind === "approved-for-deployment" && data.readyLine) showBanner(data.readyToDeploy ? "ok" : "wait", data.readyLine);
    else showBanner("", "");
    if (items.length) items.forEach(function (item) { cards.appendChild(card(item)); });
    else cards.appendChild(el("div", "empty", "Nothing to show."));
    $("foot").textContent = CONFIG.footnote;
    $("refresh").hidden = !(hostCaps.serverTools && lastRender);
    sendSize();
  }

  // ── Refresh: re-run the same read-only tool through the host ───────────
  $("refresh").addEventListener("click", function () {
    var btn = $("refresh");
    btn.disabled = true;
    request("tools/call", { name: CONFIG.tool, arguments: lastInput })
      .then(function (res) { renderResult(res); })
      .catch(function (err) { showBanner("error", "Refresh failed: " + ((err && err.message) || "the host refused the call")); })
      .then(function () { btn.disabled = false; });
  });

  // ── Handshake ──────────────────────────────────────────────────────────
  if (window.parent === window) {
    // Opened directly in a browser tab, not inside a host.
    $("count").textContent = "This view renders inside an MCP Apps host (Claude). Ask your agent for " + CONFIG.tool + " and it appears there.";
    var s = $("cards"); while (s.firstChild) s.removeChild(s.firstChild);
    return;
  }
  var waiting = setTimeout(function () { if (!connected) $("count").textContent = "Waiting for the host to connect…"; }, 5000);
  request("ui/initialize", {
    appInfo: { name: "PH Agent Console — " + CONFIG.headline, version: CONFIG.version },
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: CONFIG.protocolVersion,
  }).then(function (result) {
    clearTimeout(waiting);
    connected = true;
    hostCaps = (result && result.hostCapabilities) || {};
    applyHostContext((result && result.hostContext) || {});
    notify("ui/notifications/initialized");
    sendSize();
  }).catch(function (err) {
    clearTimeout(waiting);
    showBanner("error", "The host refused the view: " + ((err && err.message) || "unknown error"));
  });
})();
</script>
</body>
</html>
`;
}

module.exports = { MCP_APP_MIME, MCP_APPS_PROTOCOL_VERSION, VIEW_VERSION, UI_META, BOARD_VIEWS, viewByUri, boardViewHTML };
