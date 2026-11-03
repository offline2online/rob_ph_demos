// Non-GitHub (Elementor/WordPress) deployment target: pure logic, no network.
// Run with: node test/elementor-deploy.test.js
const assert = require("assert");
const E = require("../functions/elementor-deploy");

const gh = { name: "Repo project" };
const wp = { name: "PH Website", deployTarget: "elementor", autoPublish: true };

(async () => {
  // GitHub projects are unaffected
  assert.strictEqual(E.deployTargetOf(gh), "github");
  assert.strictEqual(E.deployTargetOf({ deployTarget: "bogus" }), "github");
  assert.ok(E.usesGithub(gh));
  assert.ok(!E.usesGithub(wp));
  const r0 = await E.publishArtifact({ ticket: {}, project: gh, artifact: { kind: "page", title: "x", content: {} }, callTool: async () => assert.fail("must not call") });
  assert.strictEqual(r0.ok, false);

  // validation
  assert.ok(E.validateArtifact({ kind: "x" }).length >= 2);
  assert.deepStrictEqual(E.validateArtifact({ kind: "post", title: "t", content: "c" }), []);

  // create: dry-run calls nothing and writes nothing
  const art = { kind: "post", title: "Weekly", content: "<p>hi</p>" };
  const dry = await E.publishArtifact({ ticket: {}, project: wp, artifact: art, dryRun: true, callTool: async () => assert.fail("dry run must not call") });
  assert.ok(dry.ok && dry.dryRun && dry.plan.tool === "elementor-create-page");
  assert.deepStrictEqual(dry.fields, {});

  // create then update (keeps previous version) then rollback
  const calls = [];
  const tool = async (name, args) => {
    calls.push(name);
    if (name === "elementor-create-page") return { id: 42, url: "https://personalisationhub.com/weekly/" };
    if (name === "elementor-get-page-structure") return { content: "<p>v1</p>" };
    return { id: args.postId, url: "https://personalisationhub.com/weekly/" };
  };
  const p1 = await E.publishArtifact({ ticket: {}, project: wp, artifact: art, callTool: tool, now: "2026-11-02T00:00:00Z" });
  assert.strictEqual(p1.fields.wpId, 42);
  assert.strictEqual(p1.fields.deployVersion, 1);
  assert.strictEqual(p1.fields.publishedUrl, "https://personalisationhub.com/weekly/");
  let ticket = { ...p1.fields };
  assert.strictEqual(E.planRollback(ticket).ok, false); // first publish created it

  const p2 = await E.publishArtifact({ ticket, project: wp, artifact: { ...art, wpId: 42, content: "<p>v2</p>" }, callTool: tool });
  assert.strictEqual(p2.fields.deployVersion, 2);
  assert.deepStrictEqual(p2.fields.deployHistory[1].previousSnapshot, { content: "<p>v1</p>" });
  ticket = { ...p2.fields };
  const rb = await E.rollback({ ticket, callTool: tool });
  assert.ok(rb.ok);
  assert.strictEqual(rb.fields.deployVersion, 3);
  assert.strictEqual(rb.fields.deployHistory.length, 3);
  assert.ok(calls.includes("elementor-publish-document"));
  const rbDry = await E.rollback({ ticket, callTool: async () => assert.fail("no call"), dryRun: true });
  assert.ok(rbDry.ok && !Object.keys(rbDry.fields).length);

  // pre-publish check holds the item
  const bad = await E.publishArtifact({ ticket: {}, project: wp, artifact: { ...art, content: "Case study for Acme Corp" }, blockedTerms: ["acme corp"], callTool: async () => assert.fail("held") });
  assert.ok(!bad.ok && bad.held && /acme corp/i.test(bad.error));
  assert.ok(E.prePublishChecks({ title: "Acmeville", content: "x" }, ["Acme"]).ok); // whole word only

  // recurring weekly Friday ~9am Sydney
  const job = { id: "blog", title: "Weekly blog", weekday: 5, hour: 9, minute: 0, jitterMinutes: 60, tz: "Australia/Sydney", autoPublish: true };
  const from = new Date("2026-11-02T00:00:00Z"); // Monday
  const t0 = E.nextRunAt(job, from, () => 0);
  assert.strictEqual(t0.toISOString(), "2026-11-05T22:00:00.000Z"); // Fri 6 Nov 09:00 AEDT (UTC+11)
  const t1 = E.nextRunAt(job, from, () => 0.999);
  assert.ok(t1 > t0 && t1 - t0 <= 60 * 60000);
  assert.ok(E.nextRunAt(job, t0, () => 0) > t0); // strictly after
  // winter: AEST (UTC+10)
  assert.strictEqual(E.nextRunAt(job, new Date("2027-06-14T00:00:00Z"), () => 0).toISOString(), "2027-06-17T23:00:00.000Z");

  // scheduled runs: auto-publish only when allowed and clean
  const ok = E.scheduledRunRecord(job, wp, art, ["acme"], t0);
  assert.strictEqual(ok.status, "published-live");
  assert.strictEqual(E.scheduledRunRecord(job, { ...wp, autoPublish: false }, art, [], t0).status, "ready-for-testing");
  const held = E.scheduledRunRecord(job, wp, { ...art, content: "acme wins" }, ["acme"], t0);
  assert.strictEqual(held.status, "ready-for-testing");
  assert.strictEqual(held.hold.reason, "pre-publish-check");
  console.log("elementor-deploy: ok");
})().catch((e) => { console.error(e); process.exit(1); });
