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

  await test("exposes no tool that deploys, merges or triggers a campaign", async () => {
    const names = mcp.__test.TOOLS.map((t) => t.name).join(" ");
    for (const forbidden of ["deploy", "merge", "publish", "notify", "trigger", "campaign", "train", "approve"]) {
      assert.ok(!names.includes(forbidden), `tool surface must not include "${forbidden}"`);
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
