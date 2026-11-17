// Helpers every insight script gets as its third argument (`lib`).
//
// This function is NOT called on the server. Its source text is prepended to
// the insight's own script and both run inside the sandbox, so it must be
// self-contained: it may use only `tools` and plain JavaScript — no require,
// no closure over anything in this file.
/* eslint-disable no-unused-vars */
module.exports = function makeLib(tools) {
  const norm = (v) => String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const DAY = 86400000;

  // One record from a spoken or typed reference: an exact id, else a name —
  // exact, then starts-with, then contains — compared case-insensitively and
  // ignoring punctuation. Ambiguous or unknown references throw a message
  // that lists the candidates, so the caller can ask the person which one.
  function pick(list, ref, kind, namesOf) {
    const raw = String(ref == null ? "" : ref).trim();
    if (!raw) throw new Error(`Say which ${kind}: a name or an id.`);
    const byId = list.find((x) => x.id === raw);
    if (byId) return byId;
    const want = norm(raw);
    const names = (x) => namesOf(x).map(norm).filter(Boolean);
    const tiers = [
      list.filter((x) => names(x).some((n) => n === want)),
      list.filter((x) => names(x).some((n) => n.startsWith(want))),
      list.filter((x) => names(x).some((n) => n.includes(want) || want.includes(n))),
    ];
    for (const hits of tiers) {
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) throw new Error(`"${raw}" matches more than one ${kind}: ${hits.slice(0, 6).map((x) => namesOf(x)[0]).join(", ")}. Say which.`);
    }
    throw new Error(`No ${kind} called "${raw}". There ${list.length === 1 ? "is" : "are"}: ${list.slice(0, 12).map((x) => namesOf(x)[0]).join(", ") || "none"}.`);
  }

  async function projects() {
    return (await tools.list_projects({ includeArchived: true })).projects;
  }
  async function resolveProject(ref, list) {
    return pick(list || await projects(), ref, "project", (p) => [p.name]);
  }
  async function resolveConcept(ref) {
    const list = (await tools.list_concepts({})).concepts;
    return pick(list, ref, "concept", (c) => [c.name]);
  }
  // board = kanban_list_people's answer. No reference, or "current", means
  // the board's current release.
  function resolveRelease(ref, board) {
    const raw = String(ref == null ? "" : ref).trim();
    if (!raw || norm(raw) === "current") {
      const cur = board.releases.find((r) => r.id === board.currentRelease);
      if (!cur) throw new Error("No current release is set. Say which release: " + (board.releases.map((r) => r.name).join(", ") || "none exist"));
      return cur;
    }
    return pick(board.releases, raw, "release", (r) => [r.name, r.version, r.version ? "v" + r.version : "", r.version ? "release " + r.version : ""]);
  }

  // Every ticket matching `args`, following nextCursor. Stops early when
  // `until(item)` is true for the last item of a page (the list is newest-
  // updated first, so that means "everything after this is older").
  async function allItems(args, opts) {
    const o = opts || {};
    const out = [];
    let cursor;
    let truncated = false;
    for (let page = 0; page < (o.maxPages || 15); page += 1) {
      const r = await tools.list_backlog_items(Object.assign({ limit: 100 }, args || {}, cursor ? { cursor } : {}));
      out.push(...r.items);
      if (r.truncated) truncated = true;
      cursor = r.nextCursor;
      if (!cursor) return { items: out, truncated };
      if (o.until && r.items.length && o.until(r.items[r.items.length - 1])) return { items: out, truncated };
    }
    return { items: out, truncated: true };
  }

  const ms = (iso) => { const t = Date.parse(iso || ""); return Number.isFinite(t) ? t : 0; };
  const ageDays = (iso, now) => (ms(iso) ? Math.floor(((now || Date.now()) - ms(iso)) / DAY) : null);
  // "2026-11-10", a full ISO time, "7d", "36h", "2w" or a number of days.
  function sinceMs(value, defaultDays, now) {
    const n = now || Date.now();
    if (value == null || value === "") return n - defaultDays * DAY;
    if (typeof value === "number") return n - value * DAY;
    const m = /^\s*(\d+(?:\.\d+)?)\s*(h|d|w)\w*\s*$/i.exec(String(value));
    if (m) return n - Number(m[1]) * ({ h: 3600000, d: DAY, w: 7 * DAY })[m[2].toLowerCase()];
    const t = Date.parse(String(value));
    if (!Number.isFinite(t)) throw new Error(`since must be a date (2026-11-10), an ISO time, or a span like 7d, 36h, 2w. Got "${value}".`);
    return t;
  }
  const clip = (text, n) => { const s = String(text || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
  // The first n, and how many were left out — never a silent cut.
  const top = (list, n) => ({ shown: list.slice(0, n), more: Math.max(0, list.length - n) });
  const countBy = (list, keyOf) => { const out = {}; for (const x of list) { const k = keyOf(x); out[k] = (out[k] || 0) + 1; } return out; };

  const STAGES = [
    ["backlog", "Backlog"], ["ready-for-testing", "Ready for Testing"],
    ["ready-to-publish", "Approved for Deployment"], ["published-live", "Deployed (Live)"],
  ];

  return { norm, pick, projects, resolveProject, resolveConcept, resolveRelease, allItems, ms, ageDays, sinceMs, clip, top, countBy, STAGES, DAY };
};
