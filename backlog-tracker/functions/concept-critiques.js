// Concept Incubator critiques — the pure logic shared by the board and the
// MCP server (THIS file is the generated CommonJS copy of
// public/js/concept-critiques.js — edit that and mirror the change here:
// strip `export ` and keep the module.exports line. test/concept-critiques.test.mjs
// fails if they drift).
//
// A critique is one reviewer's structured red-team review of a concept:
// verdict, arguments for/against, assumptions challenged and recommended
// changes. `role` is free text (CFO, store operations manager, ...) — never a
// fixed list — and a critique without one is grouped as "Unspecified".

const VERDICTS = ["will-work", "wont-work", "conditional"];
const VERDICT_LABEL = { "will-work": "Will work", "wont-work": "Won't work", conditional: "Conditional" };
const UNSPECIFIED_ROLE = "Unspecified";
const LIMITS = { role: 80, reviewer: 120, summary: 2000, item: 600, items: 30 };

function roleOf(c) {
  const r = String((c && c.role) || "").trim();
  return r || UNSPECIFIED_ROLE;
}

// Roles are matched case-insensitively so "CFO" and "cfo" are one role.
function roleKey(role) { return roleOf({ role }).toLowerCase(); }

// Roles already used on any critique, most used first, one spelling per role.
function roleSuggestions(critiques) {
  const seen = new Map();
  for (const c of critiques || []) {
    const r = String((c && c.role) || "").trim();
    if (!r) continue;
    const k = r.toLowerCase();
    const e = seen.get(k) || { role: r, n: 0 };
    e.n += 1;
    seen.set(k, e);
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.role.localeCompare(b.role)).map((e) => e.role);
}

