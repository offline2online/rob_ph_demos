// Touch taps act when the finger lifts, not when the browser gets round to a
// click. iPad WebKit sometimes drops a tap's click altogether (the console's
// Staff Kanban link, 21 Oct 2026) or delivers it late, after the next thing
// has started (the whiteboard: a colour tapped just before drawing reached the
// page after the stroke began, so the stroke took the old colour, 22 Oct 2026).
//
// So a touch or pen tap that lifts on the control it started on clicks it
// right there, which also keeps the user gesture that clipboard and share
// need, and the browser's own click for that tap, if it arrives, is swallowed
// so the tap never fires twice (Share and menus toggle).
//
// Hardened 3 Nov 2026, when the sidebar's Staff Kanban and Concepts went dead
// on the iPad again (see backlog-tracker/REQUIREMENTS.md → "iPad taps"). The
// first version relied on one pointerdown/pointerup pair and could still lose
// the tap three ways on WebKit, each of which leaves the menu looking dead:
//  1. A pointercancel (WebKit starts a pan on a sub-pixel finger roll inside
//     the scrollable sidebar) threw the tap away, and WebKit then sends no
//     click either. Touch Events are now tracked as well: touchend still
//     arrives after a pointercancel, and the 10 px / 800 ms rule decides.
//  2. The age check compared Event.timeStamp values, which WebKit has not
//     always stamped from one clock for pointer and touch events; a "stale"
//     tap was then left to the native click that never came. performance.now()
//     is read here instead.
//  3. The native click was only swallowed if it landed on the same button.
//     The slide-over closes the instant the item is clicked, so WebKit's late
//     click hit whatever was underneath (a card, another link) and opened
//     that instead. It is now swallowed wherever it lands near the tap, and
//     touchend's default is prevented so WebKit doesn't synthesise it at all.
const SWALLOW_MS = 1000;
const MOVE_PX = 10;
const MAX_TAP_MS = 800;
const LATE_CLICK_PX = 40;

// One window-level guard for every root: the late native click of a tap
// already handled, wherever it lands.
let swallow = null;
let guardInstalled = false;
function installGuard() {
  if (guardInstalled) return;
  guardInstalled = true;
  window.addEventListener("click", (ev) => {
    const s = swallow;
    if (!s || !ev.isTrusted) return;
    if (performance.now() > s.until) { swallow = null; return; }
    // A keyboard/AT activation has no coordinates (0,0) and must never be eaten.
    if (ev.detail === 0 && ev.clientX === 0 && ev.clientY === 0) return;
    if (Math.hypot(ev.clientX - s.x, ev.clientY - s.y) > LATE_CLICK_PX) return;
    swallow = null;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
}

export function clickOnTouchTap(root, selector) {
  installGuard();
  let tap = null;
  let lastFired = 0;
  const isTouch = (e) => e.pointerType === "touch" || e.pointerType === "pen";
  const itemAt = (target) => {
    const el = target && target.closest ? target.closest(selector) : null;
    return el && root.contains(el) ? el : null;
  };

  function begin(target, x, y) {
    const el = itemAt(target);
    tap = el ? { el, x, y, at: performance.now() } : null;
  }
  // `target` is where the finger is now: pointerup's own target, or for
  // touchend (whose target is always the element the touch started on) the
  // element under the lift point.
  function finish(target, x, y) {
    const t = tap;
    tap = null;
    if (!t || itemAt(target) !== t.el) return false;
    if (Math.hypot(x - t.x, y - t.y) > MOVE_PX || performance.now() - t.at > MAX_TAP_MS) return false;
    if (!t.el.isConnected || t.el.disabled) return false;
    lastFired = performance.now();
    swallow = { x, y, until: lastFired + SWALLOW_MS };
    t.el.click();
    return true;
  }

  root.addEventListener("pointerdown", (e) => {
    if (isTouch(e) && e.isPrimary) begin(e.target, e.clientX, e.clientY);
  });
  root.addEventListener("pointerup", (e) => {
    if (isTouch(e) && e.isPrimary) finish(e.target, e.clientX, e.clientY);
  });
  // Deliberately no pointercancel handler: touchend below still decides the
  // tap by distance and time (cause 1 above).

  root.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { tap = null; return; }
    const p = e.touches[0];
    // pointerdown already began this tap; begin again only if it didn't.
    if (!tap || tap.el !== itemAt(e.target)) begin(e.target, p.clientX, p.clientY);
  }, { passive: true });
  root.addEventListener("touchcancel", () => { tap = null; });
  root.addEventListener("touchend", (e) => {
    const p = e.changedTouches && e.changedTouches[0];
    let fired = performance.now() - lastFired < 120; // pointerup handled it just now
    if (!fired && p && tap) {
      const under = document.elementFromPoint(p.clientX, p.clientY);
      fired = finish(under, p.clientX, p.clientY);
    }
    // Stop WebKit synthesising its own (late, re-targeted) click for a tap
    // already acted on.
    if (fired && e.cancelable) e.preventDefault();
  }, { passive: false });
}
