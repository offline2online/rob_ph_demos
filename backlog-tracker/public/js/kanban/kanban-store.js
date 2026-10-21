// Staff Kanban: the Firestore / Storage data layer behind kanban-page.js.
//
// Collections (see kanban-staff-board/REQUIREMENTS.md §12 and the matching
// blocks in ../../firestore.rules / ../../storage.rules):
//   kanbanTasks/{PH-n}                 one ticket; the doc id is its key
//   kanbanTasks/{PH-n}/comments/{id}   comments (rich HTML + plain text)
//   kanbanTasks/{PH-n}/activity/{id}   append-only log: moves, hand-offs, flags
//   kanbanCounters/main                nextNumber, taken in a transaction
//   kanbanSettings/main                field settings, tester, current release
//   kanbanSprints/{id}                 name, start, end
//   kanbanNotifications/{id}           @mentions, one per recipient
//   memberDirectory/{email}            names and photos of every member,
//                                      kept by functions/index.js (the full
//                                      consoleUsers list is admin-only)
//   Storage kanban/{PH-n}/…            screenshots, recordings, attachments
//
// Loading (KB §13 performance): every open ticket, the 300 most recently
// closed, and — when a release is picked — everything in that release. All
// single-field queries, so no composite index is needed.
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, writeBatch, runTransaction, increment, deleteField,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { searchTokens, htmlToText, mentionsIn, keyOf, keyNumber, normaliseSettings, queryToken } from "./kanban-core.js";

export const CLOSED_LIMIT = 300;
export const SERVER_SEARCH_LIMIT = 200;

// Firestore Timestamp | Date | ISO string | millis → ISO string ("" if none).
export function isoOf(v) {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (typeof v.toMillis === "function") return new Date(v.toMillis()).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number") return new Date(v).toISOString();
  return "";
}

// A stored task as the page uses it (the prototype's shape).
export function taskFromDoc(id, d) {
  return {
    key: id,
    number: typeof d.number === "number" ? d.number : keyNumber(id),
    type: d.type || "task",
    title: d.title || "",
    description: d.description || "",
    descriptionText: d.descriptionText || "",
    status: d.status || "backlog",
    resolution: d.resolution || null,
    rank: typeof d.rank === "number" ? d.rank : 0,
    assignee: d.assignee || "",
    previousAssignee: d.previousAssignee || "",
    reporter: d.reporter || "",
    release: d.release || "",
    sprint: d.sprint || "",
    estimate: typeof d.estimate === "number" ? d.estimate : "",
    logged: typeof d.logged === "number" ? d.logged : 0,
    priority: d.priority || "",
    due: d.due || "",
    labels: Array.isArray(d.labels) ? d.labels : [],
    epic: d.epic || "",
    links: Array.isArray(d.links) ? d.links : [],
    flagged: !!d.flagged,
    attachments: Array.isArray(d.attachments) ? d.attachments : [],
    commentCount: typeof d.commentCount === "number" ? d.commentCount : 0,
    created: isoOf(d.createdAt),
    createdBy: d.createdBy || "",
    updated: isoOf(d.updatedAt),
  };
}

// Derived fields every write that touches their sources must refresh.
export function derivedFields(t) {
  const descriptionText = htmlToText(t.description || "").slice(0, 20000);
  return {
    descriptionText,
    mentions: mentionsIn(t.description || ""),
    searchTokens: searchTokens({ key: t.key, title: t.title, labels: t.labels, descriptionText }),
  };
}
const DERIVED_FROM = ["title", "description", "labels"];

// The fields of a task that are stored as they are.
export const STORED_FIELDS = ["type", "title", "description", "status", "resolution", "rank", "assignee", "previousAssignee", "reporter", "release", "sprint", "estimate", "logged", "priority", "due", "labels", "epic", "links", "flagged", "attachments"];

