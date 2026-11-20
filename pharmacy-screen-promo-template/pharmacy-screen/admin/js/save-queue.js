// The admin editor's write queue. Each entity's writes run one after another (a chain per key) and carry the
// record's version, so the server refuses (409) an edit made on top of someone else's newer save instead of
// overwriting it. Edits are debounced per field (`later`), and the status pill reads "Saving…" while any
// write is waiting or running, "All changes saved" after, or the error when one failed.
//
// No DOM here: the editor passes `render(state)` and draws the pill itself.

export function createSaveQueue(render = () => {}) {
  const timers = new Map(); // debounce key -> {t, run}
  const chains = new Map(); // chain key -> the last write queued on it
  let inflight = 0, error = null, savedOnce = false;

  function draw() {
    const busy = inflight > 0 || timers.size > 0;
    render({ busy, error, hidden: !busy && !error && !savedOnce });
  }
  async function track(p) {
    inflight++; draw();
    try { const r = await p; savedOnce = true; return r; }
    finally { inflight--; draw(); }
  }
  /** Run `fn` after every write already queued on `chain` (whether that one succeeded or not). */
  function queue(chain, fn) {
    const run = (chains.get(chain) || Promise.resolve()).catch(() => {}).then(fn);
    chains.set(chain, run);
    return track(run);
  }
  /** Debounced write: a later call with the same key replaces the one still waiting. */
  function later(key, chain, fn, ms = 600) {
    const old = timers.get(key);
    if (old) clearTimeout(old.t);
    const run = () => { timers.delete(key); return queue(chain, fn).catch(fail); };
    timers.set(key, { t: setTimeout(run, ms), run });
    draw();
  }
  /**
   * Send every waiting edit now and wait until nothing is waiting or running, including writes a finishing
   * write queued (a new pharmacy's create queues the edits made while it was in flight). Callers switch or
   * delete the selected pharmacy only after this, so no write lands on the wrong record.
   */
  async function flush() {
    for (let round = 0; round < 10; round++) {
      const waiting = [...timers.values()];
      waiting.forEach((v) => clearTimeout(v.t));
      await Promise.all([...waiting.map((v) => v.run()), ...[...chains.values()].map((p) => p.catch(() => {}))]);
      if (!timers.size && !inflight) return;
    }
  }
  function fail(e) {
    error = e && e.code === 'version-conflict' ? 'Someone else changed this. Reload to see their changes.' : `Not saved: ${(e && e.message) || e}`;
    draw();
  }
  return { queue, later, flush, fail, clear() { error = null; draw(); }, pending: () => timers.size + inflight };
}
