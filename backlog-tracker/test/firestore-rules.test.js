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
// Membership is a consoleUsers doc now, not a hard-coded list (see the
// rules' own "Who may use the board"). These four are ordinary Google
// accounts whose access comes entirely from the rows reset() seeds below —
// which is the whole point: adding a row is the act of granting access, to
// the board in a browser and to that person's AI agent over MCP alike.
const MEMBER = { uid: "member", claims: { email: "sam@personalisationhub.com", email_verified: true } };
const VIEWER = { uid: "viewer", claims: { email: "kit@personalisationhub.com", email_verified: true } };
const DISABLED = { uid: "disabled", claims: { email: "expat@personalisationhub.com", email_verified: true } };
const TEAM_ADMIN = { uid: "teamadmin", claims: { email: "ada@personalisationhub.com", email_verified: true } };
// A row carrying nothing but an email — no role, no disabled, no mcpEnabled.
// Rules THROW on a property that isn't present rather than reading it as
// null, so a bare property access here denies the member outright. That bug
// shipped once and CI caught it; these cases are why.
const SPARSE = { uid: "sparse", claims: { email: "min@personalisationhub.com", email_verified: true } };
// Same address as MEMBER but signed in with an unverified email — the rules
// require email_verified, which for an invited password account is what
// completing Firebase's password-setup email establishes.
const UNVERIFIED = { uid: "unverified", claims: { email: "sam@personalisationhub.com", email_verified: false } };

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
    await setDoc(doc(db, "consoleUsers/sam@personalisationhub.com"), { email: "sam@personalisationhub.com", role: "editor" });
    await setDoc(doc(db, "consoleUsers/kit@personalisationhub.com"), { email: "kit@personalisationhub.com", role: "viewer" });
    await setDoc(doc(db, "consoleUsers/expat@personalisationhub.com"), { email: "expat@personalisationhub.com", role: "editor", disabled: true });
    await setDoc(doc(db, "consoleUsers/ada@personalisationhub.com"), { email: "ada@personalisationhub.com", role: "admin" });
    await setDoc(doc(db, "consoleUsers/min@personalisationhub.com"), { email: "min@personalisationhub.com" });
    await setDoc(doc(db, "mcpTokens/deadbeef"), { email: "sam@personalisationhub.com", type: "access" });
    await setDoc(doc(db, "docRevisions/r1"), { target: "project.requirementsMd", projectId: "p1", contentMd: "the text that was replaced", replacedByEmail: "sam@personalisationhub.com" });
    await setDoc(doc(db, "mcpAuditLog/e1"), { email: "sam@personalisationhub.com", tool: "create_backlog_item" });
    await setDoc(doc(db, "releases/rDraft"), { name: "October", version: "2.4.0", status: "draft", order: 1 });
    await setDoc(doc(db, "releases/rLive"), { name: "September", status: "live", order: 0 });
    await setDoc(doc(db, "concepts/cActive"), { name: "Store staff shift handover", status: "active", readmeMd: "", requirementsMd: "", comments: [] });
    await setDoc(doc(db, "concepts/cPromoted"), { name: "Already shipped idea", status: "promoted", promotedProjectId: "p1" });
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

  // ── Linking a NEW project to GitHub (repoFolder/deployBranch at creation) ──
  // There is no train yet on a brand-new project doc, so naming its branch
  // once at creation isn't the same risk as repointing an established one's
  // (see "Editor CANNOT repoint deployBranch" above, which is still denied —
  // this only ever applies to a `create`, never an `update`).
  await check("Editor can set repoFolder freely (not a train field)", "allow", () =>
    setDoc(doc(as(HUMAN), "projects/newRepoFolder"), { name: "New Project", repoFolder: "dsp-integration" }));
  await check("Editor can seed deployBranch when CREATING a new project", "allow", () =>
    setDoc(doc(as(HUMAN), "projects/newWithBranch"), { name: "New Project", deployBranch: "deploy/new-project" }));
  await check("Editor CANNOT seed a malformed deployBranch at creation", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/newBadBranch"), { name: "New Project", deployBranch: "not-a-branch" }));
  await check("Editor still cannot set trainReady even when creating the project", "deny", () =>
    setDoc(doc(as(HUMAN), "projects/newWithTrainReady"), { name: "New Project", deployBranch: "deploy/new-project-2", trainReady: true }));

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

  // ── Membership: a consoleUsers row is what grants access ────────────────
  await check("A member added to consoleUsers can read the board", "allow", () => getDoc(doc(as(MEMBER), "projects/p1")));
  await check("A member added to consoleUsers can write the board", "allow", () =>
    setDoc(doc(as(MEMBER), "backlogItems/i1"), { desc: "Edited by a teammate" }, { merge: true }));
  await check("A viewer can read the board", "allow", () => getDoc(doc(as(VIEWER), "projects/p1")));
  await check("A viewer CANNOT write the board", "deny", () =>
    setDoc(doc(as(VIEWER), "backlogItems/i1"), { desc: "Viewers don't get to" }, { merge: true }));
  await check("A disabled member cannot read the board", "deny", () => getDoc(doc(as(DISABLED), "projects/p1")));
  // Optional fields absent entirely — the regression that broke every member
  // whose row had no `disabled` field.
  await check("A member row with no optional fields can read the board", "allow", () => getDoc(doc(as(SPARSE), "projects/p1")));
  await check("A member row with no role defaults to editor and can write", "allow", () =>
    setDoc(doc(as(SPARSE), "backlogItems/i1"), { desc: "Edited by a minimal member row" }, { merge: true }));
  await check("A member row with no role is NOT an admin", "deny", () =>
    setDoc(doc(as(SPARSE), "consoleUsers/newbie3@personalisationhub.com"), { email: "newbie3@personalisationhub.com", role: "editor" }));
  await check("A member with an unverified email cannot read the board", "deny", () => getDoc(doc(as(UNVERIFIED), "projects/p1")));

  // ── consoleUsers itself ────────────────────────────────────────────────
  await check("Anyone signed in may read their OWN membership row (the sign-in gate needs this)", "allow", () =>
    getDoc(doc(as(STRANGER), "consoleUsers/someone@example.com")));
  await check("A stranger cannot read someone else's membership row", "deny", () =>
    getDoc(doc(as(STRANGER), "consoleUsers/sam@personalisationhub.com")));
  await check("A non-admin member CANNOT add a user", "deny", () =>
    setDoc(doc(as(MEMBER), "consoleUsers/newbie@personalisationhub.com"), { email: "newbie@personalisationhub.com", role: "editor" }));
  await check("A non-admin member CANNOT promote themselves to admin", "deny", () =>
    setDoc(doc(as(MEMBER), "consoleUsers/sam@personalisationhub.com"), { role: "admin" }, { merge: true }));
  await check("An admin can add a user", "allow", () =>
    setDoc(doc(as(TEAM_ADMIN), "consoleUsers/newbie@personalisationhub.com"), { email: "newbie@personalisationhub.com", role: "editor" }));
  await check("An admin cannot file a user under an id that isn't their email", "deny", () =>
    setDoc(doc(as(TEAM_ADMIN), "consoleUsers/not-the-email"), { email: "newbie@personalisationhub.com", role: "editor" }));
  await check("An admin cannot invent a role", "deny", () =>
    setDoc(doc(as(TEAM_ADMIN), "consoleUsers/newbie@personalisationhub.com"), { email: "newbie@personalisationhub.com", role: "superuser" }));
  await check("An admin cannot delete their own row and strand themselves", "deny", () =>
    deleteDoc(doc(as(TEAM_ADMIN), "consoleUsers/ada@personalisationhub.com")));
  await check("An owner account works with no consoleUsers row at all", "allow", () =>
    setDoc(doc(as(HUMAN), "consoleUsers/newbie2@personalisationhub.com"), { email: "newbie2@personalisationhub.com", role: "viewer" }));

  // ── The MCP credential store is nobody's business but the server's ─────
  await check("An admin CANNOT read stored MCP tokens", "deny", () => getDoc(doc(as(TEAM_ADMIN), "mcpTokens/deadbeef")));
  await check("An owner CANNOT read stored MCP tokens", "deny", () => getDoc(doc(as(HUMAN), "mcpTokens/deadbeef")));
  await check("Nobody can forge an MCP token", "deny", () =>
    setDoc(doc(as(HUMAN), "mcpTokens/forged"), { email: "rob@offline2online.com", type: "access" }));
  await check("Nobody can register an MCP client from the browser", "deny", () =>
    setDoc(doc(as(TEAM_ADMIN), "mcpClients/c1"), { clientId: "c1" }));
  // ── Documentation revision history ─────────────────────────────────────
  // This is what makes agent-driven documentation recoverable, so it has to
  // be readable by a member and forgeable by nobody.
  await check("A member may read the documentation revision history", "allow", () => getDoc(doc(as(MEMBER), "docRevisions/r1")));
  await check("A viewer may read the documentation revision history", "allow", () => getDoc(doc(as(VIEWER), "docRevisions/r1")));
  await check("A stranger cannot read the documentation revision history", "deny", () => getDoc(doc(as(STRANGER), "docRevisions/r1")));
  await check("Nobody can forge a documentation revision", "deny", () =>
    setDoc(doc(as(TEAM_ADMIN), "docRevisions/forged"), { target: "project.requirementsMd", projectId: "p1", contentMd: "never happened" }));
  await check("Not even an owner can rewrite a documentation revision", "deny", () =>
    setDoc(doc(as(HUMAN), "docRevisions/r1"), { contentMd: "altered" }, { merge: true }));
  await check("Nobody can delete a documentation revision", "deny", () => deleteDoc(doc(as(TEAM_ADMIN), "docRevisions/r1")));

  await check("An admin may read the agent audit log", "allow", () => getDoc(doc(as(TEAM_ADMIN), "mcpAuditLog/e1")));
  await check("A non-admin member may NOT read the agent audit log", "deny", () => getDoc(doc(as(MEMBER), "mcpAuditLog/e1")));
  await check("Nobody can edit the agent audit log", "deny", () =>
    setDoc(doc(as(TEAM_ADMIN), "mcpAuditLog/e1"), { tool: "something else" }, { merge: true }));

  // ── Releases ───────────────────────────────────────────────────────────
  // order is what article bindings are range-compared on, and status only
  // ever advances draft -> live (marking live promotes FAQ proposals, which
  // un-marking couldn't undo).
  await check("A member may read releases", "allow", () => getDoc(doc(as(MEMBER), "releases/rDraft")));
  await check("A stranger cannot read releases", "deny", () => getDoc(doc(as(STRANGER), "releases/rDraft")));
  await check("An editor can create a draft release", "allow", () =>
    setDoc(doc(as(MEMBER), "releases/rNew"), { name: "November", version: null, status: "draft", order: 2 }));
  await check("A viewer CANNOT create a release", "deny", () =>
    setDoc(doc(as(VIEWER), "releases/rNew"), { name: "November", status: "draft", order: 2 }));
  await check("A release needs a known status", "deny", () =>
    setDoc(doc(as(MEMBER), "releases/rNew"), { name: "November", status: "shipped", order: 2 }));
  await check("An editor can mark a draft release live", "allow", () =>
    setDoc(doc(as(MEMBER), "releases/rDraft"), { status: "live" }, { merge: true }));
  await check("Nobody can move a live release back to draft", "deny", () =>
    setDoc(doc(as(HUMAN), "releases/rLive"), { status: "draft" }, { merge: true }));
  await check("Nobody can change a release's order", "deny", () =>
    setDoc(doc(as(HUMAN), "releases/rDraft"), { order: 5 }, { merge: true }));
  await check("An editor can assign a project to a release", "allow", () =>
    setDoc(doc(as(MEMBER), "projects/p1"), { releaseId: "rDraft" }, { merge: true }));
  await check("An editor can clear a project's release", "allow", () =>
    setDoc(doc(as(MEMBER), "projects/p1"), { releaseId: null }, { merge: true }));
  await check("A project's releaseId must be a string id", "deny", () =>
    setDoc(doc(as(MEMBER), "projects/p1"), { releaseId: 7 }, { merge: true }));
  await check("An editor can bind an article to a release range", "allow", () =>
    setDoc(doc(as(MEMBER), "faqArticles/a1"), { introducedInReleaseId: "rLive", removedInReleaseId: "rDraft" }, { merge: true }));
  await check("An article's release binding must be a string id", "deny", () =>
    setDoc(doc(as(MEMBER), "faqArticles/a1"), { introducedInReleaseId: 1 }, { merge: true }));

  // ── Concept Incubator ──────────────────────────────────────────────────
  // An early-stage idea, held separately from projects/backlogItems until
  // promoteConceptToProject() (app.js) flips status active -> promoted.
  await check("A member may read a concept", "allow", () => getDoc(doc(as(MEMBER), "concepts/cActive")));
  await check("A stranger cannot read a concept", "deny", () => getDoc(doc(as(STRANGER), "concepts/cActive")));
  await check("An editor can create a concept", "allow", () =>
    setDoc(doc(as(MEMBER), "concepts/cNew"), { name: "A new idea", status: "active", readmeMd: "", requirementsMd: "", comments: [] }));
  await check("A viewer CANNOT create a concept", "deny", () =>
    setDoc(doc(as(VIEWER), "concepts/cNew"), { name: "A new idea", status: "active" }));
  await check("A new concept must start active, not promoted", "deny", () =>
    setDoc(doc(as(MEMBER), "concepts/cNewPromoted"), { name: "A new idea", status: "promoted" }));
  await check("An editor can save a concept's README independently of requirements", "allow", () =>
    setDoc(doc(as(MEMBER), "concepts/cActive"), { readmeMd: "# Shift handover\n\nDraft README." }, { merge: true }));
  await check("An editor can save a concept's requirements independently of README", "allow", () =>
    setDoc(doc(as(MEMBER), "concepts/cActive"), { requirementsMd: "Must support incremental edits." }, { merge: true }));
  await check("An editor can append to a concept's discussion thread", "allow", () =>
    setDoc(doc(as(MEMBER), "concepts/cActive"), { comments: [{ author: "viewer", text: "Worth exploring further", at: new Date() }] }, { merge: true }));
  await check("An editor can promote a concept to a project", "allow", () =>
    setDoc(doc(as(MEMBER), "concepts/cActive"), { status: "promoted", promotedProjectId: "p1" }, { merge: true }));
  await check("Nobody can move a promoted concept back to active", "deny", () =>
    setDoc(doc(as(HUMAN), "concepts/cPromoted"), { status: "active" }, { merge: true }));
  await check("An editor can delete a still-active concept", "allow", () => deleteDoc(doc(as(MEMBER), "concepts/cActive")));
  await check("Nobody can delete a promoted concept", "deny", () => deleteDoc(doc(as(HUMAN), "concepts/cPromoted")));

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
