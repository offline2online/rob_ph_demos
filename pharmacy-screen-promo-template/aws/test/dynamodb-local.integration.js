"use strict";

// The DynamoDB suites against real DynamoDB semantics, on DynamoDB Local:
// test/dynamodb-store.test.js and the config API's whole HTTP suite. This is
// what proves the transactions, conditions and paging the adapters rely on
// (the offline runs use test/fake-dynamodb.js).
//
//   docker run -d -p 8000:8000 amazon/dynamodb-local      (or the DynamoDB Local jar)
//   DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:dynamodb-local
//
// Without DYNAMODB_ENDPOINT it fails, rather than passing without testing.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

assert.ok(process.env.DYNAMODB_ENDPOINT, "set DYNAMODB_ENDPOINT to a DynamoDB Local endpoint (see the comment at the top of this file)");
process.env.DYNAMODB_TEST_TABLE = process.env.DYNAMODB_TEST_TABLE || `pharmacy-screen-test-${Date.now()}`;
process.env.PS_TEST_STORE = path.join(__dirname, "test-store.js");

test.before(async () => {
  const { CreateTableCommand, DescribeTableCommand } = require("@aws-sdk/client-dynamodb");
  const client = require("./test-store").localClient();
  // The same key schema as the stack's table (infra/stack.js).
  await client.send(new CreateTableCommand({
    TableName: process.env.DYNAMODB_TEST_TABLE,
    AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }, { AttributeName: "sk", AttributeType: "S" }],
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
    BillingMode: "PAY_PER_REQUEST",
  }));
  for (let i = 0; i < 50; i++) {
    const t = await client.send(new DescribeTableCommand({ TableName: process.env.DYNAMODB_TEST_TABLE }));
    if (t.Table.TableStatus === "ACTIVE") return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("test table did not become active");
});

require("./dynamodb-store.test.js");
require("../../pharmacy-screen/config-api/test/api.test.js");
