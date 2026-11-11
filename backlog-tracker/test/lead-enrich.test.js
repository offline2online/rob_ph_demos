// Promote › Leads and Prospects (TAM) enrichment (functions/lead-enrich.js): the
// route that queues a run, the trigger that runs it on create or on request,
// the agent's answer parsing, the public-address guard, and what a run writes
// back to the lead, its linked TAM record and the company's shared profile.
// No network, no Firebase, no Anthropic key: the agent is a stub.
"use strict";
const assert = require("assert");
const {
  createLeadEnrich, readPage, isPrivateAddress, parseAgentJson, cleanFindings, applyToLead, AGENT_SYSTEM,
  claudeResearch, agentError, workspaceHeaders, clip, applyToProspect,
} = require("../functions/lead-enrich");

let n = 0;
async function test(name, fn) { await fn(); n++; console.log(`  ok  ${name}`); }

// Firestore-shaped fake: get / update (dotted paths too) / set with merge.
function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== "object") o[p] = {}; o = o[p]; }
  o[parts[parts.length - 1]] = value;
}
function deepMerge(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) && out[k] && typeof out[k] === "object" ? deepMerge(out[k], v) : v;
  return out;
}
function fakeDb(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  const writes = [];
  return {
    state, writes,
    collection: (c) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!(state[c] && state[c][id]), id, data: () => state[c][id] }),
        update: async (patch) => {
          if (!state[c] || !state[c][id]) throw new Error("no document to update");
          writes.push({ c, id, patch });
          for (const [k, v] of Object.entries(patch)) { if (k.includes(".")) setPath(state[c][id], k, v); else state[c][id][k] = v; }
        },
        set: async (data, opts) => {
          state[c] = state[c] || {};
          writes.push({ c, id, set: data });
          state[c][id] = opts && opts.merge ? deepMerge(state[c][id], data) : data;
        },
      }),
    }),
  };
}

const HOME = `<html><head><title>Greene King</title><meta name="description" content="Pubs, restaurants and hotels">
<link rel="icon" href="/favicon-32.png"><link rel="apple-touch-icon" href="/apple-touch-icon.png"></head>
<body><a href="https://www.linkedin.com/company/greene-king">in</a></body></html>`;
const AGENT = {
  name: "Greene King", website: "https://www.greeneking.co.uk", industry: "Pubs & Hospitality",
  countries: ["UK"], hqCity: "Bury St Edmunds", hqCountry: "United Kingdom", storeCount: 2600,
  employees: "38,000", revenue: "£2.4bn (FY2024)", techStack: ["Zonal", "Microsoft Azure", "Zonal"], vendors: ["Fourth"],
  linkedinCompany: "https://uk.linkedin.com/company/greene-king/", summary: "A UK pub retailer and brewer.",
  logoUrl: "https://cdn.example/gk-logo.svg",
  news: [
    { title: "Greene King opens new pubs", url: "https://news.example/a", date: "2026-10-01", source: "The Caterer" },
    { title: "Bad link", url: "javascript:alert(1)", date: "2026-09-01", source: "x" },
  ],
  financials: { summary: "Revenue rose 5% to £2.4bn.", period: "FY2024", sources: [{ title: "Annual report", url: "https://gk.example/ar.pdf", date: "2025-06-30" }] },
  facts: [{ label: "Owner", value: "CK Asset Holdings" }],
};
const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body });
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, token = "tok", method = "POST", path = "/leadEnrich/v1/enrich") => ({ method, path, body, get: (h) => (h.toLowerCase() === "x-firebase-id-token" ? token : "") });
const created = (c, id, state) => ({ params: c === "leads" ? { leadId: id } : { prospectId: id }, data: { before: { exists: false }, after: { exists: true, data: () => state[c][id] } } });
const changed = (c, id, before, state) => ({ params: c === "leads" ? { leadId: id } : { prospectId: id }, data: { before: { exists: true, data: () => before }, after: { exists: true, data: () => state[c][id] } } });

