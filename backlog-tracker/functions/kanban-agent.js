// Send to Agent (kanban-staff-board/REQUIREMENTS.md → KB-AGENT-1, ticket
// VlBatzRVbPt6heAEp5mu): a Staff Kanban ticket's owner splits it into one or
// more agent tickets on the Agent Board.
//
//   POST /mcp/kanban/send-to-agent  {action: "propose", key}
//        → { proposal: [{title, description, acceptanceCriteria[]}], source,
//            projectId }   Claude's suggested split (or, with no API key or a
//            failed call, one ticket made from the Kanban ticket itself).
//   POST /mcp/kanban/send-to-agent  {action: "confirm", key, projectId, tickets}
//        → { created: [{id, title}], agentTotal, agentDone }   the agent tickets,
//            in that project's Backlog, tagged with the owner (ownerEmail, so
//            they fire only on the owner's own Claude Routine; see
//            backlog-tracker/REQUIREMENTS.md → "Agent tickets fire under their
//            owner's own Claude account") and linked both ways: each carries
//            kanbanKey, and the Kanban ticket lists them in agentTickets.
//   agentTicketWritten(event)   the Firestore trigger on backlogItems: when a
//            linked agent ticket changes status (or is deleted) it recounts the
//            Kanban ticket's agentDone / agentTotal (ticket and card), and when
//            every one is built it moves the Kanban ticket to Ready for Testing
//            through kanban_move_task, which rolls up to its parents.
//
// Only the Kanban ticket's assignee may do either: the server checks it
// against the signed-in member, whatever the page shows. Every write here is
// the admin SDK; firestore.rules keep agentTickets / agentTotal / agentDone
// out of every browser's reach.
"use strict";
const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const core = require("./kanban-core");
const { applyIntake } = require("./intake");

const db = () => require("firebase-admin/firestore").getFirestore();
const TASKS = "kanbanTasks";
const CARDS = "kanbanCards";
const ITEMS = "backlogItems";
const BEFORE_TESTING = ["backlog", "ready-for-dev", "in-progress"];
const AGENT_SPLIT_MODEL = "claude-opus-5-5";

const SPLIT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["tickets"],
  properties: {
    tickets: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["title", "description", "acceptanceCriteria"],
        properties: {
          title: { type: "string", description: "Short imperative title, at most 80 characters." },
          description: { type: "string", description: "What the agent must build or change, in plain sentences." },
          acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Checkable statements, each one sentence." },
        },
      },
    },
  },
};
const SPLIT_SYSTEM = [
  "You split a staff member's Kanban ticket into tickets for an AI coding agent that works on the team's code base (product, docs, prototypes, tooling).",
  "Each agent ticket must be one independently buildable and testable piece of work. Prefer fewer, larger tickets: one is right when the work is small; never more than " + core.AGENT_MAX_TICKETS + ".",
  "Write in British English. Give each a short imperative title, a description of what should be different when it is done, and acceptance criteria a tester can check.",
  "Leave out anything only a person can do (meetings, approvals, sending emails); the Kanban ticket keeps that.",
].join(" ");

const kanbanUrl = (origin, key) => `${origin || ""}/${core.ticketHash(key)}`;

// The split when Claude isn't available: the Kanban ticket as one agent ticket.
function fallbackSplit(t) {
  const ac = core.decodeCriteria(t.acceptanceCriteria || []).map((c) => c.text).slice(0, 20);
  return [{ title: String(t.title || "").slice(0, 200), description: String(t.descriptionText || core.htmlToText(t.description || "")).slice(0, 6000), acceptanceCriteria: ac }];
}

