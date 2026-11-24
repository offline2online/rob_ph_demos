// Promote › Leads: AWS Partner Central lead enrichment (functions/pc-lead-enrich.js) —
// sending a new lead, test leads in the Sandbox catalogue, leads that are never sent,
// following the asynchronous task, storing the result, the score and Hot Lead
// promotion, Send again, and a deleted lead. No network, no Firebase: AWS is a stub.
"use strict";
const assert = require("assert");
const { createPcLeadEnrich, buildEngagement, readEngagement, notSendable, countryCode, TEST_CONTACT } = require("../functions/pc-lead-enrich");
const core = require("../functions/leads-core");

let n = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

function fakeDb(seed) {
  const state = { leads: JSON.parse(JSON.stringify(seed || {})) };
  const ref = (id) => ({
    id,
    async get() { const d = state.leads[id]; return { exists: d !== undefined, data: () => d }; },
  });
  return {
    state,
    collection: (name) => { assert.strictEqual(name, "leads"); return { doc: ref }; },
    async runTransaction(fn) {
      const tx = {
        get: (r) => r.get(),
        update: (r, data) => {
          if (state.leads[r.id] === undefined) throw new Error("NOT_FOUND: no document to update");
          state.leads[r.id] = { ...state.leads[r.id], ...data };
        },
      };
      return fn(tx);
    },
  };
}

const ENGAGEMENT = {
  Id: "eng-1",
  Contexts: [
    { Type: "Lead", Payload: { Lead: { Customer: { CompanyName: "Acme" }, Insights: { LeadReadinessScore: "HIGH", ChannelRecommendation: { RecommendedChannel: "EMAIL", BestOutreachWindows: [{ Day: "TUESDAY", StartTimeUtc: "09:00", EndTimeUtc: "11:00" }] } } } } },
    { Id: "ctx-pr", Type: "ProspectingResult", Payload: { ProspectingResult: { Aws: {
      Customer: { AccountName: "Acme Retail", Geo: "EMEA", Region: "UKIR", Country: "GB", Industry: "Retail", SubIndustry: "Grocery", Segment: "Enterprise", CompanySize: "1000+", EligiblePrograms: ["Greenfield", "Pioneer Credits"], PublicProfileSummary: "A UK grocer." },
      Insights: { MarketplaceEngagementScore: "HIGH", SolutionScore: "MEDIUM", SolutionCategory: "Analytics", SolutionSubCategory: "Retail media" },
    } } } },
  ],
};

function makePc({ catalog = "Sandbox", autoPromote = true, taskStatus = ["COMPLETED"], engagement = ENGAGEMENT, failOn = null } = {}) {
  const calls = [];
  let polls = 0;
  const pc = {
    calls,
    async loadConfig() { return { catalog, roleArn: "arn", autoPromote }; },
    async callAws(op, payload, ctx) {
      const effective = ctx && ctx.sandbox ? "Sandbox" : (ctx && ctx.config ? ctx.config.catalog : catalog);
      calls.push({ op, payload, catalog: effective, by: ctx && ctx.by });
      if (failOn === op) throw new Error("AccessDeniedException: not authorised");
      if (op === "CreateEngagement") return { Id: "eng-1", Arn: "arn:eng-1" };
      if (op === "StartProspectingFromEngagementTask") return { TaskId: "task-abcdefghijklmn", TaskStatus: "PENDING", Identifiers: payload.Identifiers };
      if (op === "GetProspectingFromEngagementTask") { const st = taskStatus[Math.min(polls++, taskStatus.length - 1)]; return { TaskId: payload.TaskIdentifier, Engagements: [{ EngagementIdentifier: "eng-1", EngagementContextId: "ctx-pr", Status: st }] }; }
      if (op === "GetEngagement") return engagement;
      throw new Error(`unexpected ${op}`);
    },
    async authorise(req, min) {
      const who = req.get("x-user");
      if (!who) return { ok: false, status: 401, error: "sign in first" };
      if (who === "viewer@ph.example") return { ok: false, status: 403, error: "no" };
      return { ok: true, user: { email: who, role: min } };
    },
  };
  return pc;
}

