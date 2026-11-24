// Promote › Leads: Hot Lead → ACE opportunity draft (functions/ace-draft.js, ticket
// qLIDYPTSvzKqYLLsI8kC) — who is drafted, what the agent is sent, the score and
// recommendations parse, the approval gate (nothing approved here), a retried trigger,
// the lead → ACE stage queue and its one bulk sync, the insights, and the routes.
// No network, no Firebase: Firestore and the Partner Central agent are stubs.
//   cd backlog-tracker/test && node ace-draft.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  createAceDraft, eligibility, pickAttachments, leadNotes, buildDraftPrompt, parseDraftReply, opportunityIdFrom, insights,
  buildSyncPrompt, aceStageFor, stageMove, isAwsCloud, COLLECTION,
} = require("../functions/ace-draft");

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

// ── a small Firestore fake: doc get/set(merge)/update, transactions, where("a.b" == v) ──
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (k, x) => (x instanceof Date ? { __date: x.toISOString() } : x)), (k, x) => (x && x.__date ? new Date(x.__date) : x)));
const deepGet = (o, p) => p.split(".").reduce((a, k) => (a && typeof a === "object" ? a[k] : undefined), o);
function fakeDb(seed) {
  const state = clone(seed || {});
  const col = (name) => (state[name] = state[name] || {});
  const ref = (name, id) => ({
    name, id,
    async get() { const d = col(name)[id]; return { id, exists: d !== undefined, data: () => clone(d) }; },
    async set(data, opts) { col(name)[id] = opts && opts.merge ? { ...(col(name)[id] || {}), ...clone(data) } : clone(data); },
    async update(data) { if (col(name)[id] === undefined) throw new Error("NOT_FOUND"); col(name)[id] = { ...col(name)[id], ...clone(data) }; },
  });
  const query = (name, filters, max) => ({
    where: (f, op, v) => { assert.strictEqual(op, "=="); return query(name, [...filters, [f, v]], max); },
    limit: (n) => query(name, filters, n),
    async get() {
      const docs = Object.entries(col(name)).filter(([, d]) => filters.every(([f, v]) => deepGet(d, f) === v)).slice(0, max || 1e9)
        .map(([id, d]) => ({ id, data: () => clone(d) }));
      return { docs };
    },
  });
  return {
    state,
    collection: (name) => ({ doc: (id) => ref(name, id), where: (f, op, v) => query(name, [], 0).where(f, op, v) }),
    async runTransaction(fn) {
      return fn({ get: (r) => r.get(), set: (r, d, o) => r.set(d, o), update: (r, d) => r.update(d) });
    },
  };
}

const T0 = "2026-11-24T10:00:00.000Z";
let clock = Date.parse(T0);
const now = () => new Date(clock);
const quiet = { warn() {}, info() {}, error() {} };

const REPLY = [
  "I prepared the draft opportunity for Acme Retail with the one-pager and prospect pack attached.",
  "PREDICTED_SCORE: 64",
  "RECOMMENDATIONS: Add the expected monthly spend; Name the AWS account manager",
].join("\n");

function makePc({ catalog = "Sandbox", reply = REPLY, pending = true, failWith = null, opportunity = null } = {}) {
  const sent = [];
  const pc = {
    sent,
    async loadConfig() { return { catalog, roleArn: "arn" }; },
    async agentMessage(input, ctx) {
      sent.push({ input, by: ctx.by });
      if (failWith) throw Object.assign(new Error(failWith), { status: 502 });
      const approvals = pending ? [{ toolUseId: `tu-${sent.length}`, toolName: input.leadId ? "CreateOpportunity" : "UpdateOpportunity", parameters: {}, state: "pending" }] : [];
      return { session: { sessionId: `sess-${sent.length}`, approvals }, reply: { sessionId: `sess-${sent.length}`, status: pending ? "requires_approval" : "complete", text: reply, approvals } };
    },
    async getOpportunity(id) {
      if (!opportunity) throw new Error("ResourceNotFoundException");
      return { Id: id, ...opportunity };
    },
    async authorise(req, min) {
      pc.lastMin = min;
      const who = req.get("x-user");
      if (!who) return { ok: false, status: 401, error: "sign in first" };
      const role = who.split("@")[0];
      const rank = { viewer: 1, editor: 2, admin: 3 };
      if (rank[role] < rank[min]) return { ok: false, status: 403, error: "no" };
      return { ok: true, user: { email: who, role } };
    },
  };
  return pc;
}

