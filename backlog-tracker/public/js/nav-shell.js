// Console navigation shell: Build / Publish sidebar, Admin in the profile
// menu, bottom tab bar on phones, and the Command-K jump palette.
//
// Navigation and layout only. Every destination here already existed (the old
// hamburger drawer); this file groups them, adds the persistent/collapsible
// sidebar, and lets the person jump straight to a ticket, concept, project or
// release. It keeps no data of its own: app.js passes in getters and openers.

const COLLAPSE_KEY = "bt-nav-collapsed";
const root = document.documentElement;

function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}
function writeCollapsed(v) {
  try { localStorage.setItem(COLLAPSE_KEY, v ? "1" : "0"); } catch { /* private window */ }
}

// Which sidebar entry is "you are here", from the URL hash app.js maintains.
function activeNavId(hash) {
  const h = (hash || "").split("?")[0];
  if (h === "#skills") return "skills-btn";
  if (h === "#releases") return "releases-btn";
  if (h === "#concept-incubator" || h.startsWith("#concept-")) return "concept-incubator-btn";
  if (h === "#faq-management" || h.startsWith("#faq-article")) return "faq-articles-btn";
  if (h === "#settings") return "faq-settings-btn";
  return "nav-ph-console-btn";
}

// Substring match, then in-order letters ("rdy" finds "ready"); lower score wins.
export function matchScore(query, text) {
  const q = String(query || "").trim().toLowerCase();
  const t = String(text || "").toLowerCase();
  if (!q) return 1;
  const at = t.indexOf(q);
  if (at !== -1) return at === 0 ? 0 : at < 12 ? 1 : 2;
  let i = 0;
  for (const ch of t) if (ch === q[i] && ++i === q.length) return 3;
  return -1;
}

