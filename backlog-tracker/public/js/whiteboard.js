// Live whiteboard page (whiteboard.html?b=<20-character id>).
//
// Strokes live in whiteboards/{id}/strokes/{strokeId} and every open copy of
// the board listens to that collection, so a stroke finished (or, while a long
// one is still being drawn, every ~1.5 s) in one window shows in the others.
// The page signs in as nobody: the id in the link is the credential, enforced
// by firestore.rules → "Whiteboard".
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, collection, query, orderBy, onSnapshot, addDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import {
  COLORS, SIZES, isValidBoardId, boardUrl, toWorld, zoomAt, clampZoom, chunkCoords, strokeHit,
  gestureMembers, lastOwnGesture, fitView, MAX_COORDS_PER_STROKE,
} from "./whiteboard-core.js";
import { clickOnTouchTap } from "./touch-click.js";

const $ = (id) => document.getElementById(id);
const canvas = $("wb-canvas");
const ctx = canvas.getContext("2d");
const params = new URLSearchParams(location.search);
const boardId = params.get("b") || "";

function showError(title, text) {
  $("wb-error-title").textContent = title;
  if (text) $("wb-error-text").textContent = text;
  $("wb-error").hidden = false;
  $("wb-ui").hidden = true;
}

if (!isValidBoardId(boardId)) {
  showError("This whiteboard link isn't valid", "Check the link you were sent, or ask for a new one.");
} else {
  start().catch((e) => {
    console.warn("whiteboard:", e);
    showError("This whiteboard can't be opened", "The link may have been turned off, or the board no longer exists.");
  });
}

