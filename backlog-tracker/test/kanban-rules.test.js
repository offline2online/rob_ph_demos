// Security rules for Staff Kanban (../firestore.rules, "Staff Kanban"),
// run inside the Firestore emulator by `npm run test:rules`, beside
// firestore-rules.test.js and in the same style: the real rules file, one
// assert per case, a fresh set of documents before each.
//
// The writes here are the ones public/js/kanban/kanban-store.js makes:
// createTask is a transaction (counter + ticket), updateTask a batch.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, query, where, limit, setDoc, updateDoc, deleteDoc, serverTimestamp, writeBatch, runTransaction, increment } = require("firebase/firestore");

const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");

const OWNER = { uid: "owner", claims: { email: "rob@offline2online.com", email_verified: true } };
const MEMBER = { uid: "member", claims: { email: "sam@personalisationhub.com", email_verified: true } };
const VIEWER = { uid: "viewer", claims: { email: "kit@personalisationhub.com", email_verified: true } };
const ADMIN = { uid: "admin", claims: { email: "ada@personalisationhub.com", email_verified: true } };
const STRANGER = { uid: "stranger", claims: { email: "someone@example.com", email_verified: true } };
const SAM = MEMBER.claims.email;

let env;
const results = [];

// A ticket as kanban-store.js writes it.
function task(n, over = {}) {
  return Object.assign({
    key: `PH-${n}`, number: n, type: "task", title: "A task", description: "", descriptionText: "",
    status: "backlog", resolution: null, open: true, rank: 10, assignee: "", previousAssignee: "", reporter: SAM,
    release: "", sprint: "", estimate: null, logged: 0, priority: "medium", due: "", labels: [], epic: "", links: [],
    flagged: false, attachments: [], mentions: [], searchTokens: ["a", "task"], commentCount: 0,
    createdAt: serverTimestamp(), createdBy: SAM, updatedAt: serverTimestamp(), updatedBy: SAM,
  }, over);
}

async function reset() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "consoleUsers/sam@personalisationhub.com"), { email: SAM, role: "editor" });
    await setDoc(doc(db, "consoleUsers/kit@personalisationhub.com"), { email: "kit@personalisationhub.com", role: "viewer" });
    await setDoc(doc(db, "consoleUsers/ada@personalisationhub.com"), { email: "ada@personalisationhub.com", role: "admin" });
    await setDoc(doc(db, "kanbanCounters/main"), { nextNumber: 8 });
    await setDoc(doc(db, "kanbanTasks/PH-7"), task(7, { createdAt: new Date(0), updatedAt: new Date(0) }));
    await setDoc(doc(db, "kanbanCards/PH-7"), { key: "PH-7", type: "task", title: "A task", status: "backlog", resolution: null, open: true, rank: 10, assignee: "", previousAssignee: "", release: "", sprint: "", priority: "medium", flagged: false, estimate: null, logged: 0, due: "", labels: [], epic: "", commentCount: 0, attachmentCount: 0, updatedAt: new Date(0), updatedBy: SAM });
    await setDoc(doc(db, "kanbanTasks/PH-7/comments/c1"), { author: SAM, html: "<p>x</p>", text: "x", at: new Date(0) });
    await setDoc(doc(db, "kanbanTasks/PH-7/activity/a1"), { who: SAM, text: "Backlog → In Progress", at: new Date(0) });
    await setDoc(doc(db, "kanbanNotifications/n1"), { to: SAM, from: "ada@personalisationhub.com", taskKey: "PH-7", taskTitle: "A task", kind: "description", read: false, at: new Date(0) });
    await setDoc(doc(db, "memberDirectory/sam@personalisationhub.com"), { email: SAM, displayName: "Sam Sample" });
    await setDoc(doc(db, "kanbanSettings/main"), { tester: "rob@offline2online.com" });
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
const asUser = (user, data) => Object.assign(data, { updatedBy: user.claims.email, createdBy: user.claims.email });