async function claudeSplit(apiKey, t, { Anthropic, workspaceId } = {}) {
  const Client = Anthropic || require("@anthropic-ai/sdk").default || require("@anthropic-ai/sdk");
  const headers = require("./lead-enrich").workspaceHeaders(workspaceId);
  const client = new Client({ apiKey, timeout: 45000, maxRetries: 1, ...(headers ? { defaultHeaders: headers } : {}) });
  const ticket = {
    key: t.key, type: t.type, title: t.title,
    description: String(t.descriptionText || core.htmlToText(t.description || "")).slice(0, 12000),
    acceptanceCriteria: core.decodeCriteria(t.acceptanceCriteria || []).map((c) => c.text),
  };
  const res = await client.beta.messages.create({
    model: AGENT_SPLIT_MODEL,
    max_tokens: 6000,
    output_config: { effort: "low", format: { type: "json_schema", schema: SPLIT_SCHEMA } },
    fallbacks: "default",
    betas: ["server-side-fallback-2026-07-01"],
    system: SPLIT_SYSTEM,
    messages: [{ role: "user", content: `The Kanban ticket (JSON):\n${JSON.stringify(ticket)}\n\nPropose the agent tickets.` }],
  });
  if (res.stop_reason === "refusal") return null;
  const text = (res.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let out;
  try { out = JSON.parse(text); } catch { return null; }
  const list = out && Array.isArray(out.tickets) ? out.tickets.slice(0, core.AGENT_MAX_TICKETS) : [];
  const clean = core.cleanAgentSplit(list.map((x) => ({
    title: String((x && x.title) || "").slice(0, 200),
    description: String((x && x.description) || "").slice(0, 6000),
    acceptanceCriteria: (Array.isArray(x && x.acceptanceCriteria) ? x.acceptanceCriteria : []).slice(0, 20).map((c) => String(c).slice(0, 500)),
  })));
  return clean.error ? null : clean.tickets;
}

// A project the agent tickets can go to: it exists and isn't frozen.
async function usableProject(id) {
  if (!id || typeof id !== "string" || id.length > 100) return null;
  const snap = await db().collection("projects").doc(id).get();
  if (!snap.exists) return null;
  const p = snap.data() || {};
  if (p.finalised || p.archived) return null;
  return { id, name: p.name || id };
}

// h: { requireConsoleUser, rateLimited, tooMany, anthropicKey(), anthropicWorkspace?(), Anthropic?, suggestCategory?, publicOrigin? }
async function handleSendToAgent(req, res, h) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (h.rateLimited(req, "kanban-send-agent", 30)) return h.tooMany(res);
  const who = await h.requireConsoleUser(req, "editor");
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const me = core.canonicalEmail(String(who.user.email || "").toLowerCase());
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const key = core.keyNumber(String(body.key || "")) == null ? null : core.keyOf(core.keyNumber(String(body.key)));
  if (!key) { res.status(400).json({ error: "key is required (PH-n)" }); return; }
  const snap = await db().collection(TASKS).doc(key).get();
  if (!snap.exists) { res.status(404).json({ error: `No ticket ${key}.` }); return; }
  const t = Object.assign({ key }, snap.data());
  if (!core.canSendToAgent(t, me)) {
    res.status(403).json({ error: t.status === "done" ? `${key} is closed.` : `Only ${key}'s assignee can send it to an agent.` });
    return;
  }

  if (body.action === "propose") {
    const fallback = { proposal: fallbackSplit(t), source: "ticket" };
    let out = fallback;
    const apiKey = h.anthropicKey ? h.anthropicKey() : "";
    if (apiKey && apiKey !== "unset") {
      try {
        const tickets = await claudeSplit(apiKey, t, { Anthropic: h.Anthropic, workspaceId: h.anthropicWorkspace ? h.anthropicWorkspace() : "" });
        if (tickets && tickets.length) out = { proposal: tickets, source: "claude" };
      } catch (err) {
        logger.warn("send to agent: proposal failed", { key, error: String(err && err.message ? err.message : err) });
      }
    }
    const project = await usableProject(t.project);
    res.status(200).json(Object.assign(out, { projectId: project ? project.id : "" }));
    return;
  }

  if (body.action !== "confirm") { res.status(400).json({ error: "action must be propose or confirm" }); return; }
  const project = await usableProject(String(body.projectId || ""));
  if (!project) { res.status(400).json({ error: "Choose an Agent Board project that is open for new tickets." }); return; }
  const clean = core.cleanAgentSplit(body.tickets);
  if (clean.error) { res.status(400).json({ error: clean.error }); return; }
  const url = kanbanUrl(h.publicOrigin, key);
  const items = db().collection(ITEMS);
  const made = clean.tickets.map((x) => {
    const intake = applyIntake(core.agentTicketDesc(x, { key, title: t.title, url }));
    return {
      ref: items.doc(),
      title: x.title,
      data: {
        projectId: project.id, title: x.title, desc: intake.desc, type: "feature",
        category: h.suggestCategory ? h.suggestCategory(`${x.title} ${x.description}`) : "Uncategorised",
        status: "backlog",
        ownerEmail: me,
        kanbanKey: key,
        createdVia: "send-to-agent",
        createdByEmail: me,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        notes: [{ author: me, text: `Sent to Agent from Staff Kanban ticket ${key} (${url}).`, at: new Date() }],
      },
    };
  });
  const out = await db().runTransaction(async (tx) => {
    const cur = await tx.get(db().collection(TASKS).doc(key));
    if (!cur.exists) return { error: `No ticket ${key}.`, status: 404 };
    const now = Object.assign({ key }, cur.data());
    if (!core.canSendToAgent(now, me)) return { error: `Only ${key}'s assignee can send it to an agent.`, status: 403 };
    const linked = (Array.isArray(now.agentTickets) ? now.agentTickets : []).concat(made.map((m) => ({ id: m.ref.id, projectId: project.id })));
    if (linked.length > 50) return { error: `${key} already has ${linked.length - made.length} agent tickets; 50 is the most a ticket links.`, status: 400 };
    const agentTotal = (Number.isInteger(now.agentTotal) ? now.agentTotal : 0) + made.length;
    const agentDone = Number.isInteger(now.agentDone) ? now.agentDone : 0;
    for (const m of made) tx.set(m.ref, m.data);
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: me };
    tx.update(cur.ref, Object.assign({ agentTickets: linked, agentTotal, agentDone }, stamp));
    tx.set(db().collection(CARDS).doc(key), Object.assign({ agentTotal, agentDone }, stamp), { merge: true });
    tx.set(cur.ref.collection("activity").doc(), { who: me, text: `sent to agent: ${made.length} agent ticket${made.length > 1 ? "s" : ""} on ${String(project.name).slice(0, 100)} (${made.map((m) => m.title).join("; ")})`.slice(0, 500), at: FieldValue.serverTimestamp() });
    return { agentTotal, agentDone };
  });
  if (out.error) { res.status(out.status).json({ error: out.error }); return; }
  res.status(200).json({ created: made.map((m) => ({ id: m.ref.id, title: m.title, projectId: project.id })), agentTotal: out.agentTotal, agentDone: out.agentDone });
}

