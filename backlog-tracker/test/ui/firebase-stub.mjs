// One in-memory stand-in for the four Firebase SDK modules the console loads
// from www.gstatic.com (firebase-app, -auth, -firestore, -storage). The
// harness serves this same source at all four URLs; every copy shares one
// backend through globalThis.__fbStub, so the browser sees one app.
//
// It implements what public/js/app.js and auth-gate.js use, and nothing
// else: anything not implemented is exported as a function that throws
// "firebase-stub: <name> not implemented", never a silent no-op, so a new SDK
// call fails the scenario by name instead of quietly doing nothing.
//
// The page is seeded through window.__FB_SEED = { docs: { "<collection>": {
// "<id>": { ...fields } } }, user: { email, role } }. A field value of
// { $ts: <millis> } becomes a Timestamp. Every write is recorded in
// window.__fbStub.writes for the scenarios to assert on.

const Timestamp = globalThis.__fbStubTimestamp ||= class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  valueOf() { return this.ms; }
};
const SERVER_TS = { $sentinel: "serverTimestamp" };
const DELETE = { $sentinel: "deleteField" };

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Timestamp);
const clone = (v) => {
  if (v instanceof Timestamp) return v;
  if (Array.isArray(v)) return v.map(clone);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]));
  return v;
};
const revive = (v) => {
  if (Array.isArray(v)) return v.map(revive);
  if (isObj(v)) {
    if (Object.keys(v).length === 1 && typeof v.$ts === "number") return new Timestamp(v.$ts);
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)]));
  }
  return v;
};
// What a write looks like in the recorded log: sentinels as readable markers.
const describe = (v) => {
  if (v instanceof Timestamp) return { $ts: v.ms };
  if (Array.isArray(v)) return v.map(describe);
  if (isObj(v)) {
    if (v.$sentinel === "serverTimestamp") return "$serverTimestamp";
    if (v.$sentinel === "deleteField") return "$deleteField";
    if (v.$sentinel === "arrayUnion") return { $arrayUnion: v.values.map(describe) };
    if (v.$sentinel === "arrayRemove") return { $arrayRemove: v.values.map(describe) };
    if (v.$sentinel === "increment") return { $increment: v.n };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, describe(x)]));
  }
  return v;
};
const same = (a, b) => JSON.stringify(describe(a)) === JSON.stringify(describe(b));

class Backend {
  constructor() {
    this.cols = new Map();      // collection path -> Map(id -> data)
    this.writes = [];
    this.listeners = new Set();
    this.autoId = 0;
    this.now = Date.now();
    this.user = null;
  }
  col(path) { if (!this.cols.has(path)) this.cols.set(path, new Map()); return this.cols.get(path); }
  seed(seed) {
    const s = seed || {};
    for (const [path, docs] of Object.entries(s.docs || {})) {
      for (const [id, data] of Object.entries(docs)) this.col(path).set(id, revive(clone(data)));
    }
    this.user = s.user || { email: "editor@personalisationhub.com", role: "editor" };
  }
  resolve(value, existing, key) {
    if (isObj(value) && value.$sentinel === "serverTimestamp") return new Timestamp(this.now += 1000);
    if (isObj(value) && value.$sentinel === "arrayUnion") {
      const cur = Array.isArray(existing) ? existing.slice() : [];
      for (const el of value.values) if (!cur.some((c) => same(c, el))) cur.push(clone(el));
      return cur;
    }
    if (isObj(value) && value.$sentinel === "arrayRemove") return (Array.isArray(existing) ? existing : []).filter((c) => !value.values.some((el) => same(c, el)));
    if (isObj(value) && value.$sentinel === "deleteField") return undefined;
    if (isObj(value) && value.$sentinel === "increment") return (typeof existing === "number" ? existing : 0) + value.n;
    if (isObj(value)) return this.resolveMap(value, isObj(existing) ? existing : {});
    return clone(value);
  }
  resolveMap(map, existing) {
    const out = {};
    for (const [k, v] of Object.entries(map)) {
      const r = this.resolve(v, existing[k], k);
      if (r !== undefined) out[k] = r;
    }
    return out;
  }
  apply(op, ref, data, merge) {
    const col = this.col(ref.parentPath);
    const cur = col.get(ref.id);
    if (op === "delete") { col.delete(ref.id); }
    else if (op === "set" && !merge) col.set(ref.id, this.resolveMap(data, {}));
    else if (op === "set" || op === "update") {
      if (op === "update" && !cur) throw Object.assign(new Error(`firebase-stub: update of missing document ${ref.path}`), { code: "not-found" });
      const next = { ...(cur || {}) };
      for (const [k, v] of Object.entries(data)) {
        // A dotted update key writes a nested field; the console doesn't use them.
        if (op === "update" && k.includes(".")) throw new Error("firebase-stub: dotted field paths not implemented");
        const r = this.resolve(v, next[k], k);
        if (r === undefined) delete next[k]; else next[k] = r;
      }
      col.set(ref.id, next);
    } else throw new Error(`firebase-stub: unknown write ${op}`);
  }
  commit(writes) {
    for (const w of writes) {
      this.apply(w.op, w.ref, w.data, w.merge);
      this.writes.push({ op: w.as || w.op, path: w.ref.path, data: w.data === undefined ? undefined : describe(w.data), merge: !!w.merge });
    }
    this.notify();
  }
  notify() { for (const l of [...this.listeners]) l.run(); }
}

