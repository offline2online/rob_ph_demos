// Page-driving helpers shared by both Staff Kanban suites: dragging by mouse
// and by touch (with edge auto-scroll), the Status-menu move, and readers for
// where a card is and what each column header says. Nothing here knows which
// build it is driving (prototype or console): selectors are the ones both share.

export const COLS = ["backlog", "ready-for-dev", "in-progress", "ready-for-testing", "approved", "done"];
// The seven places a ticket can be: six columns, the last split in two.
export const PLACES = [
  { id: "backlog", status: "backlog", label: "Backlog" },
  { id: "ready-for-dev", status: "ready-for-dev", label: "Ready for Dev" },
  { id: "in-progress", status: "in-progress", label: "In Progress" },
  { id: "ready-for-testing", status: "ready-for-testing", label: "Ready for Testing" },
  { id: "approved", status: "approved", label: "Approved for Deployment" },
  { id: "completed", status: "done", resolution: "completed", label: "Completed" },
  { id: "withdrawn", status: "done", resolution: "withdrawn", label: "Withdrawn" },
];
export const place = (id) => PLACES.find((x) => x.id === id);

export const isTouch = (profile) => !!profile.touch;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tap on touch profiles, a click elsewhere.
export const press = (p, sel, o) => (p.profile && p.profile.touch ? p.tap(sel, o) : p.click(sel, o));

export const where = (page, key) => page.evaluate((k) => {
  const c = document.querySelector(`.kb-card[data-key="${k}"]`);
  if (!c) return null;
  const l = c.closest(".kb-list");
  return { status: c.closest(".kb-col").dataset.status, resolution: (l && l.dataset.resolution) || null, lane: c.closest(".kb-col").dataset.lane || null, avatar: (c.querySelector(".kb-card-footer .kb-avatar") || {}).title || "", withdrawn: c.classList.contains("kb-card-withdrawn") };
}, key);

export const columnKeys = (page, status, lane) => page.$$eval(`${lane ? `.kb-lane-cell[data-lane="${lane}"]` : ".kb-col"}[data-status="${status}"] .kb-card .kb-key`, (e) => e.map((x) => x.textContent));

// What the pinned header row says: count and remaining effort per column; the last column's two counts.
export const headers = (page) => page.evaluate(() => [...document.querySelectorAll("#kb-lanes-head .kb-col-head")].map((h) => ({
  title: h.querySelector(".kb-col-title").textContent,
  effort: (h.querySelector(".kb-col-effort") || {}).textContent || null,
  count: h.querySelector(".kb-res-count") ? null : +h.querySelector(".col-count").textContent,
  completed: h.querySelector(".kb-res-count-completed") ? +h.querySelector(".kb-res-count-completed").textContent.replace(/\D/g, "") : null,
  withdrawn: h.querySelector(".kb-res-count-withdrawn") ? +h.querySelector(".kb-res-count-withdrawn").textContent.replace(/\D/g, "") : null,
})));

// ── pointers ────────────────────────────────────────────────────────────────
// mouse: Playwright's mouse. touch on Chromium: real touch events over CDP.
// touch elsewhere (WebKit, which has no CDP): the same PointerEvents a finger
// produces, dispatched at the element under the point, because the board
// listens for pointer events.
export async function makePointer(p, input) {
  if (input === "mouse") return { kind: "mouse", down: (x, y) => p.mouse.move(x, y).then(() => p.mouse.down()), move: (x, y, steps = 1) => p.mouse.move(x, y, { steps }), up: () => p.mouse.up(), cancel: () => p.mouse.up(), wheel: (dx) => p.mouse.wheel(dx, 0) };
  if (p.engine === "chromium") {
    const cdp = p.cdp || (p.cdp = await p.context().newCDPSession(p));
    const send = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
    let last = null;
    return {
      kind: "touch-cdp",
      down: async (x, y) => { last = { x, y }; await send("touchStart", [{ x, y }]); },
      move: async (x, y, steps = 1) => { for (let i = 1; i <= steps; i++) { const nx = last.x + (x - last.x) * i / steps, ny = last.y + (y - last.y) * i / steps; await send("touchMove", [{ x: nx, y: ny }]); await sleep(16); } last = { x, y }; },
      up: () => send("touchEnd", []),
      cancel: () => send("touchCancel", []),
    };
  }
  const fire = (type, x, y) => p.evaluate(([t, px, py]) => {
    const el = document.elementFromPoint(px, py) || document.body;
    el.dispatchEvent(new PointerEvent(t, { pointerId: 77, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true, composed: true, clientX: px, clientY: py, button: 0, buttons: t === "pointerup" || t === "pointercancel" ? 0 : 1 }));
  }, [type, x, y]);
  let last = null;
  return {
    kind: "touch-synthetic",
    down: async (x, y) => { last = { x, y }; await fire("pointerdown", x, y); },
    move: async (x, y, steps = 1) => { for (let i = 1; i <= steps; i++) { await fire("pointermove", last.x + (x - last.x) * i / steps, last.y + (y - last.y) * i / steps); await sleep(16); } last = { x, y }; },
    up: () => fire("pointerup", last.x, last.y),
    cancel: () => fire("pointercancel", last.x, last.y),
  };
}

