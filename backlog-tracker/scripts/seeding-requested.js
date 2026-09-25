// Shared by seed-faq-data.js and migrate-artifact-data.js — the two
// insert-only seeds deploy-backlog-tracker.yml runs. Both use Firestore's
// create(), which can tell "already exists" from "never existed" but not
// "never existed" from "deleted on purpose in the console": once a doc is
// gone, the next run's create() succeeds again and the deleted article,
// category, project or card is back with its original imported content.
// Running them on every deploy is how deleted help-centre articles kept
// returning (XFeVboxWduEPT2zGcj8y), and how the "Products and Pricing
// Prototype" project deleted on 22 Sep 2026 reappeared with its 30 archived
// cards.
//
// The step-level `if: github.event_name == 'workflow_dispatch'` that
// ticket added is not enough on its own: the deploy run-backlog-automation.js
// starts after every train merge IS a workflow_dispatch (a GITHUB_TOKEN
// merge never triggers `on: push`, so the pipeline dispatches the deploy
// explicitly), so the seeds still ran on every pipeline deploy. So each seed
// now runs only when a person asked for it: the workflow's "Run workflow"
// dialog with its `seed` box ticked (a workflow_dispatch input), or
// SEED_DATA=1 in the environment of a run made by hand outside Actions.
// Everything else — a push-triggered deploy, the pipeline's own dispatch, a
// manual run with the box left unticked — exits without touching Firestore.
"use strict";
const fs = require("fs");

function seedingRequested(env = process.env) {
  if (String(env.SEED_DATA || "").trim() === "1") return { requested: true, reason: "SEED_DATA=1 is set" };
  if (!env.GITHUB_ACTIONS) {
    return { requested: false, reason: "not running in GitHub Actions and SEED_DATA is not set — set SEED_DATA=1 to seed on purpose" };
  }
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    return { requested: false, reason: `this is a ${env.GITHUB_EVENT_NAME || "non-dispatch"} run, not a manual "Run workflow" dispatch` };
  }
  let inputs = {};
  try {
    inputs = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")).inputs || {};
  } catch {
    inputs = {};
  }
  if (String(inputs.seed) === "true") return { requested: true, reason: "a manual \"Run workflow\" dispatch with its seed box ticked" };
  return {
    requested: false,
    reason: "a workflow_dispatch without the seed box ticked (the deploy the backlog automation starts after every merge is one of these)",
  };
}

module.exports = { seedingRequested };
