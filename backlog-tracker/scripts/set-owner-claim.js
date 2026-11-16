// Marks the console's account owner with the `owner: true` Firebase Auth
// custom claim — the claim firestore.rules (isOwnerAccount), storage.rules,
// functions/mcp-server.js (resolveConsoleUser) and public/js/auth-gate.js
// (isOwnerUser) read instead of a hard-coded address.
//
// NO ADDRESS IS EVER WRITTEN INTO THIS FILE OR ANY OTHER IN THE REPO.
// The addresses come from the environment only:
//
//   CONSOLE_OWNER_EMAIL     the owner's canonical sign-in address (required
//                           unless --verify)
//   CONSOLE_OWNER_ALIASES   optional, comma-separated: other addresses the
//                           same person signs in with. Each gets the owner
//                           claim plus `aliasOf: <canonical>`, and the map is
//                           written to consoleConfig/identity.personAliases
//                           (the Staff Kanban folds an alias into its person).
//
// Run it:
//   - on a runner (normal): deploy-backlog-tracker.yml runs it before any
//     rules deploy, from the repository secrets CONSOLE_OWNER_EMAIL /
//     CONSOLE_OWNER_ALIASES. Set those once with `gh secret set` (it
//     prompts for the value, so it never lands in shell history);
//   - by hand (one-off), with a service account that may manage Auth users:
//       GOOGLE_APPLICATION_CREDENTIALS=<sa.json> \
//       CONSOLE_OWNER_EMAIL=<owner address> node set-owner-claim.js [--dry]
//
// Flags:
//   --dry      say what would change, write nothing
//   --verify   change nothing; exit 1 unless at least one Auth user carries
//              owner: true (the deploy runs this so a rules deploy can never
//              go out with nobody able to administer the console)
//
// It is idempotent: a run where everything is already in place writes
// nothing. It also makes sure the owner has a consoleUsers row (role admin),
// so the member directory and Team & agent access list them like anyone
// else — the row is convenience, the claim is what can't be locked out.
// The owner picks the claim up at their next token refresh (at most an
// hour; auth-gate.js forces one the first time the rules refuse them).
"use strict";

const { initializeApp, applicationDefault, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseEnv(env) {
  const owner = String(env.CONSOLE_OWNER_EMAIL || "").trim().toLowerCase();
  const aliases = String(env.CONSOLE_OWNER_ALIASES || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    .filter((a) => a !== owner);
  return { owner, aliases: [...new Set(aliases)] };
}

// Pure: the claims an account should end up with, given its current ones.
function claimsFor(current, { aliasOf = "" } = {}) {
  const next = Object.assign({}, current || {});
  next.owner = true;
  if (aliasOf) next.aliasOf = aliasOf; else delete next.aliasOf;
  return next;
}
function sameClaims(a, b) {
  return JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
}

async function anyOwner(auth) {
  let token;
  do {
    const page = await auth.listUsers(1000, token);
    if (page.users.some((u) => u.customClaims && u.customClaims.owner === true)) return true;
    token = page.pageToken;
  } while (token);
  return false;
}

async function run({ env = process.env, argv = process.argv, auth, db, log = console.log } = {}) {
  const DRY = argv.includes("--dry");
  const VERIFY = argv.includes("--verify");
  if (!auth || !db) {
    if (!getApps().length) initializeApp({ credential: applicationDefault() });
    auth = auth || getAuth();
    db = db || getFirestore();
  }
  const { owner, aliases } = parseEnv(env);

  if (!VERIFY) {
    if (!owner) {
      log("set-owner-claim: CONSOLE_OWNER_EMAIL is not set — nothing to apply");
    } else {
      for (const a of [owner, ...aliases]) {
        if (!EMAIL_RE.test(a)) throw new Error("set-owner-claim: an owner/alias value is not an email address");
      }
      const targets = [{ email: owner, aliasOf: "" }, ...aliases.map((a) => ({ email: a, aliasOf: owner }))];
      let n = 0;
      for (const t of targets) {
        n++;
        // Never print the address: runner logs of a public repo are public.
        const label = t.aliasOf ? `alias #${n - 1}` : "owner";
        let user = null;
        try { user = await auth.getUserByEmail(t.email); } catch (err) {
          if (err && err.code !== "auth/user-not-found") throw err;
        }
        if (!user) { log(`set-owner-claim: ${label} has no Firebase Auth user yet (never signed in) — skipped; re-run after their first sign-in`); continue; }
        const next = claimsFor(user.customClaims, { aliasOf: t.aliasOf });
        if (sameClaims(user.customClaims, next)) { log(`set-owner-claim: ${label} claim already in place`); continue; }
        log(`set-owner-claim: ${DRY ? "would set" : "setting"} ${label} claim`);
        if (!DRY) await auth.setCustomUserClaims(user.uid, next);
      }

      // The owner's member row, so the directory and the Users list show them.
      const rowRef = db.collection("consoleUsers").doc(owner);
      const row = await rowRef.get();
      if (!row.exists) {
        log(`set-owner-claim: ${DRY ? "would create" : "creating"} the owner's consoleUsers row (role admin)`);
        if (!DRY) await rowRef.set({ email: owner, role: "admin", mcpEnabled: true, createdAt: FieldValue.serverTimestamp(), createdBy: "set-owner-claim" });
      }

      // The alias map. Replaces the whole map: the secret is the source of truth.
      const cfgRef = db.collection("consoleConfig").doc("identity");
      const cfg = await cfgRef.get();
      const want = Object.fromEntries(aliases.map((a) => [a, owner]));
      const have = (cfg.exists && (cfg.data() || {}).personAliases) || {};
      if (!sameClaims(have, want)) {
        log(`set-owner-claim: ${DRY ? "would write" : "writing"} consoleConfig/identity.personAliases (${aliases.length} alias${aliases.length === 1 ? "" : "es"})`);
        if (!DRY) await cfgRef.set({ personAliases: want, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      }
    }
  }

  if (VERIFY || !DRY) {
    const ok = await anyOwner(auth);
    if (!ok) {
      log("set-owner-claim: no Firebase Auth user carries owner: true — refusing, so the rules can't go out with nobody able to administer the console. Set the CONSOLE_OWNER_EMAIL repository secret and re-run.");
      return 1;
    }
    log("set-owner-claim: an owner claim is in place");
  }
  return 0;
}

module.exports = { run, parseEnv, claimsFor, sameClaims };

if (require.main === module) {
  run().then((code) => process.exit(code), (err) => { console.error(String(err && err.message || err)); process.exit(1); });
}