// The phone's carousel scrolls smoothly: wait until the card has stopped moving before aiming at it.
async function settled(p, sel) {
  let prev = null;
  for (let i = 0; i < 60; i++) {
    const b = await (await p.$(sel)).boundingBox();
    const k = b && `${Math.round(b.x)},${Math.round(b.y)}`;
    if (k === prev) return;
    prev = k; await sleep(50);
  }
}

// The point in `sel`'s box to aim at, and whether it can be reached now.
async function aim(p, sel, at, dropY) {
  return p.evaluate(([s, where_, yOverride]) => {
    const el = document.querySelector(s);
    if (!el) return { missing: true };
    const r = el.getBoundingClientRect();
    const wrap = document.querySelector("#kb-board-wrap");
    const wr = wrap ? wrap.getBoundingClientRect() : { left: 0, right: innerWidth };
    const sticky = document.querySelector("#kb-sticky");
    const top = sticky && !sticky.hidden ? sticky.getBoundingClientRect().bottom : 0;
    const x = Math.round(Math.min(Math.max(r.left + Math.min(40, r.width / 2), wr.left + 4), wr.right - 4));
    // A tall list can be aimed at wherever it shows; a small target (a card) must be aimed at exactly.
    const big = r.height > 400;
    const y = Math.round(yOverride != null ? yOverride : where_ === "top" ? (big ? Math.max(r.top + 14, top + 12) : r.top + Math.max(3, Math.min(10, r.height * 0.15))) : where_ === "bottom" ? r.bottom - 14 : big ? (Math.max(r.top, top) + Math.min(r.bottom, innerHeight)) / 2 : r.top + r.height / 2);
    const hit = document.elementFromPoint(Math.min(Math.max(x, 0), innerWidth - 1), Math.min(Math.max(y, 0), innerHeight - 1));
    // (the console's phone has a slim closing bar over the bottom edge, and it grows when a card comes within ~36px of it)
    const slimEl = document.querySelector(".kb-close-slim");
    const floor = slimEl && !s.includes("kb-close-zone") ? slimEl.getBoundingClientRect().bottom - 52 - 44 : innerHeight - 4;
    const delta = y < top + 4 ? y - top - 4 : y > floor ? y - floor : 0;
    const ok = x > wr.left && x < wr.right && delta === 0 && !!hit && (hit === el || el.contains(hit) || (hit.closest && hit.closest(s) === el));
    const zone = hit && hit.closest ? hit.closest(".kb-close-zone") : null;
    return { hit: hit && (hit.className || hit.tagName), zone: !!zone && !s.includes("kb-close-zone"), ok, x, y, dx: r.right < wr.left + 8 || r.left < wr.left - 4 ? -1 : r.left > wr.right - 8 ? 1 : zone ? 1 : 0, dy: delta < 0 ? -1 : delta > 0 ? 1 : 0, delta, wl: wr.left, wr: wr.right, top };
  }, [sel, at, dropY]);
}

