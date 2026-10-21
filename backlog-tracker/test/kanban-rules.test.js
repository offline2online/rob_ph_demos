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