let clock = Date.parse("2026-11-24T10:00:00Z");
const now = () => new Date(clock);
const sleep = async (ms) => { clock += ms; };
function make(seed, opts) {
  const db = fakeDb(seed);
  const pc = makePc(opts);
  const api = createPcLeadEnrich({ db, partnerCentral: pc, now, sleep, logger: { warn() {}, info() {}, error() {} } });
  return { db, pc, api };
}
const snap = (d) => ({ exists: d !== undefined, data: () => d });
const ev = (id, before, after) => ({ params: { leadId: id }, data: { before: snap(before), after: snap(after) } });
// Run the trigger for every write the module made, the way Firestore would.
async function settle(api, db, id, before) {
  let prev = before;
  for (let i = 0; i < 12; i++) {
    const cur = db.state.leads[id];
    if (JSON.stringify(cur) === JSON.stringify(prev)) return;
    const was = prev;
    prev = JSON.parse(JSON.stringify(cur));
    await api.onLeadWrite(ev(id, was, cur));
  }
}

const REAL = { leadType: "company", company: { name: "Acme Retail", website: "https://acme.example", industry: "Grocery", countries: ["UK"] }, contacts: [{ id: "c1", name: "Sam Smith", jobTitle: "CMO", buyingRole: "decision-maker", email: "sam@acme.example" }], stage: "lead", source: "Website form", sourceLabel: "Contact us", inboundCount: 3, createdAt: "2026-11-24T09:00:00Z", history: [] };
const TEST = { leadType: "company", company: { name: "Test Shop", countries: [] }, contacts: [], stage: "lead", source: "Website form", test: true, createdAt: "2026-11-24T09:00:00Z", history: [] };

check("the engagement body: a Lead context with the company and one interaction, no invented contact", () => {
  const b = buildEngagement("L1", REAL, 1, now());
  assert.strictEqual(b.ClientToken, "ph-lead-L1-1");
  assert.ok(b.Title.length <= 40);
  const lead = b.Contexts[0].Payload.Lead;
  assert.strictEqual(b.Contexts[0].Type, "Lead");
  assert.deepStrictEqual(lead.Customer, { CompanyName: "Acme Retail", WebsiteUrl: "https://acme.example", Industry: "Grocery", Address: { CountryCode: "GB" } });
  assert.deepStrictEqual(lead.Interactions[0].Contact, { FirstName: "Sam", LastName: "Smith", Email: "sam@acme.example", BusinessTitle: "CMO" });
  assert.strictEqual(lead.Interactions[0].SourceId, "L1");
  assert.deepStrictEqual(buildEngagement("T1", TEST, 1, now()).Contexts[0].Payload.Lead.Interactions[0].Contact, TEST_CONTACT, "a test lead carries placeholder details");
  assert.strictEqual(countryCode(["France"]), "FR"); assert.strictEqual(countryCode(["Atlantis"]), ""); assert.strictEqual(countryCode(["DE"]), "DE");
});

check("never sent: network operator inquiries, archived leads, no company name, a real lead with no named contact with an email", () => {
  assert.match(notSendable({ leadType: "operator", company: { name: "x" } }), /network operator/);
  assert.match(notSendable({ ...REAL, archivedAt: "2026-11-01" }), /archived/);
  assert.strictEqual(notSendable({ ...REAL, company: { name: "" } }), "no company name");
  assert.strictEqual(notSendable({ ...REAL, contacts: [{ name: "Sam", email: "" }] }), "contact incomplete");
  assert.strictEqual(notSendable({ ...TEST }), "", "a test lead needs no contact (placeholder details)");
  assert.strictEqual(notSendable(REAL), "");
});