// Before picking a card up, scroll the board sideways (as a person would) so the card and its
// destination are both clear of the Completed/Withdrawn targets, which are pinned over the right
// edge when the last column is off screen. When no position shows both, leave it to the drag.
async function preScroll(p, cardSel, target) {
  const tsel = target.sel || (target.lane ? `.kb-lane-cell[data-lane="${target.lane}"][data-status="${target.status}"]` : `.kb-col[data-status="${target.status}"]`);
  await p.evaluate(([c, t]) => {
    const wrap = document.querySelector("#kb-board-wrap"), card = document.querySelector(c), tgt = document.querySelector(t);
    if (!wrap || !card || !tgt || wrap.scrollWidth <= wrap.clientWidth + 2) return;
    const done = document.querySelector('.kb-col[data-status="done"], .kb-lane-cell[data-status="done"]');
    if (!done) return;
    const col = card.closest(".kb-col, .kb-lane-cell");
    const s0 = wrap.scrollLeft, wr = wrap.getBoundingClientRect();
    const rel = (el, s) => { const r = el.getBoundingClientRect(); return { l: r.left + s0 - s, r: r.right + s0 - s, w: r.width }; };
    for (let s = 0; s <= wrap.scrollWidth - wrap.clientWidth; s += 8) {
      const d = rel(done, s), a = rel(col, s), b = rel(tgt, s);
      const zoneLeft = Math.min(Math.max(d.l, 0), innerWidth - d.w - 8);
      if (a.l >= wr.left && b.l >= wr.left && a.r <= wr.right && b.r <= zoneLeft - 2) { wrap.scrollLeft = s; return; }
    }
  }, [cardSel, tsel]);
  await sleep(60);
}

// Phone: the closing targets fill the lower part of the screen, and the page does not scroll while
// the pointer is over them, so a person scrolls the card and its destination into the top part first.
async function preScrollV(p, cardSel, target) {
  const tsel = target.sel || (target.lane ? `.kb-lane-cell[data-lane="${target.lane}"][data-status="${target.status}"]` : `.kb-col[data-status="${target.status}"] .kb-list`);
  await p.evaluate(([c, t]) => {
    const card = document.querySelector(c), tgt = document.querySelector(t);
    if (!card || !tgt) return;
    const sticky = document.querySelector("#kb-sticky"), top = sticky && !sticky.hidden ? sticky.getBoundingClientRect().bottom : 0;
    const zoneTop = innerHeight * 0.52, y0 = scrollY;
    const cr = card.getBoundingClientRect(), tr = tgt.getBoundingClientRect();
    for (let d = -2000; d <= 2000; d += 10) {
      const ct = cr.top - d, cb = cr.bottom - d, tt = tr.top - d;
      if (ct >= top + 6 && cb <= zoneTop - 10 && tt >= top + 6 && tt <= zoneTop - 30) { scrollTo(0, Math.max(0, y0 + d)); return; }
    }
  }, [cardSel, tsel]);
  await sleep(80);
}