const backend = () => (globalThis.__fbStub ||= (() => {
  const b = new Backend();
  b.seed(globalThis.__FB_SEED);
  return b;
})());

// ── refs and queries ────────────────────────────────────────────────────────
const segs = (parts) => parts.filter((p) => typeof p === "string").join("/").split("/").filter(Boolean);
export function collection(base, ...rest) {
  const path = segs([base && base.path, ...rest]).join("/");
  return { type: "collection", path, parentPath: path };
}
export function doc(base, ...rest) {
  if (base && base.type === "collection" && !rest.length) {
    const id = `auto-${++backend().autoId}`;
    return { type: "doc", id, path: `${base.path}/${id}`, parentPath: base.path };
  }
  const parts = segs([base && base.type === "collection" ? base.path : base && base.path, ...rest]);
  const id = parts[parts.length - 1];
  return { type: "doc", id, path: parts.join("/"), parentPath: parts.slice(0, -1).join("/") };
}
export function where(field, op, value) { return { kind: "where", field, op, value }; }
export function orderBy(field, dir = "asc") { return { kind: "orderBy", field, dir }; }
export function limit(n) { return { kind: "limit", n }; }
// Seeded as a plain collection named after the group; the page only queries one group.
export function collectionGroup(_db, id) { return { type: "collection", path: id, parentPath: id }; }
export function query(col, ...constraints) { return { type: "query", path: col.path, constraints }; }

const val = (v) => (v instanceof Timestamp ? v.ms : v);
const cmp = (a, b) => { a = val(a); b = val(b); return a < b ? -1 : a > b ? 1 : 0; };
function run(q) {
  const path = q.path;
  let rows = [...backend().col(path)].map(([id, data]) => ({ id, data }));
  for (const c of q.constraints || []) {
    if (c.kind === "where") {
      if (c.op === "==") rows = rows.filter((r) => same(r.data[c.field], c.value));
      else if (c.op === "!=") rows = rows.filter((r) => r.data[c.field] !== undefined && !same(r.data[c.field], c.value));
      else if (c.op === "array-contains") rows = rows.filter((r) => Array.isArray(r.data[c.field]) && r.data[c.field].some((x) => same(x, c.value)));
      else throw new Error(`firebase-stub: where operator ${c.op} not implemented`);
    }
  }
  for (const c of [...(q.constraints || [])].reverse()) {
    if (c.kind === "orderBy") {
      rows = rows.filter((r) => r.data[c.field] !== undefined);
      rows.sort((a, b) => (c.dir === "desc" ? -1 : 1) * cmp(a.data[c.field], b.data[c.field]));
    }
  }
  for (const c of q.constraints || []) if (c.kind === "limit") rows = rows.slice(0, c.n);
  return rows;
}
const metadata = { fromCache: false, hasPendingWrites: false };
const docSnap = (path, id, data) => ({
  id, ref: { type: "doc", id, path: `${path}/${id}`, parentPath: path }, metadata,
  exists: () => data !== undefined,
  data: () => (data === undefined ? undefined : clone(data)),
});
function querySnap(target, prev) {
  const rows = run(target.type === "collection" ? { path: target.path, constraints: [] } : target);
  const docs = rows.map((r) => docSnap(target.path, r.id, r.data));
  const before = new Map((prev || []).map((d) => [d.id, JSON.stringify(describe(d.data()))]));
  const changes = [];
  for (const d of docs) {
    if (!before.has(d.id)) changes.push({ type: "added", doc: d });
    else if (before.get(d.id) !== JSON.stringify(describe(d.data()))) changes.push({ type: "modified", doc: d });
  }
  const now = new Set(docs.map((d) => d.id));
  for (const d of prev || []) if (!now.has(d.id)) changes.push({ type: "removed", doc: d });
  return { docs, empty: docs.length === 0, size: docs.length, metadata, forEach: (fn) => docs.forEach(fn), docChanges: () => changes };
}

export function onSnapshot(target, onNext, onError) {
  const b = backend();
  let last = null;
  const emit = () => {
    try {
      if (target.type === "doc") {
        const data = b.col(target.parentPath).get(target.id);
        onNext(docSnap(target.parentPath, target.id, data));
      } else {
        const snap = querySnap(target, last && last.docs);
        last = snap;
        // What the listener downloads: each added or changed document.
        const rb = (b.readBytes ||= {});
        for (const ch of snap.docChanges()) rb[target.path] = (rb[target.path] || 0) + JSON.stringify(describe(ch.doc.data())).length;
        onNext(snap);
      }
    } catch (err) { if (onError) onError(err); else throw err; }
  };
  const l = { run: emit };
  b.listeners.add(l);
  const watch = (b.watching ||= {});
  watch[target.path] = (watch[target.path] || 0) + 1;
  // Firestore delivers the first snapshot asynchronously.
  Promise.resolve().then(() => { if (b.listeners.has(l)) emit(); });
  return () => { if (b.listeners.delete(l)) watch[target.path] -= 1; };
}
export async function getDoc(ref) { return docSnap(ref.parentPath, ref.id, backend().col(ref.parentPath).get(ref.id)); }
export async function getDocs(target) { return querySnap(target); }
export async function getCountFromServer(target) {
  const rows = run(target.type === "collection" ? { path: target.path, constraints: [] } : target);
  return { data: () => ({ count: rows.length }) };
}

