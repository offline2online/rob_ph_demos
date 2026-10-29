// Staff Kanban: the Firestore / Storage data layer behind kanban-page.js.
//
// Collections (see kanban-staff-board/REQUIREMENTS.md §12 and the matching
// blocks in ../../firestore.rules / ../../storage.rules):
//   kanbanTasks/{PH-n}                 one ticket, in full; the doc id is its key
//   kanbanCards/{PH-n}                 the light copy the board reads: only what a
//                                      card shows (core.cardOf). Written in the
//                                      same batch as its ticket, by every writer
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
// Loading (KB §13 performance): the cards of every open ticket, of the 300
// most recently closed, and — when a release is picked — of everything in that
// release. All single-field queries, so no composite index is needed. The full
// ticket (description, links, attachments) is read when its modal opens. While
// kanbanCards is behind kanbanTasks (before the server's backfill has run) the
// board reads kanbanTasks, so no ticket ever disappears.
import {
  collection, doc, getDoc, getDocs, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, writeBatch, runTransaction, increment, deleteField, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { ref as storageRef, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import {
  searchTokens, htmlToText, mentionsIn, keyOf, keyNumber, normaliseSettings, queryToken,
  cardOf, cardPatchOf, externaliseInlineImages, dataUriParts,
} from "./kanban-core.js";

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
    attachmentCount: Array.isArray(d.attachments) ? d.attachments.length : typeof d.attachmentCount === "number" ? d.attachmentCount : 0,
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

// backfill: asks the server to fill kanbanCards from kanbanTasks (idempotent).
export function createStore({ db, storage, me, backfill = null, onChange = () => {}, onError = () => {} }) {
  const tasks = new Map();       // key -> card (open + closed + release): the board
  const extra = new Map();       // key -> task fetched on demand: never on the board
  const full = new Map();        // key -> the full ticket, as last read or saved
  const texts = new Map();       // key -> description text, from the server's search hits
  const sources = new Map();     // key -> Set of listener names that hold it
  let boardColl = "kanbanCards"; // "kanbanTasks" while the cards are behind
  const state = {
    tasks, extra, texts, settings: normaliseSettings(null), settingsLoaded: false, sprints: [], members: [], membersLoaded: false,
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
  const cardsRef = collection(db, "kanbanCards");
  const boardRef = () => collection(db, boardColl);
  const cardDoc = (key) => doc(db, "kanbanCards", key);
  const listen = (name, q, after) => onSnapshot(q, (snap) => { absorb(name, snap); if (after) after(); changed("tasks"); }, (err) => onError(err));

  // The board's two listeners (open tickets, the latest closed), on the cards
  // or, while they are behind, on the tickets.
  let boardUnsubs = [];
  function listenBoard() {
    boardUnsubs.splice(0).forEach((u) => u());
    boardUnsubs.push(listen("open", query(boardRef(), where("open", "==", true)), () => { state.ready.open = true; }));
    boardUnsubs.push(listen("closed", query(boardRef(), orderBy("closedAt", "desc"), limit(CLOSED_LIMIT)), () => { state.ready.closed = true; }));
    if (releaseWatched) { const r = releaseWatched; releaseWatched = ""; watchRelease(r); }
  }
  const countOf = async (ref) => (await getCountFromServer(ref)).data().count;
  const cardsBehind = async () => (await countOf(cardsRef)) < (await countOf(tasksRef));
  // Which collection the board reads. Behind: read the tickets, ask the server
  // to fill the cards, and move to them when they have caught up.
  async function chooseBoard() {
    let behind = false;
    try { behind = await cardsBehind(); } catch (e) { behind = true; }
    boardColl = behind ? "kanbanTasks" : "kanbanCards";
    listenBoard();
    if (!behind || !backfill) return;
    try {
      await backfill();
      if (!(await cardsBehind())) { boardColl = "kanbanCards"; listenBoard(); changed("tasks"); }
    } catch (e) { console.warn("staff kanban: card backfill:", e); }
  }

  function start() {
    unsubs.push(() => boardUnsubs.splice(0).forEach((u) => u()));
    chooseBoard();
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
    if (releaseId) releaseUnsub = listen("release", query(boardRef(), where("release", "==", releaseId)));
  }

  // ── Reads on demand ──────────────────────────────────────────────────
  // The full ticket, read fresh: what the board holds is only its card.
  async function fetchTask(key) {
    const s = await getDoc(doc(db, "kanbanTasks", key));
    if (!s.exists()) { full.delete(key); return null; }
    const t = taskFromDoc(s.id, s.data());
    full.set(key, t);
    pin([t]);
    return t;
  }
  // A ticket's full record as the page last read or saved it (else the card).
  const getFull = (key) => full.get(key) || get(key);
  async function fetchChildren(epicKey) {
    const snap = await getDocs(query(boardRef(), where("epic", "==", epicKey)));
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
    for (const t of list) texts.set(t.key, t.descriptionText);
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

  // The card of a ticket, written in the same batch or transaction as the
  // ticket itself. On the cards (the usual case) only the changed fields are
  // merged, so a concurrent change to another field is kept; while the cards
  // are behind, the whole card is written from the ticket.
  function cardOps(b, key, cur, patch, closed) {
    const part = cardPatchOf(patch);
    const data = boardColl === "kanbanCards" && cur && tasks.has(key) ? part : { ...cardOf({ ...cur, ...patch, key }), ...part };
    Object.assign(data, closed || {}, stamp());
    b.set(cardDoc(key), data, { merge: true });
  }
  // What a write needs of a ticket that the board may not hold.
  async function ensure(key) { return get(key) || full.get(key) || (await fetchTask(key)) || {}; }

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
      tx.set(cardDoc(key), { ...cardOf({ ...t, key, ...data }), ...(data.open ? {} : { closedAt: data.closedAt }), ...stamp() });
      return key;
    });
    if (activity && activity.length) { const b = writeBatch(db); activityOps(b, key, activity); await b.commit(); }
    return key;
  }

  // patch: stored fields to change; activity: lines for the log. Other
  // tickets' patches (an epic's children) ride in the same batch.
  async function updateTask(key, patch, activity, others = []) {
    const b = writeBatch(db);
    const cur = (await ensure(key));
    // Search words come from the description, which a card doesn't hold.
    const derive = DERIVED_FROM.some((k) => k in patch);
    const whole = derive && !("description" in patch) ? (await fetchTask(key)) || cur : cur;
    const data = { ...storedPatch(patch), ...stamp() };
    if (derive) Object.assign(data, derivedFields({ ...whole, ...patch, key }));
    const closed = "status" in patch ? statusExtras(patch.status) : null;
    if (closed) Object.assign(data, closed);
    b.update(doc(db, "kanbanTasks", key), data);
    cardOps(b, key, cur, patch, closed);
    activityOps(b, key, activity);
    const kids = [];
    for (const o of others) {
      kids.push([o.key, await ensure(o.key)]);
      b.update(doc(db, "kanbanTasks", o.key), { ...storedPatch(o.patch), ...stamp() });
      cardOps(b, o.key, kids[kids.length - 1][1], o.patch, null);
      activityOps(b, o.key, o.activity);
    }
    // Optimistic: the listener's echo replaces this a moment later; a failed
    // write puts the old values back.
    const before = [[key, get(key)], ...others.map((o) => [o.key, get(o.key)])];
    const put = (k, v) => { if (!v) return; (tasks.has(k) ? tasks : extra).set(k, v); };
    const withCount = (t, p) => ({ ...t, ...p, ...("attachments" in p ? { attachmentCount: (p.attachments || []).length } : {}) });
    put(key, cur.key ? withCount(cur, patch) : null);
    for (const o of others) { const t = get(o.key); put(o.key, t ? withCount(t, o.patch) : null); }
    const fullBefore = full.get(key);
    if (fullBefore) full.set(key, { ...withCount(fullBefore, patch), ...(derive ? { descriptionText: data.descriptionText } : {}) });
    try { await b.commit(); }
    catch (err) { for (const [k, v] of before) put(k, v); if (fullBefore) full.set(key, fullBefore); changed("tasks"); throw err; }
  }

  // Deleting an epic unlinks its children (KB-TASK-7).
  async function deleteTask(key) {
    const kids = await fetchChildren(key);
    const b = writeBatch(db);
    for (const k of kids) {
      b.update(doc(db, "kanbanTasks", k.key), { epic: "", ...stamp() });
      cardOps(b, k.key, k, { epic: "" });
      activityOps(b, k.key, [`removed from epic ${key} (deleted)`]);
    }
    b.delete(doc(db, "kanbanTasks", key));
    b.delete(cardDoc(key));
    await b.commit();
    tasks.delete(key); extra.delete(key); full.delete(key); sources.delete(key);
    changed("tasks");
  }

  async function addComment(key, { html, text }, notifyTo = [], title = "") {
    const b = writeBatch(db);
    b.set(doc(collection(db, "kanbanTasks", key, "comments")), { author: me, html, text: String(text || "").slice(0, 20000), mentions: mentionsIn(html), at: serverTimestamp() });
    b.update(doc(db, "kanbanTasks", key), { commentCount: increment(1), ...stamp() });
    // (the card counts it too; before the cards are filled the count is written whole)
    const cur = await ensure(key);
    b.set(cardDoc(key), boardColl === "kanbanCards" && tasks.has(key)
      ? { commentCount: increment(1), ...stamp() }
      : { ...cardOf({ ...cur, key }), commentCount: (cur.commentCount || 0) + 1, ...stamp() }, { merge: true });
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

  // Inline screenshots in a description (a paste the editor kept as a data:
  // URI) go to Storage and the description holds their URLs. Returns the new HTML.
  async function externaliseImages(key, html) {
    return externaliseInlineImages(html, async (uri) => {
      const parts = dataUriParts(uri);
      if (!parts) return uri;
      const bin = atob(parts.base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const ext = (parts.contentType.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "png";
      return (await upload(key, new Blob([bytes], { type: parts.contentType }), `screenshot.${ext}`)).url;
    });
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
    state, get, getFull, start, stop, watchRelease, fetchTask, fetchChildren, searchServer, watchComments, watchActivity,
    createTask, updateTask, deleteTask, addComment, notify, markRead, upload, externaliseImages, saveSettings, addSprint, backfill: () => (backfill ? backfill() : Promise.resolve()),
  };
}