const ACME_COMPANY = {
  name: "Acme Retail",
  profile: { primaryCloud: "AWS", summary: "A UK grocer with 40 stores." },
  aceOpportunity: null,
  documents: [
    { id: "d1", title: "Grocery one-pager v1", kind: "industry-one-pager", version: 1, date: "2026-09-01", url: "https://docs.example/op1.pdf" },
    { id: "d2", title: "Grocery one-pager", kind: "industry-one-pager", version: 2, date: "2026-11-01", url: "https://docs.example/op2.pdf" },
    { id: "d3", title: "Acme prospect pack", kind: "prospect-pack", version: 1, date: "2026-11-10", url: "" },
    { id: "d4", title: "Deck", kind: "deck", version: 1, date: "2026-11-11", url: "" },
  ],
};
const acmeLead = (stage = "lead", extra = {}) => ({
  company: { name: "Acme Retail", website: "https://acme.example", industry: "Grocery", countries: ["UK"], storeCount: 40, awsAccountId: "" },
  contacts: [{ id: "c1", name: "Dana Buyer", email: "dana@acme.example", jobTitle: "CTO", buyingRole: "decision-maker" }],
  stage, source: "Manual", leadType: "company",
  history: [
    { at: "2026-11-20T09:00:00Z", by: "rob@ph.example", kind: "note", text: "Meeting notes: they want retail media in 40 stores by Q2." },
    { at: "2026-11-21T09:00:00Z", by: "AWS Partner Central lead enrichment", kind: "note", text: "Enriched by AWS Partner Central (Sandbox catalogue): lead score 72." },
    { at: "2026-11-22T09:00:00Z", by: "rob@ph.example", kind: "stage", text: "Moved from Lead to Hot Lead" },
  ],
  ...extra,
});

