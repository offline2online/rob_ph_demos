#!/usr/bin/env node
"use strict";

// Local run of the config API with no cloud at all: in-memory store and
// media, and fixed bearer tokens instead of Firebase Auth. Data is lost when
// it stops. For the admin editor and screen while developing, and for mock
// end-to-end runs.
//
//   PS_DEV_ADMIN_TOKEN=dev-admin node scripts/dev-server.js   (port 8787, PORT= to change)
//   curl -H "Authorization: Bearer dev-admin" localhost:8787/api/admin/pharmacies
//
// The viewer token (PS_DEV_VIEWER_TOKEN, default "dev-viewer") is a signed-in
// non-admin, for checking refusals.
//
// --seed (npm run dev:seed) starts it loaded with the seed fixtures
// (../seed/): the five launch pharmacies, the default promotions and the
// service library.

const http = require("node:http");
const { createConfigApi } = require("../src/api");
const { toNodeHandler } = require("../src/http");
const { createMemoryStore } = require("../src/adapters/memory-store");
const { createMemoryBlobs } = require("../src/adapters/blobs");
const { createStaticAuth } = require("../src/adapters/auth");

const port = Number(process.env.PORT || 8787);
const adminToken = process.env.PS_DEV_ADMIN_TOKEN || "dev-admin";
const viewerToken = process.env.PS_DEV_VIEWER_TOKEN || "dev-viewer";
const blobs = createMemoryBlobs({ baseUrl: `http://localhost:${port}/media/` });
const store = createMemoryStore();

const api = createConfigApi({
  store,
  blobs,
  auth: createStaticAuth({
    [adminToken]: { uid: "dev-admin", email: "admin@example.com", admin: true },
    [viewerToken]: { uid: "dev-viewer", email: "viewer@example.com", admin: false },
  }),
  allowedOrigins: String(process.env.PS_ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:8080").split(","),
  log: (level, msg) => console.error(`[${level}] ${msg}`),
});
const handle = toNodeHandler(api);

const server = http
  .createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/media/")) {
      const obj = blobs.objects.get(decodeURIComponent(req.url.slice("/media/".length)));
      if (!obj) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader("Content-Type", obj.contentType);
      return res.end(obj.buffer);
    }
    return handle(req, res);
  });

async function start() {
  if (process.argv.includes("--seed")) {
    const { seedConfig, summarise } = require("../../seed/seed");
    console.log(summarise(await seedConfig({ store, blobs })));
  }
  server.listen(port, () => console.log(`pharmacy-screen config API on http://localhost:${port}/api (admin token: ${adminToken === "dev-admin" ? "dev-admin" : "from PS_DEV_ADMIN_TOKEN"})`));
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
