// Folds every alias address (PERSON_ALIASES in public/js/kanban/kanban-core.js)
// into its owner on the board's data. Run by the deploy workflow on every
// deploy; it is idempotent, so a run with nothing to fold writes nothing.
//
//   GOOGLE_APPLICATION_CREDENTIALS=<sa.json> node apply-person-aliases.js [--dry]
//
// For each alias → owner it:
//   - deletes consoleUsers/<alias> (Settings → Team & agent access) and
//     memberDirectory/<alias>, so the alias is not a second person. An alias
//     that is an owner account in firestore.rules can still sign in; the
//     board treats it as its owner (functions/kanban.js, kanban-page.js).
//   - re-points Staff Kanban tickets (assignee, reporter, previousAssignee,
//     createdBy, updatedBy), their comments' authors and mentions, and
//     mention notifications from the alias to the owner;
//   - moves the alias's "Shown as" first name and the tester setting across,
//     and names the owner "Rob"-style from the address when nothing names them.
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, FieldValue, FieldPath } = require("firebase-admin/firestore");
const { PERSON_ALIASES } = require("../functions/kanban-core.js");

const DRY = process.argv.includes("--dry");
const TASK_PEOPLE = ["assignee", "reporter", "previousAssignee", "createdBy", "updatedBy"];

async function main() {
  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();
  const pending = [];
  const write = (what, fn) => { console.log(`apply-person-aliases: ${DRY ? "would " : ""}${what}`); if (!DRY) pending.push(fn); };

  for (const [alias, owner] of Object.entries(PERSON_ALIASES)) {
    for (const coll of ["consoleUsers", "memberDirectory"]) {
      const ref = db.collection(coll).doc(alias);
      if ((await ref.get()).exists) write(`delete ${coll}/${alias}`, () => ref.delete());
    }

    const tasks = await db.collection("kanbanTasks").get();
    for (const t of tasks.docs) {
      const d = t.data() || {};
      const patch = {};
      for (const f of TASK_PEOPLE) if (String(d[f] || "").toLowerCase() === alias) patch[f] = owner;
      if (Array.isArray(d.mentions) && d.mentions.includes(alias)) patch.mentions = [...new Set(d.mentions.map((m) => (m === alias ? owner : m)))];
      if (Object.keys(patch).length) write(`kanbanTasks/${t.id}: ${Object.keys(patch).join(", ")} → ${owner}`, () => t.ref.update(patch));
      const comments = await t.ref.collection("comments").get();
      for (const c of comments.docs) {
        const cd = c.data() || {};
        const cp = {};
        if (String(cd.author || "").toLowerCase() === alias) cp.author = owner;
        if (Array.isArray(cd.mentions) && cd.mentions.includes(alias)) cp.mentions = [...new Set(cd.mentions.map((m) => (m === alias ? owner : m)))];
        if (Object.keys(cp).length) write(`kanbanTasks/${t.id}/comments/${c.id}: ${Object.keys(cp).join(", ")} → ${owner}`, () => c.ref.update(cp));
      }
    }

    for (const f of ["to", "from"]) {
      const notes = await db.collection("kanbanNotifications").where(f, "==", alias).get();
      for (const n of notes.docs) {
        // A note from the owner to their own alias is a note to themselves.
        const other = f === "to" ? n.data().from : n.data().to;
        if (other === owner) write(`delete kanbanNotifications/${n.id} (owner to self)`, () => n.ref.delete());
        else write(`kanbanNotifications/${n.id}: ${f} → ${owner}`, () => n.ref.update({ [f]: owner }));
      }
    }

    const settingsRef = db.collection("kanbanSettings").doc("main");
    const settingsSnap = await settingsRef.get();
    const settings = settingsSnap.data() || {};
    const names = settings.firstNames || {};
    const sp = {};
    if (names[alias] != null) {
      sp[`firstNames.${alias}`] = FieldValue.delete();
      if (!String(names[owner] || "").trim()) sp[`firstNames.${owner}`] = names[alias];
    }
    if (!String(names[owner] || "").trim() && !String(names[alias] || "").trim()) {
      const dir = (await db.collection("memberDirectory").doc(owner).get()).data() || {};
      if (!String(dir.displayName || "").trim()) {
        const local = owner.split("@")[0];
        sp[`firstNames.${owner}`] = local.charAt(0).toUpperCase() + local.slice(1);
      }
    }
    if (settings.tester === alias) sp.tester = owner;
    // An email has dots in it, so a firstNames key goes through FieldPath.
    if (Object.keys(sp).length) {
      const args = [];
      for (const [k, v] of Object.entries(sp)) args.push(k.startsWith("firstNames.") ? new FieldPath("firstNames", k.slice("firstNames.".length)) : k, v);
      write(`kanbanSettings/main: ${Object.keys(sp).join(", ")}`, () => (settingsSnap.exists
        ? settingsRef.update(...args)
        : settingsRef.set({ firstNames: { [owner]: sp[`firstNames.${owner}`] } }, { merge: true })));
    }
  }

  for (const fn of pending) await fn();
  console.log(`apply-person-aliases: ${DRY ? "dry run, " : ""}${pending.length} write(s)`);
}

main().catch((err) => { console.error("apply-person-aliases failed:", err); process.exit(1); });