export function createStore({ db, storage, me, onChange = () => {}, onError = () => {} }) {
  const tasks = new Map();       // key -> task (open + closed + release): the board
  const extra = new Map();       // key -> task fetched on demand: never on the board
  const sources = new Map();     // key -> Set of listener names that hold it
  const state = {
    tasks, extra, settings: normaliseSettings(null), settingsLoaded: false, sprints: [], members: [], membersLoaded: false,
    notifications: [], ready: { open: false, closed: false },
  };
  const unsubs = [];
  let releaseUnsub = null, releaseWatched = "";
  const changed = (what) => { try { onChange(what); } catch (e) { onError(e); } };

  function absorb(name, snap) {
    const seen = new Set();
    snap.forEach((d) => {
      seen.add(d.id);
      tasks.set(d.id, taskFromDoc(d.id, d.data({ serverTimestamps: "estimate" })));
      if (!sources.has(d.id)) sources.set(d.id, new Set());
      sources.get(d.id).add(name);
    });
    for (const [key, set] of sources) {
      if (set.has(name) && !seen.has(key)) {
        set.delete(name);
        if (!set.size) { sources.delete(key); tasks.delete(key); }
      }
    }
  }
  // Tickets fetched on demand (an epic's children, a linked ticket, a search
  // hit) are kept beside the board's own, so they can be named and opened
  // without appearing in its columns.
  function pin(list) { for (const t of list) if (!tasks.has(t.key)) extra.set(t.key, t); }
  const get = (key) => tasks.get(key) || extra.get(key) || null;

  const tasksRef = collection(db, "kanbanTasks");
  const listen = (name, q, after) => onSnapshot(q, (snap) => { absorb(name, snap); if (after) after(); changed("tasks"); }, (err) => onError(err));

  function start() {
    unsubs.push(listen("open", query(tasksRef, where("open", "==", true)), () => { state.ready.open = true; }));
    unsubs.push(listen("closed", query(tasksRef, orderBy("closedAt", "desc"), limit(CLOSED_LIMIT)), () => { state.ready.closed = true; }));
    unsubs.push(onSnapshot(doc(db, "kanbanSettings", "main"), (s) => {
      state.settings = normaliseSettings(s.exists() ? s.data() : null);
      state.settingsLoaded = true;
      changed("settings");
    }, onError));
    unsubs.push(onSnapshot(collection(db, "kanbanSprints"), (snap) => {
      state.sprints = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
      changed("sprints");
    }, onError));
    unsubs.push(onSnapshot(collection(db, "memberDirectory"), (snap) => {
      state.members = snap.docs.map((d) => ({ email: d.id, ...d.data() })).filter((m) => !m.disabled);
      state.membersLoaded = true;
      changed("members");
    }, onError));
    unsubs.push(onSnapshot(query(collection(db, "kanbanNotifications"), where("to", "==", me), limit(100)), (snap) => {
      state.notifications = snap.docs.map((d) => ({ id: d.id, ...d.data(), at: isoOf(d.data({ serverTimestamps: "estimate" }).at) })).sort((a, b) => b.at.localeCompare(a.at));
      changed("notifications");
    }, onError));
  }
  function stop() { unsubs.splice(0).forEach((u) => u()); if (releaseUnsub) releaseUnsub(); releaseUnsub = null; releaseWatched = ""; }

  // Every ticket of one release, closed ones included (the board's Release filter).
  function watchRelease(releaseId) {
    if (releaseId === releaseWatched) return;
    if (releaseUnsub) { releaseUnsub(); releaseUnsub = null; absorb("release", { forEach() {} }); }
    releaseWatched = releaseId || "";
    if (releaseId) releaseUnsub = listen("release", query(tasksRef, where("release", "==", releaseId)));
  }

  // ── Reads on demand ──────────────────────────────────────────────────
  async function fetchTask(key) {
    const s = await getDoc(doc(db, "kanbanTasks", key));
    if (!s.exists()) return null;
    const t = taskFromDoc(s.id, s.data());
    pin([t]);
    return t;
  }
  async function fetchChildren(epicKey) {
    const snap = await getDocs(query(tasksRef, where("epic", "==", epicKey)));
    const list = snap.docs.map((d) => taskFromDoc(d.id, d.data()));
    pin(list);
    return list;
  }
  // KB-TASK-6: one array-contains query on searchTokens, capped; the page
  // ranks the result together with what it already holds.
  async function searchServer(q) {
    const token = queryToken(q);
    if (!token) return [];
    const snap = await getDocs(query(tasksRef, where("searchTokens", "array-contains", token), limit(SERVER_SEARCH_LIMIT)));
    const list = snap.docs.map((d) => taskFromDoc(d.id, d.data()));
    pin(list);
    return list;
  }
  function watchComments(key, cb) {
    return onSnapshot(collection(db, "kanbanTasks", key, "comments"), (snap) => {
      cb(snap.docs.map((d) => { const x = d.data({ serverTimestamps: "estimate" }); return { id: d.id, author: x.author, html: x.html || "", text: x.text || "", at: isoOf(x.at) }; }));
    }, onError);
  }
  function watchActivity(key, cb) {
    return onSnapshot(collection(db, "kanbanTasks", key, "activity"), (snap) => {
      cb(snap.docs.map((d) => { const x = d.data({ serverTimestamps: "estimate" }); return { id: d.id, who: x.who, text: x.text || "", at: isoOf(x.at) }; }));
    }, onError);
  }

  // ── Writes ───────────────────────────────────────────────────────────
  const stamp = () => ({ updatedAt: serverTimestamp(), updatedBy: me });
  function activityOps(batch, key, texts) {
    for (const text of texts || []) {
      if (!text) continue;
      batch.set(doc(collection(db, "kanbanTasks", key, "activity")), { who: me, text: String(text).slice(0, 500), at: serverTimestamp() });
    }
  }
  function statusExtras(status) {
    return status === "done" ? { open: false, closedAt: serverTimestamp() } : { open: true, closedAt: deleteField() };
  }
  function storedPatch(patch) {
    const out = {};
    for (const k of STORED_FIELDS) if (k in patch) out[k] = patch[k] === undefined ? null : patch[k];
    if ("estimate" in out && (out.estimate === "" || out.estimate == null)) out.estimate = null;
    if ("resolution" in out && !out.resolution) out.resolution = null;
    return out;
  }

  // New ticket: PH-n from the counter, in one transaction (KB-TASK-1).
  async function createTask(fields, activity) {
    const counterRef = doc(db, "kanbanCounters", "main");
    const key = await runTransaction(db, async (tx) => {
      const c = await tx.get(counterRef);
      const n = c.exists() && typeof c.data().nextNumber === "number" ? c.data().nextNumber : 1;
      const key = keyOf(n);
      const t = { ...fields, key };
      const data = {
        ...storedPatch(t), ...derivedFields(t),
        key, number: n, status: t.status || "backlog", ...statusExtras(t.status || "backlog"),
        commentCount: 0, createdAt: serverTimestamp(), createdBy: me, ...stamp(),
      };
      if (data.closedAt && data.open) delete data.closedAt;
      if (data.open) delete data.closedAt;
      tx.set(counterRef, { nextNumber: n + 1, updatedAt: serverTimestamp() });
      tx.set(doc(db, "kanbanTasks", key), data);
      return key;
    });
    if (activity && activity.length) { const b = writeBatch(db); activityOps(b, key, activity); await b.commit(); }
    return key;
  }

  // patch: stored fields to change; activity: lines for the log. Other
  // tickets' patches (an epic's children) ride in the same batch.
  async function updateTask(key, patch, activity, others = []) {
    const b = writeBatch(db);
    const cur = get(key) || {};
    const data = { ...storedPatch(patch), ...stamp() };
    if (DERIVED_FROM.some((k) => k in patch)) Object.assign(data, derivedFields({ ...cur, ...patch, key }));
    if ("status" in patch) Object.assign(data, statusExtras(patch.status));
    b.update(doc(db, "kanbanTasks", key), data);
    activityOps(b, key, activity);
    for (const o of others) {
      b.update(doc(db, "kanbanTasks", o.key), { ...storedPatch(o.patch), ...stamp() });
      activityOps(b, o.key, o.activity);
    }
    // Optimistic: the listener's echo replaces this a moment later; a failed
    // write puts the old values back.
    const before = [[key, get(key)], ...others.map((o) => [o.key, get(o.key)])];
    const put = (k, v) => { if (!v) return; (tasks.has(k) ? tasks : extra).set(k, v); };
    put(key, cur.key ? { ...cur, ...patch } : null);
    for (const o of others) { const t = get(o.key); put(o.key, t ? { ...t, ...o.patch } : null); }
    try { await b.commit(); }
    catch (err) { for (const [k, v] of before) put(k, v); changed("tasks"); throw err; }
  }

  // Deleting an epic unlinks its children (KB-TASK-7).
  async function deleteTask(key) {
    const kids = await fetchChildren(key);
    const b = writeBatch(db);
    for (const k of kids) {
      b.update(doc(db, "kanbanTasks", k.key), { epic: "", ...stamp() });
      activityOps(b, k.key, [`removed from epic ${key} (deleted)`]);
    }
    b.delete(doc(db, "kanbanTasks", key));
    await b.commit();
    tasks.delete(key); extra.delete(key); sources.delete(key);
    changed("tasks");
  }

  async function addComment(key, { html, text }, notifyTo = [], title = "") {
    const b = writeBatch(db);
    b.set(doc(collection(db, "kanbanTasks", key, "comments")), { author: me, html, text: String(text || "").slice(0, 20000), mentions: mentionsIn(html), at: serverTimestamp() });
    b.update(doc(db, "kanbanTasks", key), { commentCount: increment(1), ...stamp() });
    notifyOps(b, notifyTo, key, title, "comment");
    await b.commit();
  }

  // @mention notifications (KB-MOD-3): one doc per recipient.
  function notifyOps(b, to, key, title, kind) {
    for (const email of [...new Set(to)].filter((e) => e && e !== me)) {
      b.set(doc(collection(db, "kanbanNotifications")), { to: email, from: me, taskKey: key, taskTitle: String(title || "").slice(0, 200), kind, read: false, at: serverTimestamp() });
    }
  }
  async function notify(to, key, title, kind = "description") {
    if (!to.length) return;
    const b = writeBatch(db);
    notifyOps(b, to, key, title, kind);
    await b.commit();
  }
  async function markRead(ids) {
    const b = writeBatch(db);
    for (const id of ids) b.update(doc(db, "kanbanNotifications", id), { read: true });
    await b.commit();
  }

  async function upload(key, blob, name) {
    const safe = String(name || "file").replace(/[^\w.\-]+/g, "_").slice(-80);
    const path = `kanban/${key || "new"}/${Date.now()}-${safe}`;
    const r = storageRef(storage, path);
    await uploadBytes(r, blob, { contentType: blob.type || "application/octet-stream" });
    return { url: await getDownloadURL(r), path };
  }

  async function saveSettings(patch) {
    const b = writeBatch(db);
    b.set(doc(db, "kanbanSettings", "main"), { ...patch, updatedAt: serverTimestamp(), updatedBy: me }, { merge: true });
    await b.commit();
  }
  async function addSprint({ name, start, end }) {
    const b = writeBatch(db);
    b.set(doc(collection(db, "kanbanSprints")), { name: String(name).trim().slice(0, 80), start: start || "", end: end || "", createdAt: serverTimestamp(), createdBy: me });
    await b.commit();
  }

  return {
    state, get, start, stop, watchRelease, fetchTask, fetchChildren, searchServer, watchComments, watchActivity,
    createTask, updateTask, deleteTask, addComment, notify, markRead, upload, saveSettings, addSprint,
  };
}
