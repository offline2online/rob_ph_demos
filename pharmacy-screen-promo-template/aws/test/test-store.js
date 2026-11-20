"use strict";

// createTestStore() for config-api/test/api.test.js (PS_TEST_STORE): the
// DynamoDB store, on DynamoDB Local when DYNAMODB_ENDPOINT and
// DYNAMODB_TEST_TABLE are set (test/dynamodb-local.integration.js sets them),
// otherwise on the in-memory fake. Each store gets its own key prefix, so the
// suite's tests never see each other's records.

const crypto = require("node:crypto");
const { createDynamoStore } = require("../adapters/dynamodb-store");
const { createFakeDynamo } = require("./fake-dynamodb");

function localClient() {
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  return new DynamoDBClient({
    endpoint: process.env.DYNAMODB_ENDPOINT,
    region: "local",
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
}

let shared = null;
function createTestStore() {
  const root = `t${crypto.randomBytes(6).toString("hex")}`;
  if (process.env.DYNAMODB_ENDPOINT) {
    shared = shared || localClient();
    return createDynamoStore({ client: shared, table: process.env.DYNAMODB_TEST_TABLE, root });
  }
  return createDynamoStore({ client: createFakeDynamo(), table: "fake", root });
}

module.exports = { createTestStore, localClient };
