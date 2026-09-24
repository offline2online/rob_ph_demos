// Permanently remove a project from the PH Agent Console, together with
// everything in Firestore that points at it.
//
//   node delete-projects.js --project <id> [--project <id> ...]   # dry run
//   node delete-projects.js --project <id> --apply                # deletes
//
// The console's own UI deliberately has no such button — archiveProject()
// in public/js/app.js hides a project and keeps its data, which is the
// right default. This is the other thing: a project that was created
// speculatively, never used, and should stop appearing in list_projects
// for every agent that connects over MCP. It is irreversible, so:
//
//   * Every run — dry or real — writes a full JSON export of everything it
//     would delete (--out, default backlog-tracker/backups/). Restoring is
//     then a matter of writing those documents back.
//   * A dry run is the default. Deleting needs --apply.
//   * It refuses a project that still has a non-archived ticket, and one
//     whose interface contract names a project that is NOT being deleted —
//     removing that record would silently take the contract away from the
//     surviving side too. --force overrides either, deliberately loudly.
//   * After deleting it re-queries every collection and fails if anything
//     is left, so "it said it worked" and "it worked" are the same claim.
//
// Runs on a runner (.github/workflows/board-admin.yml), where the service
// account credential already is — see the root CLAUDE.md, "The board's key
// lives in GitHub, not on anyone's laptop".
const fs = require("fs");
const path = require("path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// Collections holding documents that belong to exactly one project, keyed
// by a plain projectId field. Deleted with their project.
const OWNED_BY_PROJECT = ["backlogItems", "projectDocs", "docRevisions"];
// interfaces are the exception: projectIds is an array naming both sides.
const SHARED = "interfaces";

function parseArgs(argv) {
  const out = { projects: [], apply: false, force: false, outDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") out.projects.push(String(argv[++i] || "").trim());
    else if (a === "--apply") out.apply = true;
    else if (a === "--force") out.force = true;
    else if (a === "--out") out.outDir = String(argv[++i] || "").trim();
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  out.projects = out.projects.filter(Boolean);
  return out;
}

const plain = (v) => JSON.parse(JSON.stringify(v, (_k, val) => {
  if (val && typeof val.toDate === "function") return val.toDate().toISOString();
  return val;
}));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.projects.length) {
    console.log("usage: node delete-projects.js --project <id> [--project <id> ...] [--apply] [--force] [--out <dir>]");
    process.exit(args.help ? 0 : 2);
  }

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const targets = new Set(args.projects);

  // ── Gather ───────────────────────────────────────────────────────────
  const plan = [];
  const problems = [];
  for (const id of args.projects) {
    const snap = await db.collection("projects").doc(id).get();
    if (!snap.exists) { problems.push(`${id}: no such project`); continue; }
    const entry = { id, project: plain({ id, ...snap.data() }), owned: {}, interfaces: [] };

    for (const coll of OWNED_BY_PROJECT) {
      const docs = await db.collection(coll).where("projectId", "==", id).get();
      entry.owned[coll] = docs.docs.map((d) => plain({ id: d.id, ...d.data() }));
    }
    const live = entry.owned.backlogItems.filter((i) => i.status && i.status !== "archived");
    if (live.length) problems.push(`${id} (${entry.project.name}): ${live.length} ticket(s) are still in the pipeline, not archived`);

    const ifaces = await db.collection(SHARED).where("projectIds", "array-contains", id).get();
    for (const d of ifaces.docs) {
      const data = plain({ id: d.id, ...d.data() });
      entry.interfaces.push(data);
      const survivors = (data.projectIds || []).filter((p) => !targets.has(p));
      if (survivors.length) problems.push(`${id} (${entry.project.name}): interface "${data.name}" is shared with ${survivors.join(", ")}, which is not being deleted`);
    }
    plan.push(entry);
  }

  // ── Export, always, before anything is touched ───────────────────────
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  const outDir = args.outDir || path.resolve(__dirname, "../backups");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `deleted-projects-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify({
    exportedAt: new Date().toISOString(),
    applied: args.apply && !problems.length,
    requested: args.projects,
    projects: plan,
  }, null, 2) + "\n");

  // ── Say exactly what this is ─────────────────────────────────────────
  for (const e of plan) {
    const counts = OWNED_BY_PROJECT.map((c) => `${e.owned[c].length} ${c}`).concat(`${e.interfaces.length} interfaces`);
    console.log(`${e.id}  ${e.project.name}`);
    console.log(`    ${counts.join(", ")}`);
  }
  const missing = args.projects.filter((id) => !plan.some((e) => e.id === id));
  for (const id of missing) console.log(`${id}  — not found`);
  console.log(`\nExport written to ${outFile}`);

  if (problems.length && !args.force) {
    console.error("\nRefusing to delete:");
    for (const p of problems) console.error(`  - ${p}`);
    console.error("\nPass --force only if each of those is genuinely intended.");
    process.exit(1);
  }
  if (problems.length) {
    console.warn("\n--force given, proceeding despite:");
    for (const p of problems) console.warn(`  - ${p}`);
  }
  if (!plan.length) { console.error("\nNothing to delete."); process.exit(1); }

  if (!args.apply) {
    console.log("\nDry run — nothing was deleted. Re-run with --apply to delete.");
    return;
  }

  // ── Delete: dependants first, the project doc last, so an interrupted
  // run never leaves a live project pointing at half-removed data. ─────
  let deleted = 0;
  for (const e of plan) {
    for (const coll of OWNED_BY_PROJECT) {
      for (const d of e.owned[coll]) { await db.collection(coll).doc(d.id).delete(); deleted++; }
    }
    for (const d of e.interfaces) { await db.collection(SHARED).doc(d.id).delete(); deleted++; }
    await db.collection("projects").doc(e.id).delete(); deleted++;
    console.log(`Deleted ${e.project.name} (${e.id})`);
  }

  // ── Verify, rather than assume ───────────────────────────────────────
  const left = [];
  for (const e of plan) {
    if ((await db.collection("projects").doc(e.id).get()).exists) left.push(`projects/${e.id}`);
    for (const coll of OWNED_BY_PROJECT) {
      const snap = await db.collection(coll).where("projectId", "==", e.id).get();
      if (!snap.empty) left.push(`${coll} × ${snap.size} still point at ${e.id}`);
    }
    const snap = await db.collection(SHARED).where("projectIds", "array-contains", e.id).get();
    if (!snap.empty) left.push(`${SHARED} × ${snap.size} still name ${e.id}`);
  }
  if (left.length) {
    console.error("\nVerification failed — still present:");
    for (const l of left) console.error(`  - ${l}`);
    process.exit(1);
  }
  console.log(`\n${deleted} document(s) deleted and verified gone. Recovery copy: ${outFile}`);
}

main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