// A short fingerprint of the text a critique reviewed, so it can later be
// shown whether the concept has moved on since.
function textFingerprint(readmeMd, requirementsMd) {
  const s = `${readmeMd || ""}\u0000${requirementsMd || ""}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function words(text) {
  return new Set(String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));
}
function similar(a, b) {
  if (!a.size || !b.size) return false;
  let both = 0;
  for (const w of a) if (b.has(w)) both += 1;
  return both / (a.size + b.size - both) >= 0.6;
}

// Groups near-identical statements; each group keeps the first wording.
function cluster(entries) {
  const groups = [];
  for (const e of entries) {
    const w = words(e.text);
    const g = groups.find((x) => similar(x.words, w));
    if (g) g.entries.push(e); else groups.push({ text: e.text, words: w, entries: [e] });
  }
  return groups;
}

function supporters(entries) {
  const out = [];
  for (const e of entries) if (!out.some((s) => s.critiqueId === e.critiqueId)) out.push({ critiqueId: e.critiqueId, role: e.role, reviewer: e.reviewer });
  return out;
}

function adjustmentState(recs) {
  if (recs.some((r) => r.status === "pending")) return "pending";
  if (recs.some((r) => r.status === "accepted")) return "accepted";
  return "rejected";
}

// Pure, deterministic synthesis — no model call, so it is the same on the
// board and over MCP. `opts.role` limits it to one role (case-insensitive).
function synthesise(critiques, opts) {
  const wantRole = opts && opts.role ? roleKey(opts.role) : null;
  const list = (critiques || []).filter((c) => !wantRole || roleKey(c.role) === wantRole);
  const verdictCounts = { "will-work": 0, "wont-work": 0, conditional: 0 };
  const byRoleMap = new Map();
  const items = { for: [], against: [], assumption: [], rec: [] };
  for (const c of list) {
    if (verdictCounts[c.verdict] !== undefined) verdictCounts[c.verdict] += 1;
    const role = roleOf(c);
    const k = role.toLowerCase();
    const r = byRoleMap.get(k) || { role, critiques: 0, verdicts: { "will-work": 0, "wont-work": 0, conditional: 0 } };
    r.critiques += 1;
    if (r.verdicts[c.verdict] !== undefined) r.verdicts[c.verdict] += 1;
    byRoleMap.set(k, r);
    const base = { critiqueId: c.id, role, reviewer: c.reviewer || "" };
    for (const t of c.argumentsFor || []) items.for.push({ ...base, text: t });
    for (const t of c.argumentsAgainst || []) items.against.push({ ...base, text: t });
    for (const t of c.assumptions || []) items.assumption.push({ ...base, text: t });
    for (const rec of c.recommendations || []) items.rec.push({ ...base, text: rec.text, recId: rec.id, status: rec.status || "pending" });
  }
  const used = Object.keys(verdictCounts).filter((v) => verdictCounts[v] > 0);

  const agreement = [];
  if (list.length > 1 && used.length === 1) agreement.push({ kind: "verdict", text: `All ${list.length} critiques say: ${VERDICT_LABEL[used[0]]}.`, supporters: supporters(list.map((c) => ({ critiqueId: c.id, role: roleOf(c), reviewer: c.reviewer || "" }))) });
  const labels = { for: "argument-for", against: "argument-against", assumption: "assumption", rec: "recommendation" };
  const clusters = {};
  for (const kind of Object.keys(items)) {
    clusters[kind] = cluster(items[kind]);
    for (const g of clusters[kind]) {
      const s = supporters(g.entries);
      if (s.length > 1) agreement.push({ kind: labels[kind], text: g.text, supporters: s });
    }
  }

  const disagreement = [];
  if (used.length > 1) {
    disagreement.push({
      kind: "verdict",
      text: "Verdicts are split: " + used.map((v) => `${verdictCounts[v]} ${VERDICT_LABEL[v].toLowerCase()}`).join(", ") + ".",
      positions: used.map((v) => ({ verdict: v, roles: [...new Set(list.filter((c) => c.verdict === v).map(roleOf))] })),
    });
  }
  // The same point argued for by one reviewer and against by another.
  for (const f of clusters.for) {
    for (const a of clusters.against) {
      if (!similar(f.words, a.words)) continue;
      const pro = supporters(f.entries), con = supporters(a.entries);
      if (pro.some((p) => con.some((q) => q.critiqueId !== p.critiqueId))) disagreement.push({ kind: "contested-point", text: f.text, for: pro, against: con });
    }
  }

  const adjustments = clusters.rec.map((g, i) => {
    const recs = g.entries.map((e) => ({ critiqueId: e.critiqueId, recId: e.recId, status: e.status }));
    return { key: `adj-${i + 1}`, text: g.text, supporters: supporters(g.entries), recs, state: adjustmentState(recs) };
  }).sort((x, y) => y.supporters.length - x.supporters.length);

  return {
    total: list.length,
    verdictCounts,
    byRole: [...byRoleMap.values()].sort((a, b) => b.critiques - a.critiques || a.role.localeCompare(b.role)),
    agreement,
    disagreement,
    adjustments,
  };
}

// "addressed" once every recommendation is decided and at least one was
// accepted; "dismissed" when every one was rejected; otherwise "open".
function critiqueStatus(recs) {
  const r = recs || [];
  if (!r.length || r.some((x) => x.status === "pending")) return "open";
  return r.some((x) => x.status === "accepted") ? "addressed" : "dismissed";
}

// Where an accepted adjustment goes in the concept's markdown: appended to a
// "Critique adjustments" section, so nothing already written is rewritten.
const ADJUSTMENTS_HEADING = "## Critique adjustments";
function applyAdjustment(md, text, source) {
  const line = `- ${String(text).trim()}${source ? ` _(${source})_` : ""}`;
  const base = String(md || "").replace(/\s+$/, "");
  if (base.includes(ADJUSTMENTS_HEADING)) return `${base}\n${line}\n`;
  return `${base}${base ? "\n\n" : ""}${ADJUSTMENTS_HEADING}\n\n${line}\n`;
}

// Cleans the free-form lists a critique carries.
function cleanList(v) {
  return (Array.isArray(v) ? v : []).map((t) => String(t || "").trim()).filter(Boolean).slice(0, LIMITS.items).map((t) => t.slice(0, LIMITS.item));
}

module.exports = { VERDICTS, VERDICT_LABEL, UNSPECIFIED_ROLE, LIMITS, roleOf, roleKey, roleSuggestions, textFingerprint, adjustmentState, synthesise, critiqueStatus, ADJUSTMENTS_HEADING, applyAdjustment, cleanList };
