// In-memory stand-ins for the Firebase SDKs mcp-server.js requires, so the
// OAuth + MCP flows can be exercised end to end with no emulator, no
// credentials and no network. Only the surface mcp-server.js actually uses
// is implemented — if a new call appears there and the stub doesn't know
// it, the test fails loudly rather than silently passing.
"use strict";
const Module = require("module");

function nowTs() {
  const ms = Date.now();
  return { toMillis: () => ms, toDate: () => new Date(ms), _ts: true };
}

const SERVER_TIMESTAMP = { __sentinel: "serverTimestamp" };
const DELETE_FIELD = { __sentinel: "delete" };
function arrayUnion(...items) { return { __sentinel: "arrayUnion", items }; }
function arrayRemove(...items) { return { __sentinel: "arrayRemove", items }; }
function increment(n) { return { __sentinel: "increment", n }; }

function resolve(value) {
  if (value === SERVER_TIMESTAMP) return nowTs();
  if (Array.isArray(value)) return value.map(resolve);
  if (value && typeof value === "object" && !value._ts && !(value instanceof Date) && !value.__sentinel) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolve(v);
    return out;
  }
  return value;
}

function applyWrite(existing, data, merge) {
  const base = merge && existing ? Object.assign({}, existing) : {};
  for (const [k, v] of Object.entries(data)) {
    if (v === DELETE_FIELD) {
      delete base[k];
    } else if (v && v.__sentinel === "increment") {
      base[k] = (typeof base[k] === "number" ? base[k] : 0) + v.n;
    } else if (v && v.__sentinel === "arrayUnion") {
      const cur = Array.isArray(base[k]) ? base[k].slice() : [];
      // Firestore adds only the elements the array doesn't already hold.
      for (const it of v.items.map(resolve)) if (!cur.some((c) => JSON.stringify(c) === JSON.stringify(it))) cur.push(it);
      base[k] = cur;
    } else if (v && v.__sentinel === "arrayRemove") {
      const gone = v.items.map((i) => JSON.stringify(resolve(i)));
      base[k] = (Array.isArray(base[k]) ? base[k] : []).filter((c) => !gone.includes(JSON.stringify(c)));
    } else if (merge && v && typeof v === "object" && !Array.isArray(v) && !v._ts && !(v instanceof Date) && !v.__sentinel
      && base[k] && typeof base[k] === "object" && !Array.isArray(base[k]) && !base[k]._ts) {
      // Firestore's set(..., {merge: true}) merges nested maps field by field.
      base[k] = applyWrite(base[k], v, true);
    } else {
      base[k] = resolve(v);
    }
  }
  return base;
}

class Store {
  constructor() { this.data = new Map(); this.seq = 0; this.reads = new Map(); }
  // Documents read per collection (a get on a doc or a query), so a test can assert a tool reads only what it needs.
  countRead(collection, n = 1) { this.reads.set(collection, (this.reads.get(collection) || 0) + n); }
  col(name) { if (!this.data.has(name)) this.data.set(name, new Map()); return this.data.get(name); }
  nextId() { return `id${++this.seq}`; }
}

function snapshotFor(store, collection, id, counted = true) {
  if (counted) store.countRead(collection);
  const raw = store.col(collection).get(id);
  return {
    id, exists: raw !== undefined,
    data: () => (raw === undefined ? undefined : raw),
    ref: docRef(store, collection, id),
  };
}

function docRef(store, collection, id) {
  return {
    id,
    path: `${collection}/${id}`,
    async get() { return snapshotFor(store, collection, id); },
    async set(data, opts) { store.col(collection).set(id, applyWrite(store.col(collection).get(id), data, !!(opts && opts.merge))); },
    async update(data) {
      if (!store.col(collection).has(id)) throw new Error(`update on missing doc ${collection}/${id}`);
      store.col(collection).set(id, applyWrite(store.col(collection).get(id), data, true));
    },
    async delete() { store.col(collection).delete(id); },
    // create() refuses a document that exists, as Firestore's does (code 6, ALREADY_EXISTS).
    async create(data) {
      if (store.col(collection).has(id)) throw Object.assign(new Error(`6 ALREADY_EXISTS: ${collection}/${id}`), { code: 6 });
      store.col(collection).set(id, applyWrite(undefined, data, false));
    },
    // A subcollection is just another stub collection under a path-shaped name.
    collection: (sub) => collectionRef(store, `${collection}/${id}/${sub}`),
  };
}

function query(store, collection, filters = [], limit = null, order = null) {
  return {
    where(field, op, value) { return query(store, collection, filters.concat([{ field, op, value }]), limit, order); },
    limit(n) { return query(store, collection, filters, n, order); },
    // Projections/ordering are accepted and ignored: the stub hands back
    // whole documents, which is a superset of what the real call returns.
    select() { return query(store, collection, filters, limit, order); },
    orderBy(field, dir) { return query(store, collection, filters, limit, field ? { field, dir: dir === "desc" ? -1 : 1 } : order); },
    // The aggregate count the server uses to compare two collections.
    count() { return { async get() { const r = await query(store, collection, filters, limit, order).get(); return { data: () => ({ count: r.size }) }; } }; },
    async get() {
      let rows = [...store.col(collection).entries()];
      for (const f of filters) {
        rows = rows.filter(([, d]) => {
          const v = d[f.field];
          if (f.op === "==") return v === f.value;
          if (f.op === "<") return v != null && v < f.value;
          if (f.op === "array-contains") return Array.isArray(v) && v.includes(f.value);
          throw new Error(`stub: unsupported operator ${f.op}`);
        });
      }
      if (order) rows.sort(([, a], [, b]) => (a[order.field] > b[order.field] ? 1 : a[order.field] < b[order.field] ? -1 : 0) * order.dir);
      if (limit != null) rows = rows.slice(0, limit);
      const docs = rows.map(([id]) => snapshotFor(store, collection, id));
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    },
  };
}

