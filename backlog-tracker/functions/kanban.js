// Staff Kanban on the server (kanban-staff-board/REQUIREMENTS.md):
//
//   syncMemberDirectory   consoleUsers/{email} → memberDirectory/{email}:
//                         every member's name and photo (no role), which any
//                         member may read. consoleUsers itself is admin-only
//                         to list, and the board needs everyone's name for
//                         its assignee lists and avatars (KB-PPL-1).
//   /mcp/kanban/agent-fill   KB-MOD-2: a voice transcript in, a ticket draft
//                         out, written by Claude. Answers { draft: null }
//                         until ANTHROPIC_API_KEY is set, and the page then
//                         fills the ticket with its local stand-in.
//   /mcp/kanban/directory-sync   fills memberDirectory from consoleUsers
//                         when it is behind (the first time the board opens).
//   /mcp/kanban/backfill  fills kanbanCards (the light copy of each ticket the
//                         board reads) from kanbanTasks, and moves inline
//                         screenshots in descriptions to Storage. Idempotent;
//                         the board calls it when it finds the cards behind.
//   kanbanTools()         the KB-MCP-1 tools, attributed to the member. Every
//                         write puts a ticket's card in the same batch or
//                         transaction as the ticket.
//
// The board's rules (statuses, the testing hand-off, search tokens, the
// release report) come from kanban-core.js, a generated CommonJS copy of
// public/js/kanban/kanban-core.js, so the page and the tools agree.
"use strict";
const { FieldValue, FieldPath } = require("firebase-admin/firestore");
const crypto = require("crypto");
const logger = require("firebase-functions/logger");
const core = require("./kanban-core");
const notify = require("./kanban-notify");

const db = () => require("firebase-admin/firestore").getFirestore();
const TASKS = "kanbanTasks";
const CARDS = "kanbanCards";
const BUCKET = "backlog-tracker-e4ed2.firebasestorage.app";

// ── Per-instance cache ─────────────────────────────────────────────────────
// The member directory, settings, releases, sprints, projects and the
// cards-or-tickets check change rarely and every tool wants them, so each is
// read at most once a minute per function instance. This instance's own
// writes to the directory drop its copy at once (syncMemberDirectoryWrite).
const CACHE_MS = 60000;
const cache = new Map();
async function cached(name, load) {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(name, { at: Date.now(), value });
  return value;
}
const clearCaches = (name) => { if (name) cache.delete(name); else cache.clear(); };
// An index still building answers FAILED_PRECONDITION (gRPC 9): the caller
// falls back to the read it made before the index existed, never an error.
const indexMissing = (err) => !!err && (err.code === 9 || /FAILED_PRECONDITION|requires an index/i.test(String(err.message || err)));

// ── Cards ─────────────────────────────────────────────────────────────────
// kanbanCards/{PH-n} is what the board reads (core.cardOf + closedAt and who
// last wrote it). A card is built from the whole ticket, so the two cannot
// be derived apart.
function cardData(t, email, closedAt) {
  const c = core.cardOf(t);
  if (!c.open) c.closedAt = closedAt !== undefined ? closedAt : t.closedAt || FieldValue.serverTimestamp();
  return Object.assign(c, { updatedAt: FieldValue.serverTimestamp(), updatedBy: email });
}
// Which collection a read of "the board" uses: the cards, once they have
// caught up with the tickets, else the tickets (no ticket ever disappears).
async function boardCollection() {
  return cached("board", async () => {
    try {
      const [c, t] = await Promise.all([db().collection(CARDS).count().get(), db().collection(TASKS).count().get()]);
      return c.data().count >= t.data().count ? CARDS : TASKS;
    } catch (err) { return TASKS; }
  });
}

// ── Member directory ──────────────────────────────────────────────────────
// The console's bootstrap admins (mcp-server.js STATIC_ADMINS, firestore.rules)
// are members without a consoleUsers row, so the sync below would otherwise
// leave them off every assignee list. The other owner account,
// rob@personalisationhub.com, is an alias of this one (core.PERSON_ALIASES):
// an alias never gets an entry, its owner stands for it on the board.
const BOOTSTRAP_ADMINS = ["rob@offline2online.com"];
function directoryEntry(email, row) {
  return {
    email,
    displayName: typeof row.displayName === "string" ? row.displayName.slice(0, 120) : "",
    photoUrl: typeof row.photoUrl === "string" ? row.photoUrl : "",
    photoUpdatedAt: row.photoUpdatedAt || null,
    disabled: row.disabled === true,
  };
}
async function syncMemberDirectoryWrite(event) {
  const email = String(event.params.userEmail || "").toLowerCase();
  if (!email) return;
  clearCaches("directory");
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const ref = db().collection("memberDirectory").doc(email);
  if (core.isAliasEmail(email)) { await ref.delete(); return; }
  if (!after) {
    if (BOOTSTRAP_ADMINS.includes(email)) await ref.set(directoryEntry(email, {})); else await ref.delete();
    return;
  }
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  // A sign-in stamp (lastLoginAt) changes nothing the directory holds.
  const same = before && ["displayName", "photoUrl", "disabled"].every((k) => before[k] === after[k])
    && String(before.photoUpdatedAt && before.photoUpdatedAt.toMillis ? before.photoUpdatedAt.toMillis() : before.photoUpdatedAt || "") === String(after.photoUpdatedAt && after.photoUpdatedAt.toMillis ? after.photoUpdatedAt.toMillis() : after.photoUpdatedAt || "");
  if (same) {
    const cur = await ref.get();
    if (cur.exists) return;
  }
  await ref.set(directoryEntry(email, after));
}
async function syncWholeDirectory() {
  const [users, dir] = await Promise.all([db().collection("consoleUsers").get(), db().collection("memberDirectory").get()]);
  const have = new Set(dir.docs.map((d) => d.id));
  const want = new Set();
  const b = db().batch();
  let writes = 0;
  users.forEach((d) => {
    const email = d.id.toLowerCase();
    if (core.isAliasEmail(email)) return;
    want.add(email);
    b.set(db().collection("memberDirectory").doc(email), directoryEntry(email, d.data() || {}));
    writes++;
  });
  for (const email of BOOTSTRAP_ADMINS) {
    if (want.has(email)) continue;
    want.add(email);
    b.set(db().collection("memberDirectory").doc(email), directoryEntry(email, {}));
    writes++;
  }
  for (const id of have) if (!want.has(id)) { b.delete(db().collection("memberDirectory").doc(id)); writes++; }
  if (writes) await b.commit();
  clearCaches("directory");
  return { members: want.size };
}

// ── Agent fill (KB-MOD-2) ────────────────────────────────────────────────
const AGENT_MODEL = "claude-opus-5-5";
const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "description", "type", "priority", "assignee", "release", "estimateHours", "due", "sprint", "labels", "epic", "flagged"],
  properties: {
    title: { type: "string", description: "Short imperative title, at most 70 characters." },
    description: { type: "string", description: "The task in tidy sentences, without the routing talk (who, when, how urgent)." },
    type: { type: "string", enum: ["task", "bug", "epic"] },
    priority: { type: "string", enum: ["", "highest", "high", "medium", "low", "lowest"] },
    assignee: { type: "string", description: "One of the given people's ids (emails), or empty." },
    release: { type: "string", description: "One of the given release ids, or empty for none." },
    estimateHours: { type: ["number", "null"], description: "Hours of work if an estimate was said (1 day = 8 hours), else null." },
    due: { type: "string", description: "YYYY-MM-DD if a deadline was said, else empty." },
    sprint: { type: "string", description: "One of the given sprint ids, or empty." },
    labels: { type: "array", items: { type: "string" } },
    epic: { type: "string", description: "The key of a given epic this belongs to, or empty." },
    flagged: { type: "boolean", description: "True if the speaker said it is blocked or should be flagged." },
  },
};
const AGENT_SYSTEM = [
  "You turn a spoken note from a member of staff into a ticket on their team's Kanban board (a Jira replacement).",
  "Write a short title and a clear description in British English. Keep the speaker's meaning; drop filler and the routing talk (who should do it, how urgent, how long, which release), which goes in the fields instead.",
  "Fill a field only when the note says it, or clearly implies it. Choose people, releases, sprints and epics only from the lists given, by id. Leave anything else empty.",
  "A bug is something broken or wrong; an epic is a larger body of work; anything else is a task.",
  "The board context names the speaker (me, one of the people ids). When the note gives the work to the speaker (\"for me\", \"assign it to myself\", \"I need to\", \"remind me\"), the assignee is that id.",
].join(" ");

