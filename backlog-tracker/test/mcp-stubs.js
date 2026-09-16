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
function arrayUnion(...items) { return { __sentinel: "arrayUnion", items }; }

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
    if (v && v.__sentinel === "arrayUnion") {
      const cur = Array.isArray(base[k]) ? base[k].slice() : [];
      base[k] = cur.concat(v.items.map(resolve));
    } else {
      base[k] = resolve(v);
    }
  }
  return base;
}

class Store {
  constructor() { this.data = new Map(); this.seq = 0; }
  col(name) { if (!this.data.has(name)) this.data.set(name, new Map()); return this.data.get(name); }
  nextId() { return `id${++this.seq}`; }
}

function snapshotFor(store, collection, id) {
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
  };
}

function query(store, collection, filters = [], limit = null) {
  return {
    where(field, op, value) { return query(store, collection, filters.concat([{ field, op, value }]), limit); },
    limit(n) { return query(store, collection, filters, n); },
    async get() {
      let rows = [...store.col(collection).entries()];
      for (const f of filters) {
        rows = rows.filter(([, d]) => {
          const v = d[f.field];
          if (f.op === "==") return v === f.value;
          if (f.op === "array-contains") return Array.isArray(v) && v.includes(f.value);
          throw new Error(`stub: unsupported operator ${f.op}`);
        });
      }
      if (limit != null) rows = rows.slice(0, limit);
      const docs = rows.map(([id]) => snapshotFor(store, collection, id));
      return { docs, empty: docs.length === 0, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    },
  };
}

function collectionRef(store, name) {
  const q = query(store, name);
  return Object.assign(Object.create(Object.getPrototypeOf(q)), q, {
    doc: (id) => docRef(store, name, id),
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
    "firebase-functions/logger": {
      info: (...a) => logs.push(["info", ...a]), warn: (...a) => logs.push(["warn", ...a]),
      error: (...a) => logs.push(["error", ...a]), debug: () => {},
    },
    "firebase-admin/firestore": {
      getFirestore: () => db,
      FieldValue: { serverTimestamp: () => SERVER_TIMESTAMP, arrayUnion },
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
