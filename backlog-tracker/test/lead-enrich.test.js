// Promote › Leads enrichment (functions/lead-enrich.js): the route, the
// public-address guard, and what a run writes back. No network, no Firebase.
"use strict";
const assert = require("assert");
const { createLeadEnrich, readPage, readTechLookup, isPrivateAddress } = require("../functions/lead-enrich");
const mediaKeys = require("../functions/media-keys");

let n = 0;
async function test(name, fn) { await fn(); n++; console.log(`  ok  ${name}`); }

const KEY = Buffer.alloc(32, 7).toString("base64");
function fakeDb(seed) {
  const state = JSON.parse(JSON.stringify(seed));
  return {
    state,
    collection: (c) => ({
      doc: (id) => ({
        get: async () => ({ exists: !!(state[c] && state[c][id]), id, data: () => state[c][id] }),
        update: async (patch) => { Object.assign(state[c][id], patch); },
      }),
    }),
  };
}
const HOME = `<html><head><title>Acme &amp; Sons</title><meta name="description" content="Grocery stores across the UK"></head><body><a href="https://www.linkedin.com/company/acme-sons">in</a></body></html>`;
const TECH = { Results: [{ Result: { Paths: [{ Technologies: [{ Name: "Shopify" }, { Name: "Klaviyo" }, { Name: "Shopify" }] }] }, Meta: { CompanyName: "Acme", Vertical: "Retail", Country: "GB", Names: [{ Name: "Jo Bloggs", Type: "CTO", Email: "jo@acme.example" }, { Name: "Someone Else", Type: "CEO", Email: "x@acme.example" }] } }] };
const resp = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k.toLowerCase()] || null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), json: async () => body });
const res = () => { const r = { code: 0, body: null, status(c) { r.code = c; return r; }, set() { return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body, token = "tok", method = "POST", path = "/leadEnrich/v1/enrich") => ({ method, path, body, get: (h) => (h.toLowerCase() === "x-firebase-id-token" ? token : "") });

const LEAD = { company: { name: "Acme", website: "https://acme.example", industry: "", countries: ["UK"], storeCount: null }, contacts: [{ id: "c1", name: "Jo Bloggs", jobTitle: "", buyingRole: "decision-maker", email: "", linkedin: "" }, { id: "c2", name: "Pat Nobody", jobTitle: "Buyer", buyingRole: "procurement", email: "", linkedin: "" }], stage: "lead" };

function make({ withKey = true, role = "editor", fetchImpl } = {}) {
  const box = mediaKeys.encrypt(Buffer.from(KEY, "base64"), "builtwith", "bw-key-0123456789abcdef");
  const db = fakeDb({ leads: { l1: LEAD }, mediaProviderKeys: withKey ? { builtwith: { box } } : {} });
  const calls = [];
  const api = createLeadEnrich({
    db, verifyIdToken: async (t) => { if (t !== "tok") throw new Error("bad"); return { email: "sam@ph.com" }; },
    resolveConsoleUser: async (e) => (e === "sam@ph.com" ? { email: e, role } : null),
    encKey: () => KEY,
    lookup: async (h) => (h === "internal.test" ? [{ address: "10.0.0.5" }] : [{ address: "93.184.216.34" }]),
    fetch: fetchImpl || (async (url) => { calls.push(url); return url.includes("builtwith") ? resp(200, TECH) : resp(200, HOME); }),
    logger: { warn() {}, error() {} },
    now: () => new Date("2026-11-05T10:00:00Z"),
  });
  return { api, db, calls };
}

(async () => {
  await test("private, loopback, link-local and metadata addresses are never fetched", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "192.168.0.1", "172.20.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) assert.ok(isPrivateAddress(ip), ip);
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  });
  await test("readPage takes the title, description and company LinkedIn page", () => {
    assert.deepEqual(readPage(HOME), { title: "Acme & Sons", description: "Grocery stores across the UK", linkedinCompany: "https://www.linkedin.com/company/acme-sons" });
  });
  await test("readTechLookup lists distinct technologies, the country by name and the named people", () => {
    const r = readTechLookup(TECH);
    assert.deepEqual(r.techStack, ["Klaviyo", "Shopify"]);
    assert.deepEqual(r.company.countries, ["United Kingdom"]);
    assert.equal(r.people.length, 2);
  });
  await test("sign-in, role and the lead are checked", async () => {
    const { api } = make();
    let r = res(); await api.handle(req({ leadId: "l1" }, ""), r); assert.equal(r.code, 401);
    r = res(); await api.handle(req({ leadId: "l1" }, "wrong"), r); assert.equal(r.code, 401);
    r = res(); await api.handle(req({ leadId: "nope" }), r); assert.equal(r.code, 404);
    r = res(); await api.handle(req({}), r); assert.equal(r.code, 400);
    r = res(); await api.handle(req({ leadId: "l1" }, "tok", "GET"), r); assert.equal(r.code, 405);
    const v = make({ role: "viewer" });
    r = res(); await v.api.handle(req({ leadId: "l1" }), r); assert.equal(r.code, 403);
  });
  await test("a run fills the card and the matching contact, and leaves the other contact alone", async () => {
    const { api, db } = make();
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const l = db.state.leads.l1;
    assert.deepEqual(l.enrichment.techStack, ["Klaviyo", "Shopify"]);
    assert.equal(l.enrichment.summary, "Grocery stores across the UK");
    assert.equal(l.enrichment.linkedinCompany, "https://www.linkedin.com/company/acme-sons");
    assert.equal(l.company.industry, "Retail");
    assert.deepEqual(l.company.countries, ["UK", "United Kingdom"]);
    const jo = l.contacts.find((c) => c.id === "c1");
    assert.equal(jo.email, "jo@acme.example"); assert.equal(jo.jobTitle, "CTO"); assert.deepEqual(jo.enrichment.added, ["email", "jobTitle"]);
    const pat = l.contacts.find((c) => c.id === "c2");
    assert.equal(pat.enrichment, undefined); assert.equal(pat.jobTitle, "Buyer");
    assert.equal(r.body.contactsEnriched, 1);
    assert.deepEqual(l.enrichment.sources.map((s) => s.status), ["ok", "ok"]);
  });
  await test("without a stored lookup key the website is still read and the gap is reported", async () => {
    const { api, db, calls } = make({ withKey: false });
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 200);
    assert.ok(!calls.some((u) => u.includes("builtwith")), "no call to the lookup service");
    const l = db.state.leads.l1;
    assert.equal(l.enrichment.summary, "Grocery stores across the UK");
    assert.deepEqual(l.enrichment.sources.map((s) => s.status), ["ok", "not-configured"]);
  });
  await test("a lead with no website, or one on a private address, is refused without a fetch", async () => {
    const a = make(); a.db.state.leads.l1.company.website = "";
    let r = res(); await a.api.handle(req({ leadId: "l1" }), r); assert.equal(r.code, 400);
    const b = make({ withKey: false }); b.db.state.leads.l1.company.website = "https://internal.test";
    r = res(); await b.api.handle(req({ leadId: "l1" }), r);
    assert.equal(r.code, 200); assert.equal(b.calls.length, 0);
    assert.equal(b.db.state.leads.l1.enrichment.sources[0].status, "error");
  });
  await test("a redirect to a private address is not followed", async () => {
    const { api, db } = make({ withKey: false, fetchImpl: async () => resp(302, "", { location: "http://internal.test/admin" }) });
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(db.state.leads.l1.enrichment.sources[0].status, "error");
  });
  await test("a typed store count and industry are never overwritten", async () => {
    const { api, db } = make();
    db.state.leads.l1.company.industry = "Grocery"; db.state.leads.l1.company.storeCount = 12;
    const r = res(); await api.handle(req({ leadId: "l1" }), r);
    assert.equal(db.state.leads.l1.company.industry, "Grocery"); assert.equal(db.state.leads.l1.company.storeCount, 12);
  });
  console.log(`${n} passed`);
})().catch((e) => { console.error(e); process.exit(1); });
