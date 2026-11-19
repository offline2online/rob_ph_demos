// PH Agent Context — the pure rules (no Firestore, no network).
//
// What a search is made of: the tokens of a text, the keyword score
// (BM25), the local vector every record always has, the hybrid score with
// its recency boost, the filters, the snippet, how a long document is cut
// into chunks, and the cache keys. functions/context/index.js is the part
// that holds the index and talks to Firestore; everything it decides, it
// decides with the functions here, so test/context-core.test.js can check the
// ranking with no stubs at all.
//
// Indexed text is data. Nothing here (or anywhere in functions/context)
// interprets a record's text as an instruction.
"use strict";

const crypto = require("crypto");

// ── Sources ──────────────────────────────────────────────────────────────
// Every kind of record the index holds, the label a pack prints for it, and
// the EXISTING read tool that guards it: a caller sees a record of a source
// only when tools/call would let them call that tool (index.js → mayRead).
const SOURCES = Object.freeze({
  ticket: { label: "Agent board tickets", access: "list_backlog_items" },
  kanban: { label: "Staff Kanban", access: "kanban_list_tasks" },
  project: { label: "Projects", access: "list_projects" },
  concept: { label: "Concepts", access: "get_concept" },
  critique: { label: "Concept critiques", access: "list_concept_critiques" },
  faq: { label: "Help centre", access: "search_faq" },
  lead: { label: "Leads", access: "list_leads" },
  prospect: { label: "Prospects (TAM)", access: "list_prospects" },
  support: { label: "Support threads", access: "list_support_threads" },
  document: { label: "Project documents", access: "get_project_document" },
  skill: { label: "Skills", access: "get_skill" },
});
const SOURCE_NAMES = Object.freeze(Object.keys(SOURCES));

// ── Limits ───────────────────────────────────────────────────────────────
const DIM = 256;                    // dimensions of both vectors
const CHUNK_CHARS = 1600;           // one chunk of a long document
const MAX_CHUNKS = 130;             // chunks kept per record
const MAX_TEXT = 200000;            // characters of one record that are indexed (the longest document the board stores)
const TITLE_MAX = 200;
const SNIPPET_MAX = 220;
const SEARCH_LIMIT_DEFAULT = 10;
const SEARCH_LIMIT_MAX = 50;
const QUERY_MAX = 300;
const PACK_MAX_BYTES = 20 * 1024;   // a context pack, as JSON

// ── Text ─────────────────────────────────────────────────────────────────
const ADDRESS = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi;
// Email addresses never enter the index, a snippet or a pack.
const scrub = (text) => String(text == null ? "" : text).replace(ADDRESS, "[address]");
const squash = (text) => String(text == null ? "" : text).replace(/\s+/g, " ").trim();
const clip = (text, n) => { const s = squash(text); return s.length > n ? `${s.slice(0, Math.max(0, n - 1))}…` : s; };
const stripTags = (html) => String(html == null ? "" : html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n) || 32)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16) || 32)).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");

const STOP = new Set(("a an the and or of to in on for with by at from is are was were be been it this that these those as not but if then than so do does did " +
  "has have had can could will would should may might must i you we they he she its our your their what when where which who how why all any each about into " +
  "over under after before again also only just more most some such very me my us").split(" "));
