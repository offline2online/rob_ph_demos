// Promote › Leads and Prospects (TAM) enrichment (functions/lead-enrich.js): the
// route that queues a run, the trigger that runs it on create or on request,
// the agent's answer parsing, the public-address guard, and what a run writes
// back to the lead, its linked TAM record and the company's shared profile.
// No network, no Firebase, no Anthropic key: the agent is a stub.
"use strict";
const assert = require("assert");
const {
  createLeadEnrich, readPage, isPrivateAddress, parseAgentJson, cleanFindings, applyToLead, AGENT_SYSTEM,
  pageLogos, commonsLogos, claudeResearch, agentError, workspaceHeaders, clip, applyToProspect, claudeScreen, obviousSpam, SCREEN_SYSTEM, SCREEN_MODEL,
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
const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body,
  arrayBuffer: async () => { const b = Buffer.from(typeof body === "string" ? body : JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, token = "tok", method = "POST", path = "/leadEnrich/v1/enrich") => ({ method, path, body, get: (h) => (h.toLowerCase() === "x-firebase-id-token" ? token : "") });
const created = (c, id, state) => ({ params: c === "leads" ? { leadId: id } : { prospectId: id }, data: { before: { exists: false }, after: { exists: true, data: () => state[c][id] } } });
const changed = (c, id, before, state) => ({ params: c === "leads" ? { leadId: id } : { prospectId: id }, data: { before: { exists: true, data: () => before }, after: { exists: true, data: () => state[c][id] } } });

const LEAD = { company: { name: "Greene King", website: "", industry: "", countries: [], storeCount: null }, contacts: [], stage: "lead" };
const PROSPECT = { name: "Greene King", country: "United Kingdom", website: "", industry: "", markets: [], vendors: [], storeCount: null, leadId: "" };

const PASS = { real: true, physicalRetail: true, sites: "about 2,500 pubs", reason: "A UK pub operator." };
function make({ key = "sk-test", role = "editor", agent = AGENT, fetchImpl, seed, verdict = PASS, store = false } = {}) {
  const saved = [];
  const db = fakeDb(seed || { leads: { l1: { ...LEAD, prospectId: "p1" } }, prospects: { p1: { ...PROSPECT, leadId: "l1" } }, prospectCompanies: {} });
  const calls = [], asked = [], screened = [];
  const api = createLeadEnrich({
    db, verifyIdToken: async (t) => { if (t !== "tok") throw new Error("bad"); return { email: "sam@ph.com" }; },
    resolveConsoleUser: async (e) => (e === "sam@ph.com" ? { email: e, role } : null),
    anthropicKey: () => key,
    research: async (a) => { asked.push(a); return typeof agent === "function" ? agent(a) : agent; },
    ...(store ? { bucket: () => ({ file: (path) => ({ save: async (bytes, opts) => { if (store === "broken") throw new Error("storage down"); saved.push({ path, size: bytes.length, type: opts.contentType, token: opts.metadata.metadata.firebaseStorageDownloadTokens }); } }) }) } : {}),
    screen: async (a) => { screened.push(a); if (verdict instanceof Error) throw verdict; return typeof verdict === "function" ? verdict(a) : verdict; },
    lookup: async (h) => (h === "internal.test" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }]),
    fetch: fetchImpl || (async (url) => { calls.push(url); return resp(200, HOME); }),
    logger: { warn() {}, error() {} },
    now: () => new Date("2026-11-10T10:00:00Z"),
  });
  return { api, db, calls, asked, screened, saved };
}

