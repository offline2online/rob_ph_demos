#!/usr/bin/env node
"use strict";

// Grant or revoke the config API's admin role: sets the custom claim
// (PS_ADMIN_CLAIM, default "admin") on a Firebase Auth user, keeping their
// other claims. Run with Application Default Credentials for the project
// (`gcloud auth application-default login`, or GOOGLE_APPLICATION_CREDENTIALS).
//
//   node scripts/set-admin-claim.js --project rob-ph-demos --uid <uid>
//   node scripts/set-admin-claim.js --project rob-ph-demos --email <address> [--revoke]
//
// It prints the uid only, never the address (CI logs in this repo are public).
// The user picks the claim up on their next sign-in or token refresh.

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const projectId = arg("project") || process.env.GCLOUD_PROJECT;
  const uid = arg("uid");
  const email = arg("email");
  const revoke = process.argv.includes("--revoke");
  const claim = process.env.PS_ADMIN_CLAIM || "admin";
  if (!projectId || (!uid && !email)) {
    console.error("Usage: set-admin-claim.js --project <id> (--uid <uid> | --email <address>) [--revoke]");
    process.exit(2);
  }
  initializeApp({ projectId });
  const auth = getAuth();
  const user = uid ? await auth.getUser(uid) : await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims || {}) };
  if (revoke) delete claims[claim];
  else claims[claim] = true;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`${revoke ? "Revoked" : "Granted"} "${claim}" for uid ${user.uid}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
