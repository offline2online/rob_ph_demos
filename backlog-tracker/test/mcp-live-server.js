// Serves the real functions/mcp-server.js over real HTTP on localhost, with
// only the Firebase SDKs stubbed (mcp-stubs.js).
//
// mcp-server.test.js calls the request handler in-process, which is fast and
// covers the logic. This exists for the one thing that cannot cover: whether
// a REAL MCP client, doing its own discovery, registration, PKCE and token
// handling over the wire, can actually connect — see mcp-client.test.js.
// Between them, the only untested part of the flow is the human's click on
// the consent page.
"use strict";
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || "backlog-tracker-e4ed2";
process.env.MCP_PUBLIC_ORIGIN = process.env.MCP_PUBLIC_ORIGIN || "http://localhost:8100";

const http = require("http");
const path = require("path");
const { install } = require("./mcp-stubs.js");

const env = install();
require(path.join(__dirname, "..", "functions", "mcp-server.js"));
const handler = env.captured.requestHandler;

// The world the console would have: one member on the user list, two
// projects, a ticket in testing, one published help-centre article.
const TEAMMATE = "sam@personalisationhub.com";
const ID_TOKEN = "firebase-id-token-sam";
function seed() {
  env.authState.idTokens.set(ID_TOKEN, { uid: "uid-sam", email: TEAMMATE, email_verified: true });
  env.authState.users.set(TEAMMATE, { uid: "uid-sam", email: TEAMMATE, customClaims: {} });
  env.store.col("consoleUsers").set(TEAMMATE, { email: TEAMMATE, displayName: "Sam Patel", role: "editor" });
  env.store.col("projects").set("proj-lvp", { name: "Live Visitor Profile", deployBranch: "deploy/live-visitor-profile" });
  env.store.col("projects").set("proj-tpl", { name: "Experience Templates" });
  env.store.col("backlogItems").set("tick-1", {
    projectId: "proj-lvp", title: "Attribute freshness deadline is ignored",
    desc: "The envelope's deadline isn't honoured when a source system is slow.",
    type: "bug", category: "Backend / Infrastructure", status: "ready-for-testing",
  });
  env.store.col("faqCategories").set("cat-pricing", { name: "Pricing & Offers" });
  env.store.col("faqArticles").set("art-1", {
    categoryId: "cat-pricing", title: "Setting a local offer in Retail Admin", slug: "local-offer",
    summary: "How a store overrides HQ's RRP for its own menu boards.",
    keywords: ["offer", "rrp", "price"], bodyMd: "1. Open Retail Admin…",
    status: "published", docType: "how-to", order: 1,
  });
}
seed();

// firebase-functions hands an onRequest handler Express-shaped req/res; node's
// http gives neither, so translate. Only what mcp-server.js actually touches.
function adapt(nodeReq, nodeRes, body) {
  const url = new URL(nodeReq.url, "http://localhost");
  const query = {};
  url.searchParams.forEach((v, k) => { query[k] = v; });
  let parsed;
  const ctype = String(nodeReq.headers["content-type"] || "");
  if (body && body.length) {
    if (ctype.includes("application/x-www-form-urlencoded")) {
      parsed = {};
      new URLSearchParams(body).forEach((v, k) => { parsed[k] = v; });
    } else {
      try { parsed = JSON.parse(body); } catch { parsed = ctype.includes("json") ? {} : body; }
    }
  }
  const req = {
    method: nodeReq.method, path: url.pathname, url: nodeReq.url, originalUrl: nodeReq.url,
    query, body: parsed, headers: nodeReq.headers,
    get: (h) => nodeReq.headers[String(h).toLowerCase()],
  };
  let status = 200;
  const headers = {};
  const res = {
    get headersSent() { return nodeRes.headersSent; },
    status(c) { status = c; return res; },
    set(k, v) { if (typeof k === "object") Object.assign(headers, k); else headers[k] = v; return res; },
    json(obj) { headers["Content-Type"] = "application/json"; nodeRes.writeHead(status, headers); nodeRes.end(JSON.stringify(obj)); return res; },
    send(b) { nodeRes.writeHead(status, headers); nodeRes.end(b == null ? "" : String(b)); return res; },
    redirect(c, loc) { headers.Location = loc; nodeRes.writeHead(c, headers); nodeRes.end(); return res; },
  };
  return { req, res };
}

const server = http.createServer((nodeReq, nodeRes) => {
  const chunks = [];
  nodeReq.on("data", (c) => chunks.push(c));
  nodeReq.on("end", async () => {
    const { req, res } = adapt(nodeReq, nodeRes, Buffer.concat(chunks).toString("utf8"));
    try {
      await handler(req, res);
    } catch (err) {
      if (!nodeRes.headersSent) { nodeRes.writeHead(500); nodeRes.end(String(err)); }
    }
  });
});

module.exports = { server, env, TEAMMATE, ID_TOKEN };

if (require.main === module) {
  server.listen(8100, () => console.log("mcp-server.js listening on http://localhost:8100/mcp"));
}
