"use strict";

// A small in-memory stand-in for the DynamoDB API, covering exactly the
// operations and expressions the adapters send (GetItem, Query, PutItem,
// TransactWriteItems with Update / Delete / ConditionCheck). An expression it
// doesn't know throws, so an adapter change that needs more shows up here.
// test/dynamodb-local.integration.js runs the same suites against DynamoDB
// Local, which keeps this fake honest.

const keyOf = (k) => `${k.pk.S}\u0000${k.sk.S}`;
const copy = (v) => (v === undefined ? undefined : structuredClone(v));

class AwsError extends Error {
  constructor(name, message, extra = {}) {
    super(message);
    this.name = name;
    Object.assign(this, extra);
  }
}

function createFakeDynamo({ onSend } = {}) {
  const items = new Map();
  const calls = [];

  function check(item, input) {
    const expr = input.ConditionExpression;
    if (!expr) return true;
    if (expr === "attribute_not_exists(pk)") return !item;
    if (expr === "#rev = :seen") {
      const field = input.ExpressionAttributeNames["#rev"];
      return !!item && item[field] && item[field].N === input.ExpressionAttributeValues[":seen"].N;
    }
    throw new Error(`fake-dynamodb: unsupported condition ${expr}`);
  }

  function applyUpdate(item, input) {
    const next = copy(item) || { ...copy(input.Key) };
    const names = input.ExpressionAttributeNames || {};
    const values = input.ExpressionAttributeValues || {};
    const expr = input.UpdateExpression;
    const m = /^(?:SET #f = :v REMOVE #o )?ADD #rev :one$/.exec(expr);
    if (!m) throw new Error(`fake-dynamodb: unsupported update ${expr}`);
    if (expr.startsWith("SET")) {
      next[names["#f"]] = copy(values[":v"]);
      delete next[names["#o"]];
    }
    const rev = names["#rev"];
    next[rev] = { N: String(Number((next[rev] && next[rev].N) || 0) + Number(values[":one"].N)) };
    return next;
  }

  const handlers = {
    CreateTableCommand: () => ({}),
    GetItemCommand: (input) => ({ Item: copy(items.get(keyOf(input.Key))) }),
    PutItemCommand: (input) => {
      const k = keyOf(input.Item);
      if (!check(items.get(k), input)) throw new AwsError("ConditionalCheckFailedException", "The conditional request failed");
      items.set(k, copy(input.Item));
      return {};
    },
    QueryCommand: (input) => {
      if (input.KeyConditionExpression !== "pk = :pk") throw new Error(`fake-dynamodb: unsupported key condition ${input.KeyConditionExpression}`);
      const pk = input.ExpressionAttributeValues[":pk"].S;
      let rows = [...items.values()].filter((i) => i.pk.S === pk).sort((a, b) => (a.sk.S < b.sk.S ? -1 : a.sk.S > b.sk.S ? 1 : 0));
      if (input.ScanIndexForward === false) rows.reverse();
      if (input.ExclusiveStartKey) {
        const i = rows.findIndex((r) => r.sk.S === input.ExclusiveStartKey.sk.S);
        rows = rows.slice(i + 1);
      }
      const page = input.Limit ? rows.slice(0, input.Limit) : rows;
      const more = input.Limit && rows.length > input.Limit;
      return { Items: page.map(copy), LastEvaluatedKey: more ? { pk: copy(page[page.length - 1].pk), sk: copy(page[page.length - 1].sk) } : undefined };
    },
    TransactWriteItemsCommand: (input) => {
      const list = input.TransactItems;
      if (list.length > 100) throw new AwsError("ValidationException", "Member must have length less than or equal to 100");
      const seen = new Set();
      const ops = list.map((t) => {
        const [kind, op] = Object.entries(t)[0];
        const k = keyOf(op.Key);
        if (seen.has(k)) throw new AwsError("ValidationException", "Transaction request cannot include multiple operations on one item");
        seen.add(k);
        return { kind, op, k };
      });
      const reasons = ops.map(({ op, k }) => (check(items.get(k), op) ? { Code: "None" } : { Code: "ConditionalCheckFailed" }));
      if (reasons.some((r) => r.Code !== "None")) {
        throw new AwsError("TransactionCanceledException", "Transaction cancelled", { CancellationReasons: reasons });
      }
      for (const { kind, op, k } of ops) {
        if (kind === "Delete") items.delete(k);
        else if (kind === "Update") items.set(k, applyUpdate(items.get(k), op));
        else if (kind === "Put") items.set(k, copy(op.Item));
        else if (kind !== "ConditionCheck") throw new Error(`fake-dynamodb: unsupported ${kind}`);
      }
      return {};
    },
  };

  return {
    items,
    calls,
    async send(cmd) {
      const name = cmd.constructor.name;
      calls.push({ name, input: cmd.input });
      // Yield first, so concurrent callers interleave the way real network calls do.
      await new Promise((r) => setImmediate(r));
      if (onSend) await onSend(name, cmd.input);
      const h = handlers[name];
      if (!h) throw new Error(`fake-dynamodb: unsupported command ${name}`);
      return h(cmd.input);
    },
  };
}

module.exports = { createFakeDynamo, AwsError };
