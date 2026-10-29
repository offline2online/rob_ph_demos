// Staff Kanban notifications, fanned out on the server (KB-NAV-2, KB-MOD-3).
//
// One trigger on kanbanTasks and one on its comments subcollection write one
// kanbanNotifications doc per recipient, so the board, the MCP tools and the
// voice path all notify the same way and no client writes a notification.
// Never to the person who acted. A doc is named from the trigger's event id
// and the recipient, so a retried delivery writes nothing twice. Events:
//
//   assigned   assigned to you (create, edit, drag, kanban_assign_task, MCP create)
//   testing    handed to you for testing (moved to Ready for Testing)
//   returned   returned to you from testing
//   commented  a comment on a ticket you are assignee or reporter of, or watching
//   mention    @mentioned in a description or comment (wins over the above)
//   closed     your ticket (assignee/reporter) closed by someone else
//
// pruneReadFor() deletes one member's read notifications older than 30 days;
// it runs when that member marks notifications read (no scheduled job).
"use strict";
const { FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");
const core = require("./kanban-core");

const db = () => require("firebase-admin/firestore").getFirestore();
const COL = "kanbanNotifications";
const PRUNE_AFTER_DAYS = 30;
// A mention beats the other reasons a person has to be told about the same change.
const RANK = { mention: 3, testing: 2, returned: 2, assigned: 2, closed: 1, commented: 1 };

const clean = (e) => (e ? core.canonicalEmail(String(e).trim().toLowerCase()) : "");
const list = (v) => (Array.isArray(v) ? v : []);

// Adds one reason to the recipients map, keeping the strongest per person.
function add(map, to, kind, via) {
  const email = clean(to);
  if (!email) return;
  const cur = map.get(email);
  if (!cur || RANK[kind] > RANK[cur.kind]) map.set(email, { kind, via: via || null });
}

// What a change to a ticket tells whom: Map(email → { kind, via }).
function recipientsForTask(before, after, actor) {
  const out = new Map();
  if (!after) return out;
  const created = !before;
  const b = before || {};
  const assigneeChanged = clean(after.assignee) !== clean(b.assignee);
  if (assigneeChanged && after.assignee) {
    if (after.status === "ready-for-testing" && b.status !== "ready-for-testing") add(out, after.assignee, "testing");
    else if (b.status === "ready-for-testing" && after.status !== "ready-for-testing" && clean(after.assignee) === clean(b.previousAssignee)) add(out, after.assignee, "returned");
    else add(out, after.assignee, "assigned");
  }
  const had = new Set(list(b.mentions).map(clean));
  for (const m of list(after.mentions)) if (!had.has(clean(m))) add(out, m, "mention", "description");
  if (!created && after.status === "done" && b.status !== "done") {
    add(out, after.assignee, "closed");
    add(out, after.reporter, "closed");
  }
  out.delete(clean(actor));
  return out;
}

function recipientsForComment(task, comment) {
  const out = new Map();
  for (const e of [task.assignee, task.reporter, ...list(task.watchers)]) add(out, e, "commented");
  for (const m of list(comment.mentions)) add(out, m, "mention", "comment");
  out.delete(clean(comment.author));
  return out;
}

async function write(eventId, key, task, actor, recipients) {
  const col = db().collection(COL);
  const title = String(task.title || "").slice(0, 200);
  let written = 0;
  await Promise.all([...recipients].map(async ([to, r]) => {
    const doc = { to, from: clean(actor) || null, taskKey: key, taskTitle: title, kind: r.kind, read: false, at: FieldValue.serverTimestamp() };
    if (r.via) doc.via = r.via;
    try { await col.doc(`${eventId}_${to.replace(/[^a-z0-9]/g, "_")}`).create(doc); written++; }
    catch (err) { if (err && (err.code === 6 || /ALREADY_EXISTS/.test(String(err.message)))) return; throw err; }
  }));
  return written;
}

// onDocumentWritten("kanbanTasks/{key}")
async function taskWritten(event) {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  if (!after) return null;
  const actor = after.updatedBy || after.createdBy || "";
  const recipients = recipientsForTask(before, after, actor);
  if (!recipients.size) return null;
  return write(event.id, event.params.key, after, actor, recipients);
}

// A comment's creation: { id, params: { key }, data: DocumentSnapshot }
async function commentCreated(event) {
  const comment = event.data.data();
  const snap = await db().collection("kanbanTasks").doc(event.params.key).get();
  if (!snap.exists) return null;
  const task = snap.data();
  const recipients = recipientsForComment(task, comment);
  if (!recipients.size) return null;
  return write(event.id, event.params.key, task, comment.author, recipients);
}

// A member's read notifications older than 30 days go; unread ones stay until
// read. One query (to, read, at), at most 200 a time, run on the member's own
// "mark read" so no scheduled job is needed. Best effort: an index still
// building, or any other failure, never fails the mark-read.
const PRUNE_BATCH = 200;
async function pruneReadFor(email, now = Date.now()) {
  try {
    const cutoff = new Date(now - PRUNE_AFTER_DAYS * 86400000);
    const snap = await db().collection(COL).where("to", "==", email).where("read", "==", true).where("at", "<", cutoff).limit(PRUNE_BATCH).get();
    if (snap.empty) return 0;
    const b = db().batch();
    snap.docs.forEach((d) => b.delete(d.ref));
    await b.commit();
    return snap.size;
  } catch (err) {
    logger.warn("kanban notifications not pruned", { email, error: String(err && err.message ? err.message : err) });
    return 0;
  }
}

module.exports = { taskWritten, commentCreated, pruneReadFor, recipientsForTask, recipientsForComment, PRUNE_AFTER_DAYS, PRUNE_BATCH };