// Returns the draft in the page's shape, or null.
async function claudeDraft(apiKey, transcript, context, { Anthropic } = {}) {
  const Client = Anthropic || require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const client = new Client({ apiKey, timeout: 25000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: AGENT_MODEL,
    max_tokens: 4000,
    // Voice capture waits on this, so a light touch: low effort, JSON out.
    output_config: { effort: "low", format: { type: "json_schema", schema: DRAFT_SCHEMA } },
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
    system: AGENT_SYSTEM,
    messages: [{ role: "user", content: `Today is ${context.today}.\n\nBoard context (JSON):\n${JSON.stringify(context)}\n\nSpoken note:\n${transcript}` }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { return null; }
  return draftFromClaude(out, context);
}
// Keeps only values the board can use: known ids, sane numbers and dates.
function draftFromClaude(o, c) {
  if (!o || typeof o !== "object") return null;
  const ids = (list, key = "id") => new Set((list || []).map((x) => x[key]));
  const pick = (v, set) => (typeof v === "string" && set.has(v) ? v : "");
  const out = {
    title: String(o.title || "").trim().slice(0, 200),
    description: String(o.description || "").trim().slice(0, 20000),
    type: ["task", "bug", "epic"].includes(o.type) ? o.type : "task",
    priority: ["highest", "high", "medium", "low", "lowest"].includes(o.priority) ? o.priority : "",
    assignee: pick(core.canonicalEmail(o.assignee), ids(c.users)),
    release: pick(o.release, ids(c.releases)),
    sprint: pick(o.sprint, ids(c.sprints)),
    epic: pick(o.epic, ids(c.epics, "key")),
    due: /^\d{4}-\d{2}-\d{2}$/.test(o.due || "") ? o.due : "",
    labels: Array.isArray(o.labels) ? [...new Set(o.labels.map((l) => String(l).trim().toLowerCase().replace(/\s+/g, "-")).filter(Boolean))].slice(0, 10) : [],
    flagged: o.flagged === true,
  };
  if (typeof o.estimateHours === "number" && o.estimateHours > 0 && o.estimateHours < 10000) out.estimate = Math.round(o.estimateHours * 4) / 4;
  if (!out.title) return null;
  return out;
}

function cleanContext(c) {
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  const s = (v, n = 200) => String(v == null ? "" : v).slice(0, n);
  return {
    today: /^\d{4}-\d{2}-\d{2}$/.test(c.today || "") ? c.today : new Date().toISOString().slice(0, 10),
    users: arr(c.users, 200).filter((u) => !core.isAliasEmail(u && u.id)).map((u) => ({ id: s(u.id), first: s(u.first, 60), full: s(u.full, 120) })),
    me: core.canonicalEmail(s(c.me)),
    epics: arr(c.epics, 300).map((e) => ({ key: s(e.key, 20), title: s(e.title) })),
    releases: arr(c.releases, 100).map((r) => ({ id: s(r.id, 100), name: s(r.name, 120), version: s(r.version, 40), released: !!r.released })),
    currentRelease: s(c.currentRelease, 100),
    sprints: arr(c.sprints, 100).map((x) => ({ id: s(x.id, 100), name: s(x.name, 80), start: s(x.start, 10), end: s(x.end, 10) })),
    labels: arr(c.labels, 200).map((l) => s(l, 40)),
  };
}

// helpers: { requireConsoleUser, rateLimited, tooMany, anthropicKey(), Anthropic? }
async function handleAgentFill(req, res, h) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (h.rateLimited(req, "kanban-agent", 60)) return h.tooMany(res);
  const who = await h.requireConsoleUser(req, "editor");
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const transcript = String(body.transcript || "").trim().slice(0, 8000);
  if (!transcript) { res.status(400).json({ error: "transcript is required" }); return; }
  const key = h.anthropicKey();
  // 200 with no draft, not an error status: the page falls back quietly.
  if (!key || key === "unset") { res.status(200).json({ draft: null, reason: "not-configured" }); return; }
  try {
    // The speaker is whoever the token says, never what the page claims.
    const context = cleanContext(Object.assign({}, body.context || {}, { me: who.user.email }));
    const draft = await claudeDraft(key, transcript, context, { Anthropic: h.Anthropic });
    res.status(200).json(draft ? { draft, source: "claude" } : { draft: null, reason: "no-draft" });
  } catch (err) {
    logger.warn("kanban agent fill failed", { email: who.user.email, error: String(err && err.message ? err.message : err) });
    res.status(200).json({ draft: null, reason: "error" });
  }
}
async function handleDirectorySync(req, res, h) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (h.rateLimited(req, "kanban-directory", 10)) return h.tooMany(res);
  const who = await h.requireConsoleUser(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const out = await syncWholeDirectory();
  res.status(200).json(out);
}

// ── Backfill: kanbanCards from kanbanTasks, screenshots to Storage ─────────
// Idempotent and sliced, so the board can call it whenever it finds the cards
// behind and nobody needs a terminal: each call handles BACKFILL_SLICE tickets
// after `after` (document-id order, a page at a time, never the whole
// collection), writing a card where it is missing or differs and moving inline
// (data:) screenshots in a description to Storage. Once the tickets are done it
// pages the cards the same way (after: "orphans:<id>") and removes those whose
// ticket is gone. Answers { done, after, ... }.
const BACKFILL_SLICE = 100;
const sameCard = (card, want, closedAt) => {
  if (!card) return false;
  for (const k of core.CARD_FIELDS) if (JSON.stringify(card[k]) !== JSON.stringify(want[k])) return false;
  const ms = (v) => (v && v.toMillis ? v.toMillis() : v instanceof Date ? v.getTime() : v);
  if (want.open) return card.closedAt === undefined || card.closedAt === null;
  return card.closedAt != null && (closedAt == null || ms(card.closedAt) === ms(closedAt));
};
async function uploadInlineImage(h, key, uri) {
  const parts = core.dataUriParts(uri);
  if (!parts) return uri;
  const ext = (parts.contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
  const path = `kanban/${key}/${Date.now()}-${crypto.randomBytes(3).toString("hex")}-screenshot.${ext}`;
  const token = crypto.randomUUID();
  const bucket = h && h.bucket ? h.bucket() : require("firebase-admin/storage").getStorage().bucket(BUCKET);
  await bucket.file(path).save(Buffer.from(parts.base64, "base64"), { contentType: parts.contentType, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}
// A page of ids in document-id order after `after` (the server's own order, so
// the cursor needs no sorting of the whole collection).
const idPage = (coll, after, size) => {
  let q = db().collection(coll).orderBy(FieldPath.documentId());
  if (after) q = q.startAfter(after);
  return q.limit(size);
};
const ORPHANS = "orphans:";
async function backfillSlice({ after = "", size = BACKFILL_SLICE, h } = {}) {
  const out = { cards: 0, images: 0, failed: 0, orphans: 0 };
  const b = db().batch();
  let writes = 0;
  // Second pass: cards whose ticket is gone, a page of cards at a time.
  const orphanPass = async (from) => {
    const page = (await idPage(CARDS, from, size).select().get()).docs;
    for (const d of page) {
      if (!(await db().collection(TASKS).doc(d.id).get()).exists) { b.delete(d.ref); out.orphans += 1; writes++; }
    }
    const done = page.length < size;
    return { done, after: done ? ORPHANS : ORPHANS + page[page.length - 1].id, scanned: page.length };
  };
  let res;
  if (after.startsWith(ORPHANS)) res = await orphanPass(after.slice(ORPHANS.length));
  else {
    const page = (await idPage(TASKS, after, size).get()).docs;
    for (const snap of page) {
      const key = snap.id;
      const ref = snap.ref;
      const t = Object.assign({ key }, snap.data());
      if (core.hasInlineImages(t.description)) {
        try {
          const html = await core.externaliseInlineImages(t.description, (uri) => uploadInlineImage(h, key, uri));
          b.update(ref, { description: html });
          out.images += 1; writes++;
          t.description = html;
        } catch (err) {
          out.failed += 1;
          logger.warn("kanban backfill: screenshots not moved", { key, error: String(err && err.message ? err.message : err) });
        }
      }
      const have = (await db().collection(CARDS).doc(key).get()).data();
      if (!sameCard(have, core.cardOf(t), t.closedAt)) {
        b.set(db().collection(CARDS).doc(key), cardData(t, t.updatedBy || "backfill", t.closedAt));
        out.cards += 1; writes++;
      }
    }
    // The last page of tickets carries on into the orphan pass in the same call.
    res = page.length < size ? await orphanPass("") : { done: false, after: page[page.length - 1].id, scanned: page.length };
  }
  if (writes) await b.commit();
  return Object.assign(res, out);
}
async function handleBackfill(req, res, h) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (h.rateLimited(req, "kanban-backfill", 120)) return h.tooMany(res);
  const who = await h.requireConsoleUser(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const after = req.body && typeof req.body.after === "string" ? req.body.after : "";
  try {
    res.status(200).json(await backfillSlice({ after, h }));
  } catch (err) {
    logger.error("kanban backfill failed", { error: String(err && err.stack ? err.stack : err) });
    res.status(500).json({ error: "backfill_failed" });
  }
}

// ── Links on both tickets: the backfill ─────────────────────────────────────
// Links stored before they were written on both tickets are one-sided. This
// adds the missing side (arrayUnion, so running it twice changes nothing) and,
// on the last slice, stamps kanbanSettings/main.linksTwoSidedAt, which is how
// the board knows to stop asking.
async function backfillLinksSlice({ after = "", size = BACKFILL_SLICE } = {}) {
  const page = (await idPage(TASKS, after, size).get()).docs;
  const out = { links: 0 };
  const b = db().batch();
  for (const snap of page) {
    const key = snap.id;
    for (const l of (snap.data() || {}).links || []) {
      if (!core.INVERSE_LINK[l.type] || l.key === key) continue;
      const inv = core.inverseOf(key, l);
      const other = await db().collection(TASKS).doc(l.key).get();
      if (!other.exists || ((other.data() || {}).links || []).some((x) => x.type === inv.type && x.key === inv.key)) continue;
      b.update(db().collection(TASKS).doc(l.key), { links: FieldValue.arrayUnion(inv) });
      out.links += 1;
    }
  }
  const done = page.length < size;
  const last = page.length ? page[page.length - 1].id : after;
  if (done) b.set(db().collection("kanbanSettings").doc("main"), { linksTwoSidedAt: FieldValue.serverTimestamp() }, { merge: true });
  await b.commit();
  return Object.assign({ done, after: last, scanned: page.length }, out);
}
async function handleBackfillLinks(req, res, h) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (h.rateLimited(req, "kanban-backfill-links", 120)) return h.tooMany(res);
  const who = await h.requireConsoleUser(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const after = req.body && typeof req.body.after === "string" ? req.body.after : "";
  try {
    res.status(200).json(await backfillLinksSlice({ after }));
  } catch (err) {
    logger.error("kanban links backfill failed", { error: String(err && err.stack ? err.stack : err) });
    res.status(500).json({ error: "backfill_failed" });
  }
}

// ── Attachments over MCP (kanban_attach_file) ──────────────────────────────
// The bytes arrive base64 in the call; nothing is ever fetched from a URL.
// Only types whose first bytes can be checked are accepted, so a file can't
// claim to be a picture and be something else.
const ATTACH_MAX_BYTES = 5 * 1024 * 1024;
const ATTACH_MAX_PER_TICKET = 50;
const ATTACH_PER_HOUR = 60;
const ATTACH_MAX_SIDE = 1400; // the page shrinks a pasted screenshot to this too
const ATTACH_TYPES = {
  "image/png": { ext: "png", magic: (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a },
  "image/jpeg": { ext: "jpg", magic: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { ext: "gif", magic: (b) => b.length > 6 && /^GIF8[79]a$/.test(b.toString("latin1", 0, 6)) },
  "image/webp": { ext: "webp", magic: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
  "application/pdf": { ext: "pdf", magic: (b) => b.length > 5 && b.toString("latin1", 0, 5) === "%PDF-" },
};
const ATTACH_LIMIT_TEXT = "png, jpeg, webp or gif images, or a pdf, at most 5 MB once decoded";
const imageResizer = {
  // Shrinks png / jpeg / webp whose longest side is over ATTACH_MAX_SIDE. A gif
  // is kept as it is (resizing would drop its animation). Without the sharp
  // module the original is stored, which is still within the size limit.
  async resize(buf, contentType) {
    if (contentType === "image/gif") return { buf, resized: false };
    let sharp;
    try { sharp = require("sharp"); } catch (err) { return { buf, resized: false }; }
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height || Math.max(meta.width, meta.height) <= ATTACH_MAX_SIDE) return { buf, resized: false };
    const out = await sharp(buf).rotate().resize({ width: ATTACH_MAX_SIDE, height: ATTACH_MAX_SIDE, fit: "inside", withoutEnlargement: true }).toBuffer();
    return { buf: out, resized: true };
  },
};
const safeFileName = (name, ext) => {
  let n = String(name || "").split(/[\\/]/).pop().normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|-+$/g, "").replace(/-{2,}/g, "-").slice(0, 80);
  if (!n) n = "file";
  if (!new RegExp(`\\.${ext}$`, "i").test(n) && !(ext === "jpg" && /\.jpeg$/i.test(n))) n += "." + ext;
  return n;
};
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ── MCP tools (KB-MCP-1) ──────────────────────────────────────────────────
// One sentence, appended to every kanban_* tool description (so tools added
// later carry it too), saying which board is for what.
const KANBAN_SCOPE = "Staff Kanban is for staff tasks only: work a human staff member does. Agent work (product, docs, prototype and tooling changes, including for the Staff Kanban project itself) goes in the agent backlog with create_backlog_item. You can still create and assign staff tasks here.";
// h: { textResult, toolError, audit }
function kanbanTools(h) {
  const { textResult, toolError } = h;
  // Every call writes one mcpAuditLog row with the milliseconds it took, so a
  // slow tool shows up. A write tool's own audit detail rides on that row
  // (the wrapper at the end); called outside a wrapped run it writes its own.
  const timings = new WeakMap();
  const audit = (session, tool, detail) => {
    const t = timings.get(session);
    if (t) { Object.assign(t.detail, detail || {}); return Promise.resolve(); }
    return h.audit(session, tool, detail);
  };
  const tasks = () => db().collection(TASKS);
  const PERSON = { type: "string", description: "A member's email address, or \"me\" for yourself; kanban_list_people says who's who." };
  const KEY = { type: "string", description: "Ticket key, e.g. PH-36." };
  const normKey = (k) => { const n = core.keyNumber(String(k || "").trim().replace(/^ph\s*-?\s*/i, "PH-").replace(/^(\d+)$/, "PH-$1")); return n == null ? null : core.keyOf(n); };

  const settings = () => cached("settings", async () => {
    const s = await db().collection("kanbanSettings").doc("main").get();
    return core.normaliseSettings(s.exists ? s.data() : null);
  });
  // Releases, sprints and console projects (document snapshots), read once a minute.
  const releases = () => cached("releases", async () => (await db().collection("releases").get()).docs);
  const sprints = () => cached("sprints", async () => (await db().collection("kanbanSprints").get()).docs);
  const projects = () => cached("projects", async () => (await db().collection("projects").get()).docs);
  // The chosen current release, else the earliest one not yet live.
  const currentRelease = (s, relDocs) => core.currentReleaseId(s, relDocs.map((d) => ({ id: d.id, version: d.data().version, released: d.data().status === "live", order: d.data().order })));
  // The directory, plus the bootstrap admins and the caller when they have no
  // consoleUsers row (so no directory entry yet).
  async function people(session) {
    const docs = await cached("directory", async () => (await db().collection("memberDirectory").get()).docs.map((d) => d.data() || {}));
    const list = docs.filter((m) => !m.disabled && !core.isAliasEmail(m.email));
    const have = new Set(list.map((m) => String(m.email || "").toLowerCase()));
    for (const email of [...BOOTSTRAP_ADMINS, session && session.email]) {
      const e = String(email || "").toLowerCase();
      if (e && !have.has(e)) { have.add(e); list.push(directoryEntry(e, session && e === session.email ? { displayName: session.displayName } : {})); }
    }
    return list;
  }
  // The board's first name for someone, as the page shows it.
  const firstOf = (p, s) => String((s.firstNames || {})[p.email] || "").trim() || String(p.displayName || "").trim().split(/\s+/)[0] || String(p.email).split("@")[0];
  // "me" means the authenticated member.
  const meOr = (v, session) => (String(v || "").trim().toLowerCase() === "me" ? session.email : v);
  const resolveMe = (args, session) => {
    const out = Object.assign({}, args);
    for (const k of ["assignee", "reporter"]) if (k in out) out[k] = meOr(out[k], session);
    return out;
  };
  async function firstNamer() {
    const [ppl, s] = await Promise.all([people(), settings()]);
    const map = new Map(ppl.map((p) => [p.email, firstOf(p, s)]));
    return (e) => (e ? map.get(core.canonicalEmail(e)) || String(e).split("@")[0] : "Unassigned");
  }
  async function getTask(key) {
    const snap = await tasks().doc(key).get();
    return snap.exists ? Object.assign({ key }, snap.data()) : null;
  }
  function summary(t, first) {
    return {
      key: t.key, type: t.type, title: t.title, status: t.status, statusLabel: core.statusLabel(t.status, t.resolution),
      resolution: t.resolution || null, priority: t.priority || null, flagged: !!t.flagged,
      assignee: t.assignee || null, assigneeName: first(t.assignee), release: t.release || null, sprint: t.sprint || null, project: t.project || null,
      epic: t.epic || null, estimate: typeof t.estimate === "number" ? core.fmtH(t.estimate) : null,
      logged: t.logged ? core.fmtH(t.logged) : null, remaining: typeof t.estimate === "number" ? core.fmtH(core.remaining(t)) : null,
      due: t.due || null, labels: t.labels || [],
      criteriaTotal: core.cardOf(t).acTotal, criteriaDone: core.cardOf(t).acDone,
    };
  }
  const board = async () => db().collection(await boardCollection());
  const SUB_LIMIT = 100; // comments and activity lines kanban_get_task returns (the newest)
  const EPIC_CHILDREN = 500;
  // The next rank in a column is the highest there plus 10: one query on the
  // column's status+rank index, never a read of the column. An index still building falls back to the
  // column read.
  async function nextRank(status) {
    let top = 0;
    try {
      const snap = await tasks().where("status", "==", status).orderBy("rank", "desc").limit(1).get();
      top = snap.docs.length ? snap.docs[0].data().rank || 0 : 0;
    } catch (err) {
      if (!indexMissing(err)) throw err;
      const col = await tasks().where("status", "==", status).get();
      top = col.docs.reduce((m, d) => Math.max(m, d.data().rank || 0), 0);
    }
    return top + 10;
  }
  // What a list may read in one call, by document id; the answer carries a cursor for the rest.
  const LIST_PAGE = 500;
  const DONE_RECENT = 300;
  // Loads what a filter needs, pushing the filters into the query (equality and
  // array-contains merge single-field indexes, so none needs a composite index):
  // a release's tickets, else the closed ones for a done status, else the open
  // ones. It reads the board's cards; a text search reads the tickets (the
  // search tokens, then the description in memory). Answers
  // { list, truncated, nextCursor }. An index still building falls back to
  // the read made before filters were pushed down.
  async function loadTasks(f, { cursor = "", pages = 1 } = {}) {
    try {
      return await loadPushed(f, cursor, pages);
    } catch (err) {
      if (!indexMissing(err)) throw err;
      return { list: await loadAllOpen(f), truncated: false, nextCursor: null };
    }
  }
  const isDone = (st) => st === "done" || (st || "").startsWith("done:");
  async function loadPushed(f, cursor, pages) {
    const useTasks = !!f.search;
    const src = useTasks ? tasks() : await board();
    let q = src;
    const eq = (field, v) => { q = q.where(field, "==", v); };
    if (f.release) eq("release", f.release);
    else if (isDone(f.status)) eq("open", false);
    else eq("open", true);
    if (f.project) eq("project", f.project);
    if (f.assignee && f.assignee !== "none") eq("assignee", f.assignee);
    if (f.type) eq("type", f.type);
    if (f.priority) eq("priority", f.priority);
    if (f.sprint) eq("sprint", f.sprint);
    if (f.flagged) eq("flagged", true);
    if (f.status && !isDone(f.status)) eq("status", f.status);
    // One array-contains per query: the search token, else the label.
    const token = f.search ? core.queryToken(f.search) : "";
    if (token) q = q.where("searchTokens", "array-contains", token);
    else if (f.label) q = q.where("labels", "array-contains", f.label);
    // The most recent closed tickets, newest first, when no release names them.
    if (isDone(f.status) && !f.release && !f.search) {
      const snap = await q.orderBy("closedAt", "desc").limit(DONE_RECENT).get();
      return { list: snap.docs.map((d) => Object.assign({ key: d.id }, d.data())), truncated: false, nextCursor: null };
    }
    const list = [];
    let after = cursor || "";
    for (let i = 0; i < pages; i++) {
      let page = q.orderBy(FieldPath.documentId());
      if (after) page = page.startAfter(after);
      const snap = await page.limit(LIST_PAGE + 1).get();
      const docs = snap.docs.slice(0, LIST_PAGE);
      docs.forEach((d) => list.push(Object.assign({ key: d.id }, d.data())));
      if (snap.docs.length <= LIST_PAGE) return { list, truncated: false, nextCursor: null };
      after = docs[docs.length - 1].id;
    }
    return { list, truncated: true, nextCursor: after };
  }
  // The read made before filters were pushed down: every open ticket, plus a release's.
  async function loadAllOpen(f) {
    const src = f.search ? tasks() : await board();
    const scoped = (q) => (f.project ? q.where("project", "==", f.project) : q);
    const open = await scoped(src.where("open", "==", true)).get();
    const map = new Map(open.docs.map((d) => [d.id, Object.assign({ key: d.id }, d.data())]));
    if (f.release) (await scoped(src.where("release", "==", f.release)).get()).docs.forEach((d) => map.set(d.id, Object.assign({ key: d.id }, d.data())));
    if (isDone(f.status)) {
      (await scoped(src).orderBy("closedAt", "desc").limit(DONE_RECENT).get()).docs.forEach((d) => map.set(d.id, Object.assign({ key: d.id }, d.data())));
    }
    return [...map.values()];
  }
  // Writes a ticket's card with the ticket (same batch or transaction).
  const putCard = (w, key, t, email, closedAt) => w.set(db().collection(CARDS).doc(key), cardData(Object.assign({}, t, { key }), email, closedAt));
  // Per-member hourly allowance, kept in Firestore so every instance shares it.
  async function takeAttachSlot(email) {
    const ref = db().collection("kanbanAttachLimits").doc(String(email).toLowerCase());
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const now = Date.now();
      const fresh = typeof d.windowStart === "number" && now - d.windowStart < 3600000;
      const count = fresh ? d.count || 0 : 0;
      if (count >= ATTACH_PER_HOUR) return false;
      tx.set(ref, { windowStart: fresh ? d.windowStart : now, count: count + 1 });
      return true;
    });
  }
  const stamp = (email) => ({ updatedAt: FieldValue.serverTimestamp(), updatedBy: email });
  const activity = (batch, key, email, texts) => {
    for (const text of texts) if (text) batch.set(tasks().doc(key).collection("activity").doc(), { who: email, text: String(text).slice(0, 500), at: FieldValue.serverTimestamp() });
  };
  // The fields a write must refresh when its sources change (as the page does).
  function derived(t) {
    const descriptionText = core.htmlToText(t.description || "").slice(0, 20000);
    return { descriptionText, mentions: core.mentionsIn(t.description || ""), searchTokens: core.searchTokens({ key: t.key, title: t.title, labels: t.labels, descriptionText }) };
  }
  const asHtml = (text) => {
    const s = String(text || "");
    if (/<\/?(p|div|ul|ol|li|br|h[1-6]|strong|em|a)\b/i.test(s)) return s;
    return s.split(/\n{2,}/).filter(Boolean).map((p) => "<p>" + p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>") + "</p>").join("");
  };
  const WRITABLE = {
    title: { type: "string" }, description: { type: "string", description: "Plain text or HTML." },
    type: { type: "string", enum: ["task", "bug", "epic"] }, priority: { type: "string", enum: ["highest", "high", "medium", "low", "lowest", ""] },
    assignee: PERSON, reporter: PERSON, release: { type: "string", description: "A console release id (kanban_list_people returns them too)." },
    sprint: { type: "string" }, project: { type: "string", description: "A console project (id or name) the ticket belongs to; empty clears it. kanban_list_people lists them." },
    estimate: { type: ["string", "number"], description: "Hours, or a duration like 1d 4h (1d = 8h)." },
    logged: { type: ["string", "number"], description: "Time logged: hours or a duration." }, due: { type: "string", description: "YYYY-MM-DD" },
    labels: { type: "array", items: { type: "string" } }, epic: { type: "string", description: "Parent epic key, or empty." },
    links: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: core.LINK_TYPES }, key: { type: "string" } }, required: ["type", "key"] } },
    flagged: { type: "boolean" },
    acceptanceCriteria: {
      type: "array", maxItems: core.AC_MAX_ITEMS,
      description: `The ticket's acceptance-criteria checklist (up to ${core.AC_MAX_ITEMS} items of at most ${core.AC_MAX_TEXT} characters): strings, or {text, done}. On an update it replaces the whole list (an item with unchanged text keeps its id and state unless you give done); to tick items without resending the list use kanban_check_criteria. An empty list clears it.`,
      items: { anyOf: [{ type: "string", maxLength: core.AC_MAX_TEXT }, { type: "object", properties: { text: { type: "string", maxLength: core.AC_MAX_TEXT }, done: { type: "boolean" } }, required: ["text"] }] },
    },
  };
  async function checkEpic(epicKey, selfKey) {
    if (!epicKey) return null;
    const e = await getTask(epicKey);
    if (!e || e.type !== "epic") return `${epicKey} is not an epic.`;
    if (epicKey === selfKey) return "A ticket can't be its own epic.";
    return null;
  }

  // Everything a write names that must exist, checked together so an agent
  // sees every problem at once: people are console members, a release is an
  // id, name or version of a real one (v.release is rewritten to its id),
  // the epic is an epic. Returns the messages.
  async function checkRefs(v, selfKey, session) {
    const errs = [];
    const named = ["assignee", "reporter"].filter((k) => v[k]);
    if (named.length) {
      const members = new Set((await people(session)).map((p) => p.email));
      for (const k of named) if (!members.has(v[k])) errs.push(`${k} ${v[k]} isn't a member of the console; kanban_list_people lists who's who`);
    }
    if (v.release) {
      const rel = await releases();
      const want = String(v.release).trim().toLowerCase();
      const hit = rel.find((d) => d.id === v.release) || rel.find((d) => [d.data().name, d.data().version].some((x) => x != null && String(x).trim().toLowerCase() === want));
      if (hit) v.release = hit.id; else errs.push(`release ${v.release} isn't a release (an id, name or version; kanban_list_people lists them)`);
    }
    if (v.project) {
      const hit = await findProject(v.project);
      if (hit) v.project = hit.id; else errs.push(`project ${v.project} isn't a project (an id or name; kanban_list_people lists them)`);
    }
    const e = await checkEpic(v.epic, selfKey);
    if (e) errs.push(e);
    return errs;
  }
  // A console project by id or (case-insensitively) name: { id, name }, else null.
  async function findProject(ref) {
    const want = String(ref).trim().toLowerCase();
    const all = await projects();
    const byId = all.find((d) => d.id === String(ref).trim());
    if (byId) return { id: byId.id, name: byId.data().name || byId.id };
    const hit = all.find((d) => d.data().name != null && String(d.data().name).trim().toLowerCase() === want);
    return hit ? { id: hit.id, name: hit.data().name } : null;
  }
  // Links are stored on both tickets (KB-TASK-5): "A blocks B" is {blocks, B}
  // on A and {is blocked by, A} on B, written in one batch, so reading a ticket
  // never reads another. Links to nowhere, or to the ticket itself, are refused.
  async function checkLinks(links, selfKey) {
    const errs = [];
    for (const l of links || []) {
      if (l.key === selfKey) errs.push(`${selfKey} can't be linked to itself`);
      else if (!(await tasks().doc(l.key).get()).exists) errs.push(`link ${l.type} ${l.key}: no such ticket`);
    }
    return errs;
  }
  // The other side of every link added or removed, in the caller's batch.
  // Returns the number of other tickets written.
  function linkOps(b, key, before, after, email) {
    const { added, removed } = core.linkChanges(before, after);
    for (const [list, add] of [[added, true], [removed, false]]) {
      for (const l of list) {
        if (l.key === key) continue;
        const inv = core.inverseOf(key, l);
        b.update(tasks().doc(l.key), Object.assign({ links: add ? FieldValue.arrayUnion(inv) : FieldValue.arrayRemove(inv) }, stamp(email)));
        activity(b, l.key, email, [`${add ? "linked" : "unlinked"}: ${inv.type} ${key}`]);
      }
    }
  }
  // One line per notification, the way the bell words it.
  const describe = (n, first) => {
    const who = first(n.from), what = `${n.taskKey}${n.taskTitle ? " " + n.taskTitle : ""}`;
    switch (n.kind) {
      case "assigned": return `${who} assigned ${what} to you`;
      case "testing": return `${who} handed ${what} to you for testing`;
      case "returned": return `${who} returned ${what} to you from testing`;
      case "commented": return `${who} commented on ${what}`;
      case "closed": return `${who} closed ${what}`;
      case "mention": return `${who} mentioned you ${n.via === "comment" ? "in a comment on" : "on"} ${what}`;
      case "comment": return `${who} mentioned you in a comment on ${what}`;
      default: return `${who} mentioned you on ${what}`;
    }
  };

  const tools = [
    {
      name: "kanban_list_people",
      description: "Staff Kanban: who's on the board (email and the first name the board shows), the releases, sprints and console projects tickets can belong to, the current release and the tester Ready for Testing hands tickets to.",
      scope: "board.read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run(args, session) {
        const [ppl, s, relDocs, sprDocs, prjDocs] = await Promise.all([people(session), settings(), releases(), sprints(), projects()]);
        const rel = { docs: relDocs }, spr = { docs: sprDocs }, prj = { docs: prjDocs };
        return textResult({
          people: ppl.map((p) => ({ email: p.email, name: firstOf(p, s), fullName: p.displayName || null })),
          releases: rel.docs.map((d) => ({ id: d.id, name: d.data().name, version: d.data().version || null, live: d.data().status === "live", date: s.releaseDates[d.id] || null })),
          sprints: spr.docs.map((d) => ({ id: d.id, name: d.data().name, start: d.data().start || null, end: d.data().end || null })),
          projects: prj.docs.filter((d) => !d.data().archived).map((d) => ({ id: d.id, name: d.data().name || d.id })),
          currentRelease: currentRelease(s, rel.docs) || null, tester: s.tester,
          statuses: core.STATUSES.map((x) => x.key), resolutions: core.RESOLUTIONS.map((x) => x.key),
        });
      },
    },
    {
      name: "kanban_list_tasks",
      description: "Staff Kanban: tickets matching the board's filters (summaries; kanban_get_task for one in full). Without a release or status it covers every open ticket; a release adds its closed ones, and status done / done:completed / done:withdrawn covers the 300 most recently closed. Filters are applied in the query; at most 500 tickets are read per call, and when there are more the answer says truncated and gives nextCursor to pass as cursor.",
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: {
          assignee: { type: "string", description: "An email, \"me\", or \"none\" for unassigned." },
          release: { type: "string" }, project: { type: "string", description: "A console project, by id or name." },
          status: { type: "string", description: "A status key, or done:completed / done:withdrawn." },
          type: { type: "string", enum: ["task", "bug", "epic"] }, priority: { type: "string" }, sprint: { type: "string" }, label: { type: "string" },
          flagged: { type: "boolean" }, search: { type: "string", description: "Words in the key, title, description or labels." },
          limit: { type: "integer", minimum: 1, maximum: 200 },
          cursor: { type: "string", description: "nextCursor from the previous answer, to read the next 500 tickets." },
        },
        additionalProperties: false,
      },
      async run(args, session) {
        const f = { ...args };
        if (f.project) {
          const hit = await findProject(f.project);
          if (!hit) return toolError(`project ${f.project} isn't a project (an id or name; kanban_list_people lists them)`);
          f.project = hit.id;
        }
        const who = f.assignee === "me" ? session.email : f.assignee;
        const loaded = await loadTasks(Object.assign({}, f, { assignee: who }), { cursor: typeof args.cursor === "string" ? args.cursor : "" });
        const list = core.filterTasks(loaded.list, { assignees: who ? [who] : [], release: f.release || "", type: f.type || "", priority: f.priority || "", sprint: f.sprint || "", project: f.project || "", label: f.label || "", flagged: !!f.flagged, status: f.status || "", q: f.search || "" });
        list.sort((a, b) => core.STATUS_KEYS.indexOf(a.status) - core.STATUS_KEYS.indexOf(b.status) || (a.rank || 0) - (b.rank || 0));
        const first = await firstNamer();
        const n = Math.min(args.limit || 100, 200);
        return textResult({ matched: list.length, returned: Math.min(n, list.length), truncated: loaded.truncated, nextCursor: loaded.nextCursor, tasks: list.slice(0, n).map((t) => summary(t, first)) });
      },
    },
    {
      name: "kanban_get_task",
      description: "Staff Kanban: one ticket in full — description (plain text and descriptionHtml), every field, links (stored on both tickets: blocks / is blocked by, relates to, duplicates / is duplicated by), attachments, comments and the activity log.",
      scope: "board.read",
      inputSchema: { type: "object", properties: { key: KEY }, required: ["key"], additionalProperties: false },
      async run(args) {
        const key = normKey(args.key);
        const t = key && await getTask(key);
        if (!t) return toolError(`No ticket ${args.key}.`);
        // The newest 100 of each, and how many were left out.
        const newest = (sub) => tasks().doc(key).collection(sub).orderBy("at", "desc").limit(SUB_LIMIT).get();
        const total = async (sub) => (await tasks().doc(key).collection(sub).count().get()).data().count;
        const [cs, act, nCs, nAct, first] = await Promise.all([newest("comments"), newest("activity"), total("comments"), total("activity"), firstNamer()]);
        const iso = (v) => (v && v.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v || null);
        const kidDocs = t.type === "epic" ? (await (await board()).where("epic", "==", key).limit(EPIC_CHILDREN + 1).get()).docs : null;
        const kids = kidDocs ? kidDocs.slice(0, EPIC_CHILDREN).map((d) => ({ key: d.id, title: d.data().title, status: core.statusLabel(d.data().status, d.data().resolution) })) : undefined;
        const project = t.project ? await findProject(t.project) : null;
        return textResult(Object.assign(summary(t, first), {
          projectName: project ? project.name : null,
          description: t.descriptionText || core.htmlToText(t.description || ""), descriptionHtml: t.description || "", reporter: t.reporter || null, previousAssignee: t.previousAssignee || null,
          acceptanceCriteria: core.decodeCriteria(t.acceptanceCriteria),
          links: (t.links || []).map((l) => ({ type: l.type, key: l.key })), attachments: (t.attachments || []).map((a) => ({ name: a.name, url: a.url || null, contentType: a.contentType || null, size: a.size || null, caption: a.caption || null })),
          children: kids, childrenOmitted: kidDocs && kidDocs.length > EPIC_CHILDREN ? "more than " + EPIC_CHILDREN : undefined, created: iso(t.createdAt), createdBy: t.createdBy || null, updated: iso(t.updatedAt),
          commentsOmitted: Math.max(0, nCs - cs.docs.length), activityOmitted: Math.max(0, nAct - act.docs.length),
          comments: cs.docs.map((d) => d.data()).sort((a, b) => String(iso(a.at)).localeCompare(String(iso(b.at)))).map((c) => ({ author: c.author, at: iso(c.at), text: c.text })),
          activity: act.docs.map((d) => d.data()).sort((a, b) => String(iso(a.at)).localeCompare(String(iso(b.at)))).map((a) => ({ who: a.who, at: iso(a.at), text: a.text })),
        }));
      },
    },
    {
      name: "kanban_search_tickets",
      description: "Staff Kanban: find tickets by number (36, PH-36) or words from the title or description. Best 50 matches, ranked like the board's ticket picker.",
      scope: "board.read",
      inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      async run(args) {
        const token = core.queryToken(args.query);
        if (!token) return toolError("Give a ticket number or some words to search for.");
        const snap = await tasks().where("searchTokens", "array-contains", token).limit(200).get();
        const list = snap.docs.map((d) => Object.assign({ key: d.id }, d.data()));
        const ranked = core.searchTickets(list, args.query).slice(0, core.PICK_LIMIT);
        return textResult({ matched: ranked.length, results: ranked.map(({ t, where }) => ({ key: t.key, title: t.title, type: t.type, status: core.statusLabel(t.status, t.resolution), matchedIn: where === "desc" ? "description" : "title" })) });
      },
    },
    {
      name: "kanban_release_report",
      description: "Staff Kanban: the release report — outstanding tickets, remaining effort, time logged and each person's remaining effort against capacity (6 focused hours per working day to the release date). Defaults to the current release.",
      scope: "board.read",
      inputSchema: { type: "object", properties: { release: { type: "string", description: "A release id, or \"all\"." }, assignee: { type: "string" }, status: { type: "string" } }, additionalProperties: false },
      async run(args, session) {
        const s = await settings();
        const relDocs = await releases();
        const release = args.release || currentRelease(s, relDocs);
        if (!release) return toolError("No current release is set. Give a release id (kanban_list_people lists them).");
        const hit = release === "all" ? null : relDocs.find((d) => d.id === release);
        const relDoc = hit ? { exists: true, data: () => hit.data() } : { exists: false };
        // A release's tickets, a page of 500 at a time (cards are light); more than 5,000 are cut off and said so.
        const loaded = await loadTasks({ release: release === "all" ? "" : release }, { pages: 10 });
        const all = loaded.list;
        const first = await firstNamer();
        const r = core.releaseReport(all, { release, assignee: args.assignee || "", status: args.status || "" }, { people: (await people(session)).map((p) => p.email), releaseDate: s.releaseDates[release] || "", released: !!(relDoc && relDoc.exists && relDoc.data().status === "live") });
        return textResult({
          truncated: loaded.truncated,
          release, releaseName: relDoc && relDoc.exists ? relDoc.data().name : release === "all" ? "All releases" : release,
          releaseDate: s.releaseDates[release] || null, workingDaysLeft: r.workingDays,
          outstanding: r.outstanding.length, completed: r.totals.completed, withdrawn: r.totals.withdrawn, flagged: r.totals.flagged,
          remaining: core.fmtH(r.totals.remaining), logged: core.fmtH(r.totals.logged), estimate: core.fmtH(r.totals.estimate), withoutEstimate: r.totals.noEstimate,
          capacityPerPerson: r.capacityPerPerson ? core.fmtH(r.capacityPerPerson) : null,
          byPerson: r.perPerson.map((p) => ({ assignee: p.id || null, name: first(p.id), tasks: p.tasks.length, outstanding: p.out.length, remaining: core.fmtH(p.rem), overCapacity: r.capacityPerPerson ? p.rem > r.capacityPerPerson : null })),
        });
      },
    },
    {
      name: "kanban_create_task",
      description: "Staff Kanban: create a ticket. It always starts in Backlog and gets the next PH-n key. Say it the way you'd tell a colleague — title and description — and set any fields you know.",
      scope: "board.write",
      inputSchema: { type: "object", properties: Object.assign({}, WRITABLE), required: ["title"], additionalProperties: false },
      async run(args, session) {
        args = resolveMe(args, session);
        const { value: v, errors } = core.cleanTaskFields(args);
        if (v.type === "epic") v.epic = "";
        errors.push(...await checkRefs(v, null, session));
        errors.push(...await checkLinks(v.links, null));
        if (errors.length) return toolError(errors.join("; "));
        const s = await settings();
        const counterRef = db().collection("kanbanCounters").doc("main");
        const rank = await nextRank("backlog");
        const key = await db().runTransaction(async (tx) => {
          const c = await tx.get(counterRef);
          const n = c.exists && typeof c.data().nextNumber === "number" ? c.data().nextNumber : 1;
          const key = core.keyOf(n);
          const t = {
            key, number: n, type: v.type || "task", title: v.title, description: asHtml(v.description || ""),
            status: "backlog", resolution: null, open: true, rank,
            assignee: v.assignee || "", previousAssignee: "", reporter: v.reporter || session.email,
            release: v.release || "", sprint: v.sprint || "", project: v.project || "",
            estimate: v.estimate == null ? null : v.estimate, logged: v.logged || 0, priority: v.priority || "medium",
            due: v.due || "", labels: v.labels || [], epic: v.epic || "", links: v.links || [], flagged: !!v.flagged,
            attachments: [], commentCount: 0, acceptanceCriteria: core.encodeCriteria(v.acceptanceCriteria || []),
          };
          Object.assign(t, derived(t), { createdAt: FieldValue.serverTimestamp(), createdBy: session.email }, stamp(session.email));
          tx.set(counterRef, { nextNumber: n + 1, updatedAt: FieldValue.serverTimestamp() });
          tx.set(tasks().doc(key), t);
          putCard(tx, key, t, session.email);
          for (const l of t.links) tx.update(tasks().doc(l.key), Object.assign({ links: FieldValue.arrayUnion(core.inverseOf(key, l)) }, stamp(session.email)));
          return key;
        });
        const b = db().batch();
        activity(b, key, session.email, ["created this ticket over MCP"]);
        for (const l of v.links || []) activity(b, l.key, session.email, [`linked: ${core.inverseOf(key, l).type} ${key}`]);
        await b.commit();
        await audit(session, "kanban_create_task", { key });
        return textResult({ created: true, key, status: "backlog" });
      },
    },
    {
      name: "kanban_update_task",
      description: "Staff Kanban: change a ticket's fields (title, description, type, priority, people, release, sprint, project, estimate, time logged, due date, labels, parent epic, links, flag). To move it between columns use kanban_move_task.",
      scope: "board.write",
      inputSchema: { type: "object", properties: Object.assign({ key: KEY }, WRITABLE), required: ["key"], additionalProperties: false },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const input = resolveMe(args, session); delete input.key;
        if (!Object.keys(input).length) return toolError("Nothing to change.");
        const { value: v, errors } = core.cleanTaskFields(input, { partial: true, existingCriteria: cur.acceptanceCriteria });
        if ("description" in v) v.description = asHtml(v.description);
        const type = v.type || cur.type;
        if (type === "epic") v.epic = "";
        errors.push(...await checkRefs(v, key, session));
        if ("links" in v) errors.push(...await checkLinks(v.links, key));
        if (errors.length) return toolError(errors.join("; "));
        const first = await firstNamer();
        const lines = [];
        if ("assignee" in v && v.assignee !== core.canonicalEmail(cur.assignee || "")) lines.push(`reassigned ${first(cur.assignee)} → ${first(v.assignee)}`);
        if ("flagged" in v && v.flagged !== !!cur.flagged) lines.push(v.flagged ? "flagged this ticket" : "removed the flag");
        if ("acceptanceCriteria" in v) {
          lines.push(...core.diffCriteria(cur.acceptanceCriteria, v.acceptanceCriteria));
          v.acceptanceCriteria = core.encodeCriteria(v.acceptanceCriteria);
        }
        if (!lines.length) lines.push(`updated ${Object.keys(v).join(", ")} over MCP`);
        const next = Object.assign({}, cur, v);
        const patch = Object.assign({}, v, stamp(session.email));
        if (["title", "description", "labels"].some((k) => k in v)) Object.assign(patch, derived(next));
        const b = db().batch();
        b.update(tasks().doc(key), patch);
        putCard(b, key, Object.assign({}, next, patch), session.email);
        activity(b, key, session.email, lines);
        if ("links" in v) linkOps(b, key, cur.links || [], v.links, session.email);
        // An epic that stops being one lets go of its children (KB-TASK-7).
        if (cur.type === "epic" && type !== "epic") {
          const kids = await tasks().where("epic", "==", key).get();
          kids.docs.forEach((d) => { b.update(d.ref, Object.assign({ epic: "" }, stamp(session.email))); putCard(b, d.id, Object.assign({}, d.data(), { epic: "" }), session.email); activity(b, d.id, session.email, [`removed from epic ${key} (no longer an epic)`]); });
        }
        await b.commit();
        await audit(session, "kanban_update_task", { key, fields: Object.keys(v) });
        return textResult({ updated: true, key, changed: Object.keys(v) });
      },
    },
    {
      name: "kanban_check_criteria",
      description: "Staff Kanban: tick or untick acceptance criteria on a ticket by id (kanban_get_task returns each item's id) without resending the list. Each change writes an activity line.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { key: KEY, ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: core.AC_MAX_ITEMS, description: "Criterion ids." }, done: { type: "boolean", description: "true to tick, false to untick." } },
        required: ["key", "ids", "done"], additionalProperties: false,
      },
      async run(args, session) {
        const key = normKey(args.key);
        const ids = [...new Set((args.ids || []).map((x) => String(x).trim()))];
        if (!key) return toolError(`No ticket ${args.key}.`);
        if (!ids.length) return toolError("Give at least one criterion id.");
        const done = !!args.done;
        const out = await db().runTransaction(async (tx) => {
          const snap = await tx.get(tasks().doc(key));
          if (!snap.exists) return { error: `No ticket ${args.key}.` };
          const list = core.decodeCriteria(snap.data().acceptanceCriteria);
          const missing = ids.filter((id) => !list.some((c) => c.id === id));
          if (missing.length) return { error: `${key} has no criterion ${missing.join(", ")}; kanban_get_task lists the ids.` };
          const before = list.map((c) => Object.assign({}, c));
          for (const c of list) if (ids.includes(c.id)) c.done = done;
          const lines = core.diffCriteria(before, list);
          if (!lines.length) return { unchanged: true, list };
          const t = Object.assign({ key }, snap.data(), { acceptanceCriteria: core.encodeCriteria(list) });
          tx.update(tasks().doc(key), Object.assign({ acceptanceCriteria: t.acceptanceCriteria }, stamp(session.email)));
          putCard(tx, key, t, session.email);
          for (const text of lines) tx.set(tasks().doc(key).collection("activity").doc(), { who: session.email, text: String(text).slice(0, 500), at: FieldValue.serverTimestamp() });
          return { list, changed: lines.length };
        });
        if (out.error) return toolError(out.error);
        const n = core.acCounts(out.list);
        if (!out.unchanged) await audit(session, "kanban_check_criteria", { key, ids, done });
        return textResult({ key, done, changed: out.changed || 0, acDone: n.done, acTotal: n.total, acceptanceCriteria: out.list });
      },
    },
    {
      name: "kanban_move_task",
      description: "Staff Kanban: move a ticket to another column. Moving to Ready for Testing reassigns it to the tester; moving it back to In Progress or Ready for Dev returns it to the developer. To close one, use status done with resolution completed or withdrawn.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { key: KEY, status: { type: "string", enum: core.STATUS_KEYS }, resolution: { type: "string", enum: ["completed", "withdrawn"] } },
        required: ["key", "status"], additionalProperties: false,
      },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const [s, first] = await Promise.all([settings(), firstNamer()]);
        const ch = core.statusChange(cur, args.status, { resolution: args.resolution, tester: s.tester, firstName: first });
        if (!ch) return textResult({ moved: false, key, status: cur.status, note: "Already there." });
        const rank = await nextRank(args.status);
        const patch = Object.assign({}, ch.patch, { rank }, stamp(session.email), args.status === "done" ? { closedAt: FieldValue.serverTimestamp() } : { closedAt: FieldValue.delete() });
        const b = db().batch();
        b.update(tasks().doc(key), patch);
        const moved = Object.assign({}, cur, patch);
        if (args.status !== "done") delete moved.closedAt;
        putCard(b, key, moved, session.email, args.status === "done" ? patch.closedAt : undefined);
        activity(b, key, session.email, [ch.activity]);
        await b.commit();
        await audit(session, "kanban_move_task", { key, status: args.status, resolution: ch.resolution });
        return textResult({ moved: true, key, status: args.status, resolution: ch.resolution, note: ch.note || null, assignee: patch.assignee || cur.assignee || null });
      },
    },
    {
      name: "kanban_assign_task",
      description: "Staff Kanban: assign a ticket to someone (an email), or pass an empty assignee to unassign it.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { key: KEY, assignee: PERSON }, required: ["key", "assignee"], additionalProperties: false },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const { value: v, errors } = core.cleanTaskFields({ assignee: meOr(args.assignee, session) }, { partial: true });
        if (errors.length) return toolError(errors.join("; "));
        const refErrs = await checkRefs(v, null, session);
        if (refErrs.length) return toolError(refErrs.join("; "));
        const first = await firstNamer();
        const same = first(cur.assignee) === first(v.assignee) && core.canonicalEmail(cur.assignee) === v.assignee;
        const b = db().batch();
        b.update(tasks().doc(key), Object.assign({ assignee: v.assignee, previousAssignee: "" }, stamp(session.email)));
        putCard(b, key, Object.assign({}, cur, { assignee: v.assignee, previousAssignee: "" }), session.email);
        if (!same) activity(b, key, session.email, [`reassigned ${first(cur.assignee)} → ${first(v.assignee)}`]);
        await b.commit();
        await audit(session, "kanban_assign_task", { key, assignee: v.assignee });
        return textResult({ assigned: true, key, assignee: v.assignee || null });
      },
    },
    {
      name: "kanban_flag_task",
      description: "Staff Kanban: flag a ticket (or remove its flag). Flagged tickets show amber on the board.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { key: KEY, flagged: { type: "boolean" } }, required: ["key", "flagged"], additionalProperties: false },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const b = db().batch();
        b.update(tasks().doc(key), Object.assign({ flagged: !!args.flagged }, stamp(session.email)));
        putCard(b, key, Object.assign({}, cur, { flagged: !!args.flagged }), session.email);
        activity(b, key, session.email, [args.flagged ? "flagged this ticket" : "removed the flag"]);
        await b.commit();
        await audit(session, "kanban_flag_task", { key, flagged: !!args.flagged });
        return textResult({ key, flagged: !!args.flagged });
      },
    },
    {
      name: "kanban_attach_file",
      description: "Staff Kanban: attach a screenshot, image or PDF to a ticket in one call, sent as base64 `data` (png, jpeg, webp or gif images, or a pdf, at most 5 MB decoded; nothing is fetched from a URL). Images over 1400 px are shrunk, as on the board. It shows under the ticket's Attachments; `inline: true` also puts an image in the description. Limited to 60 files an hour per member.",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: {
          key: KEY,
          name: { type: "string", description: "File name, e.g. home-page.png." },
          contentType: { type: "string", enum: Object.keys(ATTACH_TYPES) },
          data: { type: "string", description: "The file's bytes, base64 encoded." },
          inline: { type: "boolean", description: "Also place the image in the description (images only)." },
          caption: { type: "string", description: "Optional caption, shown under an inline image. Up to 300 characters." },
        },
        required: ["key", "name", "contentType", "data"], additionalProperties: false,
      },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const contentType = String(args.contentType || "").trim().toLowerCase();
        const kind = ATTACH_TYPES[contentType];
        if (!kind) return toolError(`${args.contentType || "That type"} can't be attached. Allowed: ${ATTACH_LIMIT_TEXT}.`);
        const name = String(args.name || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
        if (!name) return toolError("name is required.");
        const caption = String(args.caption || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
        if (caption.length > 300) return toolError("A caption is limited to 300 characters.");
        if (args.inline && !contentType.startsWith("image/")) return toolError("Only an image can go inline in the description; a pdf is attached.");
        let b64 = String(args.data || "");
        const uri = core.dataUriParts(b64);
        if (uri) { if (uri.contentType.toLowerCase() !== contentType) return toolError("The data: prefix names a different type from contentType."); b64 = uri.base64; }
        b64 = b64.replace(/\s+/g, "");
        if (!b64) return toolError("data is required (the file, base64 encoded).");
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 === 1) return toolError("data isn't valid base64.");
        const approx = Math.floor(b64.length * 3 / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
        if (approx > ATTACH_MAX_BYTES) return toolError(`That file is ${(approx / 1048576).toFixed(1)} MB; the limit is 5 MB decoded (${ATTACH_LIMIT_TEXT}). Nothing was attached.`);
        let bytes = Buffer.from(b64, "base64");
        if (!kind.magic(bytes)) return toolError(`The bytes aren't a ${contentType} file. Nothing was attached.`);
        if ((cur.attachments || []).length >= ATTACH_MAX_PER_TICKET) return toolError(`${key} already has ${ATTACH_MAX_PER_TICKET} attachments, the most a ticket holds.`);
        if (!(await takeAttachSlot(session.email))) return toolError(`Limit reached: ${ATTACH_PER_HOUR} files an hour per member. Try again later.`);
        let resized = false;
        if (contentType.startsWith("image/")) {
          try { const r = await imageResizer.resize(bytes, contentType); bytes = r.buf; resized = r.resized; }
          catch (err) { return toolError("That image couldn't be read. Nothing was attached."); }
        }
        const path = `kanban/${key}/${Date.now()}-${safeFileName(name, kind.ext)}`;
        const token = crypto.randomUUID();
        const bucket = h.bucket ? h.bucket() : require("firebase-admin/storage").getStorage().bucket(BUCKET);
        await bucket.file(path).save(bytes, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: token } } });
        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
        const entry = { name, url, path, contentType, size: bytes.length };
        if (caption) entry.caption = caption;
        const ref = tasks().doc(key);
        const result = await db().runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists) return null;
          const t = Object.assign({ key }, snap.data());
          const attachments = (t.attachments || []).concat([entry]);
          const patch = Object.assign({ attachments }, stamp(session.email));
          if (args.inline) {
            patch.description = (t.description || "") + `<p><img src="${esc(url)}" alt="${esc(caption || name)}">${caption ? `<br><em>${esc(caption)}</em>` : ""}</p>`;
            Object.assign(patch, derived(Object.assign({}, t, { description: patch.description })));
          }
          tx.update(ref, patch);
          putCard(tx, key, Object.assign({}, t, patch), session.email);
          activity(tx, key, session.email, [`attached ${name} over MCP`]);
          return attachments.length;
        });
        if (result == null) return toolError(`No ticket ${args.key}.`);
        await audit(session, "kanban_attach_file", { key, name, contentType, size: bytes.length, inline: !!args.inline });
        return textResult({ attached: true, key, name, url, path, contentType, size: bytes.length, downscaled: resized, inline: !!args.inline, attachments: result });
      },
    },
    {
      name: "kanban_comment",
      description: "Staff Kanban: comment on a ticket, labelled with your email. Mention people by email in `mention` to notify them; the assignee, reporter and watchers are notified too (the board's notification trigger does it).",
      scope: "board.write",
      inputSchema: {
        type: "object",
        properties: { key: KEY, text: { type: "string", description: "Up to 4000 characters." }, mention: { type: "array", items: { type: "string" }, description: "Emails of people to notify." } },
        required: ["key", "text"], additionalProperties: false,
      },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const text = String(args.text || "").trim();
        if (!text) return toolError("text is required.");
        if (text.length > 4000) return toolError("A comment is limited to 4000 characters.");
        const members = new Set((await people(session)).map((p) => p.email));
        const mention = [...new Set((args.mention || []).map((e) => String(e).trim().toLowerCase()))].filter((e) => members.has(e) && e !== session.email);
        const b = db().batch();
        b.set(tasks().doc(key).collection("comments").doc(), { author: session.email, html: asHtml(text), text, mentions: mention, at: FieldValue.serverTimestamp() });
        b.update(tasks().doc(key), Object.assign({ commentCount: FieldValue.increment(1) }, stamp(session.email)));
        putCard(b, key, Object.assign({}, cur, { commentCount: (cur.commentCount || 0) + 1 }), session.email);
        await b.commit();
        await audit(session, "kanban_comment", { key, chars: text.length, mentions: mention.length });
        return textResult({ added: true, key, author: session.email, notified: mention });
      },
    },
    {
      name: "kanban_list_notifications",
      description: "Staff Kanban: your notifications — assigned to you, handed to you for testing, comments on tickets you own or watch, @mentions, your tickets closed — unread first, newest first. Answers \"what's new for me on the board?\".",
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: { unread_only: { type: "boolean", description: "Only the unread ones." }, limit: { type: "integer", minimum: 1, maximum: 100, description: "Of your newest notifications (default 30)." } },
        additionalProperties: false,
      },
      async run(args, session) {
        const n = Math.min(args.limit || 30, 100);
        const mine = db().collection("kanbanNotifications").where("to", "==", session.email);
        const [snap, unread, first] = await Promise.all([mine.orderBy("at", "desc").limit(n).get(), mine.where("read", "==", false).count().get(), firstNamer()]);
        const at = (d) => { const t = d.at; return t && t.toDate ? t.toDate().toISOString() : t || null; };
        let list = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
        if (args.unread_only) list = list.filter((x) => !x.read);
        list.sort((a, b) => (a.read === b.read ? 0 : a.read ? 1 : -1));
        return textResult({
          unreadCount: unread.data().count, returned: list.length,
          notifications: list.map((x) => ({ id: x.id, read: !!x.read, kind: x.kind, via: x.via || null, key: x.taskKey, title: x.taskTitle || "", from: x.from || null, fromName: first(x.from), at: at(x), message: describe(x, first) })),
        });
      },
    },
    {
      name: "kanban_mark_notifications_read",
      description: "Staff Kanban: mark your notifications read — pass `ids` (from kanban_list_notifications) or `all: true`. The bell on the open board updates without a reload.",
      scope: "board.write",
      inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, maxItems: 100 }, all: { type: "boolean" } }, additionalProperties: false },
      async run(args, session) {
        if (!args.all && !(args.ids && args.ids.length)) return toolError("Pass ids, or all: true.");
        const col = db().collection("kanbanNotifications");
        let refs;
        if (args.all) refs = (await col.where("to", "==", session.email).where("read", "==", false).limit(450).get()).docs.map((d) => d.ref);
        else {
          const snaps = await Promise.all([...new Set(args.ids.map(String))].map((id) => col.doc(id).get()));
          refs = snaps.filter((x) => x.exists && x.data().to === session.email && !x.data().read).map((x) => x.ref);
        }
        const b = db().batch();
        refs.forEach((r) => b.update(r, { read: true }));
        if (refs.length) await b.commit();
        // Their read notifications older than 30 days go with it.
        const pruned = await notify.pruneReadFor(session.email);
        await audit(session, "kanban_mark_notifications_read", { count: refs.length, all: !!args.all, pruned });
        const unread = await col.where("to", "==", session.email).where("read", "==", false).count().get();
        return textResult({ marked: refs.length, unreadCount: unread.data().count });
      },
    },
  ];
  // An alias signs in as its owner (core.PERSON_ALIASES): the session, and
  // every person an argument names, resolve to the canonical address before
  // a tool runs, so the alias is never assigned, notified or credited.
  const asPerson = (v) => (typeof v === "string" && v.includes("@") ? core.canonicalEmail(v) : v);
  return tools.map((t) => Object.assign({}, t, {
    description: `${t.description} ${KANBAN_SCOPE}`,
    async run(args, session) {
      const a = Object.assign({}, args);
      for (const k of ["assignee", "reporter"]) if (k in a) a[k] = asPerson(a[k]);
      if (Array.isArray(a.mention)) a.mention = a.mention.map(asPerson);
      const as = session && Object.assign({}, session, { email: core.canonicalEmail(session.email) });
      const timing = { detail: {} };
      if (as) timings.set(as, timing);
      const t0 = Date.now();
      try {
        return await t.run(a, as);
      } finally {
        if (as) await h.audit(as, t.name, Object.assign({}, timing.detail, { ms: Date.now() - t0 }));
      }
    },
  }));
}

module.exports = { clearCaches, imageResizer, ATTACH_MAX_BYTES, syncMemberDirectoryWrite, syncWholeDirectory, handleAgentFill, handleDirectorySync, handleBackfill, backfillSlice, handleBackfillLinks, backfillLinksSlice, boardCollection, kanbanTools, KANBAN_SCOPE, claudeDraft, draftFromClaude, cleanContext, AGENT_MODEL, DRAFT_SCHEMA };
