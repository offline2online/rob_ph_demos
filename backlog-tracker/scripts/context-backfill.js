#!/usr/bin/env node
// Backfill of the PH Agent Context search index (functions/context, MCP.md →
// "PH Agent Context"): indexes every existing record of every source into
// `searchIndex`, and removes index entries whose record no longer exists.
//
// The index is otherwise kept current by Firestore triggers, one record at a
// time, so this is needed once after the feature first deploys (existing data
// was written before the triggers existed) and is safe to run again at any
// time: a record whose indexed content has not changed is one read and no
// write. It is also the repair for anything a failed trigger left behind.
//
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node context-backfill.js            # dry run: counts per source only
//   GOOGLE_APPLICATION_CREDENTIALS=sa.json node context-backfill.js --apply    # write the index
//   … --apply --sources ticket,document      only these sources
//   … --apply --reembed                      also add semantic vectors to records indexed without one
//
// It reads the source collections and writes ONLY searchIndex,
// searchIndexState and the `stale` mark on topicContext packs. It prints
// counts, never a record's text (support threads are customers' email, and
// Actions logs are public).
"use strict";

const path = require("path");
const core = require("../functions/context/core.js");

function parseArgs(argv) {
  const out = { apply: false, reembed: false, sources: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--apply") out.apply = true;
    else if (argv[i] === "--reembed") out.reembed = true;
    else if (argv[i] === "--sources") {
      out.sources = String(argv[i + 1] || "").split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
      const bad = out.sources.filter((s) => !core.SOURCE_NAMES.includes(s));
      if (!out.sources.length || bad.length) throw new Error(`--sources takes a comma-separated list of: ${core.SOURCE_NAMES.join(", ")}${bad.length ? ` (not ${bad.join(", ")})` : ""}`);
    } else throw new Error(`Unknown argument ${argv[i]}. Use --apply, --reembed, --sources a,b.`);
  }
  return out;
}

// The collections one run reads, for the dry run's counts.
const COLLECTIONS = { ticket: ["backlogItems"], kanban: ["kanbanTasks"], project: ["projects"], concept: ["concepts"], critique: ["conceptCritiques"], faq: ["faqArticles"], lead: ["leads"], prospect: ["prospects"], support: ["supportTickets"], document: ["projectDocs", "interfaces"], skill: ["skills"] };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { initializeApp, applicationDefault } = require("firebase-admin/app");
  const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
  initializeApp({ credential: applicationDefault(), projectId: "backlog-tracker-e4ed2" });
  const db = getFirestore();
  const wanted = args.sources || core.SOURCE_NAMES;
  if (!args.apply) {
    console.log("Dry run (nothing is written). Records per source:");
    for (const s of wanted) {
      let n = 0;
      for (const c of COLLECTIONS[s]) n += (await db.collection(c).count().get()).data().count;
      console.log(`  ${s}: ${n}${s === "document" ? " (plus Requirements and README per project)" : ""}`);
    }
    console.log(`  already in the index: ${(await db.collection("searchIndex").where("deleted", "==", false).count().get()).data().count}`);
    console.log("Run again with --apply to write the index.");
    return;
  }
  const logger = { warn: (msg, d) => console.warn(`::warning::${msg}${d && d.error ? `: ${d.error}` : ""}`), error: (msg, d) => console.error(`${msg}${d && d.error ? `: ${d.error}` : ""}`) };
  // Semantic vectors: the token comes from this folder's own google-auth-library
  // (functions/ has no node_modules on a runner).
  let embedder;   // undefined: functions/context decides (off outside Cloud Functions)
  if (String(process.env.CONTEXT_EMBEDDINGS || "").toLowerCase() === "vertex") {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    embedder = require(path.join("..", "functions", "context", "embedder.js")).vertexEmbedder({ projectId: "backlog-tracker-e4ed2", logger, getToken: () => auth.getAccessToken() });
  }
  const ctx = require(path.join("..", "functions", "context")).create({
    db: () => db, FieldValue, FieldPath, logger, embedder,
    origin: process.env.MCP_PUBLIC_ORIGIN || "https://backlog-tracker-e4ed2.web.app",
  });
  const started = Date.now();
  const { report, removed, pruned } = await ctx.backfill({ sources: args.sources, concurrency: 8, reembed: args.reembed, log: (line) => console.log(`  ${line}`) });
  const total = Object.values(report).reduce((n, r) => n + r.records, 0);
  const written = Object.values(report).reduce((n, r) => n + r.written, 0);
  console.log(`Indexed ${total} records (${written} written, ${total - written} unchanged), removed ${removed} entries with no record, pruned ${pruned} old tombstones and unused packs, in ${Math.round((Date.now() - started) / 1000)} s.`);
}

if (require.main === module) main().catch((err) => { console.error(`context-backfill failed: ${err && err.message ? err.message : err}`); process.exit(1); });
module.exports = { parseArgs, COLLECTIONS };
