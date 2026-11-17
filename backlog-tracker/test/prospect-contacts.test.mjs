// Unit tests for Promote › Prospects (TAM) › Contacts: public/js/prospect-contacts-core.js
// (profile URLs, ids, company matching, dedupe, the spreadsheet import) and the Chrome
// extension's page reader (chrome-extension/linkedin-reader.js) on saved markup.
//   node prospect-contacts.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import * as C from "../public/js/prospect-contacts-core.js";
import { normaliseProspect } from "../public/js/prospects-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const P = (id, o) => normaliseProspect(id, o);
const prospects = [
  P("tesco-united-kingdom", { name: "Tesco", country: "United Kingdom", hqCountry: "United Kingdom", contacts: [{ name: "Jo Bloggs", role: "CMO", lastContact: "May 2026" }, { name: "Sam Lee", role: "CIO", lastContact: "" }] }),
  P("aldi-australia", { name: "ALDI", country: "Australia", hqCountry: "Germany" }),
  P("aldi-germany", { name: "ALDI", country: "Germany", hqCountry: "Germany" }),
  P("woolworths-group-australia", { name: "Woolworths Group", country: "Australia", hqCountry: "Australia", contacts: [{ name: "Ann Smith", role: "Head of Retail Media", lastContact: "" }] }),
  P("schwarz-group-lidl-germany", { name: "Schwarz Group (Lidl)", country: "Germany" }),
  P("bp-retail-uk", { name: "BP Retail", country: "United Kingdom" }),
];

t("LinkedIn profile URLs normalise to one form", () => {
  const want = "https://www.linkedin.com/in/jo-bloggs-1a2b3c/";
  for (const u of ["https://www.linkedin.com/in/jo-bloggs-1a2b3c", "https://uk.linkedin.com/in/Jo-Bloggs-1a2b3c/?originalSubdomain=uk", "linkedin.com/in/jo-bloggs-1a2b3c/details/experience/", "http://www.linkedin.com/in/jo-bloggs-1a2b3c#about"]) assert.equal(C.normaliseLinkedInProfileUrl(u), want, u);
  assert.equal(C.normaliseLinkedInProfileUrl(""), "");
  for (const bad of ["https://www.linkedin.com/company/tesco/", "https://www.linkedin.com/search/results/people/?keywords=jo", "https://example.com/in/jo/", "javascript:alert(1)", "not a url at all"]) assert.equal(C.normaliseLinkedInProfileUrl(bad), null, bad);
  assert.equal(C.normaliseLinkedInProfileUrl("https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller/"), "https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller/");
});

t("a profile is one id, whatever form the URL came in", () => {
  assert.equal(C.contactIdForLinkedIn("https://uk.linkedin.com/in/Jo-Bloggs-1a2b3c/"), "li-jo-bloggs-1a2b3c");
  assert.equal(C.contactIdForLinkedIn("https://www.linkedin.com/in/jo-bloggs-1a2b3c"), "li-jo-bloggs-1a2b3c");
  assert.equal(C.contactIdForLinkedIn("https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller/"), "li-jorg-muller");
  assert.match(C.contactIdForLinkedIn("https://www.linkedin.com/in/jo-bloggs/"), /^[A-Za-z0-9_-]{1,220}$/);
  assert.equal(C.contactIdForLinkedIn("https://www.linkedin.com/company/x/"), "");
  assert.equal(C.seedContactId("tesco-united-kingdom", "Jo Bloggs"), "tam-tesco-united-kingdom-jobloggs");
});

t("the name is guessed from the URL's slug", () => {
  assert.equal(C.nameFromLinkedInUrl("https://www.linkedin.com/in/jo-bloggs-1a2b3c/"), "Jo Bloggs");
  assert.equal(C.nameFromLinkedInUrl("https://www.linkedin.com/in/ann-marie-smith/"), "Ann Marie Smith");
  assert.equal(C.nameFromLinkedInUrl("https://www.linkedin.com/in/jsmith123/"), "");
});

