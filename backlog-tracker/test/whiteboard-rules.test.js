// Security rules for the live whiteboard (../firestore.rules, "Whiteboard"), run inside the
// Firestore emulator by `npm run test:rules`, in the style of kanban-rules.test.js.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, addDoc, serverTimestamp, writeBatch } = require("firebase/firestore");

const RULES = fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8");
const MEMBER = { uid: "member", claims: { email: "sam@personalisationhub.com", email_verified: true } };
const VIEWER = { uid: "viewer", claims: { email: "kit@personalisationhub.com", email_verified: true } };
const ID = "Ab3dEf6hIj9lMn2pQr5T";
const OFF = "Zz3dEf6hIj9lMn2pQr5T";

let env;
const results = [];
const as = (user) => (user ? env.authenticatedContext(user.uid, user.claims) : env.unauthenticatedContext()).firestore();
const stroke = (over = {}) => Object.assign({ g: "g1", color: "#232628", size: 5, pts: [0, 0, 10, 10], t: 1 }, over);

async function reset() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "consoleUsers/sam@personalisationhub.com"), { email: "sam@personalisationhub.com", role: "editor" });
    await setDoc(doc(db, "consoleUsers/kit@personalisationhub.com"), { email: "kit@personalisationhub.com", role: "viewer" });
    await setDoc(doc(db, `whiteboards/${ID}`), { shared: true, createdAt: new Date(0) });
    await setDoc(doc(db, `whiteboards/${ID}/strokes/s1`), stroke());
    await setDoc(doc(db, `whiteboards/${OFF}`), { shared: false, createdAt: new Date(0) });
    await setDoc(doc(db, `whiteboards/${OFF}/strokes/s1`), stroke());
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
  const anon = () => as(null);

  // Creating and managing a board is a member's job.
  const newBoard = (user, id = "Qw3dEf6hIj9lMn2pQr5T", data = { shared: true, createdAt: serverTimestamp() }) => setDoc(doc(as(user), `whiteboards/${id}`), data);
  await check("A member creates a board", "allow", () => newBoard(MEMBER));
  await check("A signed-out visitor can't create one", "deny", () => newBoard(null));
  await check("A read-only viewer can't create one", "deny", () => newBoard(VIEWER));
  await check("The id must be 20 letters/digits", "deny", () => newBoard(MEMBER, "short"));
  await check("A board holds no extra fields (no email or name)", "deny", () => newBoard(MEMBER, undefined, { shared: true, createdAt: serverTimestamp(), createdBy: "sam@personalisationhub.com" }));
  await check("A member turns sharing off", "allow", () => updateDoc(doc(as(MEMBER), `whiteboards/${ID}`), { shared: false }));
  await check("A link holder can't turn sharing off", "deny", () => updateDoc(doc(anon(), `whiteboards/${ID}`), { shared: false }));
  await check("Boards can't be rewritten beyond the sharing switch", "deny", () => updateDoc(doc(as(MEMBER), `whiteboards/${ID}`), { createdAt: new Date() }));

  // Opening one: the id is the credential, and ids can't be listed.
  await check("Anyone with the id opens the board doc", "allow", () => getDoc(doc(anon(), `whiteboards/${ID}`)));
  await check("A non-member can't list boards", "deny", () => getDocs(collection(anon(), "whiteboards")));
  await check("A member can list boards", "allow", () => getDocs(collection(as(MEMBER), "whiteboards")));

  // Drawing without signing in.
  await check("A link holder reads the strokes of a shared board", "allow", () => getDocs(collection(anon(), `whiteboards/${ID}/strokes`)));
  await check("A link holder draws on a shared board", "allow", () => addDoc(collection(anon(), `whiteboards/${ID}/strokes`), stroke()));
  await check("…and erases a stroke", "allow", () => deleteDoc(doc(anon(), `whiteboards/${ID}/strokes/s1`)));
  await check("…and clears in a batch", "allow", () => { const db = anon(); const b = writeBatch(db); b.delete(doc(db, `whiteboards/${ID}/strokes/s1`)); return b.commit(); });
  await check("Nobody reads strokes of a board with sharing off", "deny", () => getDocs(collection(anon(), `whiteboards/${OFF}/strokes`)));
  await check("Nobody draws on a board with sharing off", "deny", () => addDoc(collection(anon(), `whiteboards/${OFF}/strokes`), stroke()));
  await check("Nobody erases on a board with sharing off", "deny", () => deleteDoc(doc(anon(), `whiteboards/${OFF}/strokes/s1`)));
  await check("A made-up id has no strokes to read", "deny", () => getDocs(collection(anon(), "whiteboards/Nn3dEf6hIj9lMn2pQr5T/strokes")));
  await check("A made-up id can't be drawn on", "deny", () => addDoc(collection(anon(), "whiteboards/Nn3dEf6hIj9lMn2pQr5T/strokes"), stroke()));
  await check("A stroke can't be edited", "deny", () => updateDoc(doc(anon(), `whiteboards/${ID}/strokes/s1`), { color: "#ff0000" }));

  // What a stroke may contain.
  const draw = (over) => addDoc(collection(anon(), `whiteboards/${ID}/strokes`), stroke(over));
  await check("A stroke of 4000 numbers is fine", "allow", () => draw({ pts: Array.from({ length: 4000 }, (_, i) => i) }));
  await check("A stroke over 4000 numbers is refused", "deny", () => draw({ pts: Array.from({ length: 4002 }, (_, i) => i) }));
  await check("Points must come in pairs", "deny", () => draw({ pts: [1, 2, 3] }));
  await check("Points must be numbers", "deny", () => draw({ pts: ["a", "b"] }));
  await check("Colour must be #rrggbb", "deny", () => draw({ color: "red" }));
  await check("Size must be positive and sane", "deny", () => draw({ size: 5000 }));
  await check("Unknown fields are refused", "deny", () => draw({ html: "<script>" }));

  await env.cleanup();
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  [${r.expectation.padEnd(5)}] ${r.label}`);
    if (!r.ok) console.log(`        ${r.err}`);
  }
  console.log(`\n${results.length - failed.length}/${results.length} whiteboard rules checks passed`);
  if (failed.length) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