const LEAD = { company: { name: "Greene King", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead" };
const PROSPECT = { name: "Greene King", country: "United Kingdom", website: "", industry: "", markets: [], vendors: [], storeCount: null, leadId: "" };

function make({ key = "sk-test", role = "editor", agent = AGENT, fetchImpl, seed } = {}) {
  const db = fakeDb(seed || { leads: { l1: { ...LEAD, prospectId: "p1" } }, prospects: { p1: { ...PROSPECT, leadId: "l1" } }, prospectCompanies: {} });
  const calls = [], asked = [];
  const api = createLeadEnrich({
    db, verifyIdToken: async (t) => { if (t !== "tok") throw new Error("bad"); return { email: "sam@ph.com" }; },
    resolveConsoleUser: async (e) => (e === "sam@ph.com" ? { email: e, role } : null),
    anthropicKey: () => key,
    research: async (a) => { asked.push(a); return typeof agent === "function" ? agent(a) : agent; },
    lookup: async (h) => (h === "internal.test" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }]),
    fetch: fetchImpl || (async (url) => { calls.push(url); return resp(200, HOME); }),
    logger: { warn() {}, error() {} },
    now: () => new Date("2026-11-10T10:00:00Z"),
  });
  return { api, db, calls, asked };
}

(async () => {
  await test("private, loopback, link-local and metadata addresses are never fetched", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  await test("readPage takes the title, description, LinkedIn page and the apple-touch-icon over the plain icon", () => {
    assert.deepEqual(readPage(HOME, "https://www.greeneking.co.uk/"), { title: "Greene King", description: "Pubs, restaurants and hotels", linkedinCompany: "https://www.linkedin.com/company/greene-king", iconUrl: "https://www.greeneking.co.uk/apple-touch-icon.png" });
  });
  await test("the agent is told to research without paid providers and to answer with news and financials", () => {
    assert.match(AGENT_SYSTEM, /web search/); assert.match(AGENT_SYSTEM, /news/); assert.match(AGENT_SYSTEM, /financials/); assert.match(AGENT_SYSTEM, /logo/);
  });
  await test("parseAgentJson reads the last ```json block, else the last {...}, else null", () => {
    assert.deepEqual(parseAgentJson('Notes {"a":0}\n```json\n{"a":1}\n```\nthen\n```json\n{"a":2}\n```'), { a: 2 });
    assert.deepEqual(parseAgentJson('Found it: {"name":"X"}'), { name: "X" });
    assert.equal(parseAgentJson("no json here"), null);
  });
  await test("cleanFindings keeps only http(s) links, caps lists and normalises the LinkedIn page and countries", () => {
    const f = cleanFindings(AGENT);
    assert.equal(f.news.length, 1, "the javascript: link is dropped");
    assert.equal(f.linkedinCompany, "https://www.linkedin.com/company/greene-king/");
    assert.deepEqual(f.countries, ["United Kingdom"]);
    assert.deepEqual(f.techStack, ["Zonal", "Microsoft Azure"]);
    assert.equal(f.storeCount, 2600);
    assert.equal(cleanFindings({ logoUrl: "file:///etc/passwd", storeCount: "about 1,200 stores" }).logoUrl, "");
    assert.equal(cleanFindings({ storeCount: "about 1,200 stores" }).storeCount, 1200);
  });
  await test("the route checks sign-in, role and the record, and only queues a run (202)", async () => {
    const { api, db, asked } = make();
    let r = res(); await api.handle(req({ leadId: "l1" }, ""), r); assert.equal(r.code, 401);
    r = res(); await api.handle(req({ leadId: "l1" }, "wrong"), r); assert.equal(r.code, 401);
    r = res(); await api.handle(req({ leadId: "nope" }), r); assert.equal(r.code, 404);
    r = res(); await api.handle(req({}), r); assert.equal(r.code, 400);
    r = res(); await api.handle(req({ leadId: "l1" }, "tok", "GET"), r); assert.equal(r.code, 405);
    const v = make({ role: "viewer" });
    r = res(); await v.api.handle(req({ leadId: "l1" }), r); assert.equal(r.code, 403);
    r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assert.equal(db.state.leads.l1.enrichment.request.status, "queued");
    assert.equal(db.state.leads.l1.enrichment.request.by, "sam@ph.com");
    assert.equal(asked.length, 0, "the route does not research; the trigger does");
    r = res(); await api.handle(req({ prospectId: "p1" }), r);
    assert.equal(r.code, 202); assert.equal(db.state.prospects.p1.enrichment.request.status, "queued");
    r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.body.already, true, "a second click while a run is queued does not queue another");
  });
  await test("a new lead with no website and no email is researched by name and filled in, with its TAM record", async () => {
    const { api, db, asked, calls } = make();
    const out = await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.ok(out && out.ok, JSON.stringify(out));
    assert.equal(asked.length, 1); assert.equal(asked[0].company, "Greene King"); assert.equal(asked[0].website, "");
    assert.ok(calls.includes("https://www.greeneking.co.uk"), "the website the agent found is read for its icon");
    const l = db.state.leads.l1;
    assert.equal(l.company.industry, "Pubs & Hospitality");
    assert.equal(l.company.storeCount, 2600);
    assert.deepEqual(l.company.countries, ["United Kingdom"]);
    assert.equal(l.company.website, "https://www.greeneking.co.uk");
    assert.equal(l.enrichment.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
    assert.equal(l.enrichment.hq, "Bury St Edmunds, United Kingdom");
    assert.equal(l.enrichment.summary, "A UK pub retailer and brewer.");
    assert.equal(l.enrichment.news[0].url, "https://news.example/a");
    assert.equal(l.enrichment.news[0].date, "2026-10-01");
    assert.equal(l.enrichment.financials.period, "FY2024");
    assert.equal(l.enrichment.financials.sources[0].url, "https://gk.example/ar.pdf");
    assert.deepEqual(l.enrichment.techStack, ["Zonal", "Microsoft Azure"]);
    assert.equal(l.enrichment.request.status, "done");
    assert.deepEqual(l.enrichment.sources.map((s) => s.status), ["ok", "ok"]);
    const p = db.state.prospects.p1;
    assert.equal(p.industry, "Pubs & Hospitality");
    assert.equal(p.hqCountry, "United Kingdom");
    assert.equal(p.storeCount, 2600);
    assert.equal(p.linkedinUrl, "https://www.linkedin.com/company/greene-king/");
    assert.deepEqual(p.vendors, ["Fourth", "Zonal", "Microsoft Azure"]);
    assert.equal(p.enrichment.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
    assert.equal(p.enrichment.request, undefined, "the linked record gets the findings, not a run of its own");
    const prof = db.state.prospectCompanies.greeneking.profile;
    assert.equal(prof.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
    assert.equal(prof.summary, "A UK pub retailer and brewer.");
    assert.equal(prof.lastResearchedAt, "2026-11-10");
    assert.match(prof.latestNews, /Greene King opens new pubs/);
  });
  await test("the trigger runs on create and on a newly queued request only, so its own writes never loop", async () => {
    const { api, db, asked } = make();
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    const before = JSON.parse(JSON.stringify(db.state.leads.l1));
    assert.equal(await api.onEnrichWrite("leads", changed("leads", "l1", before, db.state)), null, "a plain update does nothing");
    assert.equal(asked.length, 1);
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 202);
    await api.onEnrichWrite("leads", changed("leads", "l1", before, db.state));
    assert.equal(asked.length, 2, "a queued request runs");
    assert.equal(db.state.leads.l1.enrichment.request.status, "done");
    const after = JSON.parse(JSON.stringify(db.state.leads.l1));
    assert.equal(await api.onEnrichWrite("leads", changed("leads", "l1", after, db.state)), null);
    assert.equal(asked.length, 2);
  });
  await test("a refresh updates what enrichment wrote, never blanks a known field, and never overwrites a typed one", async () => {
    let round = 0;
    const { api, db } = make({ agent: () => (++round === 1 ? AGENT : { storeCount: 2700, industry: "", summary: "", news: [], financials: null, logoUrl: "" }) });
    db.state.leads.l1.company.industry = "Pubs"; // typed by a person
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(db.state.leads.l1.company.industry, "Pubs", "a typed industry stays");
    assert.equal(db.state.leads.l1.company.storeCount, 2600);
    await api.handle(req({ leadId: "l1" }), res());
    const before = JSON.parse(JSON.stringify(db.state.leads.l1));
    before.enrichment.request = null;
    await api.onEnrichWrite("leads", changed("leads", "l1", before, db.state));
    const l = db.state.leads.l1;
    assert.equal(l.company.storeCount, 2700, "enrichment's own figure is updated");
    assert.equal(l.company.industry, "Pubs");
    assert.equal(l.enrichment.summary, "A UK pub retailer and brewer.", "an empty answer keeps the summary");
    assert.equal(l.enrichment.news.length, 1, "and the news");
    assert.ok(l.enrichment.financials, "and the financials");
    assert.equal(l.enrichment.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
    assert.equal(l.company.website, "https://www.greeneking.co.uk");
    // A store count a person typed over enrichment's stays on the next run.
    l.company.storeCount = 3000;
    await api.handle(req({ leadId: "l1" }), res());
    await api.onEnrichWrite("leads", changed("leads", "l1", { ...l, enrichment: { ...l.enrichment, request: null } }, db.state));
    assert.equal(db.state.leads.l1.company.storeCount, 3000);
  });
  await test("an unenriched TAM record can be run on its own, and fills its linked lead", async () => {
    const { api, db } = make();
    const r = res(); await api.handle(req({ prospectId: "p1" }), r);
    assert.equal(r.code, 202);
    await api.onEnrichWrite("prospects", changed("prospects", "p1", PROSPECT, db.state));
    assert.equal(db.state.prospects.p1.enrichment.request.status, "done");
    assert.equal(db.state.prospects.p1.enrichment.news.length, 1);
    assert.equal(db.state.leads.l1.company.industry, "Pubs & Hospitality");
    assert.equal(db.state.leads.l1.enrichment.request, undefined);
  });
  await test("a person's profile summary and logo are never replaced", async () => {
    const { api, db } = make({ seed: { leads: {}, prospects: { p1: { ...PROSPECT } }, prospectCompanies: { greeneking: { name: "Greene King", profile: { summary: "Our notes", logoUrl: "https://mine.example/logo.png", techStack: ["SAP"] } } } } });
    await api.onEnrichWrite("prospects", created("prospects", "p1", db.state));
    const prof = db.state.prospectCompanies.greeneking.profile;
    assert.equal(prof.summary, "Our notes"); assert.equal(prof.logoUrl, "https://mine.example/logo.png");
    assert.deepEqual(prof.techStack, ["SAP", "Zonal", "Microsoft Azure"]);
  });
  await test("without the agent's key the website is still read and the gap is reported", async () => {
    const { api, db, asked } = make({ key: "unset" });
    db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(asked.length, 0);
    const l = db.state.leads.l1;
    assert.deepEqual(l.enrichment.sources.map((s) => s.status), ["not-configured", "ok"]);
    assert.equal(l.enrichment.summary, "Pubs, restaurants and hotels");
    assert.equal(l.enrichment.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
  });
  await test("a website on a private address, or redirecting to one, is not fetched", async () => {
    const a = make({ key: "unset" }); a.db.state.leads.l1.company.website = "https://internal.test";
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    assert.equal(a.calls.length, 0);
    assert.equal(a.db.state.leads.l1.enrichment.sources[1].status, "error");
    assert.equal(a.db.state.leads.l1.enrichment.request.status, "error");
    const b = make({ key: "unset", fetchImpl: async () => resp(302, "", { location: "http://internal.test/admin" }) });
    b.db.state.leads.l1.company.website = "https://acme.example";
    await b.api.onEnrichWrite("leads", created("leads", "l1", b.db.state));
    assert.equal(b.db.state.leads.l1.enrichment.sources[1].status, "error");
  });
  await test("test leads are not enriched", async () => {
    const { api, db, asked } = make();
    db.state.leads.l1.test = true;
    assert.equal(await api.onEnrichWrite("leads", created("leads", "l1", db.state)), null);
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 400); assert.equal(asked.length, 0);
  });
  await test("applyToLead adds countries without removing any", () => {
    const out = applyToLead({ company: { name: "X", countries: ["France"] } }, cleanFindings({ countries: ["UK"], hqCountry: "UK" }), "", [], { at: new Date(), by: "a" });
    assert.deepEqual(out.company.countries, ["France", "United Kingdom"]);
  });
  await test("the agent call uses web search and web fetch, resumes a paused turn and reads the JSON answer", async () => {
    const sent = [];
    class FakeAnthropic {
      constructor(opts) { this.opts = opts; this.beta = { messages: { create: async (params) => {
        sent.push(JSON.parse(JSON.stringify(params)));
        if (sent.length === 1) return { stop_reason: "pause_turn", content: [{ type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Greene King" } }] };
        return { stop_reason: "end_turn", content: [{ type: "text", text: "Here it is.\n```json\n" + JSON.stringify(AGENT) + "\n```" }] };
      } } }; }
    }
    const db = fakeDb({ leads: { l1: { ...LEAD } }, prospects: {}, prospectCompanies: {} });
    const api = createLeadEnrich({
      db, verifyIdToken: async () => ({ email: "x" }), resolveConsoleUser: async () => null,
      anthropicKey: () => "sk-test", Anthropic: FakeAnthropic,
      lookup: async () => [{ address: "93.184.216.34" }], fetch: async () => resp(200, HOME),
      logger: { warn() {}, error() {} }, now: () => new Date("2026-11-10T10:00:00Z"),
    });
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(sent.length, 2, "the paused turn is sent back once");
    assert.equal(sent[0].model, "claude-opus-5-5");
    assert.deepEqual(sent[0].tools.map((t) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
    assert.match(sent[0].messages[0].content, /Company: Greene King/);
    assert.equal(sent[1].messages.length, 2); assert.equal(sent[1].messages[1].role, "assistant");
    assert.equal(db.state.leads.l1.company.industry, "Pubs & Hospitality");
    assert.equal(db.state.leads.l1.enrichment.financials.summary, "Revenue rose 5% to £2.4bn.");
  });
  // ── 11 Nov 2026: every live run failed; these are the reasons it could ──
  const fake = (answers, sent = [], seen = {}) => class {
    constructor(opts) { seen.opts = opts; this.beta = { messages: {
      stream: (params) => ({ finalMessage: async () => { sent.push(JSON.parse(JSON.stringify(params))); const a = answers[Math.min(sent.length, answers.length) - 1]; if (a instanceof Error) throw a; return a; } }),
    } }; }
  };
  const text = (...parts) => ({ stop_reason: "end_turn", content: parts.map((t) => ({ type: "text", text: t })) });
  await test("a key made for the whole organisation sends the workspace on every request, and never a malformed one", async () => {
    assert.deepEqual(workspaceHeaders("wrkspc_01AbC"), { "anthropic-workspace-id": "wrkspc_01AbC" });
    for (const v of ["", "unset", null, undefined, "two words", "a\nb"]) assert.equal(workspaceHeaders(v), undefined);
    const seen = {};
    await claudeResearch({ apiKey: "k", workspaceId: "wrkspc_01AbC", Anthropic: fake([text("```json\n" + JSON.stringify(AGENT) + "\n```")], [], seen), company: "Greene King" });
    assert.deepEqual(seen.opts.defaultHeaders, { "anthropic-workspace-id": "wrkspc_01AbC" });
    const none = {};
    await claudeResearch({ apiKey: "k", workspaceId: "unset", Anthropic: fake([text(JSON.stringify(AGENT))], [], none), company: "Greene King" });
    assert.equal("defaultHeaders" in none.opts, false);
  });
  await test("the research request is streamed, with room to answer and a limit longer than a research turn", async () => {
    const sent = [], seen = {};
    await claudeResearch({ apiKey: "k", Anthropic: fake([text(JSON.stringify(AGENT))], sent, seen), company: "Greene King" });
    assert.ok(seen.opts.timeout >= 240000, "an unstreamed 150 s limit cut research turns off");
    assert.ok(sent[0].max_tokens >= 32000);
    assert.deepEqual(sent[0].tools.map((t) => t.name), ["web_search", "web_fetch"]);
  });
  await test("an answer that citations split across text blocks is read as one", async () => {
    const json = "```json\n" + JSON.stringify(AGENT) + "\n```";
    const cut = json.indexOf("pub retailer") + 4; // inside the summary string
    const out = await claudeResearch({ apiKey: "k", Anthropic: fake([text("Done.", json.slice(0, cut), json.slice(cut))]), company: "Greene King" });
    assert.equal(out.summary, AGENT.summary);
    assert.equal(parseAgentJson([json.slice(0, cut), json.slice(cut)].join("\n")), null, "joined with newlines (as before) it cannot be read");
  });
  await test("research notes with no readable JSON are turned into the JSON by one short call with no tools", async () => {
    const sent = [];
    const out = await claudeResearch({ apiKey: "k", Anthropic: fake([text("Greene King is a pub retailer with about 2,600 pubs. {broken"), text("```json\n" + JSON.stringify(AGENT) + "\n```")], sent), company: "Greene King" });
    assert.equal(out.storeCount, 2600);
    assert.equal(sent.length, 2); assert.equal(sent[1].tools, undefined);
    assert.match(sent[1].messages[0].content, /2,600 pubs/);
  });
  await test("a refusal, an empty answer and an unreadable answer each fail with the reason", async () => {
    await assert.rejects(claudeResearch({ apiKey: "k", Anthropic: fake([{ stop_reason: "refusal", content: [] }]), company: "X" }), /declined/);
    await assert.rejects(claudeResearch({ apiKey: "k", Anthropic: fake([{ stop_reason: "max_tokens", content: [] }]), company: "X" }), /no answer \(max_tokens\)/);
    await assert.rejects(claudeResearch({ apiKey: "k", Anthropic: fake([text("notes only"), text("still not json")]), company: "X" }), /could not be read/);
  });
  await test("a failed agent run is reported as failed on the record even when the home page was read, and says what to do", async () => {
    const err = Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header"}}'), { status: 400 });
    assert.match(agentError(err), /ANTHROPIC_WORKSPACE_ID repository secret/);
    assert.match(agentError(Object.assign(new Error("x"), { status: 401 })), /was refused/);
    assert.match(agentError(Object.assign(new Error("x"), { status: 429 })), /rate limited or out of credit/);
    assert.match(agentError(new Error("Request timed out.")), /took too long/);
    const { api, db } = make({ agent: () => { throw err; } });
    db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    const out = await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    const e = db.state.leads.l1.enrichment;
    assert.equal(out.ok, false);
    assert.equal(e.request.status, "error");
    assert.match(e.request.message, /^The research agent failed: the ANTHROPIC_API_KEY isn't tied to a workspace/);
    assert.equal(e.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png", "what the home page gave is still kept");
    const empty = make({ agent: {} });
    await empty.api.onEnrichWrite("leads", created("leads", "l1", empty.db.state));
    assert.equal(empty.db.state.leads.l1.enrichment.request.status, "error");
  });
  await test("a home page description with an apostrophe is read whole", () => {
    const p = readPage(`<meta name="description" content="Greene King is the country's leading pub company"><meta property='og:description' content='x'>`, "https://gk.example/");
    assert.equal(p.description, "Greene King is the country's leading pub company");
  });
  await test("the research covers retail media and personalisation, and is kept on the lead, the TAM record and the profile", async () => {
    for (const k of ["retailMedia", "personalisation", "inStoreDigital", "loyalty", "primaryCloud", "people", "fit", "estate", "strategy", "talkingPoints"]) assert.ok(AGENT_SYSTEM.includes(`"${k}"`), k);
    assert.match(AGENT_SYSTEM, /retail media network/);
    const more = { ...AGENT, retailMedia: "Runs Greene King Media with in-pub screens.", personalisation: "App offers by visit history.", inStoreDigital: "Screens in 1,600 pubs.", loyalty: "App with 2m users.", primaryCloud: "Microsoft Azure", fit: "A large estate with screens already in place.",
      people: [{ name: "Ann Lee", title: "Chief Marketing Officer", linkedin: "https://www.linkedin.com/in/ann-lee" }, { name: "Bo Ray", title: "CIO", linkedin: "https://evil.example/in/bo" }, { name: "No Title", title: "" }] };
    const f = cleanFindings(more);
    assert.deepEqual(f.people, [{ name: "Ann Lee", title: "Chief Marketing Officer", linkedin: "https://www.linkedin.com/in/ann-lee", note: "" }, { name: "Bo Ray", title: "CIO", linkedin: "", note: "" }]);
    const extra = cleanFindings({ estate: "1,500 managed, 1,000 leased.", strategy: "Selling 150 pubs.", talkingPoints: ["New CCO starts 16 Nov.", "New CCO starts 16 Nov.", ""], people: [{ name: "Cy Dee", title: "CCO", note: "Starts 16 Nov 2026; ex-PepsiCo" }] });
    assert.deepEqual(extra.talkingPoints, ["New CCO starts 16 Nov."]); assert.equal(extra.people[0].note, "Starts 16 Nov 2026; ex-PepsiCo"); assert.equal(extra.estate, "1,500 managed, 1,000 leased.");
    const { api, db } = make({ agent: more });
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    for (const rec of [db.state.leads.l1, db.state.prospects.p1]) {
      assert.equal(rec.enrichment.retailMedia, more.retailMedia); assert.equal(rec.enrichment.fit, more.fit);
      assert.equal(rec.enrichment.primaryCloud, "Microsoft Azure"); assert.equal(rec.enrichment.people.length, 2);
    }
    assert.equal(Object.values(db.state.prospectCompanies)[0].profile.primaryCloud, "Microsoft Azure");
    // A later run that finds less keeps what was known.
    const again = make({ agent: AGENT, seed: db.state });
    await again.api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    assert.equal(again.db.state.leads.l1.enrichment.retailMedia, more.retailMedia);
    assert.equal(again.db.state.leads.l1.enrichment.people.length, 2);
  });
  await test("a website lead that creates its TAM record is researched once, not twice", async () => {
    const at = new Date("2026-11-10T09:59:30Z");
    const { api, db, asked } = make({ seed: { leads: { l1: { ...LEAD, prospectId: "p1", createdAt: at } }, prospects: { p1: { ...PROSPECT, leadId: "l1" } }, prospectCompanies: {} } });
    assert.equal(await api.onEnrichWrite("prospects", created("prospects", "p1", db.state)), null, "the new lead's own run fills both");
    assert.equal(asked.length, 0);
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(asked.length, 1);
    assert.equal(db.state.prospects.p1.enrichment.summary, AGENT.summary);
    // A new TAM record linked to a lead that already existed is researched itself.
    const old = make({ seed: { leads: { l1: { ...LEAD, prospectId: "p1", createdAt: new Date("2026-11-01T00:00:00Z") } }, prospects: { p1: { ...PROSPECT, leadId: "l1" } }, prospectCompanies: {} } });
    await old.api.onEnrichWrite("prospects", created("prospects", "p1", old.db.state));
    assert.equal(old.asked.length, 1);
  });
  // ── From the first real run (Greene King, 11 Nov 2026) ──
  await test("long findings are never cut mid-word, and the sector is the agent's own choice from the nine", () => {
    assert.equal(clip("One two three. Four five six seven eight nine ten eleven twelve.", 40), "One two three. Four five six seven…");
    assert.equal(clip("Alpha beta gamma delta. Epsilon zeta eta theta iota kappa lambda mu.", 40), "Alpha beta gamma delta.");
    assert.equal(clip("short", 40), "short");
    const f = cleanFindings({ industry: "Hospitality – pub, restaurant and hotel operator and brewer", sector: "Pubs & Hospitality", countries: ["United Kingdom (England, Wales, Scotland)"], estate: "x ".repeat(700) });
    assert.equal(f.sector, "Pubs & Hospitality"); assert.deepEqual(f.countries, ["United Kingdom"]);
    assert.ok(f.estate.length <= 1000 && f.estate.endsWith("…"));
    assert.equal(cleanFindings({ sector: "Pubs" }).sector, "", "only an exact label counts");
    // Read from the free-text industry alone, this company was filed under Quick Service Restaurants.
    const p = applyToProspect({ name: "Greene King", country: "United Kingdom" }, f, "", [], { at: new Date(), by: "a" });
    assert.equal(p.fields.industry, "Pubs & Hospitality");
    const l = applyToLead({ company: { name: "Greene King" } }, f, "", [], { at: new Date(), by: "a" });
    assert.equal(l.company.industry, "Pubs & Hospitality");
    assert.match(AGENT_SYSTEM, /closest competitors/); assert.match(AGENT_SYSTEM, /careers site/); assert.match(AGENT_SYSTEM, /sold or closed/);
  });
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