function stem(w) {
  if (/^\d+$/.test(w)) return w;
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us")) return w.slice(0, -1);
  return w;
}
// The words of a text as the index sees them: lower case, no filler words,
// lightly stemmed, so "deploys", "deployed" and "deploying" are one term.
function tokenize(text) {
  const out = [];
  const words = String(text == null ? "" : text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  for (const w of words) {
    if (w.length < 2 && !/\d/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}
function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

// ── The local vector ─────────────────────────────────────────────────────
// Every record has one, computed from its text with no network: its words
// and the three-letter runs inside them, hashed into DIM buckets. It brings
// near-spellings and word families together ("personalise" and
// "personalisation", a typo, a plural the stemmer missed). It is not a
// language model: the semantic vector (index.js → the embedder) is, and when a
// record has one it is used instead.
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function localVector(text) {
  const v = new Float32Array(DIM);
  const add = (key, weight) => { const h = fnv(key); v[h % DIM] += (h & 0x10000 ? 1 : -1) * weight; };
  for (const w of tokenize(text)) {
    add(`w:${w}`, 1);
    if (w.length > 3) { const p = `^${w}$`; for (let i = 0; i + 3 <= p.length; i += 1) add(`g:${p.slice(i, i + 3)}`, 0.4); }
  }
  return normalize(v);
}
function normalize(v) {
  let n = 0;
  for (let i = 0; i < v.length; i += 1) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i += 1) v[i] /= n;
  return v;
}
// Both vectors are unit length, so the dot product is the cosine.
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

// ── Chunks ───────────────────────────────────────────────────────────────
// A long document is searched a part at a time, so a hit names the heading
// it was found under. Cut at Markdown headings first, then at paragraphs.
// Returns [{ h: heading or "", t: text }], at most MAX_CHUNKS of at most
// CHUNK_CHARS; `truncated` says the document was longer than is indexed.
function chunkText(text) {
  const full = String(text == null ? "" : text).replace(/\r/g, "");
  const body = full.length > MAX_TEXT ? full.slice(0, MAX_TEXT) : full;
  const sections = [];
  let heading = "";
  let buf = [];
  let fence = false;
  const flush = () => { const t = buf.join("\n").trim(); if (t) sections.push({ h: heading, t }); buf = []; };
  for (const line of body.split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    const m = fence ? null : /^ {0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/.exec(line);
    if (m && m[1].trim()) { flush(); heading = clip(m[1], 120); continue; }
    buf.push(line);
  }
  flush();
  // Small sections that follow each other share a chunk (each keeps its
  // heading as a line of the text), so a document of many short sections is
  // indexed whole instead of running out of chunks a fifth of the way in.
  const packed = [];
  for (const s of sections) {
    const last = packed[packed.length - 1];
    const line = s.h ? `${s.h}\n${s.t}` : s.t;
    if (last && last.joined && s.t.length <= CHUNK_CHARS && last.t.length + line.length + 2 <= CHUNK_CHARS) {
      // s: where each further section starts in the chunk, so a hit can still name its own heading.
      (last.s || (last.s = [])).push({ at: last.t.length + 2, h: s.h });
      last.t = `${last.t}\n\n${line}`;
    } else packed.push({ h: s.h, t: s.t, joined: s.t.length <= CHUNK_CHARS });
  }
  const chunks = [];
  for (const p of packed) {
    const s = Object.assign({ h: p.h, t: p.t }, p.s ? { s: p.s } : {});
    if (s.t.length <= CHUNK_CHARS) { chunks.push(s); continue; }
    let cur = "";
    for (const para of s.t.split(/\n{2,}/)) {
      let p = para;
      while (p.length > CHUNK_CHARS) {
        if (cur) { chunks.push({ h: s.h, t: cur }); cur = ""; }
        chunks.push({ h: s.h, t: p.slice(0, CHUNK_CHARS) });
        p = p.slice(CHUNK_CHARS);
      }
      if (cur && cur.length + p.length + 2 > CHUNK_CHARS) { chunks.push({ h: s.h, t: cur }); cur = ""; }
      cur = cur ? `${cur}\n\n${p}` : p;
    }
    if (cur.trim()) chunks.push({ h: s.h, t: cur });
  }
  const truncated = full.length > MAX_TEXT || chunks.length > MAX_CHUNKS;
  return { chunks: chunks.slice(0, MAX_CHUNKS), truncated };
}

// ── Keyword score (BM25) ─────────────────────────────────────────────────
const K1 = 1.2, B = 0.75;
const TITLE_WEIGHT = 3;   // a word in the title counts three times
// stats: { n: chunks in the index, avgLen, df: Map(term -> chunks holding it) }
function idf(term, stats) {
  const df = stats.df.get(term) || 0;
  return Math.log(1 + (stats.n - df + 0.5) / (df + 0.5));
}
function bm25(queryTerms, tf, len, stats) {
  let score = 0;
  const avg = stats.avgLen || 1;
  for (const term of queryTerms) {
    const f = tf.get(term);
    if (!f) continue;
    score += idf(term, stats) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * (len / avg)));
  }
  return score;
}

// ── The hybrid score ─────────────────────────────────────────────────────
const KEYWORD_WEIGHT = 0.65, VECTOR_WEIGHT = 0.35;
const KEYWORD_HALF = 3;            // the BM25 score that counts as half marks
const RECENCY_BOOST = 0.3;         // a record changed today scores up to 30% higher
const RECENCY_DAYS = 45;           // and the boost has faded to a third by here
// With no word in common a record is a hit only when its vector is this close.
const VECTOR_ONLY_MIN = { local: 0.34, semantic: 0.7 };
function recency(updatedAt, now) {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return 1;
  const days = Math.max(0, (now - updatedAt) / 86400000);
  return 1 + RECENCY_BOOST * Math.exp(-days / RECENCY_DAYS);
}
// keyword: the BM25 score; vector: the cosine; kind: which vector it was.
// Returns 0 when the record is not a hit at all.
function hybrid({ keyword, vector, kind = "local", updatedAt, now }) {
  const sim = Math.max(0, vector || 0);
  if (!(keyword > 0) && sim < VECTOR_ONLY_MIN[kind]) return 0;
  const kw = keyword > 0 ? keyword / (keyword + KEYWORD_HALF) : 0;
  return (KEYWORD_WEIGHT * kw + VECTOR_WEIGHT * sim) * recency(updatedAt, now);
}

// A message for the caller (a bad argument, nothing by that name): the tools
// show it as it is. Any other error is a fault and is not shown.
class Refusal extends Error {}

// ── Filters ──────────────────────────────────────────────────────────────
// "2026-11-10", an ISO time, a span back from now ("7d", "36h", "2w") or a
// number of milliseconds. Returns ms, or null when not given; throws on junk.
function parseWhen(value, now, name) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(h|d|w)\w*\s*$/i.exec(String(value));
  if (m) return now - Number(m[1]) * ({ h: 3600000, d: 86400000, w: 7 * 86400000 })[m[2].toLowerCase()];
  const t = Date.parse(String(value));
  if (!Number.isFinite(t)) throw new Refusal(`${name} must be a date (2026-11-10), an ISO time, or a span like 7d, 36h, 2w. Got "${value}".`);
  return t;
}
const listOf = (v) => (v == null || v === "" ? null : (Array.isArray(v) ? v : [v]).map((x) => String(x).trim().toLowerCase()).filter(Boolean));
// The filters as the index applies them, from a tool's arguments. Throws an
// Error whose message is safe to show when one is not understood.
function cleanFilters(args, now) {
  const a = args || {};
  const sources = listOf(a.sources || a.source);
  if (sources) for (const s of sources) if (!SOURCE_NAMES.includes(s)) throw new Refusal(`Unknown source "${s}". Sources: ${SOURCE_NAMES.join(", ")}.`);
  const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    sources: sources && sources.length ? sources : null,
    projectId: str(a.projectId), conceptId: str(a.conceptId),
    status: listOf(a.status), type: listOf(a.type),
    owner: str(a.owner) ? str(a.owner).toLowerCase() : null,
    since: parseWhen(a.since, now, "since"), until: parseWhen(a.until, now, "until"),
    includeArchived: a.includeArchived === true,
    open: typeof a.open === "boolean" ? a.open : null,
  };
}
// A record is "archived" when its own read tool hides it by default: an
// archived ticket, lead or project, a Help Centre article that isn't
// published. Naming its status asks for it, as includeArchived does.
function matchFilters(e, f) {
  if (f.sources && !f.sources.includes(e.source)) return false;
  if (f.projectId && e.projectId !== f.projectId && !(Array.isArray(e.projectIds) && e.projectIds.includes(f.projectId))) return false;
  if (f.conceptId && e.conceptId !== f.conceptId) return false;
  if (f.status && !f.status.includes(String(e.status || "").toLowerCase())) return false;
  if (f.type && !f.type.includes(String(e.type || "").toLowerCase())) return false;
  if (f.owner && String(e.owner || "").toLowerCase() !== f.owner) return false;
  if (f.since != null && !(e.updatedAt >= f.since)) return false;
  if (f.until != null && !(e.updatedAt <= f.until)) return false;
  if (f.open != null && Boolean(e.open) !== f.open) return false;
  if (e.archived && !f.includeArchived && !f.status) return false;
  return true;
}

