"use strict";
// ── AWS Partner Account Mapping: the scheduled re-sync check ────────────────
// (ticket U04K46GSsIEN5xQ4NyAp; the data rules are in prospects-core.js →
// "AWS Partner Account Mapping".)
//
// Account Mapping is not exposed by the Partner Central Selling API or by its
// agents MCP server (checked 24 Nov 2026), so the TAM goes to AWS as a file
// and AWS's results come back as a file, imported on Promote › Prospects
// (TAM). Nothing here calls AWS. What runs on a schedule is the check: once a
// day it counts the records that have never been synced, or were last synced
// more than MAPPING_STALE_DAYS ago, and writes the result to
// consoleConfig/accountMapping, which the page reads to show "N companies due
// a re-sync" with the upload file limited to them. Re-importing AWS's results
// for those records updates each one's lastSyncedAt.
//
// It runs from the hourly aceToGa4 call (index.js), beside the funnel
// ingest's due run: this project has no Cloud Scheduler on purpose (the deploy
// account can't create scheduler jobs), and a build adds no new workflow.
// It reads the prospects collection and writes ONE document; it never writes
// a prospect, so it starts no enrichment or index trigger.

const core = require("./prospects-core");

const CONFIG_DOC = ["consoleConfig", "accountMapping"];
const EVERY_MS = 24 * 3600e3; // once a day is enough for a 30-day rule
const SAMPLE = 50; // ids kept on the summary so an agent can see which ones

function createAccountMappingCheck({ db, now = () => Date.now(), logger = console }) {
  const ref = () => db.collection(CONFIG_DOC[0]).doc(CONFIG_DOC[1]);

  async function run() {
    const t = now();
    const snap = await db.collection("prospects").get();
    const rows = snap.docs.map((d) => core.normaliseProspect(d.id, d.data()));
    const live = rows.filter((p) => p.status !== "disqualified" && p.status !== "converted");
    const never = live.filter((p) => !p.awsMapping || !p.awsMapping.lastSyncedAtMs);
    const stale = live.filter((p) => p.awsMapping && p.awsMapping.lastSyncedAtMs && core.isMappingStale(p, t));
    const synced = rows.map((p) => (p.awsMapping && p.awsMapping.lastSyncedAtMs) || 0).filter(Boolean);
    const summary = {
      checkedAt: new Date(t),
      staleDays: core.MAPPING_STALE_DAYS,
      total: live.length,
      neverSynced: never.length,
      stale: stale.length,
      due: never.length + stale.length,
      matched: rows.filter((p) => p.awsMapping && p.awsMapping.matched === true).length,
      highPotential: rows.filter(core.isHighPotential).length,
      lastImportAt: synced.length ? new Date(Math.max(...synced)) : null,
      dueIds: [...stale, ...never].slice(0, SAMPLE).map((p) => p.id),
    };
    await ref().set(summary, { merge: true });
    logger.info("accountMapping check", { total: summary.total, due: summary.due, stale: summary.stale, neverSynced: summary.neverSynced });
    return summary;
  }

  // Run when the last check is a day old (or there is none).
  async function runIfDue() {
    const s = await ref().get();
    const d = s.exists ? s.data() || {} : {};
    const last = d.checkedAt && typeof d.checkedAt.toMillis === "function" ? d.checkedAt.toMillis() : d.checkedAt instanceof Date ? d.checkedAt.getTime() : 0;
    if (last && now() - last < EVERY_MS) return { skipped: "not due" };
    return run();
  }

  return { run, runIfDue };
}

module.exports = { createAccountMappingCheck, CONFIG_DOC, EVERY_MS };
