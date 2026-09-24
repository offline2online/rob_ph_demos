// End-to-end test for the PH Agent Console MCP server (functions/mcp-server.js):
// dynamic client registration -> sign-in -> PKCE code exchange -> MCP calls,
// plus the refusals that matter (unknown member, read-only role, revoked
// access, replayed code, wrong PKCE verifier).
//
// Runs on plain node with no emulator and no credentials — test/mcp-stubs.js
// swaps in in-memory Firebase SDKs. Run it with:  node test/mcp-server.test.js
"use strict";
const assert = require("assert");
const crypto = require("crypto");
const { install, makeReq, makeRes } = require("./mcp-stubs");

process.env.GCLOUD_PROJECT = "backlog-tracker-e4ed2";
process.env.MCP_PUBLIC_ORIGIN = "https://backlog-tracker-e4ed2.web.app";

const env = install();
const mcp = require("../functions/mcp-server.js");
const handler = env.captured.requestHandler;
assert.ok(handler, "mcp-server should register an onRequest handler");

const ORIGIN = "https://backlog-tracker-e4ed2.web.app";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

async function call(opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

// A signed-in Firebase user the stub's verifyIdToken will accept.
function signIn(email, uid) {
  const token = `idtoken-${email}`;
  env.authState.idTokens.set(token, { uid: uid || `uid-${email}`, email, email_verified: true });
  env.authState.users.set(email, { uid: uid || `uid-${email}`, email, customClaims: {} });
  return token;
}
function addConsoleUser(email, fields) {
  env.store.col("consoleUsers").set(email, Object.assign({ email, role: "editor", displayName: "" }, fields || {}));
}

async function rpc(token, method, params, id = 1) {
  const res = await call({
    method: "POST", path: "/mcp", body: { jsonrpc: "2.0", id, method, params },
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return res;
}

(async () => {
  console.log("\nPH Agent Console MCP server\n");
  let clientId = null;
  let code = null;
  let tokens = null;
  const TEAMMATE = "sam@personalisationhub.com";
  const teammateIdToken = signIn(TEAMMATE);

  // ── discovery ───────────────────────────────────────────────────────────
  await test("serves RFC 9728 protected-resource metadata at the path-inserted location", async () => {
    const res = await call({ path: "/.well-known/oauth-protected-resource/mcp" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.resource, `${ORIGIN}/mcp`);
    assert.deepStrictEqual(res.body.authorization_servers, [ORIGIN]);
  });

  await test("serves RFC 8414 authorization-server metadata requiring PKCE S256", async () => {
    const res = await call({ path: "/.well-known/oauth-authorization-server" });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.issuer, ORIGIN);
    assert.strictEqual(res.body.authorization_endpoint, `${ORIGIN}/mcp/authorize`);
    assert.deepStrictEqual(res.body.code_challenge_methods_supported, ["S256"]);
    assert.ok(!res.body.code_challenge_methods_supported.includes("plain"), "plain PKCE must not be offered");
  });

  // ── registration ────────────────────────────────────────────────────────
  await test("registers a client dynamically (RFC 7591)", async () => {
    const res = await call({ method: "POST", path: "/mcp/register", body: { client_name: "Claude", redirect_uris: [REDIRECT] } });
    assert.strictEqual(res.statusCode, 201);
    assert.ok(res.body.client_id);
    assert.strictEqual(res.body.token_endpoint_auth_method, "none");
    clientId = res.body.client_id;
  });

  await test("refuses a javascript: redirect_uri", async () => {
    const res = await call({ method: "POST", path: "/mcp/register", body: { client_name: "Bad", redirect_uris: ["javascript:alert(1)"] } });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, "invalid_redirect_uri");
  });

  // ── authorize ───────────────────────────────────────────────────────────
  await test("renders the sign-in page for a valid authorize request", async () => {
    const res = await call({
      path: "/mcp/authorize",
      query: { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "xyz", code_challenge: challenge, code_challenge_method: "S256" },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.match(res.body, /Connect your agent/);
    assert.match(res.body, /Sign in with Google/);
    assert.match(res.body, /email and password/);
    assert.strictEqual(res.headers["Cache-Control"], "no-store");
  });

  await test("refuses an unregistered redirect_uri instead of redirecting to it", async () => {
    const res = await call({
      path: "/mcp/authorize",
      query: { response_type: "code", client_id: clientId, redirect_uri: "https://evil.example/cb", code_challenge: challenge, code_challenge_method: "S256" },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.redirectedTo, null, "must never redirect to an unvalidated URI");
  });

  await test("rejects an authorize request without PKCE", async () => {
    const res = await call({
      path: "/mcp/authorize",
      query: { response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "xyz" },
    });
    assert.strictEqual(res.statusCode, 302);
    assert.match(res.redirectedTo, /error=invalid_request/);
  });

  await test("turns away someone who isn't on the console user list", async () => {
    const outsider = signIn("nobody@example.com");
    const res = await call({
      method: "POST", path: "/mcp/authorize/complete",
      body: { idToken: outsider, clientId, redirectUri: REDIRECT, codeChallenge: challenge, codeChallengeMethod: "S256" },
    });
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.error_description, /isn't on the PH Agent Console user list/);
  });

  await test("issues a code to a team member added to consoleUsers", async () => {
    addConsoleUser(TEAMMATE, { role: "editor", displayName: "Sam" });
    const res = await call({
      method: "POST", path: "/mcp/authorize/complete",
      body: { idToken: teammateIdToken, clientId, redirectUri: REDIRECT, state: "xyz", codeChallenge: challenge, codeChallengeMethod: "S256", scope: "board.read board.write" },
    });
    assert.strictEqual(res.statusCode, 200);
    const url = new URL(res.body.redirect);
    assert.strictEqual(url.origin + url.pathname, REDIRECT);
    assert.strictEqual(url.searchParams.get("state"), "xyz");
    code = url.searchParams.get("code");
    assert.ok(code, "a code should come back");
  });

  await test("stores only the hash of an authorization code", async () => {
    const codes = [...env.store.col("mcpAuthCodes").keys()];
    assert.ok(codes.length >= 1);
    assert.ok(!codes.some((k) => k.includes(code)), "the raw code must not be a document id");
  });

  // ── token ───────────────────────────────────────────────────────────────
  await test("rejects a code exchange with the wrong PKCE verifier", async () => {
    const res = await call({
      method: "POST", path: "/mcp/token",
      body: { grant_type: "authorization_code", code, code_verifier: "not-the-verifier", client_id: clientId, redirect_uri: REDIRECT },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(res.body.error, "invalid_grant");
  });

  await test("exchanges the code for an access and refresh token", async () => {
    const res = await call({
      method: "POST", path: "/mcp/token",
      body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT },
    });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.token_type, "Bearer");
    assert.ok(res.body.access_token && res.body.refresh_token);
    assert.strictEqual(res.body.expires_in, 3600);
    assert.match(res.body.scope, /board\.write/);
    tokens = res.body;
  });

  await test("refuses to redeem the same code twice", async () => {
    const res = await call({
      method: "POST", path: "/mcp/token",
      body: { grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT },
    });
    assert.strictEqual(res.statusCode, 400);
    assert.match(res.body.error_description, /already used/);
  });

  // ── the MCP endpoint ────────────────────────────────────────────────────
  await test("answers an unauthenticated MCP call with 401 + resource metadata pointer", async () => {
    const res = await rpc(null, "initialize", { protocolVersion: "2025-06-18" });
    assert.strictEqual(res.statusCode, 401);
    assert.match(res.headers["WWW-Authenticate"], /resource_metadata="https:\/\/.*\/\.well-known\/oauth-protected-resource\/mcp"/);
  });

  await test("initializes and echoes a protocol version it supports", async () => {
    const res = await rpc(tokens.access_token, "initialize", { protocolVersion: "2025-06-18", capabilities: {} });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.result.protocolVersion, "2025-06-18");
    assert.strictEqual(res.body.result.serverInfo.name, "ph-agent-console");
    assert.match(res.body.result.instructions, /PH Agent Console/);
  });

  await test("advertises the PH mark, a display title and a website on serverInfo", async () => {
    const res = await rpc(tokens.access_token, "initialize", { protocolVersion: "2025-06-18" });
    const info = res.body.result.serverInfo;
    assert.strictEqual(info.title, "PH Agent Console");
    assert.strictEqual(info.websiteUrl, ORIGIN);
    assert.ok(Array.isArray(info.icons) && info.icons.length, "serverInfo should carry icons");
    // SVG first: crisp at whatever size a connector list renders at.
    assert.strictEqual(info.icons[0].mimeType, "image/svg+xml");
    assert.strictEqual(info.icons[0].src, `${ORIGIN}/img/ph-mark.svg`);
    // PNG fallbacks for clients that won't render SVG.
    const png = info.icons.filter((i) => i.mimeType === "image/png");
    assert.ok(png.length >= 2, "expected PNG fallbacks alongside the SVG");
    // Absolute URLs on this origin — a relative src is unresolvable to a
    // client that only ever talks to the /mcp endpoint.
    for (const icon of info.icons) assert.ok(icon.src.startsWith(`${ORIGIN}/`), `icon src must be absolute: ${icon.src}`);
  });

  await test("falls back to its newest protocol version for an unknown one", async () => {
    const res = await rpc(tokens.access_token, "initialize", { protocolVersion: "1999-01-01" });
    assert.strictEqual(res.body.result.protocolVersion, mcp.__test.SUPPORTED_PROTOCOL_VERSIONS[0]);
  });

  await test("accepts notifications/initialized with 202 and no body", async () => {
    const res = await call({
      method: "POST", path: "/mcp", body: { jsonrpc: "2.0", method: "notifications/initialized" },
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    assert.strictEqual(res.statusCode, 202);
  });

  await test("lists the tools, with read-only ones annotated", async () => {
    const res = await rpc(tokens.access_token, "tools/list", {});
    const names = res.body.result.tools.map((t) => t.name);
    for (const expected of ["whoami", "list_projects", "list_backlog_items", "get_backlog_item", "create_backlog_item", "update_backlog_item", "add_item_comment", "get_project_docs", "search_faq", "get_faq_article"]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
    const read = res.body.result.tools.find((t) => t.name === "list_projects");
    assert.strictEqual(read.annotations.readOnlyHint, true);
    const write = res.body.result.tools.find((t) => t.name === "create_backlog_item");
    assert.strictEqual(write.annotations.readOnlyHint, false);
  });

  // approve_deploy_to_main (Zogk8EKjKRKsM4GZBEJZ) is a deliberate, logged,
  // narrowly-scoped exception to this rule — see its own comment block in
  // mcp-server.js. The rule this test actually enforces is "no WRITE tool
  // deploys/merges/triggers anything", so it's scoped to board.write tools:
  // get_ready_for_testing_board is board.read and merely describes the
  // pipeline, which is exactly what it's for. The point of this test is
  // still to catch any other WRITE tool added later that shouldn't exist,
  // so it excludes only the one sanctioned name instead of dropping the
  // check entirely.
  await test("exposes no WRITE tool that deploys, merges or triggers a campaign, except the one deliberate carve-out", async () => {
    const CARVE_OUT = "approve_deploy_to_main";
    const writeTools = mcp.__test.TOOLS.filter((t) => t.scope === "board.write");
    assert.ok(writeTools.some((t) => t.name === CARVE_OUT), "the one deliberate deploy carve-out tool must exist and require board.write");
    for (const t of writeTools) {
      if (t.name === CARVE_OUT) continue;
      for (const forbidden of ["deploy", "merge", "publish", "notify", "trigger", "campaign", "train", "approve"]) {
        assert.ok(!t.name.includes(forbidden), `write tool "${t.name}" must not exist — only ${CARVE_OUT} may (found "${forbidden}")`);
      }
    }
  });

  await test("whoami reports the signed-in team member, not a shared key", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "whoami", arguments: {} });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.email, TEAMMATE);
    assert.strictEqual(payload.role, "editor");
    assert.strictEqual(payload.canWrite, true);
  });

  await test("lists projects with per-column ticket counts", async () => {
    env.store.col("projects").set("proj1", { name: "Live Visitor Profile", deployBranch: "deploy/live-visitor-profile" });
    env.store.col("projects").set("proj2", { name: "Experience Templates" });
    env.store.col("backlogItems").set("old1", { projectId: "proj1", title: "Existing", desc: "x", type: "bug", category: "HQ Admin", status: "ready-for-testing" });
    const res = await rpc(tokens.access_token, "tools/call", { name: "list_projects", arguments: {} });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.deepStrictEqual(payload.projects.map((p) => p.name), ["Experience Templates", "Live Visitor Profile"]);
    const lvp = payload.projects.find((p) => p.id === "proj1");
    assert.strictEqual(lvp.counts["ready-for-testing"], 1);
  });

  await test("files a ticket into Backlog, attributed to the person", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_backlog_item",
      arguments: { projectId: "proj1", desc: "The RRP shown on the HQ Admin grid is stale after a price change.", type: "bug" },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.created, true);
    assert.strictEqual(payload.status, "backlog");
    assert.strictEqual(payload.category, "Pricing & Offers", "category should be guessed the same way the board guesses it");
    const stored = env.store.col("backlogItems").get(payload.itemId);
    assert.strictEqual(stored.createdByEmail, TEAMMATE);
    assert.strictEqual(stored.createdVia, "mcp");
    assert.strictEqual(stored.notes[0].author, TEAMMATE);
  });

  await test("refuses a ticket on a project that doesn't exist", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "create_backlog_item", arguments: { projectId: "nope", desc: "hello" } });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /No project with id nope/);
  });

  await test("refuses a description past the board's own 2000-character limit", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "create_backlog_item", arguments: { projectId: "proj1", desc: "x".repeat(2001) } });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("adds a comment labelled with the person's email", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "add_item_comment", arguments: { itemId: "old1", text: "Retested on the preview link — still broken." } });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.added, true);
    const stored = env.store.col("backlogItems").get("old1");
    assert.strictEqual(stored.notes[stored.notes.length - 1].author, TEAMMATE);
  });

  await test("updates a ticket's area but has no way to change its status", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "update_backlog_item", arguments: { itemId: "old1", category: "Menu Board", status: "published-live" } });
    // status isn't in the schema; the handler ignores it entirely.
    assert.strictEqual(env.store.col("backlogItems").get("old1").category, "Menu Board");
    assert.strictEqual(env.store.col("backlogItems").get("old1").status, "ready-for-testing");
    assert.ok(!JSON.stringify(mcp.__test.TOOLS.find((t) => t.name === "update_backlog_item").inputSchema).includes("status"));
    assert.strictEqual(res.statusCode, 200);
  });

  await test("searches the published help centre and skips drafts", async () => {
    env.store.col("faqCategories").set("cat1", { name: "Pricing" });
    env.store.col("faqArticles").set("art1", { categoryId: "cat1", title: "Setting a local offer", slug: "local-offer", summary: "How stores override the RRP", bodyMd: "Steps...", keywords: ["offer"], status: "published" });
    env.store.col("faqArticles").set("art2", { categoryId: "cat1", title: "Draft offer article", slug: "draft", bodyMd: "offer", status: "draft" });
    const res = await rpc(tokens.access_token, "tools/call", { name: "search_faq", arguments: { query: "local offer" } });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.results.length, 1);
    assert.strictEqual(payload.results[0].id, "art1");
  });

  await test("returns a full article by slug", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_faq_article", arguments: { slug: "local-offer" } });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.title, "Setting a local offer");
    assert.strictEqual(payload.category, "Pricing");
  });

  await test("returns a project's requirements and interface contracts", async () => {
    env.store.col("projects").set("proj1", Object.assign(env.store.col("projects").get("proj1"), { requirementsMd: "# Requirements", readmeMd: "# Readme" }));
    env.store.col("interfaces").set("if1", { name: "LVP <-> Templates", projectIds: ["proj1", "proj2"], contentMd: "attribute envelope" });
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_project_docs", arguments: { projectId: "proj1" } });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.requirementsMd, "# Requirements");
    assert.strictEqual(payload.interfaces[0].name, "LVP <-> Templates");
  });

  // ── Documentation: full read/write ──────────────────────────────────────
  await test("exposes the documentation tools", async () => {
    const names = mcp.__test.TOOLS.map((t) => t.name);
    for (const expected of [
      "set_project_requirements", "set_project_readme", "set_project_artifact",
      "create_project_document", "update_project_document", "delete_project_document",
      "create_interface", "update_interface", "delete_interface",
      "list_doc_revisions", "get_doc_revision",
    ]) assert.ok(names.includes(expected), `missing tool ${expected}`);
  });

  await test("writes a project's Requirements", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "set_project_requirements",
      arguments: { projectId: "proj1", desc: undefined, contentMd: "# Requirements\n\nThe deadline model is authoritative." },
    });
    const out = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(out.updated, true);
    assert.match(env.store.col("projects").get("proj1").requirementsMd, /deadline model is authoritative/);
    assert.strictEqual(env.store.col("projects").get("proj1").requirementsUpdatedByEmail, TEAMMATE);
  });

  await test("keeps what a Requirements write replaced, and can read it back", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "set_project_requirements", arguments: { projectId: "proj1", contentMd: "# Requirements\n\nRewritten." },
    });
    const out = JSON.parse(res.body.result.content[0].text);
    assert.ok(out.revisionId, "a replaced version should be recorded");
    const back = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "get_doc_revision", arguments: { revisionId: out.revisionId },
    })).body.result.content[0].text);
    assert.match(back.contentMd, /deadline model is authoritative/, "the revision should hold the PREVIOUS text");
    assert.strictEqual(back.replacedByEmail, TEAMMATE);
  });

  await test("lists revisions newest-first for a project", async () => {
    const out = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "list_doc_revisions", arguments: { projectId: "proj1" },
    })).body.result.content[0].text);
    assert.ok(out.revisions.length >= 1);
    assert.ok(out.revisions.every((r) => typeof r.chars === "number"));
    // Metadata only — a list of 95 KB documents would be unusable.
    assert.ok(!("contentMd" in out.revisions[0]), "list should not inline document bodies");
  });

  await test("writes a project's README", async () => {
    await rpc(tokens.access_token, "tools/call", {
      name: "set_project_readme", arguments: { projectId: "proj1", contentMd: "# Readme\n\nWhat's in this folder." },
    });
    assert.match(env.store.col("projects").get("proj1").readmeMd, /What's in this folder/);
  });

  await test("refuses a Requirements document past the size ceiling", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "set_project_requirements", arguments: { projectId: "proj1", contentMd: "x".repeat(mcp.__test.PROJECT_MD_MAX + 1) },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("caps a project document at what the board's own editor can save", async () => {
    // Higher here would let an agent author a document a person could never
    // save an edit to, because firestore.rules would reject their write.
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_project_document", arguments: { projectId: "proj1", name: "Too big", contentMd: "x".repeat(mcp.__test.DOC_MD_MAX + 1) },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  let createdDocId = null;
  await test("creates, updates and deletes a project document, recoverably", async () => {
    const made = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "create_project_document", arguments: { projectId: "proj1", name: "Event schema", contentMd: "v1 shape" },
    })).body.result.content[0].text);
    createdDocId = made.docId;
    assert.strictEqual(env.store.col("projectDocs").get(createdDocId).createdByEmail, TEAMMATE);

    await rpc(tokens.access_token, "tools/call", {
      name: "update_project_document", arguments: { docId: createdDocId, contentMd: "v2 shape" },
    });
    assert.strictEqual(env.store.col("projectDocs").get(createdDocId).contentMd, "v2 shape");

    const gone = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "delete_project_document", arguments: { docId: createdDocId },
    })).body.result.content[0].text);
    assert.strictEqual(gone.deleted, true);
    assert.strictEqual(env.store.col("projectDocs").get(createdDocId), undefined);
    const back = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "get_doc_revision", arguments: { revisionId: gone.revisionId },
    })).body.result.content[0].text);
    assert.strictEqual(back.contentMd, "v2 shape", "a delete must be recoverable from the revision it wrote");
  });

  await test("creates and updates an interface contract between two projects", async () => {
    const made = JSON.parse((await rpc(tokens.access_token, "tools/call", {
      name: "create_interface", arguments: { projectIds: ["proj1", "proj2"], name: "LVP <-> Templates", contentMd: "attribute envelope v1" },
    })).body.result.content[0].text);
    assert.strictEqual(made.created, true);
    await rpc(tokens.access_token, "tools/call", { name: "update_interface", arguments: { interfaceId: made.interfaceId, contentMd: "attribute envelope v2" } });
    assert.strictEqual(env.store.col("interfaces").get(made.interfaceId).contentMd, "attribute envelope v2");
  });

  await test("refuses an interface that isn't between exactly two different projects", async () => {
    for (const projectIds of [["proj1"], ["proj1", "proj1"], ["proj1", "proj2", "proj1"]]) {
      const res = await rpc(tokens.access_token, "tools/call", { name: "create_interface", arguments: { projectIds, name: "n", contentMd: "c" } });
      assert.strictEqual(res.body.result.isError, true, `should refuse projectIds ${JSON.stringify(projectIds)}`);
    }
  });

  await test("sets and clears a project's Artifact link, https only", async () => {
    await rpc(tokens.access_token, "tools/call", { name: "set_project_artifact", arguments: { projectId: "proj1", artifactUrl: "https://claude.ai/public/artifacts/abc" } });
    assert.strictEqual(env.store.col("projects").get("proj1").artifactUrl, "https://claude.ai/public/artifacts/abc");
    const bad = await rpc(tokens.access_token, "tools/call", { name: "set_project_artifact", arguments: { projectId: "proj1", artifactUrl: "http://insecure.example/x" } });
    assert.strictEqual(bad.body.result.isError, true);
    await rpc(tokens.access_token, "tools/call", { name: "set_project_artifact", arguments: { projectId: "proj1", artifactUrl: null } });
    assert.strictEqual(env.store.col("projects").get("proj1").artifactUrl, null);
  });

  // ── FAQ write tools: create/update/review ────────────────────────────────
  await test("exposes the FAQ write and review tools", async () => {
    const names = mcp.__test.TOOLS.map((t) => t.name);
    for (const expected of ["create_faq_article", "update_faq_article", "list_pending_faq_revisions", "get_faq_revision", "comment_on_faq_revision"]) {
      assert.ok(names.includes(expected), `missing tool ${expected}`);
    }
  });

  await test("every FAQ write tool requires board.write; the review reads don't", async () => {
    for (const name of ["create_faq_article", "update_faq_article", "comment_on_faq_revision"]) {
      assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === name).scope, "board.write", `${name} must require board.write`);
    }
    for (const name of ["list_pending_faq_revisions", "get_faq_revision"]) {
      assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === name).scope, "board.read");
    }
  });

  await test("no FAQ write tool's schema can express status, reviewStatus or a delete", async () => {
    const faqWriteTools = mcp.__test.TOOLS.filter((t) => /faq/.test(t.name) && t.scope === "board.write");
    assert.ok(faqWriteTools.length >= 3);
    for (const tool of faqWriteTools) {
      const schema = JSON.stringify(tool.inputSchema);
      for (const forbidden of ["reviewStatus", "\"status\"", "approved", "publishedAt"]) {
        assert.ok(!schema.includes(forbidden), `${tool.name}'s schema mentions ${forbidden}`);
      }
      assert.ok(!tool.destructive, `${tool.name} must not be flagged destructive — no FAQ write tool deletes anything`);
    }
  });

  env.store.col("programs").set("prog1", { name: "Personalisation Hub" });

  let faqCreatedId = null;
  await test("creates a brand-new FAQ article as a draft, never published", async () => {
    env.store.col("faqCategories").set("cat2", { name: "Displays", icon: "tv", order: 1 });
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article",
      arguments: { title: "How QR control works on a display", categoryId: "cat2", bodyMd: "<p>Point a phone camera at the QR code.</p>", summary: "Explains QR control.", keywords: ["qr", "control"], programId: "prog1" },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.created, true);
    assert.strictEqual(payload.status, "draft");
    assert.strictEqual(payload.slug, "how-qr-control-works-on-a-display");
    faqCreatedId = payload.articleId;
    const stored = env.store.col("faqArticles").get(faqCreatedId);
    assert.strictEqual(stored.status, "draft");
    assert.strictEqual(stored.createdByEmail, TEAMMATE);
    assert.strictEqual(stored.createdVia, "mcp");
    assert.strictEqual(stored.docType, "faq");
    assert.strictEqual(stored.programId, "prog1");
    assert.ok(!stored.pendingRevision, "a brand-new article has nothing pending to review — it's just a draft");
  });

  await test("de-duplicates a slug that's already taken", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article",
      arguments: { title: "How QR control works on a display", categoryId: "cat2", bodyMd: "<p>Second one.</p>", programId: "prog1" },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.slug, "how-qr-control-works-on-a-display-2");
  });

  await test("refuses to create a FAQ article with no programId and no projectId to derive one from", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article",
      arguments: { title: "Unscoped", categoryId: "cat2", bodyMd: "<p>x</p>" },
    });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /programId is required/);
  });

  await test("defaults programId from projectId's own program when programId is omitted", async () => {
    env.store.col("projects").set("proj1", Object.assign(env.store.col("projects").get("proj1"), { programId: "prog1" }));
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article",
      arguments: { title: "Scoped via project", categoryId: "cat2", bodyMd: "<p>x</p>", projectId: "proj1" },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.created, true);
    assert.strictEqual(env.store.col("faqArticles").get(payload.articleId).programId, "prog1");
  });

  await test("refuses to create a FAQ article against a categoryId that doesn't exist", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article", arguments: { title: "Orphan", categoryId: "nope", bodyMd: "<p>x</p>" },
    });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /No FAQ category/);
  });

  await test("refuses a FAQ article body past the same ceiling firestore.rules enforces", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article",
      arguments: { title: "Too big", categoryId: "cat2", bodyMd: "x".repeat(mcp.__test.FAQ_BODY_MAX + 1) },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("refuses an invalid docType on create", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "create_faq_article", arguments: { title: "Bad type", categoryId: "cat2", bodyMd: "<p>x</p>", docType: "tutorial" },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  let liveArticleId = null;
  await test("proposes an update to a live article as a pendingRevision, leaving the live fields untouched", async () => {
    const ref = await env.db.collection("faqArticles").add({
      categoryId: "cat1", title: "Setting a local offer", slug: "local-offer-2", summary: "How stores override the RRP", bodyMd: "<p>Old steps.</p>", keywords: ["offer"], docType: "how-to", status: "published",
    });
    liveArticleId = ref.id;
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "update_faq_article",
      arguments: { articleId: liveArticleId, reason: "The store override screen moved to a new tab.", bodyMd: "<p>New steps.</p>" },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.proposed, true);
    assert.strictEqual(payload.reviewStatus, "awaiting-review");
    const stored = env.store.col("faqArticles").get(liveArticleId);
    // The live fields must be exactly what they were before.
    assert.strictEqual(stored.bodyMd, "<p>Old steps.</p>");
    assert.strictEqual(stored.status, "published");
    assert.strictEqual(stored.title, "Setting a local offer");
    // The proposal carries the full text (title/summary copied verbatim,
    // same "even the ones you didn't change" convention the Routine uses).
    assert.strictEqual(stored.pendingRevision.bodyMd, "<p>New steps.</p>");
    assert.strictEqual(stored.pendingRevision.title, "Setting a local offer");
    assert.strictEqual(stored.pendingRevision.summary, "How stores override the RRP");
    assert.strictEqual(stored.pendingRevision.reason, "The store override screen moved to a new tab.");
    assert.strictEqual(stored.pendingRevision.reviewStatus, "awaiting-review");
    assert.strictEqual(stored.needsReview, true);
    // Recorded as the actual signed-in person, not a shared "claude" label —
    // and distinguishably via a path marker, mirroring the Routine's own
    // proposedBy: "claude" convention without colliding with it.
    assert.strictEqual(stored.pendingRevision.proposedBy, TEAMMATE);
    assert.strictEqual(stored.pendingRevision.proposedVia, "mcp");
    // No backlog ticket triggered this — never invent one.
    assert.ok(!("sourceItemIds" in stored.pendingRevision) || stored.pendingRevision.sourceItemIds.length === 0);
  });

  await test("a second update_faq_article call builds on the pending proposal, not the stale live text", async () => {
    await rpc(tokens.access_token, "tools/call", {
      name: "update_faq_article", arguments: { articleId: liveArticleId, reason: "Also fix the title.", title: "Setting a local price override" },
    });
    const stored = env.store.col("faqArticles").get(liveArticleId);
    assert.strictEqual(stored.pendingRevision.title, "Setting a local price override");
    // bodyMd from the FIRST proposal must have carried forward, not reverted
    // to the original live text.
    assert.strictEqual(stored.pendingRevision.bodyMd, "<p>New steps.</p>");
  });

  await test("refuses update_faq_article with no reason", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "update_faq_article", arguments: { articleId: liveArticleId, title: "No reason given" },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("refuses update_faq_article on an unknown article", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "update_faq_article", arguments: { articleId: "does-not-exist", reason: "x", title: "y" },
    });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /No FAQ article/);
  });

  await test("refuses update_faq_article once the proposal is already approved", async () => {
    const stored = env.store.col("faqArticles").get(liveArticleId);
    env.store.col("faqArticles").set(liveArticleId, Object.assign({}, stored, {
      pendingRevision: Object.assign({}, stored.pendingRevision, { reviewStatus: "approved" }),
    }));
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "update_faq_article", arguments: { articleId: liveArticleId, reason: "one more tweak", title: "Should be refused" },
    });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /already has an approved update/);
    // Restore to awaiting-review for the tests below.
    const cur = env.store.col("faqArticles").get(liveArticleId);
    env.store.col("faqArticles").set(liveArticleId, Object.assign({}, cur, {
      pendingRevision: Object.assign({}, cur.pendingRevision, { reviewStatus: "awaiting-review" }),
    }));
  });

  await test("lists pending FAQ revisions, skipping bare needsReview flags with no proposal", async () => {
    // The older, coarser per-project safety net: flagged, but nothing to diff.
    env.store.col("faqArticles").set("bareFlag", { title: "Just flagged", needsReview: true, status: "published" });
    const res = await rpc(tokens.access_token, "tools/call", { name: "list_pending_faq_revisions", arguments: {} });
    const payload = JSON.parse(res.body.result.content[0].text);
    const ids = payload.revisions.map((r) => r.articleId);
    assert.ok(ids.includes(liveArticleId));
    assert.ok(!ids.includes("bareFlag"), "a bare needsReview flag with no pendingRevision has nothing to review here");
    const row = payload.revisions.find((r) => r.articleId === liveArticleId);
    assert.strictEqual(row.proposedBy, TEAMMATE);
    assert.strictEqual(row.proposedVia, "mcp");
    assert.strictEqual(row.reviewStatus, "awaiting-review");
    assert.ok(row.reason);
  });

  await test("gets old-vs-new for one pending FAQ revision", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_faq_revision", arguments: { articleId: liveArticleId } });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.live.bodyMd, "<p>Old steps.</p>");
    assert.strictEqual(payload.proposed.bodyMd, "<p>New steps.</p>");
    assert.strictEqual(payload.proposed.title, "Setting a local price override");
    assert.strictEqual(payload.reason, "Also fix the title.");
  });

  await test("refuses get_faq_revision on an article with nothing pending", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_faq_revision", arguments: { articleId: faqCreatedId } });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("comments on a pending FAQ revision, attributed to the person", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "comment_on_faq_revision", arguments: { articleId: liveArticleId, text: "Confirmed against the current UI — looks right." },
    });
    const payload = JSON.parse(res.body.result.content[0].text);
    assert.strictEqual(payload.added, true);
    const stored = env.store.col("faqArticles").get(liveArticleId);
    assert.strictEqual(stored.reviewComments.length, 1);
    assert.strictEqual(stored.reviewComments[0].author, TEAMMATE);
  });

  await test("refuses to comment on an article with no pending revision", async () => {
    const res = await rpc(tokens.access_token, "tools/call", {
      name: "comment_on_faq_revision", arguments: { articleId: faqCreatedId, text: "nothing to review here" },
    });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("a viewer can read FAQ revisions but cannot create, update or comment", async () => {
    const VIEWER2 = "faqviewer@personalisationhub.com";
    const idToken = signIn(VIEWER2);
    addConsoleUser(VIEWER2, { role: "viewer" });
    const v = b64url(crypto.randomBytes(32));
    const ch = b64url(crypto.createHash("sha256").update(v).digest());
    const auth = await call({
      method: "POST", path: "/mcp/authorize/complete",
      body: { idToken, clientId, redirectUri: REDIRECT, codeChallenge: ch, codeChallengeMethod: "S256", scope: "board.read board.write" },
    });
    const vcode = new URL(auth.body.redirect).searchParams.get("code");
    const tok = await call({
      method: "POST", path: "/mcp/token",
      body: { grant_type: "authorization_code", code: vcode, code_verifier: v, client_id: clientId, redirect_uri: REDIRECT },
    });
    const viewerToken = tok.body.access_token;

    const listed = await rpc(viewerToken, "tools/call", { name: "list_pending_faq_revisions", arguments: {} });
    assert.strictEqual(listed.body.result.isError, undefined, "a viewer can still read the review queue");

    const create = await rpc(viewerToken, "tools/call", { name: "create_faq_article", arguments: { title: "Nope", categoryId: "cat2", bodyMd: "<p>x</p>" } });
    assert.strictEqual(create.body.result.isError, true);
    assert.match(create.body.result.content[0].text, /read-only/);

    const update = await rpc(viewerToken, "tools/call", { name: "update_faq_article", arguments: { articleId: liveArticleId, reason: "x", title: "y" } });
    assert.strictEqual(update.body.result.isError, true);
    assert.match(update.body.result.content[0].text, /read-only/);

    const comment = await rpc(viewerToken, "tools/call", { name: "comment_on_faq_revision", arguments: { articleId: liveArticleId, text: "x" } });
    assert.strictEqual(comment.body.result.isError, true);
    assert.match(comment.body.result.content[0].text, /read-only/);

    // The live article must still be exactly as it was — no write leaked through.
    assert.strictEqual(env.store.col("faqArticles").get(liveArticleId).bodyMd, "<p>Old steps.</p>");
  });

  // ── The guarantee the documentation tools must not break ────────────────
  // These are the first tools that write to `projects` at all, so "no tool
  // can start a deploy" stops being a consequence of never touching the
  // collection and starts needing enforcement.
  await test("no documentation write touched a train field on the project", async () => {
    const project = env.store.col("projects").get("proj1");
    // proj1 is seeded as a project mid-release, so it legitimately HAS a
    // deployBranch. The claim is that the documentation writes left it
    // exactly as it was, and introduced none of the others.
    assert.strictEqual(project.deployBranch, "deploy/live-visitor-profile", "deployBranch must be untouched by documentation writes");
    for (const field of ["trainReady", "trainStatus", "trainPrNumber", "trainNote", "trainLocked", "needsHumanMerge", "notifyRequestedAt", "deployNotifyRequestedAt", "patchReady", "mergeReady"]) {
      assert.ok(!(field in project), `documentation writes must never set projects.${field}, found it after the doc suite`);
    }
  });

  await test("updateProjectFields refuses a train field even if a caller asks for one", async () => {
    // The allowlist is the enforcement point, so prove it throws rather than
    // trusting every future call site to pass only good keys.
    await assert.rejects(
      () => mcp.__test.updateProjectFields("proj1", { trainReady: true }),
      (err) => /refusing to write projects\.trainReady/.test(String(err.message)),
    );
    assert.ok(!("trainReady" in env.store.col("projects").get("proj1")));
  });

  await test("the project write allowlist holds nothing that could ship code", async () => {
    const allowed = [...mcp.__test.PROJECT_WRITABLE_FIELDS];
    for (const field of allowed) {
      assert.ok(/^(requirements|readme|artifact)/.test(field), `${field} is not a documentation field but is writable`);
    }
    for (const forbidden of ["deployBranch", "trainReady", "trainStatus", "trainPrNumber", "trainNote", "trainLocked", "needsHumanMerge", "notifyRequestedAt", "deployNotifyRequestedAt", "name", "programId"]) {
      assert.ok(!mcp.__test.PROJECT_WRITABLE_FIELDS.has(forbidden), `${forbidden} must not be writable`);
    }
  });

  await test("no documentation tool's schema can even express a train field", async () => {
    const docTools = mcp.__test.TOOLS.filter((t) => /project|interface|doc/.test(t.name));
    for (const tool of docTools) {
      const schema = JSON.stringify(tool.inputSchema);
      for (const forbidden of ["trainReady", "deployBranch", "trainLocked", "status", "patchReady", "mergeReady"]) {
        assert.ok(!schema.includes(forbidden), `${tool.name}'s schema mentions ${forbidden}`);
      }
    }
  });

  await test("every documentation write is gated on board.write, so a viewer can't", async () => {
    // Structural rather than per-tool: it catches a new doc tool added later
    // with the scope left off, which a per-tool test would not.
    const writeNames = ["set_project_requirements", "set_project_readme", "set_project_artifact",
      "create_project_document", "update_project_document", "delete_project_document",
      "create_interface", "update_interface", "delete_interface"];
    for (const name of writeNames) {
      assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === name).scope, "board.write", `${name} must require board.write`);
    }
    for (const name of ["list_doc_revisions", "get_doc_revision", "get_project_docs"]) {
      assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === name).scope, "board.read");
    }
  });

  await test("only the delete tools are flagged destructive", async () => {
    const destructive = mcp.__test.TOOLS.filter((t) => t.destructive).map((t) => t.name).sort();
    assert.deepStrictEqual(destructive, ["delete_interface", "delete_project_document", "delete_skill"]);
  });

  // ── Composable UI: Ready for Testing board ───────────────────────────────
  // (ZXmW4lHMKpQRlarlwK7z) — deliberately on its own fixture project
  // ("depproj") so nothing here touches proj1, which "no documentation
  // write touched a train field on the project" above already asserts stays
  // pristine.
  await test("get_ready_for_testing_board returns escaped HTML cards plus the same data as JSON", async () => {
    env.store.col("projects").set("depproj", { name: "Deploy Playground", deployBranch: "deploy/depproj" });
    env.store.col("backlogItems").set("rft1", {
      projectId: "depproj", title: "<script>evil()</script> Fix RRP grid", desc: "The RRP shown is stale.",
      testSummary: "Fixed the stale RRP — refetches on price change now.",
      type: "bug", category: "HQ Admin", status: "ready-for-testing",
      testVersion: "1.5.70", previewUrl: "https://rawcdn.githack.com/offline2online/rob_ph_demos/deploy/depproj/index.html",
    });
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_ready_for_testing_board", arguments: { projectId: "depproj" } });
    assert.strictEqual(res.body.result.isError, undefined);
    const [text, resource, json] = res.body.result.content;
    assert.strictEqual(text.type, "text");
    assert.strictEqual(resource.type, "resource");
    assert.strictEqual(resource.resource.mimeType, "text/html");
    assert.ok(!resource.resource.text.includes("<script>evil()"), "a ticket title must never inject a raw <script> tag into the widget");
    assert.match(resource.resource.text, /&lt;script&gt;/);
    assert.match(resource.resource.text, /Fixed the stale RRP/);
    assert.match(resource.resource.text, /Test this/);
    const payload = JSON.parse(json.text);
    assert.strictEqual(payload.count, 1);
    assert.strictEqual(payload.items[0].id, "rft1");
    assert.strictEqual(payload.items[0].testVersion, "1.5.70");
  });

  await test("get_ready_for_testing_board never links a javascript: previewUrl", async () => {
    env.store.col("backlogItems").set("rft2", {
      projectId: "depproj", title: "Sketchy link", desc: "x", type: "bug", category: "HQ Admin",
      status: "ready-for-testing", previewUrl: "javascript:alert(1)",
    });
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_ready_for_testing_board", arguments: { projectId: "depproj" } });
    const [, resource] = res.body.result.content;
    assert.ok(!resource.resource.text.includes("javascript:"), "a non-https previewUrl must never become a clickable href");
    env.store.col("backlogItems").delete("rft2");
  });

  await test("get_ready_for_testing_board refuses an unknown project", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "get_ready_for_testing_board", arguments: { projectId: "nope" } });
    assert.strictEqual(res.body.result.isError, true);
  });

  // ── The one deliberate deploy exception ─────────────────────────────────
  // (Zogk8EKjKRKsM4GZBEJZ) — deliberately on its own fixture project
  // ("depproj") so nothing here touches proj1, which "no documentation
  // write touched a train field on the project" above already asserts
  // stays pristine.
  await test("approve_deploy_to_main refuses while a ticket on the train is still in Ready for Testing", async () => {
    env.store.col("projects").set("depproj", { name: "Deploy Playground", deployBranch: "deploy/depproj" });
    env.store.col("backlogItems").set("dtst1", {
      projectId: "depproj", title: "Still testing", desc: "x", type: "bug", category: "HQ Admin",
      status: "ready-for-testing", deployCommit: "sha-dtst1",
    });
    env.store.col("backlogItems").set("dtst2", {
      projectId: "depproj", title: "Approved one", desc: "x", type: "feature", category: "HQ Admin",
      status: "ready-to-publish", deployCommit: "sha-dtst2",
    });
    const res = await rpc(tokens.access_token, "tools/call", { name: "approve_deploy_to_main", arguments: { projectId: "depproj" } });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /still in Ready for Testing/);
    assert.ok(!("deployNotifyRequestedAt" in env.store.col("projects").get("depproj")), "a blocked call must never write the trigger field");
  });

  await test("approve_deploy_to_main fires the same trigger the console button writes, once the whole train is approved", async () => {
    env.store.col("backlogItems").set("dtst1", Object.assign(env.store.col("backlogItems").get("dtst1"), { status: "ready-to-publish" }));
    const fire = await rpc(tokens.access_token, "tools/call", { name: "approve_deploy_to_main", arguments: { projectId: "depproj" } });
    assert.strictEqual(fire.body.result.isError, undefined);
    const payload = JSON.parse(fire.body.result.content[0].text);
    assert.strictEqual(payload.fired, true);
    assert.strictEqual(payload.deployCount, 2);
    const project = env.store.col("projects").get("depproj");
    assert.ok(project.deployNotifyRequestedAt, "must write the same field the console's Deploy to Main button writes");
    assert.strictEqual(project.deployNotifyRequestedVia, "mcp");
    assert.strictEqual(project.deployNotifyRequestedByEmail, TEAMMATE);
    for (const field of ["trainReady", "trainStatus", "trainPrNumber", "trainNote", "trainLocked", "needsHumanMerge"]) {
      assert.ok(!(field in project), `approve_deploy_to_main must never itself set projects.${field}`);
    }
    const auditRow = [...env.store.col("mcpAuditLog").values()].find((r) => r.tool === "approve_deploy_to_main");
    assert.ok(auditRow, "must audit-log the deploy trigger");
    assert.strictEqual(auditRow.email, TEAMMATE);
    assert.strictEqual(auditRow.projectId, "depproj");
  });

  await test("approve_deploy_to_main refuses while a pending revert sits on the train", async () => {
    env.store.col("projects").set("revertproj", { name: "Revert Playground", deployBranch: "deploy/revertproj" });
    env.store.col("backlogItems").set("rev1", {
      projectId: "revertproj", title: "Reverted fix", desc: "x", type: "bug", category: "HQ Admin",
      status: "backlog", deployCommit: "sha-rev1", revertRequested: true,
    });
    const res = await rpc(tokens.access_token, "tools/call", { name: "approve_deploy_to_main", arguments: { projectId: "revertproj" } });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /pending revert/);
    assert.ok(!("deployNotifyRequestedAt" in env.store.col("projects").get("revertproj")));
  });

  await test("approve_deploy_to_main refuses an unknown project", async () => {
    const res = await rpc(tokens.access_token, "tools/call", { name: "approve_deploy_to_main", arguments: { projectId: "nope" } });
    assert.strictEqual(res.body.result.isError, true);
  });

  await test("approve_deploy_to_main is board.write, so a viewer is refused", async () => {
    assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === "approve_deploy_to_main").scope, "board.write");
    assert.strictEqual(mcp.__test.TOOLS.find((t) => t.name === "get_ready_for_testing_board").scope, "board.read");
  });

  await test("writes an audit row for every write", async () => {
    const rows = [...env.store.col("mcpAuditLog").values()];
    assert.ok(rows.length >= 3, `expected audit rows, got ${rows.length}`);
    assert.ok(rows.every((r) => r.email === TEAMMATE));
  });

  // ── role and revocation ─────────────────────────────────────────────────
  await test("a viewer gets the tool list but is refused a write", async () => {
    const VIEWER = "viewer@personalisationhub.com";
    const idToken = signIn(VIEWER);
    addConsoleUser(VIEWER, { role: "viewer" });
    const v = b64url(crypto.randomBytes(32));
    const ch = b64url(crypto.createHash("sha256").update(v).digest());
    const auth = await call({
      method: "POST", path: "/mcp/authorize/complete",
      body: { idToken, clientId, redirectUri: REDIRECT, codeChallenge: ch, codeChallengeMethod: "S256", scope: "board.read board.write" },
    });
    const vcode = new URL(auth.body.redirect).searchParams.get("code");
    const tok = await call({
      method: "POST", path: "/mcp/token",
      body: { grant_type: "authorization_code", code: vcode, code_verifier: v, client_id: clientId, redirect_uri: REDIRECT },
    });
    assert.ok(!tok.body.scope.includes("board.write"), "board.write must never be granted to a viewer");
    const res = await rpc(tok.body.access_token, "tools/call", { name: "create_backlog_item", arguments: { projectId: "proj1", desc: "nope" } });
    assert.strictEqual(res.body.result.isError, true);
    assert.match(res.body.result.content[0].text, /read-only/);
  });

  await test("rotates the refresh token and kills the old one", async () => {
    const first = await call({ method: "POST", path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } });
    assert.strictEqual(first.statusCode, 200);
    assert.notStrictEqual(first.body.refresh_token, tokens.refresh_token);
    const replay = await call({ method: "POST", path: "/mcp/token", body: { grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId } });
    assert.strictEqual(replay.statusCode, 400);
    assert.match(replay.body.error_description, /revoked/);
    tokens = first.body;
  });

  await test("turning off agent access cuts an existing token off immediately", async () => {
    addConsoleUser(TEAMMATE, { role: "editor", mcpEnabled: false });
    const res = await rpc(tokens.access_token, "tools/call", { name: "whoami", arguments: {} });
    assert.strictEqual(res.statusCode, 401);
    assert.match(res.headers["WWW-Authenticate"], /agent access is turned off/);
    addConsoleUser(TEAMMATE, { role: "editor", mcpEnabled: true });
  });

  await test("removing someone from consoleUsers cuts their token off immediately", async () => {
    env.store.col("consoleUsers").delete(TEAMMATE);
    const res = await rpc(tokens.access_token, "tools/call", { name: "whoami", arguments: {} });
    assert.strictEqual(res.statusCode, 401);
    addConsoleUser(TEAMMATE, { role: "editor" });
  });

  await test("a bootstrap admin works even with an empty consoleUsers collection", async () => {
    const ownerToken = signIn("rob@offline2online.com");
    const v = b64url(crypto.randomBytes(32));
    const ch = b64url(crypto.createHash("sha256").update(v).digest());
    const res = await call({
      method: "POST", path: "/mcp/authorize/complete",
      body: { idToken: ownerToken, clientId, redirectUri: REDIRECT, codeChallenge: ch, codeChallengeMethod: "S256" },
    });
    assert.strictEqual(res.statusCode, 200);
  });

  // ── console-side endpoints ──────────────────────────────────────────────
  await test("lists a person's own agent connections from the console", async () => {
    const res = await call({ method: "GET", path: "/mcp/me/connections", headers: { "X-Firebase-ID-Token": teammateIdToken } });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.email, TEAMMATE);
    assert.ok(res.body.clients.length >= 1);
    assert.strictEqual(res.body.clients[0].clientName, "Claude");
  });

  await test("a person can revoke their own connections", async () => {
    const res = await call({ method: "POST", path: "/mcp/me/connections", body: {}, headers: { "X-Firebase-ID-Token": teammateIdToken } });
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.revoked > 0);
    const after = await rpc(tokens.access_token, "tools/call", { name: "whoami", arguments: {} });
    assert.strictEqual(after.statusCode, 401);
  });

  await test("a non-admin cannot revoke someone else's connections", async () => {
    const res = await call({ method: "POST", path: "/mcp/me/connections", body: { email: "rob@offline2online.com" }, headers: { "X-Firebase-ID-Token": teammateIdToken } });
    assert.strictEqual(res.statusCode, 403);
  });

  await test("a non-admin cannot provision sign-in credentials", async () => {
    const res = await call({ method: "POST", path: "/mcp/admin/provision", body: { email: TEAMMATE }, headers: { "X-Firebase-ID-Token": teammateIdToken } });
    assert.strictEqual(res.statusCode, 403);
  });

  await test("an admin provisions a password account for a member with no Google login", async () => {
    const ownerToken = signIn("rob@offline2online.com");
    addConsoleUser("newhire@personalisationhub.com", { role: "editor", displayName: "New Hire" });
    const res = await call({ method: "POST", path: "/mcp/admin/provision", body: { email: "newhire@personalisationhub.com" }, headers: { "X-Firebase-ID-Token": ownerToken } });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.created, true);
    assert.ok(env.authState.created.includes("newhire@personalisationhub.com"));
    const user = env.authState.users.get("newhire@personalisationhub.com");
    assert.strictEqual(user.customClaims.consoleRole, "editor");
    assert.strictEqual(user.customClaims.consoleEditor, true);
  });

  await test("the consoleUsers trigger syncs a custom claim onto the Auth user", async () => {
    const trigger = env.captured.firestoreTriggers.get("consoleUsers/{userEmail}");
    assert.ok(trigger, "a consoleUsers trigger should be registered");
    await trigger({
      params: { userEmail: TEAMMATE },
      data: { after: { exists: true, data: () => ({ email: TEAMMATE, role: "admin" }) } },
    });
    assert.strictEqual(env.authState.users.get(TEAMMATE).customClaims.consoleRole, "admin");
    await trigger({ params: { userEmail: TEAMMATE }, data: { after: { exists: false } } });
    assert.strictEqual(env.authState.users.get(TEAMMATE).customClaims.consoleRole, undefined);
  });

  await test("an unknown path 404s rather than falling through to the MCP endpoint", async () => {
    const res = await call({ method: "POST", path: "/mcp/nope" });
    assert.strictEqual(res.statusCode, 404);
  });

  await test("GET on the MCP endpoint answers 405, as a client probing for SSE expects", async () => {
    const res = await call({ method: "GET", path: "/mcp", headers: { Authorization: `Bearer ${tokens.access_token}` } });
    assert.strictEqual(res.statusCode, 405);
    assert.match(res.headers.Allow, /POST/);
  });

  env.restore();
  console.log(`\n${passed} passed, ${failures.length} failed\n`);
  if (failures.length) {
    for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  }
})();