async function start() {
  const db = getFirestore(initializeApp(firebaseConfig, "whiteboard"));
  const boardRef = doc(db, "whiteboards", boardId);
  const board = await getDoc(boardRef);
  if (!board.exists() || board.data().shared !== true) {
    showError("This whiteboard link isn't valid", "It may have been turned off, or the link is mistyped.");
    return;
  }
  $("wb-ui").hidden = false;
  // Touch taps act when the finger lifts: iPad WebKit drops or delays some
  // taps' clicks, and a late colour click used to miss the next stroke.
  clickOnTouchTap($("wb-ui"), "button");
  // The toolbar wraps onto a second row on narrow screens; the share panel and
  // Reset view place themselves under its real bottom edge.
  const toolbar = $("wb-toolbar");
  const barBottom = () => toolbar.getBoundingClientRect().bottom;
  const syncBar = () => document.documentElement.style.setProperty("--wb-bar-bottom", `${Math.round(barBottom())}px`);
  if (window.ResizeObserver) new ResizeObserver(syncBar).observe(toolbar);
  addEventListener("resize", syncBar);
  syncBar();

  // ---- state ----
  let strokes = [];                 // [{id, g, color, size, pts, t}] ordered by t
  const hidden = new Set();         // stroke ids deleted locally, not yet confirmed
  const mine = [];                  // gesture ids this window drew, oldest first
  let tool = "pen", color = COLORS[0], size = SIZES[1];
  let view = { x: 0, y: 0, k: 1 };
  let autoFit = true;               // frame the drawing for everyone until someone moves the view by hand
  let live = null;                  // the stroke being drawn: {g, color, size, coords, flushed}
  let dirty = true, spaceDown = false, panning = null, erasing = false, flushTimer = null;
  const pointers = new Map();       // active touch pointers, for pinch
  let pinch = null;
  const strokesCol = collection(db, "whiteboards", boardId, "strokes");

  // ---- drawing ----
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    dirty = true;
  }
  function drawStroke(s) {
    const p = s.pts;
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.size;
    if (p.length === 2) { ctx.beginPath(); ctx.arc(p[0], p[1], s.size / 2, 0, Math.PI * 2); ctx.fill(); return; }
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i + 1 < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    ctx.stroke();
  }
  // Auto-fit eases the view toward the framed drawing. It holds still while this
  // window is mid-gesture, so the board never moves under the pen.
  const gestureActive = () => !!(live || erasing || panning || pinch);
  function easeToFit() {
    if (!autoFit || gestureActive()) return;
    const t = fitView(strokes.filter((s) => !hidden.has(s.id)), innerWidth, innerHeight, barBottom());
    const near = (a, b, e) => Math.abs(a - b) < e;
    if (near(view.x, t.x, 0.5) && near(view.y, t.y, 0.5) && near(view.k, t.k, 0.0005)) {
      if (view.x !== t.x || view.y !== t.y || view.k !== t.k) view = t;
      return;
    }
    const f = 0.18;
    view = { k: view.k + (t.k - view.k) * f, x: view.x + (t.x - view.x) * f, y: view.y + (t.y - view.y) * f };
    dirty = true;
  }
  function setAutoFit(on) {
    autoFit = on;
    $("wb-fit").setAttribute("aria-pressed", String(on));
    dirty = true;
  }
  function render() {
    dirty = false;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ctx.setTransform(dpr * view.k, 0, 0, dpr * view.k, dpr * view.x, dpr * view.y);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    for (const s of strokes) if (!hidden.has(s.id)) drawStroke(s);
    if (live) drawStroke({ color: live.color, size: live.size, pts: live.coords });
    // The grid is CSS and does not move with the view; nudge it so panning feels anchored.
    canvas.style.backgroundPosition = `${view.x}px ${view.y}px`;
    canvas.style.backgroundSize = `${24 * view.k}px ${24 * view.k}px`;
  }
  (function frame() { easeToFit(); if (dirty) render(); requestAnimationFrame(frame); })();
  addEventListener("resize", resize);
  resize();

  // ---- live sync ----
  onSnapshot(query(strokesCol, orderBy("t")), (snap) => {
    strokes = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => Array.isArray(s.pts) && s.pts.length >= 2);
    const ids = new Set(strokes.map((s) => s.id));
    for (const id of hidden) if (!ids.has(id)) hidden.delete(id);
    dirty = true;
    $("wb-status").textContent = "";
  }, (err) => {
    console.warn("whiteboard sync:", err);
    $("wb-status").textContent = "Reconnecting…";
  });

  // ---- writing ----
  function saveStroke(g, coords) {
    if (coords.length < 2) return;
    const pts = coords.map((n) => Math.round(n * 10) / 10);
    const writes = chunkCoords(pts).map((chunk, i) =>
      addDoc(strokesCol, { g, color: live ? live.color : color, size: live ? live.size : size, pts: chunk, t: Date.now() + i }));
    Promise.all(writes).catch((e) => { console.warn("whiteboard write:", e); $("wb-status").textContent = "Couldn't save the last stroke."; });
  }
  // Save what was drawn since the last save, repeating one point so the pieces join up.
  function flushLive() {
    if (!live) return;
    const fresh = live.coords.slice(Math.max(0, live.flushed - 2));
    if (fresh.length < 4) return;
    saveStroke(live.g, fresh);
    live.flushed = live.coords.length;
  }
  async function deleteGestures(ids) {
    const targets = strokes.filter((s) => ids.has(s.g));
    for (const s of targets) hidden.add(s.id);
    dirty = true;
    for (let i = 0; i < targets.length; i += 100) {
      const batch = writeBatch(db);
      for (const s of targets.slice(i, i + 100)) batch.delete(doc(db, "whiteboards", boardId, "strokes", s.id));
      await batch.commit().catch((e) => { console.warn("whiteboard delete:", e); $("wb-status").textContent = "Couldn't remove that."; });
    }
  }

  // ---- pointer input ----
  const pt = (e) => ({ x: e.clientX, y: e.clientY });
  const activeTool = () => (spaceDown ? "pan" : tool);
  function eraseAt(e) {
    const w = toWorld(view, e.clientX, e.clientY);
    const r = 10 / view.k;
    const hit = new Set();
    for (const s of strokes) if (!hidden.has(s.id) && strokeHit(s, w.x, w.y, r)) hit.add(s.g);
    if (hit.size) deleteGestures(hit);
  }
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pt(e));
    if (e.pointerType === "touch" && pointers.size === 2) {   // second finger: cancel the stroke, start pinch
      live = null; erasing = false; panning = null;
      setAutoFit(false);
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), view: { ...view }, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      dirty = true; return;
    }
    if (e.button === 1 || e.button === 2 || activeTool() === "pan") {
      setAutoFit(false);
      panning = { sx: e.clientX, sy: e.clientY, x: view.x, y: view.y };
      canvas.classList.add("is-panning"); return;
    }
    if (activeTool() === "eraser") { erasing = true; eraseAt(e); return; }
    const w = toWorld(view, e.clientX, e.clientY);
    live = { g: crypto.randomUUID ? crypto.randomUUID().slice(0, 12) : String(Date.now()), color, size: size / view.k, coords: [w.x, w.y], flushed: 0 };
    clearInterval(flushTimer);
    flushTimer = setInterval(() => flushLive(), 1500);
    dirty = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pt(e));
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = zoomAt(pinch.view, pinch.mid.x, pinch.mid.y, dist / pinch.dist);
      view = { k: z.k, x: z.x + (mid.x - pinch.mid.x), y: z.y + (mid.y - pinch.mid.y) };
      dirty = true; return;
    }
    if (panning) { view = { ...view, x: panning.x + e.clientX - panning.sx, y: panning.y + e.clientY - panning.sy }; dirty = true; return; }
    if (erasing) { eraseAt(e); return; }
    if (live) {
      // Coalesced events keep a fast pen/finger smooth.
      for (const ev of (e.getCoalescedEvents ? e.getCoalescedEvents() : [e])) {
        const w = toWorld(view, ev.clientX, ev.clientY);
        live.coords.push(w.x, w.y);
      }
      if (live.coords.length >= MAX_COORDS_PER_STROKE) { flushLive(); live.coords = live.coords.slice(-2); live.flushed = 0; }
      dirty = true;
    }
  });
  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (panning) { panning = null; canvas.classList.remove("is-panning"); }
    erasing = false;
    if (live) {
      clearInterval(flushTimer);
      const g = live.g;
      if (live.coords.length === 2) live.coords.push(live.coords[0], live.coords[1]); // a tap is a dot
      flushLive();
      mine.push(g);
      live = null; dirty = true;
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    setAutoFit(false);
    if (e.ctrlKey || e.metaKey) { view = zoomAt(view, e.clientX, e.clientY, Math.exp(-e.deltaY * 0.01)); }
    else view = { ...view, x: view.x - e.deltaX, y: view.y - e.deltaY };
    dirty = true;
  }, { passive: false });

  // ---- keyboard ----
  addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.code === "Space") { spaceDown = true; canvas.dataset.tool = "pan"; e.preventDefault(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  });
  addEventListener("keyup", (e) => { if (e.code === "Space") { spaceDown = false; canvas.dataset.tool = tool; } });

  // ---- toolbar ----
  function setTool(t) {
    tool = t; canvas.dataset.tool = t;
    document.querySelectorAll(".wb-tool[data-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
  }
  document.querySelectorAll(".wb-tool[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
  const colorsEl = $("wb-colors"), sizesEl = $("wb-sizes");
  COLORS.forEach((c, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "wb-swatch"; b.title = "Colour " + (i + 1); b.setAttribute("aria-label", "Colour " + (i + 1) + " " + c);
    b.setAttribute("aria-pressed", String(c === color)); b.innerHTML = `<i style="background:${c}"></i>`;
    b.addEventListener("click", () => { color = c; if (tool !== "pen") setTool("pen"); colorsEl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    colorsEl.appendChild(b);
  });
  SIZES.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "wb-size"; b.title = ["Thin", "Medium", "Thick"][i] + " pen"; b.setAttribute("aria-label", b.title);
    b.setAttribute("aria-pressed", String(s === size)); b.innerHTML = `<i style="width:${s + 4}px;height:${s + 4}px"></i>`;
    b.addEventListener("click", () => { size = s; if (tool !== "pen") setTool("pen"); sizesEl.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    sizesEl.appendChild(b);
  });
  function undo() {
    const g = lastOwnGesture(mine, strokes.filter((s) => !hidden.has(s.id)));
    if (!g) return;
    mine.splice(mine.lastIndexOf(g), 1);
    deleteGestures(new Set([g]));
  }
  $("wb-undo").addEventListener("click", undo);
  $("wb-reset").addEventListener("click", () => setAutoFit(true));
  $("wb-fit").addEventListener("click", () => setAutoFit(!autoFit));
  // Zoom about the middle of the board area; doing it by hand switches auto-fit off.
  function zoomButton(factor) {
    setAutoFit(false);
    view = zoomAt(view, innerWidth / 2, (innerHeight + barBottom()) / 2, factor);
  }
  $("wb-zoom-in").addEventListener("click", () => zoomButton(1.25));
  $("wb-zoom-out").addEventListener("click", () => zoomButton(0.8));
  const confirmEl = $("wb-confirm");
  $("wb-clear").addEventListener("click", () => { confirmEl.hidden = false; $("wb-confirm-no").focus(); });
  $("wb-confirm-no").addEventListener("click", () => { confirmEl.hidden = true; });
  $("wb-confirm-yes").addEventListener("click", () => {
    confirmEl.hidden = true;
    deleteGestures(new Set(strokes.map((s) => s.g)));
    mine.length = 0;
  });

  // ---- sharing ----
  const link = boardUrl(boardId, location.href);
  const sharePanel = $("wb-share"), shareBtn = $("wb-share-open");
  $("wb-link").value = link;
  function setShare(open) {
    sharePanel.hidden = !open;
    shareBtn.setAttribute("aria-expanded", String(open));
    if (open) { $("wb-copy-msg").textContent = ""; $("wb-copy").focus(); }
  }
  shareBtn.addEventListener("click", () => setShare(sharePanel.hidden));
  $("wb-share-close").addEventListener("click", () => { setShare(false); shareBtn.focus(); });
  addEventListener("keydown", (e) => { if (e.key === "Escape") { setShare(false); confirmEl.hidden = true; } });
  $("wb-copy").addEventListener("click", async () => {
    const msg = $("wb-copy-msg");
    try {
      await navigator.clipboard.writeText(link);
      msg.textContent = "Link copied.";
    } catch {
      const input = $("wb-link");
      input.focus(); input.select();
      let ok = false;
      try { ok = document.execCommand("copy"); } catch { /* fall through */ }
      msg.textContent = ok ? "Link copied." : "Press Ctrl+C (or hold and copy) to copy the selected link.";
    }
  });
  if (navigator.share) {
    const ns = $("wb-native-share");
    ns.hidden = false;
    ns.addEventListener("click", () => navigator.share({ title: "Whiteboard", text: "Join my whiteboard", url: link }).catch(() => {}));
  }
  $("wb-link").addEventListener("focus", (e) => e.target.select());

  // A board just created from the console opens with the share panel showing.
  if (params.get("new") === "1") {
    setShare(true);
    history.replaceState(null, "", link);
  }
}
