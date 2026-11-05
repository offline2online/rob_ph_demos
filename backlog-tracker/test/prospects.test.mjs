// Unit tests for Promote › Prospects (TAM): public/js/prospects-core.js (the
// rules the page and the MCP tools share), the starter set, and the generated
// CommonJS copy.   node prospects.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as C from "../public/js/prospects-core.js";
import { SEED_PROSPECTS } from "../public/js/prospects-seed.js";
import { normaliseLead } from "../public/js/leads-core.js";
import { buildCopy } from "./prospects-core-copy.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const mk = (id, o) => C.normaliseProspect(id, o);

t("size bands follow the store count", () => {
  assert.deepEqual([null, 0, 1, 49, 50, 249, 250, 999, 1000, 85000].map(C.sizeBandFor), ["unknown", "unknown", "small", "small", "mid", "mid", "large", "large", "xlarge", "xlarge"]);
});
t("an AWS region comes from the HQ country", () => {
  assert.equal(C.awsRegionForCountry("United Kingdom"), "eu-west-2");
  assert.equal(C.awsRegionForCountry(" germany "), "eu-central-1");
  assert.equal(C.awsRegionForCountry("Atlantis"), "");
});
t("input becomes a prospect: defaults, HQ added to markets, derived region and band", () => {
  const r = C.prospectFromInput({ name: " Acme ", website: "acme.example", hqCountry: "United Kingdom", markets: "France; Germany", storeCount: "1,200", vendors: ["V1"], campaigns: "Spring" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.fields.name, "Acme");
  assert.equal(r.fields.website, "https://acme.example");
  assert.deepEqual(r.fields.markets, ["United Kingdom", "France", "Germany"]);
  assert.equal(r.fields.awsRegion, "eu-west-2");
  assert.equal(r.fields.sizeBand, "xlarge");
  assert.equal(r.fields.status, "new");
});
t("bad input is reported, not stored", () => {
  assert.ok(C.prospectFromInput({}).errors.some((e) => /name/i.test(e)));
  assert.ok(C.prospectFromInput({ name: "A", storeCount: "lots" }).errors.length);
  assert.ok(C.prospectFromInput({ name: "A", status: "won" }).errors.length);
  assert.ok(C.prospectFromInput({ name: "A", awsRegion: "mars" }).errors.length);
  assert.ok(C.prospectFromInput({ name: "A", website: "nope" }).errors.length);
});
t("enriching keeps what is already known", () => {
  const existing = mk("acme", { name: "Acme", industry: "Grocery", hqCountry: "France", storeCount: 300, vendors: ["V1"], status: "targeted" });
  const r = C.prospectFromInput({ name: "Acme", vendors: ["V1", "V2"] }, existing);
  assert.deepEqual(r.errors, []);
  assert.equal(r.fields.industry, "Grocery");
  assert.equal(r.fields.storeCount, 300);
  assert.equal(r.fields.status, "targeted");
  assert.deepEqual(r.fields.vendors, ["V1", "V2"]);
});
t("a stored document tolerates missing fields", () => {
  const p = mk("x", { name: "X" });
  assert.deepEqual([p.markets, p.status, p.sizeBand, p.storeCount, p.leadId], [[], "new", "unknown", null, ""]);
});

const rows = [
  mk("a", { name: "Alpha Grocer", industry: "Grocery", hqCountry: "United Kingdom", markets: ["United Kingdom", "Ireland"], awsRegion: "eu-west-2", storeCount: 400, campaigns: ["Spring"], status: "new" }),
  mk("b", { name: "Beta Pharmacy", industry: "Pharmacy", hqCountry: "Germany", markets: ["Germany"], awsRegion: "eu-central-1", storeCount: 40, campaigns: ["Autumn"], status: "targeted", vendors: ["Acme Signage"] }),
  mk("c", { name: "Gamma Fashion", industry: "Fashion", hqCountry: "France", markets: ["France", "Ireland"], awsRegion: "eu-west-3", storeCount: null, status: "new" }),
];
const ids = (f) => C.filterProspects(rows, f).map((p) => p.id).join("");
t("filters: industry, market (HQ or operated), AWS region, campaign, size, status", () => {
  assert.equal(ids({ industry: "grocery" }), "a");
  assert.equal(ids({ market: "Ireland" }), "ac");
  assert.equal(ids({ market: "Germany" }), "b");
  assert.equal(ids({ awsRegion: "eu-west-3" }), "c");
  assert.equal(ids({ campaign: "autumn" }), "b");
  assert.equal(ids({ sizeBand: "large" }), "a");
  assert.equal(ids({ status: "new" }), "ac");
  assert.equal(ids({}), "abc");
});
t("filters combine, store range excludes unknown counts, search spans fields", () => {
  assert.equal(ids({ market: "Ireland", status: "new", industry: "Fashion" }), "c");
  assert.equal(ids({ minStores: "100" }), "a");
  assert.equal(ids({ maxStores: "100" }), "b");
  assert.equal(ids({ minStores: "1", maxStores: "1000" }), "ab");
  assert.equal(ids({ q: "acme signage" }), "b");
  assert.equal(ids({ q: "zzz" }), "");
});
t("dropdown options come from the data, sorted, without duplicates", () => {
  const o = C.filterOptions(rows);
  assert.deepEqual(o.industry, ["Fashion", "Grocery", "Pharmacy"]);
  assert.deepEqual(o.market, ["France", "Germany", "Ireland", "United Kingdom"]);
  assert.deepEqual(o.campaign, ["Autumn", "Spring"]);
});
t("saved filters validate, replace by name and refuse empty ones", () => {
  assert.ok(C.withSavedFilter([], "", { industry: "x" }).error);
  assert.ok(C.withSavedFilter([], "Empty", {}).error);
  let list = C.withSavedFilter([], "UK grocery", { industry: "Grocery", market: "United Kingdom" }).list;
  list = C.withSavedFilter(list, "uk GROCERY", { industry: "Grocery" }).list;
  assert.equal(list.length, 1);
  assert.equal(list[0].filter.market, "");
  assert.deepEqual(C.sanitiseSavedFilters([{ name: "x" }, null, "junk", { name: "ok", filter: { status: "new", evil: "<b>" } }]), [{ name: "ok", filter: { ...C.EMPTY_FILTER, status: "new" } }]);
});
t("CSV export: header, quoting, store counts, formula cells neutralised", () => {
  const evil = mk("e", { name: '=HYPERLINK("x")', industry: 'Food, "fresh"', storeCount: 12 });
  const csv = C.toCsv([rows[0], evil]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0].split(",")[0], "Company");
  assert.ok(lines[1].startsWith("Alpha Grocer,"));
  assert.ok(lines[2].startsWith(`"'=HYPERLINK(""x"")","Food, ""fresh""",`) || lines[2].includes(`'=HYPERLINK`), lines[2]);
  assert.ok(lines[2].includes(`"Food, ""fresh"""`));
});
t("converting: one stable lead id per prospect, linked both ways", () => {
  const p = rows[0];
  assert.equal(C.leadIdForProspect("a"), C.leadIdForProspect("a"));
  const f = C.leadFieldsFromProspect(p, "Rob@PH.com");
  assert.equal(f.prospectId, "a");
  assert.equal(f.stage, "lead");
  assert.equal(f.assignee, "rob@ph.com");
  assert.deepEqual(f.company.countries, ["United Kingdom", "Ireland"]);
  assert.equal(f.company.storeCount, 400);
  assert.equal(normaliseLead("l", f).prospectId, "a", "the Leads module keeps the link");
  assert.equal(normaliseLead("l", {}).prospectId, "");
});
t("the starter set is valid, unique and spread across regions", () => {
  assert.ok(SEED_PROSPECTS.length >= 40);
  const keys = new Set();
  for (const s of SEED_PROSPECTS) {
    const r = C.prospectFromInput(s);
    assert.deepEqual(r.errors, [], s.name);
    assert.ok(!keys.has(C.slugId(s.name)), `duplicate ${s.name}`);
    keys.add(C.slugId(s.name));
    assert.ok(r.fields.awsRegion, `${s.name} has an AWS region`);
  }
  assert.ok(new Set(SEED_PROSPECTS.map((s) => C.awsRegionForCountry(s.hqCountry))).size >= 8);
});
t("functions/prospects-core.js is the generated copy of the page's prospects-core.js", () => {
  const have = fs.readFileSync(path.join(here, "..", "functions", "prospects-core.js"), "utf8");
  assert.equal(have, buildCopy(fs.readFileSync(path.join(here, "..", "public", "js", "prospects-core.js"), "utf8")), "run: node test/prospects-core-copy.mjs --write");
  assert.deepEqual(createRequire(import.meta.url)("../functions/prospects-core.js").STATUS_KEYS, C.STATUS_KEYS);
});
console.log(`${n} passed`);
