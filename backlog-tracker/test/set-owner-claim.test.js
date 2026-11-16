// scripts/set-owner-claim.js with stubbed Auth and Firestore: no address is
// needed, and the deploy gate passes only when someone can administer.
"use strict";
const assert = require("node:assert/strict");
const { run, claimsFor } = require("../scripts/set-owner-claim.js");

function stubs({ users = [], rows = {} } = {}) {
  const set = [];
  const auth = {
    async listUsers() { return { users, pageToken: undefined }; },
    async getUserByEmail(e) { const u = users.find((x) => x.email === e); if (!u) { const err = new Error("nope"); err.code = "auth/user-not-found"; throw err; } return u; },
    async setCustomUserClaims(uid, c) { set.push([uid, c]); const u = users.find((x) => x.uid === uid); if (u) u.customClaims = c; },
  };
  const db = {
    collection(name) {
      return {
        where(f, op, v) { return { async get() { return { docs: Object.entries(name === "consoleUsers" ? rows : {}).filter(([, r]) => r[f] === v).map(([id, r]) => ({ id, data: () => r })) }; } }; },
        doc(id) { return { async get() { const r = name === "consoleUsers" ? rows[id] : undefined; return { exists: !!r, data: () => r }; }, async set() {} }; },
      };
    },
  };
  return { auth, db, set };
}
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message}`); } }

(async () => {
  const quiet = () => {};
  await test("no address configured: an enabled admin row with a sign-in passes, nothing is written", async () => {
    const s = stubs({ users: [{ uid: "u1", email: "admin@ph.example" }], rows: { "admin@ph.example": { role: "admin" } } });
    assert.equal(await run({ env: {}, argv: [], auth: s.auth, db: s.db, log: quiet }), 0);
    assert.deepEqual(s.set, []);
  });
  await test("nobody can administer: refused (exit 1)", async () => {
    const s = stubs({ users: [{ uid: "u1", email: "ed@ph.example" }], rows: { "ed@ph.example": { role: "editor" }, "gone@ph.example": { role: "admin" }, "off@ph.example": { role: "admin", disabled: true } } });
    assert.equal(await run({ env: {}, argv: [], auth: s.auth, db: s.db, log: quiet }), 1);
  });
  await test("an owner claim alone is enough", async () => {
    const s = stubs({ users: [{ uid: "u1", email: "owner@example.com", customClaims: { owner: true } }] });
    assert.equal(await run({ env: {}, argv: ["--verify"], auth: s.auth, db: s.db, log: quiet }), 0);
  });
  await test("an address, when given, gets the claim; an alias gets aliasOf; nothing is logged with an address", async () => {
    const s = stubs({ users: [{ uid: "u1", email: "owner@example.com" }, { uid: "u2", email: "owner.alias@example.com" }] });
    const lines = [];
    assert.equal(await run({ env: { CONSOLE_OWNER_EMAIL: "owner@example.com", CONSOLE_OWNER_ALIASES: "owner.alias@example.com" }, argv: [], auth: s.auth, db: s.db, log: (l) => lines.push(l) }), 0);
    assert.deepEqual(s.set, [["u1", { owner: true }], ["u2", { owner: true, aliasOf: "owner@example.com" }]]);
    assert.ok(!lines.join("\n").includes("@"), "no address in the log");
  });
  await test("claimsFor keeps other claims", () => {
    assert.deepEqual(claimsFor({ consoleRole: "admin" }), { consoleRole: "admin", owner: true });
  });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