(async () => {
  await test("private, loopback, link-local and metadata addresses are never fetched", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  await test("readPage takes the title, description, LinkedIn page and the apple-touch-icon over the plain icon", () => {
    assert.deepEqual(readPage(HOME, "https://www.greeneking.co.uk/"), { title: "Greene King", description: "Pubs, restaurants and hotels", linkedinCompany: "https://www.linkedin.com/company/greene-king", iconUrl: "https://www.greeneking.co.uk/apple-touch-icon.png", logos: { light: "", dark: "" } });
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
    assert.equal(a.calls.filter((u) => u.includes("internal.test")).length, 0, "the private address itself is never requested");
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
      anthropicKey: () => "sk-test", Anthropic: FakeAnthropic, screen: async () => PASS,
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
    // A refresh that finds other people and news adds them and keeps the earlier ones, newest news first.
    const third = make({ agent: { ...AGENT, people: [{ name: "Cy Dee", title: "CCO" }, { name: "ann lee", title: "CMO and CCO" }], news: [{ title: "Later", url: "https://news.example/b", date: "2026-11-01", source: "MA" }, { title: "Same story", url: "https://news.example/a/", date: "2026-10-01", source: "x" }] }, seed: again.db.state });
    await third.api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    const e3 = third.db.state.leads.l1.enrichment;
    assert.deepEqual(e3.people.map((x) => x.name), ["Cy Dee", "ann lee", "Bo Ray"]);
    assert.deepEqual(e3.news.map((x) => x.url), ["https://news.example/b", "https://news.example/a/"]);
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
  // ── The check before any research is paid for (12 Nov 2026) ──
  await test("obvious spam is stopped by free checks, with no model call at all", async () => {
    assert.equal(obviousSpam({ name: "Greene King", website: "https://www.greeneking.co.uk", emails: ["a@greeneking.co.uk"] }), "");
    for (const name of ["", "12345", "test", "asdf", "N/A", "http://best-seo.example", "Cheap SEO backlinks", "Crypto casino"]) assert.ok(obviousSpam({ name }), name);
    assert.ok(obviousSpam({ name: "Acme Stores", emails: ["x@mailinator.com"] }));
    assert.equal(obviousSpam({ name: "Seoul Mart" }), "", "a real name that merely contains 'seo' is not spam");
    const { api, db, asked, screened } = make({ seed: { leads: { l1: { ...LEAD, company: { name: "Cheap SEO backlinks" } } }, prospects: {}, prospectCompanies: {} } });
    const out = await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(out.skipped, true); assert.equal(asked.length, 0); assert.equal(screened.length, 0);
    const e = db.state.leads.l1.enrichment;
    assert.equal(e.request.status, "skipped"); assert.match(e.request.message, /^Not researched: .*Nothing was spent\.$/);
    assert.equal(e.screen.ok, false); assert.equal(e.screen.by, "rules"); assert.equal(e.at, undefined, "no enriched date is written");
  });
  await test("a company that isn't real, or has no physical sites, is not researched; one that passes is, and is not screened twice", async () => {
    {
      const { api, db, asked, screened } = make({ verdict: { real: false, physicalRetail: false, reason: "No such company could be found." } });
      const out = await api.onEnrichWrite("leads", created("leads", "l1", db.state));
      assert.equal(out.skipped, true); assert.equal(screened.length, 1); assert.equal(asked.length, 0, "no research request is made");
      assert.equal(db.state.leads.l1.enrichment.request.status, "skipped");
      assert.match(db.state.leads.l1.enrichment.request.message, /^Not researched: No such company could be found\. Press Research anyway/);
      assert.equal(db.state.leads.l1.enrichment.at, undefined); assert.equal(db.state.prospects.p1.enrichment, undefined, "the linked record is untouched");
    }
    {
      // A real company with no physical sites: no research, but the free basics are filled in on the lead and its TAM record.
      const { api, db, asked, calls } = make({ verdict: { real: true, physicalRetail: false, reason: "An online-only software firm.", summary: "Acme makes till software.", sector: "Retail Media" } });
      db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
      const out = await api.onEnrichWrite("leads", created("leads", "l1", db.state));
      assert.equal(out.skipped, true); assert.equal(asked.length, 0, "no research request is made");
      const e = db.state.leads.l1.enrichment;
      assert.equal(e.request.status, "skipped"); assert.equal(e.level, "light");
      assert.match(e.request.message, /^Full research was held back: An online-only software firm\. The website, logo and a short description were filled in at no cost\. Press Research anyway/);
      assert.equal(e.summary, "Acme makes till software."); assert.equal(e.logoUrl, "https://www.greeneking.co.uk/apple-touch-icon.png");
      assert.equal(db.state.leads.l1.company.industry, "Retail Media");
      assert.ok(e.at, "the basics are dated"); assert.ok(calls.some((u) => u.startsWith("https://www.greeneking.co.uk")), "the home page is read");
      assert.equal(db.state.prospects.p1.enrichment.summary, "Acme makes till software."); assert.equal(db.state.prospects.p1.website, "https://www.greeneking.co.uk");
    }
    const { api, db, asked, screened } = make();
    db.state.leads.l1.contacts = [{ name: "A", email: "a@greeneking.co.uk" }, { name: "B", email: "b@gmail.com" }];
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(asked.length, 1); assert.deepEqual(screened[0].emailDomains, ["greeneking.co.uk"], "only business domains are sent, never an address");
    assert.equal(db.state.leads.l1.enrichment.screen.ok, true); assert.equal(db.state.leads.l1.enrichment.request.status, "done");
    await api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    assert.equal(screened.length, 1, "a record that passed is not screened again"); assert.equal(asked.length, 2);
  });
  await test("a person can research a stopped record anyway, and a failed check researches nothing", async () => {
    const { api, db, asked } = make({ verdict: { real: true, physicalRetail: false, reason: "Online only." } });
    await api.onEnrichWrite("leads", created("leads", "l1", db.state));
    assert.equal(asked.length, 0);
    assert.equal(db.state.leads.l1.enrichment.level, "light");
    const before = JSON.parse(JSON.stringify(db.state.leads.l1));
    const r = res(); await api.handle(req({ leadId: "l1", force: true }), r);
    assert.equal(r.code, 202); assert.equal(db.state.leads.l1.enrichment.request.force, true);
    await api.onEnrichWrite("leads", changed("leads", "l1", before, db.state));
    assert.equal(asked.length, 1); assert.equal(db.state.leads.l1.enrichment.request.status, "done");
    assert.equal(db.state.leads.l1.enrichment.level, "full", "the full research replaces the basic profile");
    const broken = make({ verdict: Object.assign(new Error("boom"), { status: 500 }) });
    const out = await broken.api.onEnrichWrite("leads", created("leads", "l1", broken.db.state));
    assert.equal(out.ok, false); assert.equal(broken.asked.length, 0);
    assert.equal(broken.db.state.leads.l1.enrichment.request.status, "error");
    assert.match(broken.db.state.leads.l1.enrichment.request.message, /^The check before research failed, so nothing was researched/);
  });
  await test("the screening call is small: a cheaper model, three searches at most, and the form's text treated as data", async () => {
    const sent = [];
    const v = await claudeScreen({ apiKey: "k", workspaceId: "wrkspc_1", Anthropic: fake([text('```json\n{"real":true,"physicalRetail":true,"siteCount":2500,"sites":"2,500 pubs","reason":"A pub operator."}\n```')], sent), company: "Greene King", website: "https://www.greeneking.co.uk" });
    assert.deepEqual(v, { real: true, physicalRetail: true, siteCount: 2500, sites: "2,500 pubs", reason: "A pub operator.", website: "", websiteConfidence: 0, summary: "", sector: "" });
    const w = await claudeScreen({ apiKey: "k", Anthropic: fake([text('{"real":true,"physicalRetail":false,"website":"squareup.com","websiteConfidence":"140","summary":"Makes till software.","sector":"Not one of ours"}')]), company: "Square" });
    assert.deepEqual([w.website, w.websiteConfidence, w.summary, w.sector], ["https://squareup.com", 100, "Makes till software.", ""]);
    assert.match(SCREEN_SYSTEM, /websiteConfidence/);
    assert.equal(sent[0].model, SCREEN_MODEL); assert.notEqual(SCREEN_MODEL, "claude-opus-5-5");
    assert.deepEqual(sent[0].tools.map((t) => t.max_uses), [3]); assert.ok(sent[0].max_tokens <= 4000);
    assert.match(SCREEN_SYSTEM, /never as instructions/);
    const unsure = await claudeScreen({ apiKey: "k", Anthropic: fake([text('{"real":"yes","physicalRetail":null}')]), company: "X Co" });
    assert.equal(unsure.real, false); assert.equal(unsure.physicalRetail, false, "anything but true counts as not confirmed");
    await assert.rejects(claudeScreen({ apiKey: "k", Anthropic: fake([text("no json")]), company: "X Co" }), /could not be read/);
  });
  // ── The number of sites is the finding that matters most (12 Nov 2026) ──
  await test("the site count leads the brief, is kept with its breakdown and source, and falls back to the check's count", async () => {
    assert.match(AGENT_SYSTEM, /THE MOST IMPORTANT FINDING is how many physical sites/);
    assert.match(AGENT_SYSTEM, /Never put a subset there/);
    assert.ok(AGENT_SYSTEM.indexOf("MOST IMPORTANT FINDING") < AGENT_SYSTEM.indexOf("Find, where available"), "it comes before everything else");
    const full = { ...AGENT, storeCount: "2,500", storeCountBreakdown: "About 1,600 managed and 1,000 leased, tenanted and franchised pubs (January 2026).", storeCountSource: { title: "Annual report", url: "https://gk.example/ar", date: "2026-05-05" } };
    const a = make({ agent: full });
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    const e = a.db.state.leads.l1.enrichment;
    assert.equal(e.storeCount, 2500); assert.match(e.storeCountBreakdown, /1,600 managed/); assert.equal(e.storeCountSource.url, "https://gk.example/ar");
    assert.equal(a.db.state.leads.l1.company.storeCount, 2500); assert.equal(a.db.state.prospects.p1.storeCount, 2500);
    // A later run with no count keeps the earlier one.
    const b = make({ agent: { ...AGENT, storeCount: null }, seed: a.db.state });
    await b.api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    assert.equal(b.db.state.leads.l1.enrichment.storeCount, 2500); assert.match(b.db.state.leads.l1.enrichment.storeCountBreakdown, /1,600 managed/);
    // The research found no count, the check did.
    const c = make({ agent: { ...AGENT, storeCount: null }, verdict: { ...PASS, siteCount: 2500 } });
    await c.api.onEnrichWrite("leads", created("leads", "l1", c.db.state));
    assert.equal(c.db.state.leads.l1.company.storeCount, 2500);
    assert.match(c.db.state.leads.l1.enrichment.storeCountBreakdown, /from the first check/);
    assert.equal(cleanFindings({ storeCountSource: { url: "javascript:x" } }).storeCountSource, null);
  });
  // ── Logos for the branded walkthrough demo (12 Nov 2026) ──
  await test("the full logo for light and for dark backgrounds is found, checked as an image and kept", async () => {
    const page = `<header><img class="site-logo" src="/img/gk-logo.svg" alt="Greene King"><img src="/img/hero.jpg" alt="A pub"><img alt="Greene King logo" data-src="/img/gk-logo-white.svg"></header>`;
    assert.deepEqual(readPage(page, "https://www.greeneking.co.uk/").logos, { light: "https://www.greeneking.co.uk/img/gk-logo.svg", dark: "https://www.greeneking.co.uk/img/gk-logo-white.svg" });
    assert.deepEqual(pageLogos(`<img class="logo" src="data:image/png;base64,AAAA">`, (x) => x), { light: "", dark: "" });
    for (const k of ["logoLight", "logoDark"]) assert.ok(AGENT_SYSTEM.includes(`"${k}"`), k);
    assert.match(AGENT_SYSTEM, /never build or guess an address/);
    const types = { "https://brand.example/gk-full.svg": "image/svg+xml", "https://brand.example/gk-white.png": "image/png", "https://www.greeneking.co.uk/img/gk-logo.svg": "image/svg+xml", "https://brand.example/not-an-image": "text/html" };
    const fetchImpl = async (url) => (types[url] ? resp(200, "x", { "content-type": types[url] }) : resp(200, page, { "content-type": "text/html" }));
    // The agent's links win when they are images; a link that is not an image falls back to the home page's own logo.
    const a = make({ agent: { ...AGENT, logoLight: "https://brand.example/gk-full.svg", logoDark: "https://brand.example/gk-white.png" }, fetchImpl });
    a.db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    assert.deepEqual(a.db.state.leads.l1.enrichment.logos, { light: "https://brand.example/gk-full.svg", dark: "https://brand.example/gk-white.png" });
    assert.deepEqual(a.db.state.prospects.p1.enrichment.logos, a.db.state.leads.l1.enrichment.logos, "the TAM record gets them too");
    const b = make({ agent: { ...AGENT, logoLight: "https://brand.example/not-an-image", logoDark: "javascript:alert(1)" }, fetchImpl });
    b.db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    await b.api.onEnrichWrite("leads", created("leads", "l1", b.db.state));
    assert.deepEqual(b.db.state.leads.l1.enrichment.logos, { light: "https://www.greeneking.co.uk/img/gk-logo.svg", dark: "" });
    // A later run that finds none keeps the earlier ones.
    const c = make({ agent: AGENT, seed: a.db.state });
    await c.api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    assert.equal(c.db.state.leads.l1.enrichment.logos.dark, "https://brand.example/gk-white.png");
  });
  await test("a logo is also taken from the site's structured data and from Wikimedia Commons, only for the right company", async () => {
    const ld = `<script type="application/ld+json">{"@graph":[{"@type":"WebSite"},{"@type":"Organization","logo":{"@type":"ImageObject","url":"/assets/brand.svg"}}]}</script>`;
    assert.equal(readPage(ld, "https://acme.example/").logos.light, "https://acme.example/assets/brand.svg");
    assert.equal(readPage(`<script type="application/ld+json">{not json</script>`, "https://acme.example/").logos.light, "");
    const commons = { query: { pages: {
      1: { index: 2, title: "File:Greene King logo.png", imageinfo: [{ url: "https://upload.wikimedia.org/gk.png", mime: "image/png" }] },
      2: { index: 1, title: "File:Greene King logo.svg", imageinfo: [{ url: "https://upload.wikimedia.org/gk.svg", mime: "image/svg+xml" }] },
      3: { index: 3, title: "File:Greene King logo white.svg", imageinfo: [{ url: "https://upload.wikimedia.org/gk-white.svg", mime: "image/svg+xml" }] },
      4: { index: 0, title: "File:Burger King logo.svg", imageinfo: [{ url: "https://upload.wikimedia.org/bk.svg", mime: "image/svg+xml" }] },
      5: { index: 4, title: "File:Greene King pub in Bury.jpg", imageinfo: [{ url: "https://upload.wikimedia.org/pub.jpg", mime: "image/jpeg" }] },
    } } };
    assert.deepEqual(commonsLogos(commons, "Greene King"), { light: "https://upload.wikimedia.org/gk.svg", dark: "https://upload.wikimedia.org/gk-white.svg" });
    assert.deepEqual(commonsLogos(commons, "Acme Stores"), { light: "", dark: "" });
    assert.deepEqual(commonsLogos({}, "Greene King"), { light: "", dark: "" });
    // In a run: nothing on the home page, so Commons supplies them.
    const fetchImpl = async (url) => {
      if (url.startsWith("https://commons.wikimedia.org/w/api.php")) return resp(200, commons, { "content-type": "application/json" });
      if (url.startsWith("https://upload.wikimedia.org/")) return resp(200, "x", { "content-type": url.endsWith(".png") ? "image/png" : "image/svg+xml" });
      return resp(200, HOME, { "content-type": "text/html" });
    };
    const a = make({ fetchImpl });
    a.db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    assert.deepEqual(a.db.state.leads.l1.enrichment.logos, { light: "https://upload.wikimedia.org/gk.svg", dark: "https://upload.wikimedia.org/gk-white.svg" });
  });
  await test("logos are copied into the console's own storage, once per image, and the original link is the fallback", async () => {
    const STORE = "https://firebasestorage.googleapis.com/v0/b/backlog-tracker-e4ed2.firebasestorage.app/o/brand%2Fgreeneking%2F";
    const files = { "https://brand.example/gk.svg": ["image/svg+xml", "<svg><path d='M0 0'/></svg>"], "https://brand.example/gk-white.png": ["image/png", "PNGDATA"], "https://brand.example/evil.svg": ["image/svg+xml", "<svg onload='x()'><script>1</script></svg>"], "https://www.greeneking.co.uk/apple-touch-icon.png": ["image/png", "ICON"] };
    const fetchImpl = async (url) => (files[url] ? resp(200, files[url][1], { "content-type": files[url][0] }) : resp(200, HOME, { "content-type": "text/html" }));
    const a = make({ agent: { ...AGENT, logoLight: "https://brand.example/gk.svg", logoDark: "https://brand.example/gk-white.png" }, fetchImpl, store: true });
    a.db.state.leads.l1.company.website = "https://www.greeneking.co.uk";
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    const e = a.db.state.leads.l1.enrichment;
    assert.deepEqual(a.saved.map((x) => [x.path.replace(/-[0-9a-f]{12}\./, "-HASH."), x.type]), [["brand/greeneking/light-HASH.svg", "image/svg+xml"], ["brand/greeneking/dark-HASH.png", "image/png"], ["brand/greeneking/icon-HASH.png", "image/png"]]);
    assert.ok(e.logos.light.startsWith(`${STORE}light-`) && e.logos.light.includes("?alt=media&token="), e.logos.light);
    assert.ok(e.logos.dark.startsWith(`${STORE}dark-`)); assert.ok(e.logoUrl.startsWith(`${STORE}icon-`));
    assert.deepEqual(e.logoSources, { light: "https://brand.example/gk.svg", dark: "https://brand.example/gk-white.png", icon: "https://www.greeneking.co.uk/apple-touch-icon.png" });
    assert.equal(a.db.state.prospects.p1.enrichment.logos.light, e.logos.light, "the TAM record points at the same copy");
    // A refresh that finds the same files copies nothing again and keeps the same addresses.
    const b = make({ agent: { ...AGENT, logoLight: "https://brand.example/gk.svg", logoDark: "https://brand.example/gk-white.png" }, fetchImpl, store: true, seed: a.db.state });
    await b.api.enrichRecord("leads", "l1", "sam@ph.com", "requested");
    assert.equal(b.saved.length, 0); assert.equal(b.db.state.leads.l1.enrichment.logos.light, e.logos.light);
    // An SVG that carries script is not copied; storage being down is not fatal. Both keep the original link.
    const c = make({ agent: { ...AGENT, logoLight: "https://brand.example/evil.svg" }, fetchImpl, store: true });
    await c.api.onEnrichWrite("leads", created("leads", "l1", c.db.state));
    assert.equal(c.db.state.leads.l1.enrichment.logos.light, "https://brand.example/evil.svg"); assert.ok(!c.saved.some((x) => x.path.includes("light-")));
    const d = make({ agent: { ...AGENT, logoLight: "https://brand.example/gk.svg" }, fetchImpl, store: "broken" });
    await d.api.onEnrichWrite("leads", created("leads", "l1", d.db.state));
    assert.equal(d.db.state.leads.l1.enrichment.logos.light, "https://brand.example/gk.svg"); assert.equal(d.db.state.leads.l1.enrichment.request.status, "done");
  });
  // ── A missing website is worked out, with how sure the run is (13 Nov 2026) ──
  await test("with no website the run finds one: the contact's email domain first, then the check, then the research", async () => {
    const site = (ok) => async (url) => { if (!ok(url)) throw new Error("ENOTFOUND"); return resp(200, HOME, { "content-type": "text/html" }); };
    // 1. From the contact's business email: free, 90% sure, and it is what the check and research are given.
    const a = make({ fetchImpl: site((u) => u.startsWith("https://square.example")) });
    a.db.state.leads.l1.contacts = [{ name: "J", email: "j@gmail.com" }, { name: "K", email: "k@square.example" }];
    await a.api.onEnrichWrite("leads", created("leads", "l1", a.db.state));
    assert.equal(a.db.state.leads.l1.company.website, "https://square.example");
    assert.equal(a.screened[0].website, "https://square.example"); assert.equal(a.asked[0].website, "https://square.example");
    const g = a.db.state.leads.l1.enrichment.websiteGuess;
    assert.equal(g.url, "https://square.example"); assert.equal(g.confidence, 90); assert.equal(g.from, "the contact's email address");
    assert.equal(a.db.state.prospects.p1.website, "https://square.example", "the TAM record gets it too");
    // 2. A free-mail address and a dead domain give nothing; the check's own answer is used, with its confidence.
    const b = make({ verdict: { ...PASS, website: "squareup.example", websiteConfidence: 72 }, fetchImpl: site((u) => u.includes("squareup.example")) });
    b.db.state.leads.l1.contacts = [{ name: "J", email: "j@gmail.com" }, { name: "K", email: "k@dead.example" }];
    await b.api.onEnrichWrite("leads", created("leads", "l1", b.db.state));
    assert.equal(b.db.state.leads.l1.company.website, "https://squareup.example");
    assert.deepEqual([b.db.state.leads.l1.enrichment.websiteGuess.confidence, b.db.state.leads.l1.enrichment.websiteGuess.from], [72, "a web search by the first check"]);
    // 3. Neither: the research's own website, with the confidence it gave.
    const c = make({ agent: { ...AGENT, websiteConfidence: 64 } });
    await c.api.onEnrichWrite("leads", created("leads", "l1", c.db.state));
    assert.equal(c.db.state.leads.l1.company.website, "https://www.greeneking.co.uk");
    assert.deepEqual([c.db.state.leads.l1.enrichment.websiteGuess.confidence, c.db.state.leads.l1.enrichment.websiteGuess.from], [64, "the research"]);
    // 4. A website a person typed is never replaced and is not called a guess.
    const d = make({ verdict: { ...PASS, website: "other.example", websiteConfidence: 99 } });
    d.db.state.leads.l1.company.website = "https://mine.example";
    await d.api.onEnrichWrite("leads", created("leads", "l1", d.db.state));
    assert.equal(d.db.state.leads.l1.company.website, "https://mine.example"); assert.equal(d.db.state.leads.l1.enrichment.websiteGuess, null);
    // 5. A company held back by the check still gets its website from the email domain.
    const e = make({ verdict: { real: true, physicalRetail: false, reason: "Software." }, fetchImpl: site((u) => u.startsWith("https://square.example")) });
    e.db.state.leads.l1.contacts = [{ name: "K", email: "k@square.example" }];
    await e.api.onEnrichWrite("leads", created("leads", "l1", e.db.state));
    assert.equal(e.db.state.leads.l1.company.website, "https://square.example"); assert.equal(e.asked.length, 0);
    assert.equal(e.db.state.leads.l1.enrichment.websiteGuess.confidence, 90);
  });
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
