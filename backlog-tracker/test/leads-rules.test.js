// Security rules for Promote › Leads' priority within a lane (../firestore.rules,
// isLead → `rank`), run inside the Firestore emulator by `npm run test:rules`,
// in the style of whiteboard-rules.test.js. The wider lead rules are covered in
// firestore-rules.test.js.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, writeBatch, deleteField } = require("firebase/firestore");

const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const MEMBER = { uid: "member", claims: { email: "sam@ph.example", email_verified: true } };
const VIEWER = { uid: "viewer", claims: { email: "kit@ph.example", email_verified: true } };
const LEAD = { company: { name: "Acme Retail", website: "https://acme.example", industry: "Grocery", countries: ["UK"], storeCount: 120 }, contacts: [], stage: "lead", source: "Manual", assignee: "", customerAccount: null };

let env;
const results = [];
const as = (user) => (user ? env.authenticatedContext(user.uid, user.claims) : env.unauthenticatedContext()).firestore();

async function reset() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "consoleUsers/sam@ph.example"), { email: "sam@ph.example", role: "editor" });
    await setDoc(doc(db, "consoleUsers/kit@ph.example"), { email: "kit@ph.example", role: "viewer" });
    await setDoc(doc(db, "leads/l1"), LEAD);
    await setDoc(doc(db, "leads/l2"), { ...LEAD, rank: 1024 });
    // What the functions add: an agent session logged on the lead, its ACE opportunity, GA4 ids, its funding check.
    await setDoc(doc(db, "leads/l4"), { ...LEAD, stage: "hot-lead", aiSessionIds: ["fund-1"], aceOpportunityId: "O-TEST-1", gaClientIds: [{ clientId: "1.2" }] });
    await setDoc(doc(db, "leadFunding/l4"), { leadId: "l4", catalog: "Sandbox", programs: [], pendingApprovals: 2 });
  });
}
async function check(label, expectation, run) {
  try {
    await reset();
    await (expectation === "allow" ? assertSucceeds(run()) : assertFails(run()));
    results.push({ label, ok: true, expectation });
  } catch (err) { results.push({ label, ok: false, expectation, err: err.message }); }
}

async function main() {
  env = await initializeTestEnvironment({ projectId: "demo-backlog-tracker", firestore: { rules: RULES, host: "127.0.0.1", port: 8080 } });

  await check("An editor can set a lead's priority in its lane", "allow", () => updateDoc(doc(as(MEMBER), "leads/l1"), { rank: 1536.5 }));
  await check("A lead's priority must be a number", "deny", () => updateDoc(doc(as(MEMBER), "leads/l1"), { rank: "top" }));
  await check("An editor can clear a lead's priority", "allow", () => updateDoc(doc(as(MEMBER), "leads/l2"), { rank: deleteField() }));
  await check("A drop renumbers the lane in one batch", "allow", () => {
    const db = as(MEMBER);
    const b = writeBatch(db);
    b.update(doc(db, "leads/l1"), { rank: 1024 });
    b.update(doc(db, "leads/l2"), { rank: 2048, stage: "hot-lead" });
    return b.commit();
  });
  await check("A new lead may be created with a priority", "allow", () => setDoc(doc(as(MEMBER), "leads/l3"), { ...LEAD, rank: 0 }));
  // O37hnP69Cnn8N32HpHot: the AWS funding check is the function's alone; the lead stays editable after it.
  await check("An editor can still edit a lead the Partner Central agent logged a session on", "allow", () => updateDoc(doc(as(MEMBER), "leads/l4"), { stage: "demo" }));
  await check("aiSessionIds must be a list", "deny", () => updateDoc(doc(as(MEMBER), "leads/l1"), { aiSessionIds: "fund-1" }));
  await check("A member can read a lead's AWS funding check", "allow", () => getDoc(doc(as(VIEWER), "leadFunding/l4")));
  await check("No browser can write a lead's AWS funding check", "deny", () => setDoc(doc(as(MEMBER), "leadFunding/l4"), { pendingApprovals: 0 }));
  await check("A signed-out visitor can't read a lead's AWS funding check", "deny", () => getDoc(doc(as(null), "leadFunding/l4")));
  await check("A viewer can't reorder a lane", "deny", () => updateDoc(doc(as(VIEWER), "leads/l1"), { rank: 1 }));
  await check("A signed-out visitor can't reorder a lane", "deny", () => updateDoc(doc(as(null), "leads/l1"), { rank: 1 }));

  await env.cleanup();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.expectation.padEnd(5)}] ${r.label}`);
    if (!r.ok) console.log(`        ${r.err}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} leads rules checks passed`);
  if (failed.length) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