// ── Snippet ──────────────────────────────────────────────────────────────
// The part of the text around the first query word, in one line.
function snippet(text, queryTerms, max = SNIPPET_MAX) {
  const s = squash(text);
  if (s.length <= max) return s;
  const want = new Set(queryTerms);
  let at = 0;
  const re = /[\p{L}\p{N}]+/gu;
  let m;
  while ((m = re.exec(s))) {
    if (want.has(stem(m[0].toLowerCase()))) { at = m.index; break; }
  }
  let start = Math.max(0, at - Math.floor(max / 3));
  if (start > 0) { const sp = s.indexOf(" ", start); if (sp !== -1 && sp < at) start = sp + 1; }
  const end = Math.min(s.length, start + max);
  return `${start > 0 ? "…" : ""}${s.slice(start, end).trim()}${end < s.length ? "…" : ""}`;
}

// The heading a hit was found under: the chunk's own, or, in a chunk that
// holds several short sections, the one the first query word falls in.
function sectionOf(chunk, queryTerms) {
  if (!chunk) return "";
  if (!Array.isArray(chunk.s) || !chunk.s.length) return chunk.h || "";
  const want = new Set(queryTerms);
  const re = /[\p{L}\p{N}]+/gu;
  let at = 0, m;
  while ((m = re.exec(chunk.t))) { if (want.has(stem(m[0].toLowerCase()))) { at = m.index; break; } }
  let h = chunk.h || "";
  for (const sub of chunk.s) if (sub.at <= at) h = sub.h || h;
  return h;
}

