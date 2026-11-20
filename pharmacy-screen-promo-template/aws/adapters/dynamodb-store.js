"use strict";

// DynamoDB config store for the AWS deployment (miPharmacy's environment).
// Same contract as config-api/src/adapters/memory-store.js and
// firestore-store.js (config-api/README.md → "Adapters"):
//
//   store.transaction(async (tx) => …)   all-or-nothing; serialisable
//     tx.get(collection, id)  -> data | null
//     tx.list(collection)     -> [{ id, ...data }]
//     tx.set(collection, id, data)
//     tx.delete(collection, id)
//   store.get(collection, id), store.list(collection, { orderBy, desc, limit })
//   store.newId()
//
// One table, key (pk, sk):
//
//   pk "<root>#<collection>", sk "<id>"     a record: doc (JSON string) or docz (gzip of it, for a
//                                            record over INLINE_LIMIT), rev (number, +1 per write)
//   pk "<root>#head", sk "<collection>"      the collection's head: rev, +1 on every write to it
//
// How a transaction stays serialisable (what keeps store codes and promo IDs
// unique under concurrent writes, as on Firestore): reads are strongly
// consistent and remember what they saw — an item's rev (or "missing"), and
// for a list the collection head's rev, read before the query. The writes
// then go out as one TransactWriteItems in which every item and head that was
// read carries a condition "still the rev I saw". If anything changed in
// between, DynamoDB refuses the whole write and the function runs again from
// the start, like Firestore's runTransaction. A write to a collection bumps
// its head, so a concurrent list-then-create (two "is this store code free?"
// checks) cannot both commit.
//
// Limits: DynamoDB takes at most 100 items in one transaction (4 MB in all),
// so one config write can republish about 90 pharmacies' screens; a record
// over ~400 KB compressed is refused. Both far above the launch data.

const crypto = require("node:crypto");
const zlib = require("node:zlib");