t("company names match TAM companies: exact, without legal words, one inside the other", () => {
  assert.equal(C.matchProspect("Tesco", prospects).id, "tesco-united-kingdom");
  assert.equal(C.matchProspect("Tesco PLC", prospects).id, "tesco-united-kingdom");
  assert.equal(C.matchProspect("tesco plc.", prospects).id, "tesco-united-kingdom");
  assert.equal(C.matchProspect("Woolworths", prospects).id, "woolworths-group-australia");
  assert.equal(C.matchProspect("Lidl", prospects).id, "schwarz-group-lidl-germany");
  assert.equal(C.matchProspect("ALDI", prospects).id, "aldi-germany", "the head-office record of a company in several countries");
  assert.equal(C.matchProspect("ALDI Süd", prospects).id, "aldi-germany");
  assert.equal(C.matchProspect("Acme Signage Ltd", prospects), null);
  assert.equal(C.matchProspect("BP", prospects).id, "bp-retail-uk", "filler words (Retail) are ignored");
  assert.equal(C.matchProspect("Ald", prospects), null, "too short to match inside another name");
  assert.equal(C.matchProspect("", prospects), null);
});

t("a contact's fields: name required, profile URL and email checked, company from the TAM record", () => {
  const ok = C.contactFromInput({ name: " Jo  Bloggs ", role: "CMO", linkedinUrl: "uk.linkedin.com/in/jo-bloggs", email: "Jo@Tesco.example", notes: " hi " }, prospects[0]);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.fields, { name: "Jo Bloggs", role: "CMO", companyName: "Tesco", prospectId: "tesco-united-kingdom", companyKey: "tesco", linkedinUrl: "https://www.linkedin.com/in/jo-bloggs/", email: "jo@tesco.example", notes: "hi", source: "" });
  const un = C.contactFromInput({ name: "Pat", companyName: "Acme Signage" }, null);
  assert.equal(un.fields.prospectId, ""); assert.equal(un.fields.companyKey, ""); assert.equal(un.fields.companyName, "Acme Signage");
  assert.equal(C.contactFromInput({ name: "" }, null).errors.length, 1);
  assert.equal(C.contactFromInput({ name: "Pat", linkedinUrl: "https://www.linkedin.com/company/x/" }, null).errors.length, 1);
  assert.equal(C.contactFromInput({ name: "Pat", email: "nope" }, null).errors.length, 1);
});

t("dedupe: the same profile, else the same name at the same company with no profile yet", () => {
  const list = [
    C.normaliseContact("li-jo-bloggs", { name: "Jo Bloggs", companyKey: "tesco", prospectId: "tesco-united-kingdom", linkedinUrl: "https://www.linkedin.com/in/jo-bloggs/" }),
    C.normaliseContact("tam-tesco-united-kingdom-samlee", { name: "Sam Lee", companyKey: "tesco", prospectId: "tesco-united-kingdom" }),
  ];
  assert.equal(C.findExisting(list, { linkedinUrl: "https://uk.linkedin.com/in/Jo-Bloggs" }).id, "li-jo-bloggs");
  assert.equal(C.findExisting(list, { linkedinUrl: "https://www.linkedin.com/in/sam-lee-9/", name: "sam lee", companyKey: "tesco" }).id, "tam-tesco-united-kingdom-samlee");
  assert.equal(C.findExisting(list, { name: "Sam Lee", companyKey: "aldi" }), null, "another company's Sam Lee is another person");
  assert.equal(C.findExisting(list, { name: "Jo Bloggs", companyKey: "tesco" }), null, "a contact with a profile is matched only by its profile");
});

