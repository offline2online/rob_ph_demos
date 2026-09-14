// Creates/updates the "board automation" Firebase Auth user that Routine-fired
// Claude sessions sign in as (email + password over Google's Identity
// Toolkit REST API — *.googleapis.com, which those sessions can reach; the
// boardApi Cloud Function host turned out to be blocked by their egress
// policy). Run by the deploy workflow on every deploy.
//
//   BOARD_API_KEY=<secret> node ensure-automation-user.js
//
// The password is the same BOARD_API_KEY secret boardApi uses, so there is
// one credential to rotate. The user is marked email-verified by the Admin
// SDK (no mailbox exists for it) so firestore.rules' isEditor() accepts it.
// Requires the Email/Password sign-in provider to be enabled once in the
// Firebase console (Authentication → Sign-in method) for the REST sign-in
// to work; creating the user itself does not need it.
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const EMAIL = "board-automation@backlog-tracker-e4ed2.firebaseapp.com";
const password = process.env.BOARD_API_KEY;

async function main() {
  if (!password || password === "unset" || password.length < 12) {
    console.log("ensure-automation-user: BOARD_API_KEY unset or too short — skipping (no automation user managed)");
    return;
  }
  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();
  let user = null;
  try { user = await auth.getUserByEmail(EMAIL); } catch (err) { if (err.code !== "auth/user-not-found") throw err; }
  if (user) {
    await auth.updateUser(user.uid, { password, emailVerified: true, disabled: false, displayName: "Board automation" });
    console.log(`ensure-automation-user: updated ${EMAIL} (${user.uid})`);
  } else {
    user = await auth.createUser({ email: EMAIL, password, emailVerified: true, displayName: "Board automation" });
    console.log(`ensure-automation-user: created ${EMAIL} (${user.uid})`);
  }
}

main().catch((err) => { console.error("ensure-automation-user failed:", err); process.exit(1); });