// ── The roll-up (trigger on backlogItems/{id}) ─────────────────────────────
let moveTool = null;
function kanbanMove() {
  if (!moveTool) {
    const tools = require("./kanban").kanbanTools({ textResult: (value) => ({ ok: true, value }), toolError: (error) => ({ ok: false, error }), audit: async () => {} });
    moveTool = tools.find((x) => x.name === "kanban_move_task");
  }
  return moveTool;
}

// Did this write change what the roll-up counts?
function rollupChanged(before, after) {
  const key = (after && after.kanbanKey) || (before && before.kanbanKey);
  if (!key) return null;
  if (!before || !after) return key;
  if (before.status !== after.status || core.agentBuilt(before) !== core.agentBuilt(after)) return key;
  return null;
}

// Recount a Kanban ticket's agent tickets; move it on when all are built.
// opts.move (tests) replaces kanban_move_task. Returns what it did.
async function recountAgentTickets(key, opts = {}) {
  const ref = db().collection(TASKS).doc(key);
  const snap = await ref.get();
  if (!snap.exists) return { key, skipped: "no-ticket" };
  const t = Object.assign({ key }, snap.data());
  const linked = Array.isArray(t.agentTickets) ? t.agentTickets.filter((x) => x && typeof x.id === "string" && x.id) : [];
  if (!linked.length) return { key, skipped: "no-agent-tickets" };
  const docs = await Promise.all(linked.map((x) => db().collection(ITEMS).doc(x.id).get()));
  const { total, done } = core.agentRollup(docs.map((d) => (d.exists ? d.data() : null)));
  // Every linked agent ticket must still exist: deleting the unbuilt ones
  // would otherwise "complete" the split and move the ticket automatically.
  const allBuilt = total > 0 && done === total && total === linked.length;
  const moveNow = allBuilt && BEFORE_TESTING.includes(t.status);
  if (total !== t.agentTotal || done !== t.agentDone || moveNow) {
    const b = db().batch();
    const stamp = { updatedAt: FieldValue.serverTimestamp(), updatedBy: core.canonicalEmail(t.assignee || "") || "agent-board" };
    b.update(ref, Object.assign({ agentTotal: total, agentDone: done }, stamp));
    b.set(db().collection(CARDS).doc(key), Object.assign({ agentTotal: total, agentDone: done }, stamp), { merge: true });
    if (moveNow) b.set(ref.collection("activity").doc(), { who: stamp.updatedBy, text: `all ${total} agent ticket${total > 1 ? "s are" : " is"} built on the Agent Board`, at: FieldValue.serverTimestamp() });
    await b.commit();
  }
  if (!moveNow) return { key, total, done, moved: false };
  // The owner's own move, so the testing hand-off, the activity line and the
  // parent roll-up (KB-TASK-14) are exactly those of a person's.
  const owner = core.canonicalEmail(t.assignee || "");
  const session = { email: owner || "agent-board", role: "editor", displayName: "" };
  const run = opts.move || ((args, s) => kanbanMove().run(args, s));
  const r = await run({ key, status: "ready-for-testing" }, session);
  if (r && r.ok === false) logger.warn("send to agent: move to testing failed", { key, error: r.error });
  const v = (r && r.value) || {};
  return { key, total, done, moved: !!(r && r.ok !== false), parentsMovedToTesting: v.parentsMovedToTesting || [] };
}

async function agentTicketWritten(event, opts = {}) {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const key = rollupChanged(before, after);
  if (!key) return null;
  try { return await recountAgentTickets(key, opts); }
  catch (err) { logger.error("send to agent: roll-up failed", { key, error: String(err && err.stack ? err.stack : err) }); return null; }
}

module.exports = { handleSendToAgent, agentTicketWritten, recountAgentTickets, rollupChanged, fallbackSplit, claudeSplit, SPLIT_SCHEMA, AGENT_SPLIT_MODEL };