t("the spreadsheet import: every contact on the TAM records once, matched to its company; removed ones stay removed", () => {
  const first = C.seedContacts(prospects, new Set());
  assert.deepEqual(first.map((r) => r.id), ["tam-tesco-united-kingdom-jobloggs", "tam-tesco-united-kingdom-samlee", "tam-woolworths-group-australia-annsmith"]);
  assert.deepEqual(first[0].fields, { name: "Jo Bloggs", role: "CMO", companyName: "Tesco", prospectId: "tesco-united-kingdom", companyKey: "tesco", linkedinUrl: "", email: "", notes: "", source: "TAM spreadsheet", lastContact: "May 2026" });
  assert.deepEqual(C.seedContacts(prospects, new Set(first.map((r) => r.id))), [], "importing again adds nothing");
  assert.deepEqual(C.seedContacts(prospects, ["tam-tesco-united-kingdom-jobloggs"]).map((r) => r.id), ["tam-tesco-united-kingdom-samlee", "tam-woolworths-group-australia-annsmith"]);
  const dup = [P("x-uk", { name: "X", country: "United Kingdom", contacts: [{ name: "A B", role: "" }, { name: "A. B", role: "" }] })];
  assert.equal(C.seedContacts(dup, new Set()).length, 1, "the same name twice on one record is one contact");
});

t("the extension's payload becomes a contact input", () => {
  assert.deepEqual(C.inputFromExtension({ name: "Jo Bloggs", headline: "CMO at Tesco", company: "Tesco", url: "https://www.linkedin.com/in/jo-bloggs/" }),
    { name: "Jo Bloggs", role: "CMO at Tesco", companyName: "Tesco", linkedinUrl: "https://www.linkedin.com/in/jo-bloggs/", source: "Chrome extension" });
  assert.deepEqual(C.inputFromExtension(null), { name: "", role: "", companyName: "", linkedinUrl: "", source: "Chrome extension" });
});

t("the list: search, company filter, Unmatched, removed hidden; a company's contacts", () => {
  const list = [
    C.normaliseContact("a", { name: "Jo Bloggs", role: "CMO", companyName: "Tesco", companyKey: "tesco", prospectId: "tesco-united-kingdom" }),
    C.normaliseContact("b", { name: "Pat Kim", role: "Buyer", companyName: "Acme Signage" }),
    C.normaliseContact("c", { name: "Old Hand", companyName: "Tesco", companyKey: "tesco", prospectId: "tesco-united-kingdom", removed: true }),
    C.normaliseContact("d", { name: "Ann Smith", role: "Retail media", companyName: "Woolworths Group", companyKey: "woolworthsgroup", prospectId: "w" }),
  ];
  assert.deepEqual(C.filterContacts(list).map((c) => c.id), ["a", "b", "d"]);
  assert.deepEqual(C.filterContacts(list, { q: "buyer" }).map((c) => c.id), ["b"]);
  assert.deepEqual(C.filterContacts(list, { q: "tesco" }).map((c) => c.id), ["a"]);
  assert.deepEqual(C.filterContacts(list, { company: C.UNMATCHED }).map((c) => c.id), ["b"]);
  assert.deepEqual(C.filterContacts(list, { company: "woolworthsgroup" }).map((c) => c.id), ["d"]);
  assert.deepEqual(C.contactsForCompany(list, "tesco").map((c) => c.id), ["a"]);
  assert.deepEqual(C.companyOptions(list), [["tesco", "Tesco"], ["woolworthsgroup", "Woolworths Group"]]);
});

t("a stored contact normalises (bad URL and email dropped, timestamps read)", () => {
  const c = C.normaliseContact("x", { name: "A", linkedinUrl: "https://example.com/", email: "bad", createdAt: { seconds: 1700000000 } });
  assert.equal(c.linkedinUrl, ""); assert.equal(c.email, ""); assert.equal(c.createdAt, "2023-11-14T22:13:20.000Z"); assert.equal(c.removed, false);
});

