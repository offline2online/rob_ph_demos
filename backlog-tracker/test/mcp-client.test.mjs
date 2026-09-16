// The real @modelcontextprotocol/sdk client, connecting to the real
// functions/mcp-server.js over real HTTP (mcp-live-server.js).
//
// mcp-server.test.js proves the logic; this proves the WIRE. The SDK does its
// own discovery, dynamic client registration, PKCE and token exchange here —
// none of it is simulated — so this is what catches a metadata document a real
// client won't accept, a redirect a real client won't follow, or a transport
// detail (405 on GET, 202 on a notification, the WWW-Authenticate hint) that
// an in-process test would never exercise.
//
// The only scripted part is the human's click on the consent page: that POSTs
// the signed-in Firebase ID token to /mcp/authorize/complete exactly as the
// page's own JavaScript does.
//
// Run with:  npm run test:client   (.mjs because it is ESM, alongside CJS suites)
import assert from "assert";
import { createRequire } from "module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";

const require = createRequire(import.meta.url);
const { server } = require("./mcp-live-server.js");

const PORT = 8100;
const BASE = `http://localhost:${PORT}/mcp`;
const REDIRECT = "http://localhost:9999/callback";

let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (err) { failures.push([name, err]); console.log(`FAIL  ${name}\n      ${err && err.message}`); }
}

// The SDK's OAuthClientProvider contract, backed by plain variables.
let clientInfo, tokens, verifier, authorizationUrl;
const provider = {
  get redirectUrl() { return REDIRECT; },
  get clientMetadata() {
    return {
      client_name: "MCP SDK test client",
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "board.read board.write",
    };
  },
  clientInformation() { return clientInfo; },
  saveClientInformation(info) { clientInfo = info; },
  tokens() { return tokens; },
  saveTokens(t) { tokens = t; },
  saveCodeVerifier(v) { verifier = v; },
  codeVerifier() { return verifier; },
  redirectToAuthorization(url) { authorizationUrl = url; },
};

const text = (result) => JSON.parse(result.content[0].text);

await new Promise((r) => server.listen(PORT, r));
console.log("\nReal MCP client ↔ real mcp-server.js, over HTTP\n");

const client = new Client({ name: "ph-console-test-client", version: "1.0.0" });
let transport = new StreamableHTTPClientTransport(new URL(BASE), { authProvider: provider });

await test("an unauthenticated connect is refused, and the client discovers the sign-in flow", async () => {
  await assert.rejects(() => client.connect(transport), (err) => err instanceof UnauthorizedError);
  assert.ok(authorizationUrl, "the client should have been sent to an authorization endpoint");
  assert.strictEqual(authorizationUrl.pathname, "/mcp/authorize");
});

await test("the client registered itself dynamically — nothing configured by hand", async () => {
  assert.ok(clientInfo && clientInfo.client_id, "no client_id was issued");
  assert.match(clientInfo.client_id, /^mcpc_/);
});

await test("the consent page renders, offering Google and email/password", async () => {
  const resp = await fetch(authorizationUrl);
  assert.strictEqual(resp.status, 200);
  const html = await resp.text();
  assert.match(html, /Connect your agent/);
  assert.match(html, /Sign in with Google/);
  assert.match(html, /or use your email and password/);
});

let code;
await test("signing in as a team member yields an authorization code", async () => {
  const q = authorizationUrl.searchParams;
  const resp = await fetch(`http://localhost:${PORT}/mcp/authorize/complete`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      idToken: "firebase-id-token-sam",
      clientId: q.get("client_id"), redirectUri: q.get("redirect_uri"), state: q.get("state"),
      scope: q.get("scope"), codeChallenge: q.get("code_challenge"), codeChallengeMethod: q.get("code_challenge_method"),
      resource: q.get("resource"),
    }),
  });
  assert.strictEqual(resp.status, 200);
  const { redirect } = await resp.json();
  code = new URL(redirect).searchParams.get("code");
  assert.ok(code);
});

await test("the SDK exchanges the code with PKCE and gets a bearer token", async () => {
  await transport.finishAuth(code);
  assert.strictEqual(tokens.token_type, "Bearer");
  assert.strictEqual(tokens.expires_in, 3600);
  assert.match(tokens.scope, /board\.write/);
  assert.ok(tokens.refresh_token);
});

await test("the client connects and the server identifies itself", async () => {
  transport = new StreamableHTTPClientTransport(new URL(BASE), { authProvider: provider });
  await client.connect(transport);
  const info = client.getServerVersion();
  assert.strictEqual(info.name, "ph-agent-console");
});