const INLINE_LIMIT = 300 * 1024;
const MAX_TX_ITEMS = 100;
// Lists whose ids sort in the requested order, so list(..., {orderBy, desc, limit})
// can page from the table instead of reading the whole collection: the audit
// log's ids start with the entry's `at` digits (service.js).
const ID_ORDERED = { audit: "at" };

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function createDynamoStore({ client, commands, table, root = "pharmacyScreen", maxAttempts = 8, sleep } = {}) {
  if (!client || !table) throw new StoreError("not-configured", "dynamodb-store: client and table are required");
  const C = commands || require("@aws-sdk/client-dynamodb");
  const wait = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pkOf = (coll) => `${root}#${coll}`;
  const headKey = (coll) => ({ pk: { S: `${root}#head` }, sk: { S: coll } });
  const itemKey = (coll, id) => ({ pk: { S: pkOf(coll) }, sk: { S: String(id) } });

  function encode(data) {
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) <= INLINE_LIMIT) return { doc: { S: json } };
    return { docz: { B: zlib.gzipSync(Buffer.from(json)) } };
  }
  function decode(item) {
    if (!item) return null;
    if (item.doc && item.doc.S !== undefined) return JSON.parse(item.doc.S);
    if (item.docz && item.docz.B) return JSON.parse(zlib.gunzipSync(Buffer.from(item.docz.B)).toString("utf8"));
    return null;
  }
  const revOf = (item) => (item && item.rev && item.rev.N !== undefined ? Number(item.rev.N) : null);

  async function getItem(key, consistent) {
    const out = await client.send(new C.GetItemCommand({ TableName: table, Key: key, ConsistentRead: consistent }));
    return out.Item || null;
  }

  async function query(coll, { consistent = false, desc = false, limit } = {}) {
    const rows = [];
    let start;
    do {
      const out = await client.send(new C.QueryCommand({
        TableName: table,
        KeyConditionExpression: "pk = :pk",
        ExpressionAttributeValues: { ":pk": { S: pkOf(coll) } },
        ConsistentRead: consistent,
        ScanIndexForward: !desc,
        ExclusiveStartKey: start,
        Limit: limit ? Math.min(1000, limit - rows.length) : undefined,
      }));
      for (const item of out.Items || []) rows.push({ id: item.sk.S, ...decode(item) });
      start = out.LastEvaluatedKey;
    } while (start && (!limit || rows.length < limit));
    return rows;
  }

  function sortRows(rows, { orderBy, desc = false, limit } = {}) {
    let out = rows;
    if (orderBy) {
      out = rows.slice().sort((a, b) => (a[orderBy] < b[orderBy] ? -1 : a[orderBy] > b[orderBy] ? 1 : 0));
      if (desc) out.reverse();
    }
    return limit ? out.slice(0, limit) : out;
  }

  // "Still what I saw": the rev it had, or still missing.
  const unchanged = (seen) =>
    seen === null
      ? { ConditionExpression: "attribute_not_exists(pk)" }
      : { ConditionExpression: "#rev = :seen", ExpressionAttributeNames: { "#rev": "rev" }, ExpressionAttributeValues: { ":seen": { N: String(seen) } } };

  function plan(reads, lists, writes) {
    const items = [];
    for (const [k, w] of writes) {
      const read = reads.has(k);
      const cond = read ? unchanged(reads.get(k)) : {};
      const Key = itemKey(w.coll, w.id);
      if (w.data === null) {
        items.push({ Delete: { TableName: table, Key, ...cond } });
      } else {
        const enc = encode(w.data);
        const field = enc.doc ? "doc" : "docz";
        const other = enc.doc ? "docz" : "doc";
        items.push({
          Update: {
            TableName: table,
            Key,
            UpdateExpression: `SET #f = :v REMOVE #o ADD #rev :one`,
            ...cond,
            ExpressionAttributeNames: { ...(cond.ExpressionAttributeNames || {}), "#f": field, "#o": other, "#rev": "rev" },
            ExpressionAttributeValues: { ...(cond.ExpressionAttributeValues || {}), ":v": enc[field], ":one": { N: "1" } },
          },
        });
      }
    }
    for (const [k, seen] of reads) {
      if (writes.has(k)) continue;
      const [coll, id] = k.split("\u0000");
      items.push({ ConditionCheck: { TableName: table, Key: itemKey(coll, id), ...unchanged(seen) } });
    }
    const written = new Set([...writes.values()].map((w) => w.coll));
    for (const coll of new Set([...written, ...lists.keys()])) {
      const listed = lists.has(coll);
      const cond = listed ? unchanged(lists.get(coll)) : {};
      if (written.has(coll)) {
        items.push({
          Update: {
            TableName: table,
            Key: headKey(coll),
            UpdateExpression: "ADD #rev :one",
            ...cond,
            ExpressionAttributeNames: { "#rev": "rev" },
            ExpressionAttributeValues: { ...(cond.ExpressionAttributeValues || {}), ":one": { N: "1" } },
          },
        });
      } else {
        items.push({ ConditionCheck: { TableName: table, Key: headKey(coll), ...cond } });
      }
    }
    return items;
  }

  const retryable = (err) => {
    if (!err) return false;
    if (err.name === "TransactionCanceledException") {
      return (err.CancellationReasons || []).some((r) => r && (r.Code === "ConditionalCheckFailed" || r.Code === "TransactionConflict"));
    }
    return err.name === "TransactionConflictException" || err.name === "TransactionInProgressException";
  };

  async function transaction(fn) {
    for (let attempt = 1; ; attempt++) {
      const reads = new Map(); // "coll\0id" -> rev | null
      const lists = new Map(); // coll -> head rev | null
      const writes = new Map(); // "coll\0id" -> { coll, id, data | null }
      const tx = {
        get: async (coll, id) => {
          if (writes.size) throw new Error("dynamodb-store: read after write in a transaction");
          const item = await getItem(itemKey(coll, id), true);
          const k = `${coll}\u0000${id}`;
          if (!reads.has(k)) reads.set(k, revOf(item));
          return decode(item);
        },
        list: async (coll) => {
          if (writes.size) throw new Error("dynamodb-store: read after write in a transaction");
          // The head first: a write that lands after this read changes its rev
          // and fails our commit; one that landed before is in the query.
          const head = await getItem(headKey(coll), true);
          if (!lists.has(coll)) lists.set(coll, revOf(head));
          return query(coll, { consistent: true });
        },
        set: (coll, id, data) => {
          writes.set(`${coll}\u0000${id}`, { coll, id: String(id), data: JSON.parse(JSON.stringify(data)) });
        },
        delete: (coll, id) => {
          writes.set(`${coll}\u0000${id}`, { coll, id: String(id), data: null });
        },
      };
      const result = await fn(tx);
      if (!writes.size) return result;
      const items = plan(reads, lists, writes);
      if (items.length > MAX_TX_ITEMS) {
        throw new StoreError("too-many-writes", `This change touches ${items.length} records; DynamoDB allows ${MAX_TX_ITEMS} in one transaction`);
      }
      try {
        await client.send(new C.TransactWriteItemsCommand({ TransactItems: items }));
        return result;
      } catch (err) {
        if (!retryable(err) || attempt >= maxAttempts) {
          if (retryable(err)) throw new StoreError("contention", "Too many changes at once; try again");
          throw err;
        }
        await wait(Math.min(1000, 20 * 2 ** attempt) * (0.5 + Math.random()));
      }
    }
  }

  return {
    kind: "dynamodb",
    transaction,
    get: async (coll, id) => decode(await getItem(itemKey(coll, id), true)),
    list: async (coll, opts = {}) => {
      if (opts.orderBy && ID_ORDERED[coll] === opts.orderBy) return query(coll, { consistent: true, desc: !!opts.desc, limit: opts.limit });
      return sortRows(await query(coll, { consistent: true }), opts);
    },
    newId: () => crypto.randomBytes(10).toString("hex"),
  };
}

module.exports = { createDynamoStore, StoreError, INLINE_LIMIT, MAX_TX_ITEMS };