// kanban-store.js createTask: read the counter, write counter + ticket together.
function create(user, n, over = {}, counterNext = n + 1) {
  const db = as(user);
  return runTransaction(db, async (tx) => {
    await tx.get(doc(db, "kanbanCounters/main"));
    tx.set(doc(db, "kanbanCounters/main"), { nextNumber: counterNext, updatedAt: serverTimestamp() });
    tx.set(doc(db, `kanbanTasks/PH-${n}`), asUser(user, task(n, over)));
  });
}

async function main() {
  env = await initializeTestEnvironment({
    projectId: "demo-backlog-tracker",
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });

  // ── Keys (KB-TASK-1) ────────────────────────────────────────────────────
  await check("A member creates the next ticket with the counter (PH-8)", "allow", () => create(MEMBER, 8));
  await check("The very first ticket creates the counter (PH-1, next 2)", "allow", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "kanbanCounters/main")));
    const db = as(MEMBER);
    return runTransaction(db, async (tx) => {
      await tx.get(doc(db, "kanbanCounters/main"));
      tx.set(doc(db, "kanbanCounters/main"), { nextNumber: 2, updatedAt: serverTimestamp() });
      tx.set(doc(db, "kanbanTasks/PH-1"), asUser(MEMBER, task(1)));
    });
  });
  await check("A missing counter can't be created far ahead", "deny", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "kanbanCounters/main")));
    return create(MEMBER, 7, {}, 8);
  });
  await check("A ticket can't skip ahead of the counter (PH-9 while next is 8)", "deny", () => create(MEMBER, 9, {}, 10));
  await check("A ticket can't reuse an existing key (PH-7)", "deny", () => create(MEMBER, 7, {}, 8));
  await check("A ticket can't be created without advancing the counter", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanTasks/PH-8"), asUser(MEMBER, task(8))));
  await check("The counter can't advance without its ticket", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanCounters/main"), { nextNumber: 9 }));
  await check("The counter can't go backwards", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanCounters/main"), { nextNumber: 3 }));
  await check("A key must match its number", "deny", () => {
    const db = as(MEMBER);
    return runTransaction(db, async (tx) => {
      await tx.get(doc(db, "kanbanCounters/main"));
      tx.set(doc(db, "kanbanCounters/main"), { nextNumber: 9 });
      tx.set(doc(db, "kanbanTasks/PH-8"), asUser(MEMBER, task(8, { key: "PH-8", number: 99 })));
    });
  });
  await check("A ticket can't be created claiming someone else made it", "deny", () => {
    const db = as(MEMBER);
    return runTransaction(db, async (tx) => {
      await tx.get(doc(db, "kanbanCounters/main"));
      tx.set(doc(db, "kanbanCounters/main"), { nextNumber: 9 });
      tx.set(doc(db, "kanbanTasks/PH-8"), Object.assign(task(8), { createdBy: "ada@personalisationhub.com", updatedBy: SAM }));
    });
  });

  // ── Who ─────────────────────────────────────────────────────────────────
  await check("A viewer can read the board", "allow", () => getDoc(doc(as(VIEWER), "kanbanTasks/PH-7")));
  await check("A viewer can't create a ticket", "deny", () => create(VIEWER, 8));
  await check("A viewer can't move a ticket", "deny", () =>
    updateDoc(doc(as(VIEWER), "kanbanTasks/PH-7"), { status: "in-progress", updatedBy: VIEWER.claims.email }));
  await check("Someone who isn't a member can't read the board", "deny", () => getDoc(doc(as(STRANGER), "kanbanTasks/PH-7")));
  await check("Signed out can't read the board", "deny", () => getDoc(doc(as(null), "kanbanTasks/PH-7")));

  // ── Updates ─────────────────────────────────────────────────────────────
  await check("A member moves a ticket with its activity line (one batch)", "allow", () => {
    const db = as(MEMBER), b = writeBatch(db);
    b.update(doc(db, "kanbanTasks/PH-7"), { status: "in-progress", resolution: null, open: true, rank: 5, updatedAt: serverTimestamp(), updatedBy: SAM });
    b.set(doc(collection(db, "kanbanTasks/PH-7/activity")), { who: SAM, text: "Backlog → In Progress", at: serverTimestamp() });
    return b.commit();
  });
  await check("Completing a ticket needs a resolution", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { status: "done", resolution: null, open: false, updatedBy: SAM }));
  await check("Completed / withdrawn: open must follow the status", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { status: "done", resolution: "withdrawn", open: true, updatedBy: SAM }));
  await check("A member withdraws a ticket", "allow", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { status: "done", resolution: "withdrawn", open: false, closedAt: serverTimestamp(), updatedBy: SAM }));
  await check("An unknown status is refused", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { status: "shipped", updatedBy: SAM }));
  await check("updatedBy must be the caller", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { title: "Renamed", updatedBy: "ada@personalisationhub.com" }));
  await check("A ticket's number can't change", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { number: 1, updatedBy: SAM }));
  await check("A title can't be emptied", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { title: "", updatedBy: SAM }));
  await check("A member deletes a ticket", "allow", () => deleteDoc(doc(as(MEMBER), "kanbanTasks/PH-7")));
  await check("Server search: array-contains on searchTokens is readable", "allow", () =>
    getDocs(query(collection(as(MEMBER), "kanbanTasks"), where("searchTokens", "array-contains", "task"), limit(200))));

  // ── The board's cards (kanbanCards): the light copy of a ticket ──────────
  const card = (n, over = {}) => Object.assign({
    key: `PH-${n}`, type: "task", title: "A task", status: "backlog", resolution: null, open: true, rank: 10, assignee: "", previousAssignee: "",
    release: "", sprint: "", priority: "medium", flagged: false, estimate: null, logged: 0, due: "", labels: [], epic: "", commentCount: 0, attachmentCount: 0,
    updatedAt: serverTimestamp(), updatedBy: SAM,
  }, over);
  await check("A member reads a card, and so does a viewer", "allow", async () => {
    await assertSucceeds(getDoc(doc(as(VIEWER), "kanbanCards/PH-7")));
    return getDocs(query(collection(as(MEMBER), "kanbanCards"), where("open", "==", true)));
  });
  await check("Someone who isn't a member can't read a card", "deny", () => getDoc(doc(as(STRANGER), "kanbanCards/PH-7")));
  await check("A ticket and its card are created together", "allow", () => {
    const db = as(MEMBER);
    return runTransaction(db, async (tx) => {
      await tx.get(doc(db, "kanbanCounters/main"));
      tx.set(doc(db, "kanbanCounters/main"), { nextNumber: 9, updatedAt: serverTimestamp() });
      tx.set(doc(db, "kanbanTasks/PH-8"), asUser(MEMBER, task(8)));
      tx.set(doc(db, "kanbanCards/PH-8"), card(8));
    });
  });
  await check("A card carries a project", "allow", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { project: "New5VKTF2QBqT3T4YEla" })));
  await check("A card's project must be a string", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { project: 7 })));
  await check("A card's project is at most 100 characters", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { project: "p".repeat(101) })));
  await check("A ticket's project must be a string", "deny", () => updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { project: ["x"], updatedBy: SAM }));
  await check("A ticket's project is at most 100 characters", "deny", () => updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { project: "p".repeat(101), updatedBy: SAM }));
  await check("A ticket can name a project", "allow", () => updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), { project: "New5VKTF2QBqT3T4YEla", updatedBy: SAM }));
  // ── Acceptance criteria (KB-TASK-12): stored as "<id>\t<0|1>\t<text>" lines ──
  const line = (i, done = 0, text = `Criterion ${i}`) => `${String(i).padStart(8, "a")}\t${done}\t${text}`;
  const crit = (n, done = 0, text) => Array.from({ length: n }, (_, i) => line(i, done, text));
  const setCrit = (list, over = {}) => updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7"), Object.assign({ acceptanceCriteria: list, updatedBy: SAM }, over));
  await check("A ticket can carry 5 criteria", "allow", () => setCrit(crit(5)));
  await check("A ticket can carry 50 criteria", "allow", () => setCrit(crit(50)));
  await check("A ticket can't carry 51 criteria", "deny", () => setCrit(crit(51)));
  await check("A ticket can clear its criteria", "allow", () => setCrit([]));
  await check("A criterion of 500 characters is accepted", "allow", () => setCrit([line(1, 0, "x".repeat(500))]));
  await check("A criterion of 501 characters is refused", "deny", () => setCrit([line(1, 0, "x".repeat(501))]));
  await check("A 501-character criterion is refused in the last of 50 slots", "deny", () => setCrit([...crit(49), line(49, 0, "x".repeat(501))]));
  await check("A 501-character criterion is refused in the first slot", "deny", () => setCrit([line(0, 0, "x".repeat(501)), ...crit(5).slice(1)]));
  await check("An empty criterion is refused", "deny", () => setCrit([line(1, 0, "")]));
  await check("A criterion without an id is refused", "deny", () => setCrit(["\t0\ttext"]));
  await check("A criterion with a bad done flag is refused", "deny", () => setCrit([line(1, 2)]));
  await check("A criterion holding a line break is refused", "deny", () => setCrit(["abcdefgh\t0\tone\ntwo"]));
  await check("Criteria stored as objects are refused", "deny", () => setCrit([{ id: "abcdefgh", text: "x", done: false }]));
  await check("Criteria that aren't a list are refused", "deny", () => setCrit("abcdefgh\t0\tx"));
  await check("Ticking one of 50 criteria is accepted", "allow", async () => {
    await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "kanbanTasks/PH-7"), { acceptanceCriteria: crit(50) }));
    return setCrit([line(0, 1), ...crit(50).slice(1)]);
  });
  await check("A ticket is created with criteria", "allow", () => create(MEMBER, 8, { acceptanceCriteria: crit(5) }));
  await check("A ticket is not created with 51 criteria", "deny", () => create(MEMBER, 8, { acceptanceCriteria: crit(51) }));
  await check("A card carries the criteria counts", "allow", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { acTotal: 5, acDone: 2 })));
  await check("A card's done count can't exceed its total", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { acTotal: 2, acDone: 3 })));
  await check("A card's total is at most 50", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { acTotal: 51, acDone: 0 })));
  await check("A card can't carry the criteria text", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { acceptanceCriteria: crit(2) })));
  await check("A card with a description can't be written", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { description: "<p>big</p>" })));
  await check("A card can't carry search tokens", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { searchTokens: ["a"] })));
  await check("A card's key must be its id", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(9)));
  await check("A card in Done needs a resolution", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { status: "done", open: false })));
  await check("A card's open flag follows its status", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { status: "done", resolution: "completed", open: true })));
  await check("A card can't be written in someone else's name", "deny", () => setDoc(doc(as(MEMBER), "kanbanCards/PH-8"), card(8, { updatedBy: "ada@personalisationhub.com" })));
  await check("A move writes the ticket, its card and the activity line together", "allow", () => {
    const db = as(MEMBER), b = writeBatch(db);
    b.update(doc(db, "kanbanTasks/PH-7"), { status: "in-progress", resolution: null, open: true, rank: 5, updatedAt: serverTimestamp(), updatedBy: SAM });
    b.set(doc(db, "kanbanCards/PH-7"), { status: "in-progress", open: true, rank: 5, updatedAt: serverTimestamp(), updatedBy: SAM }, { merge: true });
    return b.commit();
  });
  await check("A viewer can't write a card", "deny", () => setDoc(doc(as(VIEWER), "kanbanCards/PH-8"), card(8, { updatedBy: VIEWER.claims.email })));
  await check("A member deletes a card with its ticket", "allow", () => {
    const db = as(MEMBER), b = writeBatch(db);
    b.delete(doc(db, "kanbanTasks/PH-7")); b.delete(doc(db, "kanbanCards/PH-7"));
    return b.commit();
  });

  // ── Comments and activity ───────────────────────────────────────────────
  await check("A member comments, bumping the count", "allow", () => {
    const db = as(MEMBER), b = writeBatch(db);
    b.set(doc(collection(db, "kanbanTasks/PH-7/comments")), { author: SAM, html: "<p>hi</p>", text: "hi", mentions: [], at: serverTimestamp() });
    b.update(doc(db, "kanbanTasks/PH-7"), { commentCount: increment(1), updatedAt: serverTimestamp(), updatedBy: SAM });
    return b.commit();
  });
  await check("A comment can't be written in someone else's name", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanTasks/PH-7/comments/c2"), { author: "ada@personalisationhub.com", html: "", text: "x", at: serverTimestamp() }));
  await check("The activity log is append-only", "deny", () =>
    updateDoc(doc(as(MEMBER), "kanbanTasks/PH-7/activity/a1"), { text: "rewritten" }));
  await check("An activity line can't be deleted", "deny", () => deleteDoc(doc(as(ADMIN), "kanbanTasks/PH-7/activity/a1")));
  await check("A viewer can't comment", "deny", () =>
    setDoc(doc(as(VIEWER), "kanbanTasks/PH-7/comments/c3"), { author: VIEWER.claims.email, html: "", text: "x", at: serverTimestamp() }));

  // ── Settings and sprints (admins) ───────────────────────────────────────
  await check("An admin changes Kanban settings", "allow", () =>
    setDoc(doc(as(ADMIN), "kanbanSettings/main"), { tester: SAM, updatedBy: ADMIN.claims.email }, { merge: true }));
  await check("A member can't change Kanban settings", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanSettings/main"), { tester: SAM, updatedBy: SAM }, { merge: true }));
  await check("A member reads Kanban settings", "allow", () => getDoc(doc(as(MEMBER), "kanbanSettings/main")));
  await check("An admin adds a sprint", "allow", () => setDoc(doc(as(ADMIN), "kanbanSprints/s1"), { name: "Sprint 43", start: "2026-11-11", end: "2026-11-24" }));
  await check("A member can't add a sprint", "deny", () => setDoc(doc(as(MEMBER), "kanbanSprints/s1"), { name: "Sprint 43" }));

  // ── Mentions ────────────────────────────────────────────────────────────
  await check("A member notifies someone they mentioned", "allow", () =>
    setDoc(doc(as(MEMBER), "kanbanNotifications/n2"), { to: "ada@personalisationhub.com", from: SAM, taskKey: "PH-7", taskTitle: "A task", kind: "comment", read: false, at: serverTimestamp() }));
  await check("A notification can't claim to be from someone else", "deny", () =>
    setDoc(doc(as(MEMBER), "kanbanNotifications/n2"), { to: "ada@personalisationhub.com", from: "rob@offline2online.com", taskKey: "PH-7", taskTitle: "", kind: "comment", read: false, at: serverTimestamp() }));
  await check("The person notified reads their mentions (the bell's query)", "allow", () =>
    getDocs(query(collection(as(MEMBER), "kanbanNotifications"), where("to", "==", SAM), limit(100))));
  await check("Nobody else reads them", "deny", () =>
    getDocs(query(collection(as(ADMIN), "kanbanNotifications"), where("to", "==", SAM), limit(100))));
  await check("The person notified marks one read", "allow", () => updateDoc(doc(as(MEMBER), "kanbanNotifications/n1"), { read: true }));
  await check("…and can't rewrite it", "deny", () => updateDoc(doc(as(MEMBER), "kanbanNotifications/n1"), { taskTitle: "edited" }));

  // ── Member directory (written by functions only) ────────────────────────
  await check("A member reads the member directory", "allow", () => getDocs(collection(as(MEMBER), "memberDirectory")));
  await check("Nobody writes the member directory from a browser", "deny", () =>
    setDoc(doc(as(OWNER), "memberDirectory/x@personalisationhub.com"), { email: "x@personalisationhub.com", displayName: "X" }));

  await env.cleanup();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.expectation.padEnd(5)}] ${r.label}`);
    if (!r.ok) console.log(`        ${r.err}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} Staff Kanban rules checks passed`);
  if (failed.length) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