// Drag a card by its key onto `target`:
//   { sel }                          any element (e.g. a lane cell's list)
//   { zone: "completed"|"withdrawn" } the closing targets that appear mid-drag
//   { status, lane? }                a column (or lane cell) list
// `at`: "top" | "middle" | "bottom" inside that list. `input`: "mouse" | "touch".
// `hold`: leave the pointer down and return it (no drop) so a case can inspect or cancel the drag.
export async function dragCard(p, key, target, o = {}) {
  const input = o.input || (p.profile && p.profile.touch ? "touch" : "mouse");
  const P = await makePointer(p, input);
  if (o.scrollTop !== false) await p.evaluate(() => scrollTo(0, 0));
  const card = `.kb-card[data-key="${key}"]`;
  await showCard(p, key);
  await p.waitForSelector(card);
  if (!target.zone && !(p.profile && p.profile.kind === "phone")) await preScroll(p, card, target);
  if (!target.zone && p.profile && p.profile.kind === "phone") await preScrollV(p, card, target);
  await p.$eval(card, (e) => { const r = e.getBoundingClientRect(); const s = document.querySelector("#kb-sticky"); const top = s && !s.hidden ? s.getBoundingClientRect().bottom : 0; if (r.top < top + 4 || r.bottom > innerHeight - 4 || r.left < Math.max(0, (document.querySelector("#kb-board-wrap") || { getBoundingClientRect: () => ({ left: 0 }) }).getBoundingClientRect().left) || r.right > Math.min(innerWidth, (document.querySelector("#kb-board-wrap") || { getBoundingClientRect: () => ({ right: innerWidth }) }).getBoundingClientRect().right)) e.scrollIntoView({ block: "center", inline: innerWidth <= 640 ? "center" : "nearest" }); }).catch(() => {});
  await sleep(120);
  await settled(p, card);
  // On a phone the carousel scrolls sideways: bring the card's column to the middle.
  let b = await (await p.$(card)).boundingBox();
  await P.down(b.x + Math.min(30, b.width / 2), b.y + Math.min(20, b.height / 2));
  if (input === "touch") await sleep(o.holdMs || 420);
  const cx = b.x + Math.min(30, b.width / 2), cy = b.y + Math.min(20, b.height / 2);
  await P.move(cx + 14, cy + 10, 3);
  const sel = target.zone ? `.kb-close-zone[data-resolution="${target.zone}"]` : target.sel || (target.lane ? `.kb-lane-cell[data-lane="${target.lane}"][data-status="${target.status}"] .kb-list, .kb-lane-cell[data-lane="${target.lane}"][data-status="${target.status}"]` : `.kb-col[data-status="${target.status}"] .kb-list`);
  const first = sel.split(", ")[0];
  const at = o.at || "top";
  let pos = { x: cx + 14, y: cy + 10 }, blocked = 0, reached = false;
  for (let i = 0; i < (o.maxSteps || 160); i++) {
    const a = await aim(p, first, at, o.y); if (process.env.KB_DEBUG) console.log("aim", i, JSON.stringify(a), JSON.stringify(pos));
    if (a.missing) { await P.cancel(); throw Object.assign(new Error(`drop target ${first} not found`), { unreachable: true, missing: true }); }
    if (a.ok) {
      await P.move(a.x, a.y, 10); pos = { x: a.x, y: a.y };
      // The page may still be scrolling from the edge it was parked at: settle on the target.
      for (let k = 0; k < 6; k++) {
        await sleep(40);
        const b2 = await aim(p, first, at, o.y);
        if (!b2.ok) break;
        if (Math.abs(b2.y - pos.y) <= 2 && Math.abs(b2.x - pos.x) <= 2) break;
        await P.move(b2.x, b2.y, 2); pos = { x: b2.x, y: b2.y };
      }
      reached = true;
      break;
    }
    // The closing targets are pinned over the right edge when the last column is off screen,
    // and the board only auto-scrolls while the pointer is NOT over them: a mouse can still
    // use the wheel, a finger cannot. The case decides what an unreachable column means.
    if (a.zone) {
      if (P.wheel) { await P.move(Math.min(a.wl + 60, a.x), pos.y, 2); await P.wheel(160); await sleep(60); continue; }
      if (++blocked > 3) { await P.cancel(); await sleep(150); throw Object.assign(new Error(`${first} is under the Completed/Withdrawn targets and cannot be scrolled to by touch`), { unreachable: true }); }
    }
    // Not reachable: park the pointer near the edge it must scroll and keep it moving there.
    const ex = a.dx > 0 ? a.wr - 24 : a.dx < 0 ? a.wl + 24 : pos.x;
    // (the console's phone has a slim closing bar over the bottom edge: the page scrolls in the strip just above it)
    const slimTop = a.dy > 0 ? await p.evaluate(() => { const z = document.querySelector(".kb-close-slim"); return z ? Math.round(z.getBoundingClientRect().top) : null; }) : null;
    const ey = a.dy > 0 ? (slimTop != null ? slimTop - 60 : p.viewportSize().height - 24) : a.dy < 0 ? 90 : pos.y;
    await P.move(ex, ey, 2); await P.move(ex + 3, ey + 2, 1); await P.move(ex, ey, 1);
    pos = { x: ex, y: ey };
    await sleep(20);
  }
  if (!reached) { await P.cancel(); await sleep(150); throw Object.assign(new Error(`${first} could not be reached while dragging`), { unreachable: true }); }
  if (o.hold) return { P, pos };
  await P.up();
  await sleep(o.settle || 220);
  return { P, pos };
}

// On a phone with swimlanes only the current column shows: go to the card's column.
export async function showCard(p, key) {
  if (!(p.profile && p.profile.kind === "phone")) return;
  const vis = await p.$eval(`.kb-card[data-key="${key}"]`, (e) => e.getClientRects().length > 0 && getComputedStyle(e.closest(".kb-lane-cell, .kb-col")).display !== "none").catch(() => false);
  if (vis) return;
  const st = await p.$eval(`.kb-card[data-key="${key}"]`, (e) => e.closest(".kb-col, .kb-lane-cell").dataset.status);
  await p.tap(`.kb-pager-tab[data-col="${COLS.indexOf(st)}"]`); await sleep(700);
}