check("a new test lead is sent to the Sandbox catalogue even when the live catalogue is on, followed and enriched; never promoted", async () => {
  const { db, pc, api } = make({ T1: TEST }, { catalog: "AWS", taskStatus: ["IN_PROGRESS", "COMPLETED"] });
  await settle(api, db, "T1", undefined);
  assert.deepStrictEqual(pc.calls.map((c) => c.op), ["CreateEngagement", "StartProspectingFromEngagementTask", "GetProspectingFromEngagementTask", "GetProspectingFromEngagementTask", "GetEngagement"]);
  assert.ok(pc.calls.every((c) => c.catalog === "Sandbox"), "every call in Sandbox: " + pc.calls.map((c) => c.catalog));
  assert.deepStrictEqual(pc.calls[1].payload.Identifiers, ["eng-1"]); assert.strictEqual(pc.calls[1].payload.ClientToken, "ph-task-T1-1");
  const p = db.state.leads.T1.partnerCentral;
  assert.strictEqual(p.status, "done"); assert.strictEqual(p.catalog, "Sandbox"); assert.strictEqual(p.engagementId, "eng-1"); assert.strictEqual(p.taskId, "task-abcdefghijklmn");
  assert.deepStrictEqual(p.customer.eligiblePrograms, ["Greenfield", "Pioneer Credits"]);
  assert.strictEqual(p.insights.leadReadiness, "High"); assert.strictEqual(p.insights.solutionScore, "Medium"); assert.strictEqual(p.insights.recommendedChannel, "EMAIL");
  assert.deepStrictEqual(p.insights.outreachWindows, [{ day: "TUESDAY", start: "09:00", end: "11:00" }]);
  assert.strictEqual(db.state.leads.T1.stage, "lead", "a test lead is never promoted");
  assert.ok(!p.autoPromotedAt);
  assert.match(db.state.leads.T1.history.at(-1).text, /^Enriched by AWS Partner Central \(Sandbox catalogue\): lead score \d+\.$/);
});

check("a real lead on the live catalogue scoring 70+ moves from Lead to Hot Lead once, with a history line; dragged back it stays", async () => {
  const { db, pc, api } = make({ L1: REAL }, { catalog: "AWS" });
  await settle(api, db, "L1", undefined);
  const l = db.state.leads.L1;
  assert.ok(pc.calls.every((c) => c.catalog === "AWS"));
  assert.strictEqual(l.partnerCentral.status, "done");
  const score = core.leadScore(core.normaliseLead("L1", l)).score;
  assert.ok(score >= core.HOT_LEAD_SCORE, `score ${score}`);
  assert.strictEqual(l.stage, "hot-lead");
  assert.ok(l.partnerCentral.autoPromotedAt);
  assert.match(l.history.at(-1).text, new RegExp(`^Moved from Lead to Hot Lead: lead score ${score} from AWS Partner Central \\(Hot Lead from 70\\)\\.$`));
  // dragged back to Lead, then refreshed: stays in Lead
  db.state.leads.L1 = { ...db.state.leads.L1, stage: "lead" };
  const before = JSON.parse(JSON.stringify(db.state.leads.L1));
  const r = await api.send("L1", { force: true, by: "ed@ph.example" });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  await settle(api, db, "L1", before);
  assert.strictEqual(db.state.leads.L1.partnerCentral.status, "done");
  assert.strictEqual(db.state.leads.L1.stage, "lead", "promoted at most once");
  assert.strictEqual(pc.calls.filter((c) => c.op === "CreateEngagement").length, 1, "Send again reuses the engagement");
  assert.strictEqual(pc.calls.filter((c) => c.op === "StartProspectingFromEngagementTask")[1].payload.ClientToken, "ph-task-L1-2");
});

check("no promotion on a Sandbox result, with the off switch, or from a later stage", async () => {
  for (const [opts, seed] of [[{ catalog: "Sandbox" }, REAL], [{ catalog: "AWS", autoPromote: false }, REAL], [{ catalog: "AWS" }, { ...REAL, stage: "demo" }]]) {
    const { db, api } = make({ L1: seed }, opts);
    await settle(api, db, "L1", undefined);
    assert.strictEqual(db.state.leads.L1.partnerCentral.status, "done");
    assert.strictEqual(db.state.leads.L1.stage, seed.stage, JSON.stringify(opts));
  }
});

