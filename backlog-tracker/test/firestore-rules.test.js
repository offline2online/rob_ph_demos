// Security-rules tests for ../firestore.rules, run inside the Firestore
// emulator by `npm test` (see README.md for why this exists).
//
// Reads the REAL rules file rather than a copy, so the thing under test is
// the thing that ships. No test framework: one assert helper, an explicit
// list of cases, and a non-zero exit on any failure, which is all
// `firebase emulators:exec` needs to fail a build.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, deleteDoc } = require("firebase/firestore");

const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");

// The three principals the rules distinguish. The service account is absent
// on purpose: it bypasses rules entirely, so there is nothing here to test.
// `uid` is passed separately, never inside the token claims — the emulator
// rejects a mock token carrying it ("use sub instead").
const HUMAN = { uid: "human", claims: { email: "rob@offline2online.com", email_verified: true } };
const BOT = { uid: "bot", claims: { email: "board-automation@backlog-tracker-e4ed2.firebaseapp.com", email_verified: true } };
const STRANGER = { uid: "stranger", claims: { email: "someone@example.com", email_verified: true } };

// A project mid-release: the automation has created the train branch and the
// board has latched the lock, which is exactly the state the Deploy click
// happens in.
const PROJECT = {
  name: "Backlog Tracker & FAQs",
  deployBranch: "deploy/backlog-tracker-faqs",
  trainLocked: true,
};
const ITEM = {
  projectId: "p1", title: "A ticket", desc: "Something to do",
  type: "feature", status: "ready-for-testing",
};

let env;
const results = [];

// Every case starts from the same documents. Without this the suite is
// order-dependent in a way that quietly weakens it: an earlier case that
// sets trainReady leaves it set, so a later "an editor must not set
// trainReady" case is really writing the value it already has — an
// unchanged field, which the rules correctly allow. The test would pass
// while asserting nothing. Resetting is cheap and keeps each case honest
// about the transition it claims to cover.
async function reset() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "projects/p1"), PROJECT);
    await setDoc(doc(db, "backlogItems/i1"), ITEM);
    await setDoc(doc(db, "faqArticles/a1"), {
      categoryId: "c1", title: "T", slug: "t", bodyMd: "<p>x</p>", status: "published", order: 1,
    });
  });
}

async function check(label, expectation, run) {
  try {
    await reset();
    await (expectation === "allow" ? assertSucceeds(run()) : assertFails(run()));
    results.push({ label, ok: true, expectation });
  } catch (err) {
    results.push({ label, ok: false, expectation, err: err.message });
  }
}
const as = (user) => (user ? env.authenticatedContext(user.uid, user.claims) : env.unauthenticatedContext()).firestore();

async function main() {
  env = await initializeTestEnvironment({
    projectId: "demo-backlog-tracker",
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });
  await env.clearFirestore();

  // ── The regression this suite exists for ────────────────────────────────
  // The Routine's trainReady write is the whole Deploy to Main flow. If this
  // one fails, the button does nothing and no card can ever reach live.
  await check("Routine (board automation) can set trainReady — THE DEPLOY SIGNAL", "allow", () =>
    setDoc(doc(as(BOT), "projects/p1"), { trainReady: true }, { merge: true }));
  await check("Routine can self-report deployRoutine progress", "allow", () =>
    setDoc(doc(as(BOT), "projects/p1"), { deployRoutine: { status: "done" } }, { merge: true }));
  await check("Routine can write an item's patch hand-off", "allow", () =>
    setDoc(doc(as(BOT), "backlogItems/i1"), { patchReady: true }, { merge: true }));

  // ── What a person on the board may do ───────────────────────────────────
  await check("Editor can latch trainLocked true (approving closes the train)", "allow", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { trainLocked: true }, { merge: true }));
  await check("Editor can request a deploy (deployNotifyRequestedAt)", "allow", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { deployNotifyRequestedAt: new Date().toISOString() }, { merge: true }));
  await check("Editor can rename a project", "allow", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { name: "Renamed" }, { merge: true }));
  await check("Editor can reject a ticket (revertRequested)", "allow", () =>
    setDoc(doc(as(HUMAN), "backlogItems/i1"), { status: "backlog", revertRequested: true }, { merge: true }));
  await check("Editor can read the board", "allow", () => getDoc(doc(as(HUMAN), "projects/p1")));

  // ── What a person must NOT be able to do ────────────────────────────────
  // These decide which branch a real merge points at.
  await check("Editor CANNOT set trainReady by hand", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { trainReady: true }, { merge: true }));
  await check("Editor CANNOT unlock a closing train", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { trainLocked: false }, { merge: true }));
  await check("Editor CANNOT repoint deployBranch", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { deployBranch: "deploy/elsewhere" }, { merge: true }));
  await check("Editor CANNOT fake a train PR number", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/p1"), { trainPrNumber: 999 }, { merge: true }));

  // ── The sign-in wall ────────────────────────────────────────────────────
  await check("Stranger cannot read the board", "deny", () => getDoc(doc(as(STRANGER), "projects/p1")));
  await check("Stranger cannot write the board", "deny", () =>
    setDoc(doc(as(STRANGER), "projects/p1"), { name: "Mine now" }, { merge: true }));
  await check("Signed-out visitor cannot read backlog items", "deny", () => getDoc(doc(as(null), "backlogItems/i1")));
  await check("Stranger cannot delete a backlog item", "deny", () => deleteDoc(doc(as(STRANGER), "backlogItems/i1")));

  // ── The help centre stays publicly readable, never publicly writable ────
  await check("Anyone may READ a help-centre article (the public FAQ site)", "allow", () =>
    getDoc(doc(as(null), "faqArticles/a1")));
  await check("Nobody may write a help-centre article signed out", "deny", () =>
    setDoc(doc(as(null), "faqArticles/a1"), { title: "Defaced" }, { merge: true }));

  await env.cleanup();

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.expectation.padEnd(5)}] ${r.label}`);
    if (!r.ok) console.log(`        ${r.err}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} rules checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