// ── Content version ──────────────────────────────────────────────────────
// What a pack remembers about a record it cites. It changes when the indexed
// content changes, and not when a field the index ignores does.
function contentHash(entry) {
  const view = {
    t: entry.title, x: entry.text, p: entry.projectId || null, ps: entry.projectIds || null, c: entry.conceptId || null,
    // The day it last changed, not the instant: recency and date filters stay
    // right without an index write for every stamp on a busy ticket.
    d: Math.floor((Number(entry.updatedAt) || 0) / 86400000),
    s: entry.status || null, y: entry.type || null, o: entry.owner || null, op: Boolean(entry.open), a: Boolean(entry.archived),
    u: entry.url || null, m: entry.meta || null, ac: entry.access,
  };
  return crypto.createHash("sha256").update(JSON.stringify(view), "utf8").digest("hex").slice(0, 20);
}

// ── Topics and cache keys ────────────────────────────────────────────────
const normTopic = (t) => squash(String(t == null ? "" : t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " "));
const sha = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
// What a caller may see, as one string: the role, and the sources it opens.
// It is part of every cache key, so a pack built for one role is never read
// back by another.
function visibilityKey(role, sources) {
  return `${String(role || "none")}|${[...(sources || [])].sort().join(",")}`;
}
// topicRef: "project:<id>", "concept:<id>", "lead:<id>" or "text:<normalised words>".
function packKey(topicRef, visibility) {
  return sha(`pack|${visibility}|${topicRef}`).slice(0, 40);
}
function queryKey(query, filters, limit, visibility) {
  return sha(`search|${visibility}|${normTopic(query)}|${JSON.stringify(filters)}|${limit}`).slice(0, 40);
}
const queryHash = (text) => sha(normTopic(text)).slice(0, 32);

// Names are matched the way Aidan's resolveProjectRef matches them: an id
// first, then the name exactly, then starting with it, then containing it;
// two candidates at a tier is no match. rows: [{ id, name }]. Returns the row or null.
const normRef = (t) => String(t == null ? "" : t).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// opts.contains false: only the id, the whole name, or the start of it.
function resolveRef(ref, rows, opts = {}) {
  const raw = typeof ref === "string" ? ref.trim() : "";
  const list = Array.isArray(rows) ? rows : [];
  if (!raw) return null;
  const byId = list.find((r) => r.id === raw);
  if (byId) return byId;
  const want = normRef(raw);
  if (!want) return null;
  const name = (r) => normRef(r.name);
  // Whole words only ("arc" is not in "search"), and a name found inside a
  // longer topic must be at least two words or eight letters, so a short
  // name does not capture a sentence that happens to use the word.
  const within = (hay, needle) => ` ${hay} `.includes(` ${needle} `);
  const distinctive = (n) => n.includes(" ") || n.length >= 8;
  const tiers = [
    list.filter((r) => name(r) && name(r) === want),
    list.filter((r) => name(r) && name(r).startsWith(want) && (name(r).length === want.length || name(r)[want.length] === " " || want.length >= 4)),
    opts.contains === false ? [] : list.filter((r) => name(r) && (within(name(r), want) || (distinctive(name(r)) && within(want, name(r))))),
  ];
  for (const hits of tiers) {
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

// A comment that reads like a decision (the same test the concept_status
// insight uses: discussions have no "decision" field).
const DECISION = /\b(decid\w*|decision|agreed?|we(?:'| wi)ll go with|go(?:ing)? with|approved?|sign(?:ed)? off|settled|ruled out|won't|will not|confirmed)\b/i;

// ── A small LRU with a time limit ────────────────────────────────────────
function lru(max, ttlMs, clock = Date.now) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (clock() - hit.at > ttlMs) { map.delete(key); return undefined; }
      map.delete(key); map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, at: clock() });
      while (map.size > max) map.delete(map.keys().next().value);
    },
    delete(key) { map.delete(key); },
    clear() { map.clear(); },
    get size() { return map.size; },
  };
}

module.exports = {
  Refusal, SOURCES, SOURCE_NAMES, DIM, CHUNK_CHARS, MAX_CHUNKS, MAX_TEXT, TITLE_MAX, SNIPPET_MAX, SEARCH_LIMIT_DEFAULT, SEARCH_LIMIT_MAX, QUERY_MAX, PACK_MAX_BYTES,
  TITLE_WEIGHT, KEYWORD_WEIGHT, VECTOR_WEIGHT, RECENCY_BOOST, RECENCY_DAYS, VECTOR_ONLY_MIN,
  scrub, squash, clip, stripTags, stem, tokenize, termFreq, localVector, normalize, cosine, chunkText,
  idf, bm25, recency, hybrid, parseWhen, cleanFilters, matchFilters, snippet, sectionOf, contentHash,
  normTopic, sha, visibilityKey, packKey, queryKey, queryHash, normRef, resolveRef, DECISION, lru,
};