function collectionRef(store, name) {
  const q = query(store, name);
  return Object.assign(Object.create(Object.getPrototypeOf(q)), q, {
    // doc() with no id gets a fresh one, as Firestore's auto-id does.
    doc: (id) => docRef(store, name, id || store.nextId()),
    async add(data) { const id = store.nextId(); await docRef(store, name, id).set(data); return docRef(store, name, id); },
  });
}

function makeDb(store) {
  return {
    collection: (name) => collectionRef(store, name),
    batch() {
      const ops = [];
      return {
        set: (ref, data, opts) => ops.push(() => ref.set(data, opts)),
        update: (ref, data) => ops.push(() => ref.update(data)),
        delete: (ref) => ops.push(() => ref.delete()),
        commit: async () => { for (const op of ops) await op(); },
      };
    },
    async runTransaction(fn) {
      return fn({
        get: (ref) => ref.get(),
        update: (ref, data) => ref.update(data),
        set: (ref, data, opts) => ref.set(data, opts),
      });
    },
  };
}

// ── install ───────────────────────────────────────────────────────────────
function install() {
  const store = new Store();
  const db = makeDb(store);
  const authState = {
    // Set by a test before the code under test verifies an ID token.
    idTokens: new Map(),   // token string -> decoded claims
    secrets: {},           // defineSecret(name).value()
    users: new Map(),      // email -> { uid, customClaims }
    created: [],
  };
  const captured = { requestHandler: null, firestoreTriggers: new Map() };
  const logs = [];

  const stubs = {
    "firebase-functions/v2/https": { onRequest: (opts, handler) => { captured.requestHandler = handler; return handler; } },
    "firebase-functions/v2/firestore": {
      onDocumentWritten: (docPath, handler) => { captured.firestoreTriggers.set(docPath, handler); return handler; },
    },
    // Secrets: a test sets authState.secrets[name]; unset reads as "".
    "firebase-functions/params": { defineSecret: (name) => ({ value: () => (authState.secrets && authState.secrets[name]) || "" }) },
    "firebase-functions/logger": {
      info: (...a) => logs.push(["info", ...a]), warn: (...a) => logs.push(["warn", ...a]),
      error: (...a) => logs.push(["error", ...a]), debug: () => {},
    },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP, arrayUnion, arrayRemove, increment, delete: () => DELETE_FIELD },
    },
    // Storage: an upload is kept in authState.uploads (path -> { size, contentType, token }).
    "firebase-admin/storage": {
      getStorage: () => ({
        bucket: (name) => ({
          name: name || "test-bucket",
          file: (path) => ({ save: async (buf, opts) => { (authState.uploads ||= {})[path] = { size: buf.length, contentType: opts && opts.contentType, token: opts && opts.metadata && opts.metadata.metadata && opts.metadata.metadata.firebaseStorageDownloadTokens }; } }),
        }),
      }),
    },
    "firebase-admin/auth": {
      getAuth: () => ({
        async verifyIdToken(token) {
          const decoded = authState.idTokens.get(token);
          if (!decoded) { const e = new Error("bad token"); e.code = "auth/argument-error"; throw e; }
          return decoded;
        },
        async getUserByEmail(email) {
          const u = authState.users.get(String(email).toLowerCase());
          if (!u) { const e = new Error("no user"); e.code = "auth/user-not-found"; throw e; }
          return u;
        },
        async createUser({ email, displayName }) {
          const u = { uid: `uid-${authState.users.size + 1}`, email, displayName, customClaims: {} };
          authState.users.set(String(email).toLowerCase(), u);
          authState.created.push(email);
          return u;
        },
        async revokeRefreshTokens() {},
        async setCustomUserClaims(uid, claims) {
          for (const u of authState.users.values()) if (u.uid === uid) u.customClaims = claims;
        },
      }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    return originalLoad.call(this, request, parent, isMain);
  };

  return {
    store, db, authState, captured, logs,
    restore() { Module._load = originalLoad; },
  };
}

// Minimal Express-shaped request/response pair.
function makeReq({ method = "GET", path = "/", query = {}, body = undefined, headers = {} }) {
  const lower = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { method, path, url: path, originalUrl: path, query, body, get: (h) => lower[String(h).toLowerCase()] };
}

function makeRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, headersSent: false, redirectedTo: null,
    status(code) { res.statusCode = code; return res; },
    set(k, v) { if (typeof k === "object") Object.assign(res.headers, k); else res.headers[k] = v; return res; },
    json(obj) { res.body = obj; res.headersSent = true; return res; },
    send(text) { res.body = text; res.headersSent = true; return res; },
    redirect(code, url) { res.statusCode = code; res.redirectedTo = url; res.headersSent = true; return res; },
  };
  return res;
}

module.exports = { install, makeReq, makeRes };
