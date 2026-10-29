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
//   kanbanTools()         the KB-MCP-1 tools, attributed to the member.
//
// The board's rules (statuses, the testing hand-off, search tokens, the
// release report) come from kanban-core.js, a generated CommonJS copy of
// public/js/kanban/kanban-core.js, so the page and the tools agree.
"use strict";
const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const core = require("./kanban-core");

const db = () => require("firebase-admin/firestore").getFirestore();
const TASKS = "kanbanTasks";

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

// ── MCP tools (KB-MCP-1) ──────────────────────────────────────────────────
// h: { textResult, toolError, audit }
function kanbanTools(h) {
  const { textResult, toolError, audit } = h;
  const tasks = () => db().collection(TASKS);
  const PERSON = { type: "string", description: "A member's email address, or \"me\" for yourself; kanban_list_people says who's who." };
  const KEY = { type: "string", description: "Ticket key, e.g. PH-36." };
  const normKey = (k) => { const n = core.keyNumber(String(k || "").trim().replace(/^ph\s*-?\s*/i, "PH-").replace(/^(\d+)$/, "PH-$1")); return n == null ? null : core.keyOf(n); };

  async function settings() {
    const s = await db().collection("kanbanSettings").doc("main").get();
    return core.normaliseSettings(s.exists ? s.data() : null);
  }
  // The chosen current release, else the earliest one not yet live.
  const currentRelease = (s, relDocs) => core.currentReleaseId(s, relDocs.map((d) => ({ id: d.id, version: d.data().version, released: d.data().status === "live", order: d.data().order })));
  // The directory, plus the bootstrap admins and the caller when they have no
  // consoleUsers row (so no directory entry yet).
  async function people(session) {
    const snap = await db().collection("memberDirectory").get();
    const list = snap.docs.map((d) => d.data() || {}).filter((m) => !m.disabled && !core.isAliasEmail(m.email));
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
      assignee: t.assignee || null, assigneeName: first(t.assignee), release: t.release || null, sprint: t.sprint || null,
      epic: t.epic || null, estimate: typeof t.estimate === "number" ? core.fmtH(t.estimate) : null,
      logged: t.logged ? core.fmtH(t.logged) : null, remaining: typeof t.estimate === "number" ? core.fmtH(core.remaining(t)) : null,
      due: t.due || null, labels: t.labels || [],
    };
  }
  // Loads what a filter needs: open tickets, plus a release's closed ones.
  async function loadTasks(f) {
    const open = await tasks().where("open", "==", true).get();
    const map = new Map(open.docs.map((d) => [d.id, Object.assign({ key: d.id }, d.data())]));
    if (f.release) (await tasks().where("release", "==", f.release).get()).docs.forEach((d) => map.set(d.id, Object.assign({ key: d.id }, d.data())));
    if (f.status === "done" || (f.status || "").startsWith("done:")) {
      (await tasks().orderBy("closedAt", "desc").limit(300).get()).docs.forEach((d) => map.set(d.id, Object.assign({ key: d.id }, d.data())));
    }
    return [...map.values()];
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
    sprint: { type: "string" }, estimate: { type: ["string", "number"], description: "Hours, or a duration like 1d 4h (1d = 8h)." },
    logged: { type: ["string", "number"], description: "Time logged: hours or a duration." }, due: { type: "string", description: "YYYY-MM-DD" },
    labels: { type: "array", items: { type: "string" } }, epic: { type: "string", description: "Parent epic key, or empty." },
    links: { type: "array", items: { type: "object", properties: { type: { type: "string", enum: core.LINK_TYPES }, key: { type: "string" } }, required: ["type", "key"] } },
    flagged: { type: "boolean" },
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
      const rel = (await db().collection("releases").get()).docs;
      const want = String(v.release).trim().toLowerCase();
      const hit = rel.find((d) => d.id === v.release) || rel.find((d) => [d.data().name, d.data().version].some((x) => x != null && String(x).trim().toLowerCase() === want));
      if (hit) v.release = hit.id; else errs.push(`release ${v.release} isn't a release (an id, name or version; kanban_list_people lists them)`);
    }
    const e = await checkEpic(v.epic, selfKey);
    if (e) errs.push(e);
    return errs;
  }
  // The other end of each typed link, as the board reads it (KB-TASK-5):
  // links are stored on the ticket they were added to, and shown on both.
  const INVERSE_LINK = { blocks: "is blocked by", "is blocked by": "blocks", "relates to": "relates to", duplicates: "is duplicated by", "is duplicated by": "duplicates" };
  async function linksFor(t) {
    const own = (t.links || []).map((l) => ({ type: l.type, key: l.key }));
    const seen = new Set(own.map((l) => `${l.type}|${l.key}`));
    const all = await tasks().get();
    for (const d of all.docs) {
      if (d.id === t.key) continue;
      for (const l of (d.data().links || [])) {
        if (l.key !== t.key || !INVERSE_LINK[l.type]) continue;
        const inv = { type: INVERSE_LINK[l.type], key: d.id };
        if (!seen.has(`${inv.type}|${inv.key}`)) { seen.add(`${inv.type}|${inv.key}`); own.push(Object.assign(inv, { from: "inverse" })); }
      }
    }
    return own;
  }

  const tools = [
    {
      name: "kanban_list_people",
      description: "Staff Kanban: who's on the board (email and the first name the board shows), the releases and sprints tickets can belong to, the current release and the tester Ready for Testing hands tickets to.",
      scope: "board.read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      async run(args, session) {
        const [ppl, s, rel, spr] = await Promise.all([people(session), settings(), db().collection("releases").get(), db().collection("kanbanSprints").get()]);
        return textResult({
          people: ppl.map((p) => ({ email: p.email, name: firstOf(p, s), fullName: p.displayName || null })),
          releases: rel.docs.map((d) => ({ id: d.id, name: d.data().name, version: d.data().version || null, live: d.data().status === "live", date: s.releaseDates[d.id] || null })),
          sprints: spr.docs.map((d) => ({ id: d.id, name: d.data().name, start: d.data().start || null, end: d.data().end || null })),
          currentRelease: currentRelease(s, rel.docs) || null, tester: s.tester,
          statuses: core.STATUSES.map((x) => x.key), resolutions: core.RESOLUTIONS.map((x) => x.key),
        });
      },
    },
    {
      name: "kanban_list_tasks",
      description: "Staff Kanban: tickets matching the board's filters (summaries; kanban_get_task for one in full). Without a release or status it covers every open ticket; a release adds its closed ones, and status done / done:completed / done:withdrawn adds the 300 most recently closed.",
      scope: "board.read",
      inputSchema: {
        type: "object",
        properties: {
          assignee: { type: "string", description: "An email, \"me\", or \"none\" for unassigned." },
          release: { type: "string" }, status: { type: "string", description: "A status key, or done:completed / done:withdrawn." },
          type: { type: "string", enum: ["task", "bug", "epic"] }, priority: { type: "string" }, sprint: { type: "string" }, label: { type: "string" },
          flagged: { type: "boolean" }, search: { type: "string", description: "Words in the key, title, description or labels." },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
      async run(args, session) {
        const f = { ...args };
        const who = f.assignee === "me" ? session.email : f.assignee;
        const list = core.filterTasks(await loadTasks(f), { assignees: who ? [who] : [], release: f.release || "", type: f.type || "", priority: f.priority || "", sprint: f.sprint || "", label: f.label || "", flagged: !!f.flagged, status: f.status || "", q: f.search || "" });
        list.sort((a, b) => core.STATUS_KEYS.indexOf(a.status) - core.STATUS_KEYS.indexOf(b.status) || (a.rank || 0) - (b.rank || 0));
        const first = await firstNamer();
        const n = Math.min(args.limit || 100, 200);
        return textResult({ matched: list.length, returned: Math.min(n, list.length), tasks: list.slice(0, n).map((t) => summary(t, first)) });
      },
    },
    {
      name: "kanban_get_task",
      description: "Staff Kanban: one ticket in full — description (plain text and descriptionHtml), every field, links (both directions: blocks / is blocked by, relates to, duplicates / is duplicated by), attachments, comments and the activity log.",
      scope: "board.read",
      inputSchema: { type: "object", properties: { key: KEY }, required: ["key"], additionalProperties: false },
      async run(args) {
        const key = normKey(args.key);
        const t = key && await getTask(key);
        if (!t) return toolError(`No ticket ${args.key}.`);
        const [cs, act, first] = await Promise.all([tasks().doc(key).collection("comments").get(), tasks().doc(key).collection("activity").get(), firstNamer()]);
        const iso = (v) => (v && v.toDate ? v.toDate().toISOString() : v instanceof Date ? v.toISOString() : v || null);
        const kids = t.type === "epic" ? (await tasks().where("epic", "==", key).get()).docs.map((d) => ({ key: d.id, title: d.data().title, status: core.statusLabel(d.data().status, d.data().resolution) })) : undefined;
        return textResult(Object.assign(summary(t, first), {
          description: t.descriptionText || core.htmlToText(t.description || ""), descriptionHtml: t.description || "", reporter: t.reporter || null, previousAssignee: t.previousAssignee || null,
          links: await linksFor(t), attachments: (t.attachments || []).map((a) => ({ name: a.name, url: a.url || null })),
          children: kids, created: iso(t.createdAt), createdBy: t.createdBy || null, updated: iso(t.updatedAt),
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
        const release = args.release || currentRelease(s, (await db().collection("releases").get()).docs);
        if (!release) return toolError("No current release is set. Give a release id (kanban_list_people lists them).");
        const relDoc = release === "all" ? null : await db().collection("releases").doc(release).get();
        const all = await loadTasks({ release: release === "all" ? "" : release });
        const first = await firstNamer();
        const r = core.releaseReport(all, { release, assignee: args.assignee || "", status: args.status || "" }, { people: (await people(session)).map((p) => p.email), releaseDate: s.releaseDates[release] || "", released: !!(relDoc && relDoc.exists && relDoc.data().status === "live") });
        return textResult({
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
        if (errors.length) return toolError(errors.join("; "));
        const s = await settings();
        const counterRef = db().collection("kanbanCounters").doc("main");
        const backlog = await tasks().where("status", "==", "backlog").get();
        const rank = backlog.docs.reduce((m, d) => Math.max(m, d.data().rank || 0), 0) + 10;
        const key = await db().runTransaction(async (tx) => {
          const c = await tx.get(counterRef);
          const n = c.exists && typeof c.data().nextNumber === "number" ? c.data().nextNumber : 1;
          const key = core.keyOf(n);
          const t = {
            key, number: n, type: v.type || "task", title: v.title, description: asHtml(v.description || ""),
            status: "backlog", resolution: null, open: true, rank,
            assignee: v.assignee || "", previousAssignee: "", reporter: v.reporter || session.email,
            release: v.release || "", sprint: v.sprint || "",
            estimate: v.estimate == null ? null : v.estimate, logged: v.logged || 0, priority: v.priority || "medium",
            due: v.due || "", labels: v.labels || [], epic: v.epic || "", links: v.links || [], flagged: !!v.flagged,
            attachments: [], commentCount: 0,
          };
          Object.assign(t, derived(t), { createdAt: FieldValue.serverTimestamp(), createdBy: session.email }, stamp(session.email));
          tx.set(counterRef, { nextNumber: n + 1, updatedAt: FieldValue.serverTimestamp() });
          tx.set(tasks().doc(key), t);
          return key;
        });
        const b = db().batch();
        activity(b, key, session.email, ["created this ticket over MCP"]);
        await b.commit();
        await audit(session, "kanban_create_task", { key });
        return textResult({ created: true, key, status: "backlog" });
      },
    },
    {
      name: "kanban_update_task",
      description: "Staff Kanban: change a ticket's fields (title, description, type, priority, people, release, sprint, estimate, time logged, due date, labels, parent epic, links, flag). To move it between columns use kanban_move_task.",
      scope: "board.write",
      inputSchema: { type: "object", properties: Object.assign({ key: KEY }, WRITABLE), required: ["key"], additionalProperties: false },
      async run(args, session) {
        const key = normKey(args.key);
        const cur = key && await getTask(key);
        if (!cur) return toolError(`No ticket ${args.key}.`);
        const input = resolveMe(args, session); delete input.key;
        if (!Object.keys(input).length) return toolError("Nothing to change.");
        const { value: v, errors } = core.cleanTaskFields(input, { partial: true });
        if ("description" in v) v.description = asHtml(v.description);
        const type = v.type || cur.type;
        if (type === "epic") v.epic = "";
        errors.push(...await checkRefs(v, key, session));
        if (errors.length) return toolError(errors.join("; "));
        const first = await firstNamer();
        const lines = [];
        if ("assignee" in v && v.assignee !== core.canonicalEmail(cur.assignee || "")) lines.push(`reassigned ${first(cur.assignee)} → ${first(v.assignee)}`);
        if ("flagged" in v && v.flagged !== !!cur.flagged) lines.push(v.flagged ? "flagged this ticket" : "removed the flag");
        if (!lines.length) lines.push(`updated ${Object.keys(v).join(", ")} over MCP`);
        const next = Object.assign({}, cur, v);
        const patch = Object.assign({}, v, stamp(session.email));
        if (["title", "description", "labels"].some((k) => k in v)) Object.assign(patch, derived(next));
        const b = db().batch();
        b.update(tasks().doc(key), patch);
        activity(b, key, session.email, lines);
        // An epic that stops being one lets go of its children (KB-TASK-7).
        if (cur.type === "epic" && type !== "epic") {
          const kids = await tasks().where("epic", "==", key).get();
          kids.docs.forEach((d) => { b.update(d.ref, Object.assign({ epic: "" }, stamp(session.email))); activity(b, d.id, session.email, [`removed from epic ${key} (no longer an epic)`]); });
        }
        await b.commit();
        await audit(session, "kanban_update_task", { key, fields: Object.keys(v) });
        return textResult({ updated: true, key, changed: Object.keys(v) });
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
        const col = await tasks().where("status", "==", args.status).get();
        const rank = col.docs.reduce((m, d) => Math.max(m, d.data().rank || 0), 0) + 10;
        const patch = Object.assign({}, ch.patch, { rank }, stamp(session.email), args.status === "done" ? { closedAt: FieldValue.serverTimestamp() } : { closedAt: FieldValue.delete() });
        const b = db().batch();
        b.update(tasks().doc(key), patch);
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
        activity(b, key, session.email, [args.flagged ? "flagged this ticket" : "removed the flag"]);
        await b.commit();
        await audit(session, "kanban_flag_task", { key, flagged: !!args.flagged });
        return textResult({ key, flagged: !!args.flagged });
      },
    },
    {
      name: "kanban_comment",
      description: "Staff Kanban: comment on a ticket, labelled with your email. Mention people by email in `mention` to notify them.",
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
        for (const to of mention) b.set(db().collection("kanbanNotifications").doc(), { to, from: session.email, taskKey: key, taskTitle: String(cur.title || "").slice(0, 200), kind: "comment", read: false, at: FieldValue.serverTimestamp() });
        await b.commit();
        await audit(session, "kanban_comment", { key, chars: text.length, mentions: mention.length });
        return textResult({ added: true, key, author: session.email, notified: mention });
      },
    },
  ];
  // An alias signs in as its owner (core.PERSON_ALIASES): the session, and
  // every person an argument names, resolve to the canonical address before
  // a tool runs, so the alias is never assigned, notified or credited.
  const asPerson = (v) => (typeof v === "string" && v.includes("@") ? core.canonicalEmail(v) : v);
  return tools.map((t) => Object.assign({}, t, {
    run(args, session) {
      const a = Object.assign({}, args);
      for (const k of ["assignee", "reporter"]) if (k in a) a[k] = asPerson(a[k]);
      if (Array.isArray(a.mention)) a.mention = a.mention.map(asPerson);
      return t.run(a, session && Object.assign({}, session, { email: core.canonicalEmail(session.email) }));
    },
  }));
}

module.exports = { syncMemberDirectoryWrite, syncWholeDirectory, handleAgentFill, handleDirectorySync, kanbanTools, claudeDraft, draftFromClaude, cleanContext, AGENT_MODEL, DRAFT_SCHEMA };