// The Status menu: open the ticket, choose, Save. `placeId` from PLACES.
export async function statusMove(p, key, placeId) {
  const pl = place(placeId);
  if (await p.$eval("#task-backdrop", (e) => e.hidden).catch(() => true)) {
    await showCard(p, key);
    await p.$eval(`.kb-card[data-key="${key}"]`, (e) => e.scrollIntoView({ block: "center", inline: "center" }));
    await sleep(60);
    await press(p, `.kb-card[data-key="${key}"]`);
  }
  await p.waitForSelector("#f-status");
  await p.selectOption("#f-status", pl.status === "done" ? `done:${pl.resolution}` : pl.status);
  await sleep(80);
  // Save is off when the ticket is already there (nothing changed): close it as Cancel would.
  await press(p, (await p.$eval("#f-save", (e) => e.disabled)) ? "#f-cancel" : "#f-save");
  await p.waitForFunction(() => document.getElementById("task-backdrop").hidden, null, { timeout: 5000 });
  await sleep(120);
}

// Move by whichever route the profile supports. method: "drag" | "touch" | "status".
export async function moveBy(p, method, key, placeId, o = {}) {
  const pl = place(placeId);
  if (method === "status") return statusMove(p, key, placeId);
  const input = method === "touch" ? "touch" : "mouse";
  if (pl.status === "done") return dragCard(p, key, { zone: pl.resolution }, { input, ...o });
  return dragCard(p, key, { status: pl.status, lane: o.lane }, { input, ...o });
}

// One Eulerian circuit through the complete directed graph on `n` places: every
// ordered pair (source → target) is used exactly once, 42 moves for 7 places,
// so one card walks all of them without ever being reset between moves.
export function allMoves(ids) {
  const n = ids.length;
  const next = ids.map(() => new Set(ids.map((_, j) => j)));
  next.forEach((s, i) => s.delete(i));
  const stack = [0], circuit = [];
  while (stack.length) {
    const v = stack[stack.length - 1];
    const it = next[v].values().next();
    if (it.done) circuit.push(stack.pop()); else { next[v].delete(it.value); stack.push(it.value); }
  }
  circuit.reverse();
  const out = [];
  for (let i = 0; i + 1 < circuit.length; i++) out.push([ids[circuit[i]], ids[circuit[i + 1]]]);
  if (out.length !== n * (n - 1)) throw new Error("allMoves: not an Eulerian circuit");
  return out;
}

export const toastText = (p) => p.$eval("#kb-toast", (e) => (e.hidden ? "" : e.textContent)).catch(() => "");

// Pick a card up (press, hold on touch, small move) and leave the pointer down; returns the pointer.
export async function pickUp(p, key, input, o = {}) {
  const P = await makePointer(p, input);
  if (o.scrollTop !== false) await p.evaluate(() => scrollTo(0, 0));
  const sel = `.kb-card[data-key="${key}"]`;
  await showCard(p, key);
  await p.$eval(sel, (e) => { const r = e.getBoundingClientRect(); const s = document.querySelector("#kb-sticky"); const top = s && !s.hidden ? s.getBoundingClientRect().bottom : 0; if (r.top < top + 4 || r.bottom > innerHeight - 4 || r.left < Math.max(0, (document.querySelector("#kb-board-wrap") || { getBoundingClientRect: () => ({ left: 0 }) }).getBoundingClientRect().left) || r.right > Math.min(innerWidth, (document.querySelector("#kb-board-wrap") || { getBoundingClientRect: () => ({ right: innerWidth }) }).getBoundingClientRect().right)) e.scrollIntoView({ block: "center", inline: innerWidth <= 640 ? "center" : "nearest" }); });
  await sleep(120);
  await settled(p, sel);
  const b = await (await p.$(sel)).boundingBox();
  const x = b.x + Math.min(30, b.width / 2), y = b.y + Math.min(20, b.height / 2);
  await P.down(x, y);
  if (input === "touch") await sleep(o.holdMs || 420);
  await P.move(x + 14, y + 10, 3);
  P.at = { x: x + 14, y: y + 10 };
  return P;
}
