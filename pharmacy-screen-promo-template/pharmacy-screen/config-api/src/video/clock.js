"use strict";

// The stepped clock the MP4 export runs the screen under (render.js adds it to the page before any of the page's
// own scripts). Until freeze() it changes nothing: the page loads, reads its data and draws in real time. From
// freeze() on, time moves only when the renderer calls advance(ms): setTimeout/setInterval, requestAnimationFrame,
// performance.now() and Date follow the stepped time, and every CSS animation and transition is paused and set to
// where it would be at that time (Web Animations API). So each captured frame is exactly 40 ms after the last,
// however long a screenshot takes: no frame is dropped or doubled.

function installSteppedClock() {
  const w = window;
  const realNow = w.performance.now.bind(w.performance), RealDate = w.Date;
  const realST = w.setTimeout.bind(w), realCT = w.clearTimeout.bind(w), realSI = w.setInterval.bind(w), realCI = w.clearInterval.bind(w);
  const realRAF = w.requestAnimationFrame.bind(w), realCAF = w.cancelAnimationFrame.bind(w);
  let frozen = false, vNow = 0, perfBase = 0, dateBase = 0, nextId = 1e9;
  const timers = new Map(), rafs = new Map();
  let anims = new Map();

  const add = (fn, ms, args, every) => {
    const id = nextId++;
    timers.set(id, { id, fn, args, due: vNow + Math.max(0, +ms || 0), every: every ? Math.max(1, +ms || 0) : 0 });
    return id;
  };
  w.setTimeout = function (fn, ms, ...args) { return frozen ? add(fn, ms, args, false) : realST(fn, ms, ...args); };
  w.setInterval = function (fn, ms, ...args) { return frozen ? add(fn, ms, args, true) : realSI(fn, ms, ...args); };
  w.clearTimeout = function (id) { if (timers.has(id)) timers.delete(id); else realCT(id); };
  w.clearInterval = function (id) { if (timers.has(id)) timers.delete(id); else realCI(id); };
  w.requestAnimationFrame = function (fn) { if (!frozen) return realRAF(fn); const id = nextId++; rafs.set(id, fn); return id; };
  w.cancelAnimationFrame = function (id) { if (rafs.has(id)) rafs.delete(id); else realCAF(id); };
  w.performance.now = () => (frozen ? vNow : realNow());
  const nowMs = () => (frozen ? dateBase + (vNow - perfBase) : RealDate.now());
  class SteppedDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(nowMs()); }
    static now() { return nowMs(); }
  }
  w.Date = SteppedDate;

  // Every running animation, paused at its own time: (stepped now − when it was first seen) × its rate.
  function sync() {
    const next = new Map();
    for (const a of document.getAnimations()) {
      const start = anims.has(a) ? anims.get(a) : vNow;
      next.set(a, start);
      if (a.playState !== "paused") a.pause();
      a.currentTime = (vNow - start) * (a.playbackRate || 1);
    }
    anims = next;
  }
  const settle = () => new Promise((r) => realST(r, 0)); // let promise callbacks and their timers run

  w.__psClock = {
    freeze() {
      if (frozen) return;
      perfBase = realNow(); vNow = perfBase; dateBase = RealDate.now(); frozen = true;
    },
    /** The time just after freeze(), in ms since: 0 at the first frame. */
    get elapsed() { return frozen ? vNow - perfBase : 0; },
    /** Register what is running now as starting now (the first scene, drawn just after freeze()). */
    sync,
    /** Move the stepped time on by `ms`, running every timer due in order (each at its own time), then the frame
     *  callbacks, then put every animation where it is at the new time. */
    async advance(ms) {
      const target = vNow + ms;
      for (;;) {
        let t = null;
        for (const x of timers.values()) if (x.due <= target && (!t || x.due < t.due || (x.due === t.due && x.id < t.id))) t = x;
        if (!t) break;
        vNow = Math.max(vNow, t.due);
        if (t.every) t.due += t.every; else timers.delete(t.id);
        try { if (typeof t.fn === "function") t.fn(...t.args); } catch (e) { console.error(e); }
        sync();
        await settle();
      }
      vNow = target;
      const cbs = [...rafs.values()];
      rafs.clear();
      for (const f of cbs) { try { f(vNow); } catch (e) { console.error(e); } }
      sync();
      await settle();
      sync();
      // Images drawn since the last frame are decoded before it is captured.
      await Promise.all([...document.images].map((i) => (i.complete ? null : i.decode().catch(() => {}))));
    },
  };
}

/** The page script, as text for page.addInitScript. */
const CLOCK_SCRIPT = `(${installSteppedClock.toString()})();`;

module.exports = { CLOCK_SCRIPT, installSteppedClock };