await test("a real client sees the PH mark on serverInfo", async () => {
  const info = client.getServerVersion();
  assert.strictEqual(info.title, "PH Agent Console");
  assert.ok(Array.isArray(info.icons) && info.icons.length, "the SDK should surface icons");
  assert.strictEqual(info.icons[0].mimeType, "image/svg+xml");
  // The SDK validates serverInfo against ImplementationSchema, so this also
  // proves the icon shape is one a real client will accept rather than drop.
  assert.ok(info.icons.every((i) => typeof i.src === "string" && i.src.startsWith("http")));
});

await test("every advertised icon is actually served, not just named", async () => {
  // A 404 here would show as a blank tile in the connector list — the exact
  // failure this change exists to fix — and nothing else would catch it.
  const info = client.getServerVersion();
  const fs = await import("fs");
  const path = await import("path");
  const { fileURLToPath } = await import("url");
  // Resolved from this file, not process.cwd(), so the check holds however
  // the suite is invoked.
  const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
  for (const icon of info.icons) {
    const file = path.join(publicDir, new URL(icon.src).pathname);
    assert.ok(fs.existsSync(file), `${icon.src} has no file at ${file}`);
    assert.ok(fs.statSync(file).size > 100, `${icon.src} is suspiciously small`);
  }
});

await test("tools/list returns the whole surface", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepStrictEqual(names, [
    "add_item_comment", "create_backlog_item", "get_backlog_item", "get_faq_article",
    "get_project_docs", "list_backlog_items", "list_projects", "search_faq",
    "update_backlog_item", "whoami",
  ]);
});

await test("whoami names the signed-in person, not a shared key", async () => {
  const me = text(await client.callTool({ name: "whoami", arguments: {} }));
  assert.strictEqual(me.email, "sam@personalisationhub.com");
  assert.strictEqual(me.role, "editor");
  assert.strictEqual(me.canWrite, true);
});

await test("list_projects returns projects with pipeline counts", async () => {
  const out = text(await client.callTool({ name: "list_projects", arguments: {} }));
  const lvp = out.projects.find((p) => p.id === "proj-lvp");
  assert.strictEqual(lvp.name, "Live Visitor Profile");
  assert.strictEqual(lvp.counts["ready-for-testing"], 1);
});

let filedId;
await test("create_backlog_item files a ticket into Backlog with a guessed area", async () => {
  const out = text(await client.callTool({
    name: "create_backlog_item",
    arguments: { projectId: "proj-lvp", desc: "Pricing grid shows a stale RRP after HQ changes it.", type: "bug" },
  }));
  assert.strictEqual(out.created, true);
  assert.strictEqual(out.status, "backlog");
  assert.strictEqual(out.category, "Pricing & Offers");
  filedId = out.itemId;
});

await test("the filed ticket reads back with the person's email on it", async () => {
  const item = text(await client.callTool({ name: "get_backlog_item", arguments: { itemId: filedId } }));
  assert.strictEqual(item.project, "Live Visitor Profile");
  assert.strictEqual(item.notes[0].author, "sam@personalisationhub.com");
});

await test("add_item_comment is attributed to the person", async () => {
  const out = text(await client.callTool({ name: "add_item_comment", arguments: { itemId: "tick-1", text: "Reproduced on the preview link." } }));
  assert.strictEqual(out.author, "sam@personalisationhub.com");
});

await test("search_faq finds a published help-centre article", async () => {
  const out = text(await client.callTool({ name: "search_faq", arguments: { query: "local offer rrp" } }));
  assert.strictEqual(out.results[0].title, "Setting a local offer in Retail Admin");
  assert.strictEqual(out.results[0].docType, "how-to");
});

await test("a tool error comes back as a tool error, not a transport failure", async () => {
  const out = await client.callTool({ name: "create_backlog_item", arguments: { projectId: "nope", desc: "x" } });
  assert.strictEqual(out.isError, true);
  assert.match(out.content[0].text, /No project with id nope/);
});

await test("there is no deploy tool to call", async () => {
  await assert.rejects(
    () => client.callTool({ name: "deploy_to_main", arguments: {} }),
    (err) => /Unknown tool/.test(String(err.message)),
  );
});

await test("a request with no token gets 401 and is told where to authenticate", async () => {
  const resp = await fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.strictEqual(resp.status, 401);
  assert.match(resp.headers.get("www-authenticate") || "", /resource_metadata=/);
});

await test("the two discovery documents are reachable where a client looks for them", async () => {
  const prm = await fetch(`http://localhost:${PORT}/.well-known/oauth-protected-resource/mcp`);
  assert.strictEqual(prm.status, 200);
  assert.strictEqual((await prm.json()).resource, BASE);
  const asm = await fetch(`http://localhost:${PORT}/.well-known/oauth-authorization-server`);
  assert.strictEqual(asm.status, 200);
  assert.deepStrictEqual((await asm.json()).code_challenge_methods_supported, ["S256"]);
});

await client.close();
server.close();

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const [name, err] of failures) console.error(`--- ${name}\n${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
}
