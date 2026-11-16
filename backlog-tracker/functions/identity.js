// Run-time identity configuration — the place addresses live instead of code.
//
// consoleConfig/identity = { personAliases: { "<alias>": "<canonical>" } }
// is written only by scripts/set-owner-claim.js (the admin SDK; no client may
// write it — firestore.rules). Nothing in this repository names a person's
// address: owners are recognised by the `owner` custom claim, and the one
// mapping that has to name addresses (a second sign-in address that is the
// same person) is data, loaded here and handed to kanban-core.setPersonAliases.
"use strict";

const core = require("./kanban-core");

const TTL_MS = 60 * 1000;
let loadedAt = 0;
let inflight = null;

// `db` is a Firestore instance or a function returning one (resolved inside
// the try, so a module with no initialised app simply keeps the last map).
async function refresh(db, { force = false } = {}) {
  if (!db) return core.PERSON_ALIASES;
  if (!force && Date.now() - loadedAt < TTL_MS) return core.PERSON_ALIASES;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const fs = typeof db === "function" ? db() : db;
      const snap = await fs.collection("consoleConfig").doc("identity").get();
      const data = snap && snap.exists ? (typeof snap.data === "function" ? snap.data() : snap.data) || {} : {};
      core.setPersonAliases(data.personAliases || {});
    } catch {
      // Keep whatever we last had: a failed read must not un-alias anyone.
    } finally {
      loadedAt = Date.now();
      inflight = null;
    }
    return core.PERSON_ALIASES;
  })();
  return inflight;
}

function reset() { loadedAt = 0; inflight = null; core.setPersonAliases({}); }

module.exports = { refresh, reset, TTL_MS };
