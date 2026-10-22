// Touch taps act when the finger lifts, not when the browser gets round to a
// click. iPad WebKit sometimes drops a tap's click altogether (the console's
// Staff Kanban link, 21 Oct 2026) or delivers it late, after the next thing
// has started (the whiteboard: a colour tapped just before drawing reached the
// page after the stroke began, so the stroke took the old colour, 22 Oct 2026).
//
// So a touch or pen tap that lifts on the control it started on clicks it
// right there in pointerup, which also keeps the user gesture that clipboard
// and share need, and the browser's own click for that tap, if it arrives, is
// swallowed so the tap never fires twice (Share and menus toggle).
const SWALLOW_MS = 1000;

export function clickOnTouchTap(root, selector) {
  let tap = null;
  const isTouch = (e) => e.pointerType === "touch" || e.pointerType === "pen";
  root.addEventListener("pointerdown", (e) => {
    const el = isTouch(e) && e.isPrimary && e.target.closest(selector);
    tap = el && root.contains(el) ? { el, x: e.clientX, y: e.clientY, at: e.timeStamp } : null;
  });
  root.addEventListener("pointercancel", () => { tap = null; });
  root.addEventListener("pointerup", (e) => {
    const t = tap;
    tap = null;
    if (!t || !isTouch(e) || e.target.closest(selector) !== t.el) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || e.timeStamp - t.at > 800) return;
    if (!t.el.isConnected || t.el.disabled) return;
    t.el.click();
    const late = (ev) => { if (ev.isTrusted) { ev.preventDefault(); ev.stopImmediatePropagation(); cleanup(); } };
    const cleanup = () => { clearTimeout(timer); t.el.removeEventListener("click", late, { capture: true }); };
    t.el.addEventListener("click", late, { capture: true });
    const timer = setTimeout(cleanup, SWALLOW_MS);
  });
}