t("firestore.rules accepts the ids and URLs the page writes", () => {
  const rules = fs.readFileSync(path.join(here, "..", "firestore.rules"), "utf8");
  assert.match(rules, /match \/prospectContacts\/\{contactId\}/);
  const idRe = new RegExp(rules.match(/contactId\.matches\("([^"]+)"\)/)[1]);
  const urlRe = new RegExp(rules.match(/linkedinUrl", ""\)\.matches\("(\^https:\/\/www\[\.\]linkedin\[\.\]com\/in\/[^"]+)"\)/)[1]);
  for (const id of [C.contactIdForLinkedIn("https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller/"), C.seedContactId("schwarz-group-lidl-germany", "Ann Smith"), "AbCdEf0123456789xyzQ"]) assert.match(id, idRe);
  for (const u of ["https://uk.linkedin.com/in/Jo-Bloggs", "https://www.linkedin.com/in/j%C3%B6rg-m%C3%BCller/"]) assert.match(C.normaliseLinkedInProfileUrl(u), urlRe);
});

// ── The Chrome extension's reader ─────────────────────────────────────────
const readerSrc = fs.readFileSync(path.join(here, "..", "chrome-extension", "linkedin-reader.js"), "utf8");
const read = (html, href) => {
  const dom = new JSDOM(html, { url: href });
  const ctx = { globalThis: {} };
  ctx.globalThis = ctx;
  vm.runInNewContext(readerSrc, ctx);
  return JSON.parse(JSON.stringify(ctx.phReadLinkedInProfile(dom.window.document, href))); // out of the vm realm
};
t("reader: the top card's name, headline and current company, and the clean profile URL", () => {
  const html = `<html><head><title>(3) Jo Bloggs | LinkedIn</title></head><body><main><section class="artdeco-card"><div><h1 class="text-heading-xlarge">Jo  Bloggs</h1><div class="text-body-medium break-words">Chief Marketing Officer at Tesco | Retail media</div></div>
    <ul><li><button aria-label="Current company: Tesco PLC. Click to skip to experience card">Tesco PLC</button></li></ul></section></main></body></html>`;
  assert.deepEqual(read(html, "https://uk.linkedin.com/in/jo-bloggs-1a2b3c/?originalSubdomain=uk"), { url: "https://www.linkedin.com/in/jo-bloggs-1a2b3c/", name: "Jo Bloggs", headline: "Chief Marketing Officer at Tesco | Retail media", company: "Tesco PLC" });
});
t("reader: falls back to the first Experience entry, then to \"… at X\" in the headline", () => {
  const exp = `<html><body><main><section><h1>Ann Smith</h1><div class="text-body-medium">Retail media lead</div></section>
    <section><div id="experience"></div><ul><li><span aria-hidden="true">Head of Retail Media</span><span aria-hidden="true">Woolworths Group · Full-time</span><span aria-hidden="true">2022 - Present</span></li></ul></section></main></body></html>`;
  assert.equal(read(exp, "https://www.linkedin.com/in/ann-smith/").company, "Woolworths Group");
  const at = `<html><body><main><section><h1>Pat Kim</h1><div class="text-body-medium">Buyer at Acme Signage, ex-Retailer</div></section></main></body></html>`;
  assert.equal(read(at, "https://www.linkedin.com/in/pat-kim/").company, "Acme Signage");
});
t("reader: refuses a page that isn't a profile; uses the title when there is no heading", () => {
  assert.ok(read("<html><body></body></html>", "https://www.linkedin.com/company/tesco/").error);
  assert.equal(read("<html><head><title>Sam Lee | LinkedIn</title></head><body><main></main></body></html>", "https://www.linkedin.com/in/sam-lee/").name, "Sam Lee");
});
t("the extension asks only for what one click needs", () => {
  const m = JSON.parse(fs.readFileSync(path.join(here, "..", "chrome-extension", "manifest.json"), "utf8"));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.permissions.sort(), ["activeTab", "scripting"]);
  assert.ok(m.host_permissions.every((h) => /^https:\/\/backlog-tracker-e4ed2\.(web|firebaseapp)\.(app|com)\/\*$/.test(h)), "host access only to the console");
  assert.ok(!m.content_scripts, "nothing runs on LinkedIn until the button is clicked");
  const bg = fs.readFileSync(path.join(here, "..", "chrome-extension", "background.js"), "utf8");
  assert.match(bg, /__phAddProspectContact/);
  const page = fs.readFileSync(path.join(here, "..", "public", "js", "prospects-page.js"), "utf8");
  assert.match(page, /window\.__phAddProspectContact = /, "the console defines the hand-over");
});
console.log(`${n} passed`);
