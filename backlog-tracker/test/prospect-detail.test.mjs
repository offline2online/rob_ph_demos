// Unit tests for the Prospects (TAM) company detail view rules: public/js/prospect-detail-core.js
//   node prospect-detail.test.mjs
import assert from "node:assert/strict";
import * as D from "../public/js/prospect-detail-core.js";

let n = 0;
const t = (name, fn) => { fn(); n++; console.log(`  ok  ${name}`); };
const people = D.normaliseDetail({ people: [
  { id: "ceo", name: "Carol", title: "CEO", buyingRole: "decision-maker", email: "Carol@A.example", awsAccountId: "1234-5678-9012" },
  { id: "cio", name: "Ian", reportsTo: "ceo", buyingRole: "champion", email: "ian@a.example" },
  { id: "dev", name: "Dee", reportsTo: "cio", buyingRole: "bogus", photoUrl: "javascript:alert(1)", awsAccountId: "12345" },
  { id: "lost", name: "Lost", reportsTo: "nobody" },
] }).people;

t("stored people are cleaned: emails lowercased, unsafe photo and unknown role dropped", () => {
  assert.equal(people[0].email, "carol@a.example");
  assert.equal(people[2].photoUrl, "");
  assert.equal(people[2].buyingRole, "");
  assert.equal(people[3].reportsTo, "");
});
t("a person's AWS account ID is 12 digits or dropped", () => {
  assert.equal(people[0].awsAccountId, "123456789012");
  assert.equal(people[2].awsAccountId, "", "an invalid one is not stored");
  assert.equal(D.normaliseAwsAccountId("12345"), null, "the form can tell the person it is invalid");
});
t("the tree nests reports and puts an unknown manager at the top", () => {
  const roots = D.buildTree(people);
  assert.deepEqual(roots.map((r) => r.id), ["ceo", "lost"]);
  assert.equal(roots[0].children[0].children[0].id, "dev");
});
t("a reporting loop is broken, every person appears once", () => {
  const loop = D.normaliseDetail({ people: [{ id: "a", name: "A", reportsTo: "b" }, { id: "b", name: "B", reportsTo: "a" }] }).people;
  const count = (ns) => ns.reduce((s, x) => s + 1 + count(x.children), 0);
  assert.equal(count(D.buildTree(loop)), 2);
});
t("lead overlay matches by email and adds Demo from the stage; gaps name the missing decision maker", () => {
  const lead = { stage: "demo", contacts: [{ name: "Ian", email: "IAN@a.example" }] };
  const o = D.leadOverlay(people, lead);
  assert.equal(o.get("cio").isLead, true);
  assert.deepEqual(o.get("cio").engagement, ["demo"]);
  assert.equal(o.get("ceo").isLead, false);
  assert.deepEqual(D.leadGaps(people, o), ["No decision maker engaged yet."]);
  assert.deepEqual(D.leadGaps(people, D.leadOverlay(people, null)), ["No one at this company has engaged yet."]);
});
t("the ACE seller becomes the account manager once, and a manual row for them wins", () => {
  const ace = { id: "O1", sellerName: "Sam", sellerEmail: "sam@aws.example" };
  const team = D.awsTeamWithAce([], ace);
  assert.equal(team.length, 1); assert.equal(team[0].role, "account-manager"); assert.equal(team[0].source, "ace");
  const manual = D.normaliseDetail({ awsTeam: [{ id: "m", name: "Sam S", email: "sam@aws.example", role: "pdm" }] }).awsTeam;
  const merged = D.awsTeamWithAce(manual, ace);
  assert.equal(merged.length, 1); assert.equal(merged[0].role, "pdm");
  assert.equal(D.awsTeamWithAce(manual, null).length, 1);
});
t("who each AWS person engages, and one-click mail links", () => {
  const team = D.normaliseDetail({ people: [{ id: "x", name: "X" }], awsTeam: [{ id: "a", name: "Amy", engages: ["x", "gone"] }] });
  assert.deepEqual(D.awsEngagement(team.awsTeam, team.people).get("a").map((p) => p.name), ["X"]);
  assert.equal(D.mailto("Amy@AWS.example", "Hi there"), "mailto:amy@aws.example?subject=Hi%20there");
  assert.equal(D.mailto("not an email"), "");
});
t("documents group by title and type, newest version first, with the next version number", () => {
  const docs = D.normaliseDetail({ documents: [
    { id: "1", title: "Pack", kind: "prospect-pack", version: 1, date: "2026-10-01" },
    { id: "2", title: "pack", kind: "prospect-pack", version: 2, date: "2026-10-20", sharedWith: [{ name: "Amy", aws: true }] },
    { id: "3", title: "Deck", kind: "deck", date: "2026-09-01", url: "javascript:x" },
  ] }).documents;
  const g = D.groupDocuments(docs);
  assert.equal(g.length, 2);
  assert.deepEqual(g[0].map((d) => d.version), [2, 1]);
  assert.equal(D.nextVersion(docs, "PACK", "prospect-pack"), 3);
  assert.equal(D.sharedWithAws(docs[1]), true);
  assert.equal(docs[2].url, "");
});
t("the compact lead-card summary lists roles, the first gap and up to four AWS people", () => {
  const detail = D.normaliseDetail({ people: [{ id: "a", name: "A", buyingRole: "decision-maker" }], awsTeam: ["1", "2", "3", "4", "5"].map((i) => ({ id: i, name: `P${i}` })) });
  const c = D.compactSummary(detail, null);
  assert.equal(c.roles[0].key, "decision-maker");
  assert.equal(c.aws.length, 4); assert.equal(c.awsMore, 1);
  assert.equal(D.compactSummary(D.normaliseDetail({}), null).empty, true);
});
t("a save keeps only the shared detail keys, within the rules' limits", () => {
  const out = D.detailForSave({ people: Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, name: `N${i}` })), junk: 1 });
  assert.deepEqual(Object.keys(out).sort(), ["aceOpportunity", "awsTeam", "documents", "people", "profile"]);
  assert.equal(out.people.length, 100, "the rules' ceiling for an org chart");
});
t("every country record of a company shares one detail document", () => {
  const id = D.companyDocId("ALDI");
  assert.equal(id, "aldi");
  for (const name of ["Aldi", "A.L.D.I.", " aldi ", "ALDI"]) assert.equal(D.companyDocId(name), id, name);
  assert.notEqual(D.companyDocId("ALDI Süd"), id);
  assert.match(D.companyDocId("x".repeat(100)), /^[a-z0-9]{1,60}$/, "fits the rules' id pattern");
  assert.equal(D.companyDocId("***"), "", "a name without letters or digits has nowhere to keep detail");
  // The same stored document read for ALDI · Australia and ALDI · Netherlands is the same org chart.
  const stored = { name: "ALDI", people: [{ id: "a", name: "Carol", buyingRole: "decision-maker" }, { id: "b", name: "Ian", reportsTo: "a" }] };
  const forAustralia = D.normaliseDetail(stored), forNetherlands = D.normaliseDetail(stored);
  assert.deepEqual(D.buildTree(forAustralia.people), D.buildTree(forNetherlands.people));
  assert.deepEqual(Object.keys(D.detailForSave(forAustralia)).sort(), ["aceOpportunity", "awsTeam", "documents", "people", "profile"], "no country-specific field is part of the shared detail");
});
console.log(`${n} passed`);
t("an AWS person attaches to a company's AWS team once; attaching again changes the role", () => {
  const pat = { name: "Pat Lee", role: "Account Manager", email: "pat@amazon.com" };
  let r = D.withAwsPerson([], pat, "account-manager");
  assert.ok(r.added); assert.equal(r.team.length, 1);
  assert.equal(r.team[0].role, "account-manager"); assert.equal(r.team[0].email, "pat@amazon.com"); assert.equal(r.team[0].source, "manual");
  r = D.withAwsPerson(r.team, { ...pat, email: "PAT@amazon.com" }, "solutions-architect");
  assert.equal(r.added, false); assert.equal(r.team.length, 1); assert.equal(r.team[0].role, "solutions-architect");
  assert.equal(D.withAwsPerson([], { name: "" }, "pdm").error, "This AWS contact has no name.");
  const full = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, name: `N${i}`, email: `n${i}@aws.com` }));
  assert.ok(D.withAwsPerson(full, pat, "pdm").error);
  assert.deepEqual(Object.keys(D.detailForSave({ awsTeam: r.team })).sort(), ["aceOpportunity", "awsTeam", "documents", "people", "profile"]);
});
console.log(`${n} passed (with AWS attach)`);