check("a real lead with no contact says Not sent: contact incomplete, and is sent once a named contact with an email is added", async () => {
  const { db, pc, api } = make({ L2: { ...REAL, contacts: [] } }, { catalog: "AWS" });
  await settle(api, db, "L2", undefined);
  assert.deepStrictEqual([db.state.leads.L2.partnerCentral.status, db.state.leads.L2.partnerCentral.reason], ["not-sent", "contact incomplete"]);
  assert.strictEqual(core.partnerCentralStatusText(db.state.leads.L2.partnerCentral), "Not sent: contact incomplete");
  assert.strictEqual(pc.calls.length, 0);
  const before = JSON.parse(JSON.stringify(db.state.leads.L2));
  db.state.leads.L2 = { ...db.state.leads.L2, contacts: [{ id: "c1", name: "Ana", email: "ana@acme.example" }] };
  await settle(api, db, "L2", before);
  assert.strictEqual(db.state.leads.L2.partnerCentral.status, "done");
  assert.deepStrictEqual(pc.calls[0].payload.Contexts[0].Payload.Lead.Interactions[0].Contact, { FirstName: "Ana", LastName: "Not provided", Email: "ana@acme.example", BusinessTitle: "Not provided" });
});

check("a network operator inquiry is never sent; the reason is stored once", async () => {
  const op = { leadType: "operator", contacts: [{ name: "Pat", email: "pat@ph.example" }], stage: "applied", history: [] };
  const { db, pc, api } = make({ O1: op }, { catalog: "AWS" });
  await settle(api, db, "O1", undefined);
  assert.strictEqual(pc.calls.length, 0);
  assert.strictEqual(db.state.leads.O1.partnerCentral.status, "not-sent");
  assert.match(core.partnerCentralStatusText(db.state.leads.O1.partnerCentral), /^Not sent: network operator inquiries/);
  const r = await api.send("O1", { force: true });
  assert.strictEqual(r.ok, false); assert.match(r.reason, /network operator/);
});

check("an AWS error is stored with AWS's message, and Send again retries without a second engagement once one exists", async () => {
  const { db, pc, api } = make({ L1: REAL }, { catalog: "AWS", failOn: "StartProspectingFromEngagementTask" });
  await settle(api, db, "L1", undefined);
  assert.strictEqual(db.state.leads.L1.partnerCentral.status, "error");
  assert.strictEqual(db.state.leads.L1.partnerCentral.engagementId, "eng-1", "the engagement id was saved before the task started");
  assert.strictEqual(core.partnerCentralStatusText(db.state.leads.L1.partnerCentral), "Enrichment failed: AccessDeniedException: not authorised");
  // an unrelated edit does not resend it
  const b1 = JSON.parse(JSON.stringify(db.state.leads.L1));
  db.state.leads.L1 = { ...db.state.leads.L1, assignee: "ed@ph.example" };
  await settle(api, db, "L1", b1);
  assert.strictEqual(pc.calls.length, 2);
  pc.calls.length = 0;
  const api2 = createPcLeadEnrich({ db, partnerCentral: makePc({ catalog: "AWS" }), now, sleep, logger: { warn() {} } });
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } };
  const handled = await api2.handle({ method: "POST", path: "/partnerCentral/v1/leads/L1/enrich", get: (h) => (h === "x-user" ? "ed@ph.example" : "") }, res);
  assert.strictEqual(handled, true); assert.strictEqual(res.code, 200); assert.strictEqual(res.body.ok, true, JSON.stringify(res.body));
  assert.strictEqual(db.state.leads.L1.partnerCentral.status, "running"); assert.strictEqual(db.state.leads.L1.partnerCentral.attempts, 2);
  const res2 = { code: 0, status(c) { this.code = c; return this; }, set() { return this; }, json(b) { this.body = b; return this; } };
  await api2.handle({ method: "POST", path: "/partnerCentral/v1/leads/L1/enrich", get: (h) => (h === "x-user" ? "viewer@ph.example" : "") }, res2);
  assert.strictEqual(res2.code, 403, "viewers cannot send");
  assert.strictEqual(await api2.handle({ method: "GET", path: "/partnerCentral/v1/status", get: () => "" }, res2), false, "other routes go to partner-central.js");
});