export function searchEntries(entries, query, limit = 30) {
  const scored = [];
  for (const e of entries) {
    const s = Math.min(...[matchScore(query, e.label), matchScore(query, e.hint)].map((x) => (x < 0 ? 99 : x)));
    if (s < 99) scored.push({ e, s });
  }
  scored.sort((a, b) => a.s - b.s || a.e.label.localeCompare(b.e.label));
  return scored.slice(0, limit).map((x) => x.e);
}

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function initNavShell({ getEntries, openEntry, goHome }) {
  const drawer = document.getElementById("nav-drawer");
  const backdrop = document.getElementById("nav-drawer-backdrop");
  const collapseBtn = document.getElementById("nav-collapse-btn");
  const tabbar = document.getElementById("tabbar");
  const profileBtn = document.getElementById("profile-btn");
  const profileMenu = document.getElementById("profile-menu");
  const palette = document.getElementById("cmdk-backdrop");
  const input = document.getElementById("cmdk-input");
  const list = document.getElementById("cmdk-list");
  const mqPersistent = window.matchMedia("(min-width: 1024px)");
  const mqPhone = window.matchMedia("(max-width: 640px)");

  // ── Sidebar: persistent + collapsible on wide screens ──────────────────
  function applyCollapsed(v) {
    if (v) root.setAttribute("data-nav-collapsed", ""); else root.removeAttribute("data-nav-collapsed");
    collapseBtn.setAttribute("aria-expanded", String(!v));
    collapseBtn.setAttribute("aria-label", v ? "Expand sidebar" : "Collapse sidebar");
    document.getElementById("nav-open-btn").setAttribute("aria-expanded", String(!v));
  }
  applyCollapsed(readCollapsed());
  collapseBtn.addEventListener("click", () => {
    const next = !root.hasAttribute("data-nav-collapsed");
    writeCollapsed(next);
    applyCollapsed(next);
  });
  // The hamburger on a wide screen re-opens a collapsed sidebar rather than
  // sliding an overlay over it.
  document.getElementById("nav-open-btn").addEventListener("click", () => {
    if (mqPersistent.matches && root.hasAttribute("data-nav-collapsed")) {
      writeCollapsed(false); applyCollapsed(false);
    }
  }, true);

  // On a phone the Build / Publish tabs open the same list, filtered.
  function showSection(which) {
    drawer.dataset.show = which || "all";
    drawer.classList.add("open");
    backdrop.classList.add("open");
    setTab(which);
  }
  function setTab(which) {
    tabbar.querySelectorAll(".tab").forEach((t) => {
      const on = t.dataset.tab === which;
      t.classList.toggle("active", on);
      if (on) t.setAttribute("aria-current", "true"); else t.removeAttribute("aria-current");
    });
  }

  // Any destination click closes the phone sheet / profile menu.
  drawer.addEventListener("click", (e) => {
    if (e.target.closest(".nav-drawer-item")) { delete drawer.dataset.show; closeProfile(); }
  });
  backdrop.addEventListener("click", () => { delete drawer.dataset.show; closeProfile(); setTab(null); });

  // ── Active destination ─────────────────────────────────────────────────
  function syncActive() {
    const id = activeNavId(window.location.hash);
    drawer.querySelectorAll(".nav-drawer-item").forEach((b) => {
      if (b.id === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    profileMenu.querySelectorAll(".profile-menu-item").forEach((b) => {
      if (b.id === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    const section = id === "faq-articles-btn" ? "publish" : id === "faq-settings-btn" ? "profile" : "build";
    setTab(drawer.classList.contains("open") ? drawer.dataset.show : section);
  }
  window.addEventListener("hashchange", syncActive);
  syncActive();

  // ── Profile / Admin menu ───────────────────────────────────────────────
  function openProfile() {
    profileMenu.hidden = false;
    profileBtn.setAttribute("aria-expanded", "true");
    backdrop.classList.toggle("open", mqPhone.matches);
    setTab("profile");
    const first = profileMenu.querySelector("button");
    if (first) first.focus();
  }
  function closeProfile() {
    if (profileMenu.hidden) return;
    profileMenu.hidden = true;
    profileBtn.setAttribute("aria-expanded", "false");
    if (!drawer.classList.contains("open")) backdrop.classList.remove("open");
    syncActive();
  }
  profileBtn.addEventListener("click", () => (profileMenu.hidden ? openProfile() : closeProfile()));
  profileMenu.addEventListener("click", (e) => { if (e.target.closest("button")) closeProfile(); });
  document.addEventListener("click", (e) => {
    if (!profileMenu.hidden && !e.target.closest("#profile-menu, #profile-btn, #tabbar")) closeProfile();
  });

  // ── Command-K palette ──────────────────────────────────────────────────
  let results = [];
  let active = 0;
  let returnFocus = null;
  function renderResults() {
    results = searchEntries(getEntries(), input.value);
    if (active >= results.length) active = Math.max(0, results.length - 1);
    if (!results.length) {
      list.innerHTML = `<li class="cmdk-empty" role="presentation">No matches</li>`;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    list.innerHTML = results.map((r, i) =>
      `<li role="option" id="cmdk-opt-${i}" class="cmdk-row${i === active ? " active" : ""}" aria-selected="${i === active}" data-i="${i}">
         <span class="cmdk-kind">${esc(r.kind)}</span>
         <span class="cmdk-label">${esc(r.label)}</span>
         ${r.hint ? `<span class="cmdk-hint">${esc(r.hint)}</span>` : ""}
       </li>`).join("");
    input.setAttribute("aria-activedescendant", `cmdk-opt-${active}`);
    const row = document.getElementById(`cmdk-opt-${active}`);
    if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
  }
  function openPalette() {
    if (!palette.hidden) return;
    returnFocus = document.activeElement;
    closeProfile();
    palette.hidden = false;
    input.value = "";
    active = 0;
    renderResults();
    setTab("search");
    input.focus();
  }
  function closePalette() {
    if (palette.hidden) return;
    palette.hidden = true;
    syncActive();
    if (returnFocus && returnFocus.focus) returnFocus.focus();
  }
  function choose(i) {
    const r = results[i];
    if (!r) return;
    closePalette();
    openEntry(r);
  }
  input.addEventListener("input", () => { active = 0; renderResults(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); active = Math.min(results.length - 1, active + 1); renderResults(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(0, active - 1); renderResults(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(active); }
  });
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".cmdk-row");
    if (row) choose(Number(row.dataset.i));
  });
  list.addEventListener("mousemove", (e) => {
    const row = e.target.closest(".cmdk-row");
    if (row && Number(row.dataset.i) !== active) { active = Number(row.dataset.i); renderResults(); }
  });
  palette.addEventListener("mousedown", (e) => { if (e.target === palette) closePalette(); });
  document.getElementById("cmdk-close").addEventListener("click", closePalette);
  // Keep focus inside the dialog while it is open.
  palette.addEventListener("keydown", (e) => {
    if (e.key === "Tab") { e.preventDefault(); input.focus(); }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (palette.hidden) openPalette(); else closePalette();
    } else if (e.key === "Escape") {
      if (!palette.hidden) closePalette();
      else if (!profileMenu.hidden) { closeProfile(); profileBtn.focus(); }
      else if (drawer.dataset.show) { delete drawer.dataset.show; drawer.classList.remove("open"); backdrop.classList.remove("open"); syncActive(); }
    }
  });
  document.getElementById("cmdk-open-btn").addEventListener("click", openPalette);

  // ── Phone tab bar ──────────────────────────────────────────────────────
  tabbar.addEventListener("click", (e) => {
    const t = e.target.closest(".tab");
    if (!t) return;
    const which = t.dataset.tab;
    if (which === "search") { openPalette(); return; }
    if (which === "profile") { profileMenu.hidden ? openProfile() : closeProfile(); return; }
    closeProfile();
    if (drawer.classList.contains("open") && drawer.dataset.show === which) {
      drawer.classList.remove("open"); backdrop.classList.remove("open"); delete drawer.dataset.show; syncActive();
    } else showSection(which);
  });

  return { syncActive, openPalette, goHome };
}