function make(seed, opts) {
  const db = fakeDb(seed);
  const pc = makePc(opts);
  const api = createAceDraft({ db, partnerCentral: pc, now, logger: quiet });
  return { db, pc, api };
}
const snap = (d) => ({ exists: d !== undefined, data: () => clone(d) });
const leadEvent = (id, before, after) => ({ params: { leadId: id }, data: { before: snap(before), after: snap(after) } });
// Move a lead's stage the way the board does, and run the trigger on that write.
async function move(env, id, stage) {
  const before = clone(env.db.state.leads[id]);
  env.db.state.leads[id] = { ...before, stage };
  await env.api.onLeadWrite(leadEvent(id, before, env.db.state.leads[id]));
}
function res() {
  const r = { statusCode: 0, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
const req = (method, p, user, body = {}) => ({ method, path: p, body, get: (h) => (h === "x-user" ? user : "") });

// The keys firestore.rules lets a lead hold: anything this module writes on a lead must be one of them.
const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const LEAD_KEYS = (() => {
  const m = /function isLead\(d\)[\s\S]*?d\.keys\(\)\.hasOnly\(\[([\s\S]*?)\]\)/.exec(RULES);
  assert.ok(m, "isLead's key list in firestore.rules");
  return new Set([...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
})();

// ── pure rules ──
check("eligibility: AWS primary cloud only, no opportunity yet, company leads only", () => {
  assert.deepStrictEqual(eligibility(acmeLead("hot-lead"), ACME_COMPANY), { ok: true, reason: "" });
  assert.ok(isAwsCloud("Amazon Web Services") && isAwsCloud("aws") && !isAwsCloud("Microsoft Azure") && !isAwsCloud("Laws of retail"));
  assert.match(eligibility(acmeLead(), { ...ACME_COMPANY, profile: { primaryCloud: "Microsoft Azure" } }).reason, /primary cloud is Microsoft Azure, not AWS/);
  assert.match(eligibility(acmeLead(), { ...ACME_COMPANY, profile: {} }).reason, /no primary cloud/);
  assert.match(eligibility(acmeLead(), null).reason, /No Prospects \(TAM\) company record for Acme Retail/);
  assert.match(eligibility(acmeLead(), { ...ACME_COMPANY, aceOpportunity: { id: "O111111" } }).reason, /already has ACE opportunity O111111/);
  assert.match(eligibility(acmeLead("hot-lead", { aceOpportunityId: "O222222" }), ACME_COMPANY).reason, /already has ACE opportunity O222222/);
  assert.strictEqual(eligibility({ ...acmeLead(), leadType: "operator" }, ACME_COMPANY).ok, false);
});

check("attachments are the newest industry one-pager and prospect pack; notes leave out the console's own lines", () => {
  assert.deepStrictEqual(pickAttachments(ACME_COMPANY.documents).map((a) => [a.kind, a.title, a.url]), [
    ["industry-one-pager", "Grocery one-pager", "https://docs.example/op2.pdf"], ["prospect-pack", "Acme prospect pack", ""],
  ]);
  const notes = leadNotes(acmeLead());
  assert.deepStrictEqual(notes.map((n) => n.text), ["Meeting notes: they want retail media in 40 stores by Q2."]);
  const many = { history: Array.from({ length: 12 }, (_, i) => ({ at: `2026-11-${10 + i}T00:00:00Z`, kind: "note", text: `note ${i}` })) };
  assert.deepStrictEqual(leadNotes(many).map((n) => n.text), ["note 11", "note 10", "note 9", "note 8", "note 7", "note 6", "note 5", "note 4"]);
});

check("the draft message: lead record, attachments, notes, the 60+ ask and the reply lines; no addresses; within 4,000 characters", () => {
  const lead = acmeLead("hot-lead");
  const msg = buildDraftPrompt({ lead, company: ACME_COMPANY, attachments: pickAttachments(ACME_COMPANY.documents), notes: leadNotes(lead), catalog: "Sandbox" });
  assert.match(msg, /^Draft an ACE opportunity for this customer in the Sandbox catalogue/);
  for (const s of ["Customer: Acme Retail", "Primary cloud: AWS", "Dana Buyer, CTO, decision-maker", "Industry one-pager: Grocery one-pager (https://docs.example/op2.pdf)", "Prospect pack: Acme prospect pack", "retail media in 40 stores", "Opportunity Quality Score of 60 or more", "Do not submit", "PREDICTED_SCORE:", "RECOMMENDATIONS:"]) assert.ok(msg.includes(s), s);
  assert.ok(!/dana@acme\.example/.test(msg), "no contact addresses");
  const long = { ...lead, history: Array.from({ length: 8 }, (_, i) => ({ at: "2026-11-01T00:00:00Z", kind: "note", text: `Transcript ${i} `.repeat(300) })) };
  const big = buildDraftPrompt({ lead: long, company: ACME_COMPANY, attachments: [], notes: leadNotes(long), catalog: "AWS" });
  assert.ok(big.length <= 4000, `${big.length}`);
  assert.ok(big.endsWith("separated by semicolons, or none>"), "the reply lines are never cut off");
});

check("the reply: the last PREDICTED_SCORE line (0–100, else none) and the recommendations", () => {
  assert.deepStrictEqual(parseDraftReply(REPLY), { predictedScore: 64, recommendations: ["Add the expected monthly spend", "Name the AWS account manager"] });
  assert.deepStrictEqual(parseDraftReply("Score is about 70.\n**PREDICTED_SCORE: 71**\nRECOMMENDATIONS:\n- Add next steps\n- Attach the business case\n\nThanks"), { predictedScore: 71, recommendations: ["Add next steps", "Attach the business case"] });
  assert.strictEqual(parseDraftReply("PREDICTED_SCORE: 150").predictedScore, null);
  assert.strictEqual(parseDraftReply("I predict a score of 64").predictedScore, null, "only the fixed line counts");
  assert.deepStrictEqual(parseDraftReply("PREDICTED_SCORE: 60\nRECOMMENDATIONS: none").recommendations, []);
  assert.strictEqual(opportunityIdFrom("Created opportunity O1234567 (Prospect)."), "O1234567");
  assert.strictEqual(opportunityIdFrom("Opportunity 12 created"), null);
});

check("lead → ACE stage, never Launched, and which moves go backwards", () => {
  assert.deepStrictEqual(["lead", "hot-lead", "demo", "post-demo", "closed-won", "closed-lost"].map(aceStageFor), [null, "Prospect", "Qualified", "Technical Validation", "Committed", "Closed Lost"]);
  assert.strictEqual(stageMove("Prospect", "Qualified"), "forward");
  assert.strictEqual(stageMove("Technical Validation", "Prospect"), "backward");
  assert.strictEqual(stageMove("Qualified", "Closed Lost"), "forward");
  assert.strictEqual(stageMove("Closed Lost", "Qualified"), "backward");
  assert.strictEqual(stageMove("Prospect", null), "backward", "back to Lead has no ACE stage");
  assert.strictEqual(stageMove("Qualified", "Qualified"), "same");
});

check("insights: past target close, no change for 30 days, score under 60, no next steps, closed lost", () => {
  const at = new Date(T0);
  const keys = insights({ stage: "Qualified", targetCloseDate: "2026-10-01", lastModifiedDate: "2026-10-01T00:00:00Z", score: 48, nextSteps: "" }, at).map((i) => i.key);
  assert.deepStrictEqual(keys, ["past-close", "stale", "low-score", "no-next-steps"]);
  assert.deepStrictEqual(insights({ stage: "Qualified", targetCloseDate: "2027-01-01", lastModifiedDate: "2026-11-20T00:00:00Z", score: 70, nextSteps: "Demo" }, at), []);
  const lost = insights({ stage: "Closed Lost", closedLostReason: "Price", targetCloseDate: "2026-01-01", score: 10 }, at);
  assert.deepStrictEqual(lost, [{ key: "closed-lost", level: "lost", text: "Closed lost: Price." }]);
  assert.deepStrictEqual(insights(null, at), []);
});

// ── the trigger and the approval gate ──
check("moving to Hot Lead drafts once through the agent and waits for approval; a retried trigger does not draft again", async () => {
  const env = make({ leads: { L1: acmeLead("lead") }, prospectCompanies: { acmeretail: ACME_COMPANY } });
  await move(env, "L1", "hot-lead");
  assert.strictEqual(env.pc.sent.length, 1, "one agent message");
  assert.strictEqual(env.pc.sent[0].input.leadId, "L1", "linked to the lead (its AI session id is logged on it)");
  assert.match(env.pc.sent[0].input.text, /Draft an ACE opportunity/);
  const ace = env.db.state[COLLECTION].L1;
  assert.strictEqual(ace.status, "awaiting-approval");
  assert.strictEqual(ace.predictedScore, 64);
  assert.deepStrictEqual(ace.recommendations, ["Add the expected monthly spend", "Name the AWS account manager"]);
  assert.deepStrictEqual(ace.attachments.map((a) => a.title), ["Grocery one-pager", "Acme prospect pack"]);
  assert.strictEqual(ace.pendingApprovals, 1);
  assert.strictEqual(ace.auto, true);
  assert.ok(!env.db.state.leads.L1.aceOpportunityId, "nothing written to Partner Central, no opportunity yet");
  assert.match(env.db.state.leads.L1.history.at(-1).text, /predicted quality score 64: the create waits for an admin's approval; nothing was written to Partner Central yet/);
  // The same event delivered again (Firestore retries), and a second click.
  const before = { ...env.db.state.leads.L1, stage: "lead" };
  await env.api.onLeadWrite(leadEvent("L1", before, env.db.state.leads.L1));
  const again = await env.api.draft("L1", { by: "admin@ph.example" });
  assert.strictEqual(env.pc.sent.length, 1, "still one agent message");
  assert.match(again.reason, /already waits for approval/);
  for (const k of Object.keys(env.db.state.leads.L1)) assert.ok(LEAD_KEYS.has(k), `lead key ${k} is allowed by firestore.rules`);
});

check("a company whose primary cloud is not AWS is not drafted, and the agent is not called", async () => {
  const env = make({ leads: { L1: acmeLead("lead") }, prospectCompanies: { acmeretail: { ...ACME_COMPANY, profile: { primaryCloud: "Google Cloud" } } } });
  await move(env, "L1", "hot-lead");
  assert.strictEqual(env.pc.sent.length, 0);
  assert.deepStrictEqual([env.db.state[COLLECTION].L1.status, env.db.state[COLLECTION].L1.reason], ["skipped", "The TAM company's primary cloud is Google Cloud, not AWS."]);
  await move(env, "L1", "demo");
  assert.strictEqual(env.pc.sent.length, 0, "no stage queue without a draft");
  assert.ok(!env.db.state[COLLECTION].L1.stageSync);
});

check("an agent failure is recorded as Couldn't draft with AWS's reason, and Draft again works", async () => {
  const env = make({ leads: { L1: acmeLead("lead") }, prospectCompanies: { acmeretail: ACME_COMPANY } }, { failWith: "HTTP 403: AccessDeniedException: not linked" });
  await move(env, "L1", "hot-lead");
  assert.deepStrictEqual([env.db.state[COLLECTION].L1.status, env.db.state[COLLECTION].L1.reason], ["error", "HTTP 403: AccessDeniedException: not linked"]);
  const pc2 = makePc();
  env.pc.agentMessage = pc2.agentMessage;
  const out = await env.api.draft("L1", { by: "admin@ph.example" });
  assert.strictEqual(out.status, "awaiting-approval");
  assert.strictEqual(env.db.state[COLLECTION].L1.attempts, 2);
});

check("an approval in Settings settles the draft: the opportunity id goes on the lead; a rejection says so", async () => {
  const env = make({ leads: { L1: acmeLead("lead"), L2: acmeLead("lead", { company: { ...acmeLead().company, name: "Bravo" } }) }, prospectCompanies: { acmeretail: ACME_COMPANY, bravo: { ...ACME_COMPANY, name: "Bravo" } } });
  await move(env, "L1", "hot-lead");
  await move(env, "L2", "hot-lead");
  const s1 = env.db.state[COLLECTION].L1.sessionId; const s2 = env.db.state[COLLECTION].L2.sessionId;
  env.db.state.partnerCentralAgentSessions = {
    [s1]: { leadId: "L1", lastReply: "Draft opportunity O7654321 created (not submitted).", approvals: [{ toolUseId: "tu-1", state: "approved", decidedBy: "admin@ph.example" }] },
    [s2]: { leadId: "L2", lastReply: "Cancelled.", approvals: [{ toolUseId: "tu-2", state: "rejected" }] },
  };
  await env.api.onSessionWrite({ params: { sessionId: s1 }, data: { after: snap(env.db.state.partnerCentralAgentSessions[s1]) } });
  await env.api.onSessionWrite({ params: { sessionId: s2 }, data: { after: snap(env.db.state.partnerCentralAgentSessions[s2]) } });
  assert.deepStrictEqual([env.db.state[COLLECTION].L1.status, env.db.state[COLLECTION].L1.opportunityId, env.db.state[COLLECTION].L1.aceStage], ["drafted", "O7654321", "Prospect"]);
  assert.strictEqual(env.db.state.leads.L1.aceOpportunityId, "O7654321");
  assert.match(env.db.state.leads.L1.history.at(-1).text, /ACE opportunity O7654321 created in Partner Central/);
  assert.strictEqual(env.db.state[COLLECTION].L2.status, "rejected");
  assert.ok(!env.db.state.leads.L2.aceOpportunityId);
  assert.strictEqual(env.pc.sent.length, 2, "settling sends nothing");
});

check("later stage moves are queued, the newest wins, a backwards move is flagged; one bulk sync sends them, held for approval", async () => {
  const env = make({
    leads: { L1: acmeLead("hot-lead", { aceOpportunityId: "O7654321" }), L2: acmeLead("hot-lead", { company: { ...acmeLead().company, name: "Bravo" }, aceOpportunityId: "O1111111" }), L3: acmeLead("lead", { company: { ...acmeLead().company, name: "Carol" } }) },
    prospectCompanies: { acmeretail: ACME_COMPANY, carol: { ...ACME_COMPANY, name: "Carol" } },
    [COLLECTION]: { L1: { leadId: "L1", status: "drafted", opportunityId: "O7654321", aceStage: "Prospect" } },
  });
  await move(env, "L1", "demo");
  assert.deepStrictEqual(env.db.state[COLLECTION].L1.stageSync.status + "/" + env.db.state[COLLECTION].L1.stageSync.target, "pending/Qualified");
  await move(env, "L1", "post-demo");
  assert.strictEqual(env.db.state[COLLECTION].L1.stageSync.target, "Technical Validation");
  await move(env, "L2", "demo"); // an opportunity linked by hand counts too
  assert.deepStrictEqual([env.db.state[COLLECTION].L2.opportunityId, env.db.state[COLLECTION].L2.stageSync.target], ["O1111111", "Qualified"]);
  await move(env, "L3", "hot-lead"); // drafted, waiting for approval: its move waits for the opportunity
  await move(env, "L3", "demo");
  assert.strictEqual(env.db.state[COLLECTION].L3.stageSync.status, "pending");
  const sentBefore = env.pc.sent.length;
  assert.strictEqual(sentBefore, 1, "stage moves alone call no agent");
  const list = await env.api.syncList();
  assert.deepStrictEqual(list.map((x) => [x.leadId, x.opportunityId, x.target]).sort(), [["L1", "O7654321", "Technical Validation"], ["L2", "O1111111", "Qualified"], ["L3", null, "Qualified"]]);
  const out = await env.api.syncSend({ by: "admin@ph.example" });
  assert.strictEqual(env.pc.sent.length, 2, "one agent message for both");
  const text = env.pc.sent[1].input.text;
  assert.match(text, /O7654321 \(Acme Retail\): move to Technical Validation/);
  assert.match(text, /O1111111 \(Bravo\): move to Qualified/);
  assert.ok(!env.pc.sent[1].input.leadId);
  assert.deepStrictEqual([out.sent, out.waiting, out.message], [2, 1, "2 ACE stage changes wait for your approval."]);
  assert.strictEqual(env.db.state[COLLECTION].L1.stageSync.status, "sent");
  assert.strictEqual(env.db.state[COLLECTION].L3.stageSync.status, "pending", "no opportunity yet: stays queued");
  // Approved: the ACE stage follows.
  const sid = env.db.state[COLLECTION].L1.stageSync.sessionId;
  env.db.state.partnerCentralAgentSessions = { [sid]: { lastReply: "Updated.", approvals: [{ toolUseId: "tu-2", state: "approved" }] } };
  await env.api.onSessionWrite({ params: { sessionId: sid }, data: { after: snap(env.db.state.partnerCentralAgentSessions[sid]) } });
  assert.deepStrictEqual([env.db.state[COLLECTION].L1.stageSync.status, env.db.state[COLLECTION].L1.aceStage], ["done", "Technical Validation"]);
  assert.strictEqual(env.db.state[COLLECTION].L2.aceStage, "Qualified");
  // Backwards: flagged, never sent.
  await move(env, "L1", "hot-lead");
  assert.strictEqual(env.db.state[COLLECTION].L1.stageSync.status, "flagged");
  assert.match(env.db.state[COLLECTION].L1.stageSync.reason, /ACE is not moved backwards \(Technical Validation → Prospect\)/);
  assert.deepStrictEqual((await env.api.syncList()).map((x) => x.leadId), ["L3"]);
  assert.match(buildSyncPrompt([{ opportunityId: "O1", company: "X", target: "Qualified" }], "Sandbox"), /^Update the stage of these ACE opportunities in the Sandbox catalogue, as one bulk update:\n- O1 \(X\): move to Qualified/);
});

check("routes: the view for editors, Draft and Sync for admins; the view shows the predicted, then Partner Central's score", async () => {
  const opportunity = { LifeCycle: { Stage: "Qualified", TargetCloseDate: "2026-10-01", NextSteps: "" }, LastModifiedDate: "2026-11-20T00:00:00Z", Project: { Title: "Acme" }, OpportunityScore: 48 };
  const env = make({ leads: { L1: acmeLead("hot-lead"), L9: acmeLead("hot-lead", { company: { ...acmeLead().company, name: "Nine" } }) }, prospectCompanies: { acmeretail: ACME_COMPANY } }, { opportunity });
  let r = res();
  assert.strictEqual(await env.api.handle(req("GET", "/partnerCentral/v1/leads/L1/enrich", "admin@x"), r), false, "not ours");
  r = res(); await env.api.handle(req("GET", "/partnerCentral/v1/leads/L1/ace", "viewer@x"), r);
  assert.strictEqual(r.statusCode, 403);
  r = res(); await env.api.handle(req("GET", "/partnerCentral/v1/leads/L1/ace", "editor@x"), r);
  assert.deepStrictEqual([r.statusCode, r.body.eligible.ok, r.body.draft, r.body.primaryCloud, r.body.targetScore], [200, true, null, "AWS", 60]);
  assert.deepStrictEqual(r.body.attachments.map((a) => a.title), ["Grocery one-pager", "Acme prospect pack"]);
  r = res(); await env.api.handle(req("GET", "/partnerCentral/v1/leads/L9/ace", "editor@x"), r);
  assert.match(r.body.eligible.reason, /No Prospects \(TAM\) company record for Nine/);
  r = res(); await env.api.handle(req("POST", "/partnerCentral/v1/leads/L1/ace/draft", "editor@x"), r);
  assert.deepStrictEqual([r.statusCode, env.pc.lastMin, env.pc.sent.length], [403, "admin", 0], "editors cannot draft");
  r = res(); await env.api.handle(req("POST", "/partnerCentral/v1/leads/L1/ace/draft", "admin@x"), r);
  assert.deepStrictEqual([r.statusCode, r.body.status, r.body.ace.score, r.body.ace.draft.status], [200, "awaiting-approval", { value: 64, source: "predicted" }, "awaiting-approval"]);
  assert.strictEqual(env.pc.sent[0].by, "admin@x");
  r = res(); await env.api.handle(req("POST", "/partnerCentral/v1/leads/nope/ace/draft", "admin@x"), r);
  assert.strictEqual(r.statusCode, 404);
  r = res(); await env.api.handle(req("GET", "/partnerCentral/v1/ace-sync", "editor@x"), r);
  assert.strictEqual(r.statusCode, 403, "sync is admin only");
  r = res(); await env.api.handle(req("DELETE", "/partnerCentral/v1/ace-sync", "admin@x"), r);
  assert.strictEqual(r.statusCode, 405);
  // Once the opportunity exists, Partner Central's own score and stage, and its insights.
  env.db.state.leads.L1.aceOpportunityId = "O7654321";
  r = res(); await env.api.handle(req("GET", "/partnerCentral/v1/leads/L1/ace", "editor@x"), r);
  assert.deepStrictEqual([r.body.opportunityId, r.body.opportunity.stage, r.body.score], ["O7654321", "Qualified", { value: 48, source: "actual" }]);
  assert.deepStrictEqual(r.body.insights.map((i) => i.key), ["past-close", "low-score", "no-next-steps"]);
  assert.match(r.body.opportunity.partnerCentralUrl, /O7654321$/);
});

(async () => {
  let n = 0;
  for (const [name, fn] of checks) {
    clock = Date.parse(T0);
    await fn();
    n++;
    console.log(`ok - ${name}`);
  }
  console.log(`\nace-draft: ${n} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