check("deleting a test lead mid-enrichment: the follow-up stops and never recreates it; nothing else changes", async () => {
  const other = { ...REAL, company: { name: "Other Co" }, partnerCentral: { status: "done", catalog: "AWS" } };
  const { db, pc, api } = make({ T1: TEST, L9: other }, { catalog: "AWS", taskStatus: ["IN_PROGRESS"] });
  await api.onLeadWrite(ev("T1", undefined, db.state.leads.T1));
  assert.strictEqual(db.state.leads.T1.partnerCentral.status, "running");
  const otherBefore = JSON.stringify(db.state.leads.L9);
  delete db.state.leads.T1;
  await api.follow("T1");
  await api.onLeadWrite(ev("T1", { ...TEST }, undefined));
  assert.ok(!("T1" in db.state.leads), "not recreated");
  assert.strictEqual(JSON.stringify(db.state.leads.L9), otherBefore, "no other lead changed");
  assert.ok(pc.calls.every((c) => c.catalog === "Sandbox"), "nothing reached the live catalogue");
  assert.ok(!pc.calls.some((c) => /Delete/.test(c.op)));
});

check("a task still running after the follow window re-fires through partnerCentral.checks, and gives up after the maximum", async () => {
  const { db, api } = make({ T1: TEST }, { taskStatus: ["IN_PROGRESS"] });
  await api.onLeadWrite(ev("T1", undefined, db.state.leads.T1));
  const b = JSON.parse(JSON.stringify(db.state.leads.T1));
  b.partnerCentral.status = "sending";
  await api.onLeadWrite(ev("T1", b, db.state.leads.T1));
  assert.strictEqual(db.state.leads.T1.partnerCentral.checks, 1);
  db.state.leads.T1.partnerCentral.checks = 40;
  const b2 = JSON.parse(JSON.stringify(db.state.leads.T1)); b2.partnerCentral.checks = 39;
  await api.onLeadWrite(ev("T1", b2, db.state.leads.T1));
  assert.strictEqual(db.state.leads.T1.partnerCentral.status, "error");
  assert.match(db.state.leads.T1.partnerCentral.reason, /five hours/);
});

check("readEngagement: no prospecting result yet reads as empty, not as a failure", () => {
  const r = readEngagement({ Contexts: [] });
  assert.strictEqual(r.found, false); assert.deepStrictEqual(r.customer.eligiblePrograms, []); assert.strictEqual(r.insights.leadReadiness, "");
});

check("the score: missing Partner Central signals are neutral, the breakdown adds up, hot from 70", () => {
  const pending = core.leadScore(core.normaliseLead("x", { ...REAL }));
  assert.strictEqual(pending.enriched, false); assert.strictEqual(pending.hot, false);
  assert.strictEqual(pending.score, pending.parts.reduce((a, p) => a + p.points, 0));
  assert.ok(pending.parts.filter((p) => p.from === "not given yet").length === 4);
  const full = core.leadScore(core.normaliseLead("x", { ...REAL, partnerCentral: { status: "done", catalog: "AWS", customer: { eligiblePrograms: ["Greenfield", "Pioneer Credits"] }, insights: { leadReadiness: "HIGH", marketplaceEngagement: "High", solutionScore: "high" } } }));
  assert.strictEqual(full.score, 100); assert.strictEqual(full.hot, true);
  const partial = core.leadScore(core.normaliseLead("x", { ...REAL, partnerCentral: { status: "done", catalog: "AWS", customer: {}, insights: { leadReadiness: "LOW" } } }));
  assert.deepStrictEqual(partial.parts.map((p) => p.points), [7, 7, 7, 0, 10, 5]);
  assert.strictEqual(core.pcLevelFraction("82"), 0.82); assert.strictEqual(core.pcLevelFraction("MEDIUM"), 0.6); assert.strictEqual(core.pcLevelFraction("??"), null);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of checks) {
    try { await fn(); n++; console.log(`  ok  ${name}`); } catch (err) { failed++; console.error(`✗ ${name}\n  ${err.stack || err}`); }
  }
  console.log(failed ? `pc-lead-enrich: ${failed} failed` : `pc-lead-enrich: all ${n} checks passed`);
  process.exit(failed ? 1 : 0);
})();
