"use strict";

// DynamoDB settings store and audit log for the PH API settings
// (ph-proxy/src/stores.js documents the contract):
//
//   settings store  get() -> doc | null;  update(fn) -> new doc, atomic
//   audit log       record(entry)         entries never hold the token
//
// Both live in the config table, apart from the config records:
//
//   pk "<root>#private", sk "settings#phApi"     the settings doc (base URLs and the token's
//                                                 envelope, never the token) and its rev
//   pk "<root>#private-audit", sk "<at>-<rand>"   one audit entry per save / replace / remove
//
// Neither is reachable from a browser: only the proxy function's role may
// read or write the table, and nothing publishes these keys.

const crypto = require("node:crypto");

function createDynamoSettingsStore({ client, commands, table, root = "pharmacyScreen", maxAttempts = 8 } = {}) {
  if (!client || !table) throw new Error("dynamodb-settings: client and table are required");
  const C = commands || require("@aws-sdk/client-dynamodb");
  const Key = { pk: { S: `${root}#private` }, sk: { S: "settings#phApi" } };
  const read = async () => {
    const out = await client.send(new C.GetItemCommand({ TableName: table, Key, ConsistentRead: true }));
    const item = out.Item;
    return item ? { doc: JSON.parse(item.doc.S), rev: Number(item.rev.N) } : { doc: null, rev: null };
  };
  return {
    async get() {
      return (await read()).doc;
    },
    async update(fn) {
      for (let attempt = 1; ; attempt++) {
        const { doc, rev } = await read();
        const next = await fn(doc);
        const cond = rev === null
          ? { ConditionExpression: "attribute_not_exists(pk)" }
          : { ConditionExpression: "#rev = :seen", ExpressionAttributeNames: { "#rev": "rev" }, ExpressionAttributeValues: { ":seen": { N: String(rev) } } };
        try {
          await client.send(new C.PutItemCommand({
            TableName: table,
            Item: { ...Key, doc: { S: JSON.stringify(next) }, rev: { N: String((rev || 0) + 1) } },
            ...cond,
          }));
          return JSON.parse(JSON.stringify(next));
        } catch (err) {
          if (err && err.name === "ConditionalCheckFailedException" && attempt < maxAttempts) continue;
          throw err;
        }
      }
    },
  };
}

function createDynamoAuditLog({ client, commands, table, root = "pharmacyScreen" } = {}) {
  if (!client || !table) throw new Error("dynamodb-settings: client and table are required");
  const C = commands || require("@aws-sdk/client-dynamodb");
  return {
    async record(entry) {
      const at = typeof entry.at === "string" ? entry.at : new Date().toISOString();
      await client.send(new C.PutItemCommand({
        TableName: table,
        Item: {
          pk: { S: `${root}#private-audit` },
          sk: { S: `${at}-${crypto.randomBytes(6).toString("hex")}` },
          doc: { S: JSON.stringify(entry) },
        },
      }));
    },
  };
}

module.exports = { createDynamoSettingsStore, createDynamoAuditLog };
