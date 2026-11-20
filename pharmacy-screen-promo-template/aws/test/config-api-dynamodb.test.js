"use strict";

// The config API's whole HTTP suite (pharmacy-screen/config-api/test/api.test.js:
// CRUD of every entity, admin checks, template fallback, unique store codes and
// promo IDs under concurrent creates, the public read, audit, versions,
// uploads, validation), run against the DynamoDB store instead of the
// in-memory one. On the fake by default; on DynamoDB Local via
// test/dynamodb-local.integration.js.

const path = require("node:path");

process.env.PS_TEST_STORE = path.join(__dirname, "test-store.js");
require("../../pharmacy-screen/config-api/test/api.test.js");