export async function addDoc(colRef, data) {
  const ref = doc(colRef);
  backend().commit([{ op: "set", as: "add", ref, data }]);
  return ref;
}
export async function setDoc(ref, data, opts) { backend().commit([{ op: "set", ref, data, merge: !!(opts && opts.merge) }]); }
export async function updateDoc(ref, data) { backend().commit([{ op: "update", ref, data }]); }
export async function deleteDoc(ref) { backend().commit([{ op: "delete", ref }]); }
export function writeBatch() {
  const pending = [];
  return {
    set: (ref, data, opts) => pending.push({ op: "set", ref, data, merge: !!(opts && opts.merge) }),
    update: (ref, data) => pending.push({ op: "update", ref, data }),
    delete: (ref) => pending.push({ op: "delete", ref }),
    commit: async () => backend().commit(pending),
  };
}
// Transactions: reads see the committed state; writes commit together.
export async function runTransaction(_db, fn) {
  const pending = [];
  const tx = {
    get: async (ref) => getDoc(ref),
    set: (ref, data, opts) => { pending.push({ op: "set", ref, data, merge: !!(opts && opts.merge) }); return tx; },
    update: (ref, data) => { pending.push({ op: "update", ref, data }); return tx; },
    delete: (ref) => { pending.push({ op: "delete", ref }); return tx; },
  };
  const out = await fn(tx);
  backend().commit(pending);
  return out;
}
export const increment = (n) => ({ $sentinel: "increment", n });
export const serverTimestamp = () => SERVER_TS;
export const arrayUnion = (...values) => ({ $sentinel: "arrayUnion", values });
export const arrayRemove = (...values) => ({ $sentinel: "arrayRemove", values });
export const deleteField = () => DELETE;
export const initializeFirestore = () => ({ type: "firestore" });
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const getStorage = () => ({ type: "storage" });

// ── app and auth ────────────────────────────────────────────────────────────
const appObj = { name: "[DEFAULT]" };
let appStarted = false;
export const initializeApp = () => { appStarted = true; return appObj; };
export const getApps = () => (appStarted ? [appObj] : []);
export const getApp = () => appObj;

let authObj = null;
function auth() {
  if (authObj) return authObj;
  const u = backend().user;
  const user = {
    email: u.email, emailVerified: true, photoURL: u.photoURL || null, displayName: u.displayName || null,
    getIdToken: async () => "stub-id-token",
    getIdTokenResult: async () => ({ claims: { consoleRole: u.role } }),
    reload: async () => {},
  };
  authObj = { currentUser: user };
  return authObj;
}
export const getAuth = () => auth();
export class GoogleAuthProvider { setCustomParameters() {} }
export const setPersistence = async () => {};
export const browserLocalPersistence = {};
export const getRedirectResult = async () => null;
export const onAuthStateChanged = (a, cb) => { setTimeout(() => cb(a.currentUser), 0); return () => {}; };

// ── everything else is a loud no ────────────────────────────────────────────
const unimplemented = (name) => function () { throw new Error(`firebase-stub: ${name} not implemented`); };
// The whiteboard page (a separate document) asks for the default Firestore; the console itself uses initializeFirestore.
export const getFirestore = () => ({ type: "firestore" });
// Storage: every upload is kept in memory (window.__fbStub.uploads) and
// given a download URL shaped like the real one; the harness serves it.
export const ref = (_storage, path) => ({ type: "storageRef", path });
export async function uploadBytes(r, blob, meta) {
  const b = backend();
  (b.uploads ||= {})[r.path] = { size: blob.size, contentType: (meta && meta.contentType) || blob.type, url: `https://firebasestorage.googleapis.com/v0/b/stub/o/${encodeURIComponent(r.path)}?alt=media` };
  return { ref: r };
}
export async function getDownloadURL(r) {
  const u = (backend().uploads || {})[r.path];
  if (!u) throw new Error(`firebase-stub: no upload at ${r.path}`);
  return u.url;
}
export async function deleteObject(r) { const b = backend(); (b.uploads ||= {}); delete b.uploads[r.path]; (b.deleted ||= []).push(r.path); }
export const signInWithPopup = unimplemented("signInWithPopup");
export const signInWithRedirect = unimplemented("signInWithRedirect");
export const signInWithEmailAndPassword = unimplemented("signInWithEmailAndPassword");
export const sendPasswordResetEmail = unimplemented("sendPasswordResetEmail");
export const sendEmailVerification = unimplemented("sendEmailVerification");
export const signOut = unimplemented("signOut");
