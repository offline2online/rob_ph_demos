// PH Agent Console — MCP server + its own OAuth 2.1 authorization server.
//
// WHAT THIS IS FOR
// The console (this app, https://backlog-tracker-e4ed2.web.app/) is already
// behind Google sign-in for people. This module puts the same board behind
// an MCP endpoint so a TEAM MEMBER'S AI AGENT — Claude Desktop, Claude
// Code, claude.ai custom connectors, or anything else that speaks MCP — can
// read and update the board as that person, signing in with the exact same
// Personalisation Hub / offline2online credentials they already use for the
// console. No per-person API key to mint, copy around or rotate: the agent
// runs an ordinary OAuth flow, the person clicks "Sign in with Google" (or
// types their email + password), and that is the whole setup.
//
// WHY AN OAUTH SERVER AND NOT "PASTE A TOKEN"
// BOARD_API_KEY (see boardApi in index.js) is one shared secret that speaks
// for the whole board with no idea who is holding it. That is fine for one
// automation principal; it is exactly wrong for a team. Here every access
// token is bound to one signed-in Firebase Auth user, carries that person's
// role, is revocable on its own, and every write it makes is attributed to
// their email — on the ticket itself and in mcpAuditLog.
//
// WHAT IT DELIBERATELY DOES NOT DO
// Triggering campaigns / Notify Claude / Deploy to Main stay where they
// are: the board's own buttons and the Routine they fire. No tool here
// fires a Routine, writes a train field (trainReady, patchReady,
// mergeReady, revertReady), or moves a card's status. Agents file, read,
// enrich and comment on work; the release pipeline keeps its human gates.
// See MCP.md → "What the agent can and can't do".
//
// SHAPE OF THE HTTP SURFACE (all under https://<host>/mcp, plus two
// well-known documents that RFC 9728/8414 require at the host root):
//   GET  /.well-known/oauth-protected-resource[/mcp]  resource metadata
//   GET  /.well-known/oauth-authorization-server[/*]  AS metadata
//   POST /mcp/register            dynamic client registration (RFC 7591)
//   GET  /mcp/authorize           sign-in page (Google or email+password)
//   POST /mcp/authorize/complete  page posts the Firebase ID token here
//   POST /mcp/token               code+PKCE -> access/refresh token
//   POST /mcp/revoke              token revocation (RFC 7009)
//   POST /mcp                     the MCP endpoint itself (Streamable HTTP)
//   POST /mcp/claims/sync         self-heal a new member's custom claim
//   POST /mcp/admin/provision     admin: ensure a member's sign-in exists
"use strict";

const crypto = require("crypto");
const { onRequest } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

// initializeApp() runs in index.js before this module is required; resolve
// the SDK singletons lazily so require order can never bite.
const db = () => getFirestore();
const adminAuth = () => getAuth();

const PROJECT_ID = process.env.GCLOUD_PROJECT || "backlog-tracker-e4ed2";
// Where the console is actually served from — the origin a hosting rewrite
// puts in front of this function. Everything the OAuth documents advertise
// has to be reachable at this origin, not at the raw cloudfunctions.net URL,
// or clients will discover endpoints they then can't redirect back through.
const PUBLIC_ORIGIN = process.env.MCP_PUBLIC_ORIGIN || `https://${PROJECT_ID}.web.app`;
const RESOURCE_URL = `${PUBLIC_ORIGIN}/mcp`;
// The Personalisation Hub mark (public/img/ph-mark.*), served as static files
// from this same origin. MCP's Implementation schema carries an `icons` array,
// so a client can show the PH mark beside this server in its connector/tool
// list instead of a generic placeholder. SVG first — crisp at any size and
// under a kilobyte — with PNGs for clients that won't render SVG.
//
// No `theme` variants: the mark's centre is transparent rather than white, so
// the four coloured bars read correctly on a light and a dark UI alike.
const SERVER_ICONS = [
  { src: `${PUBLIC_ORIGIN}/img/ph-mark.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
  { src: `${PUBLIC_ORIGIN}/img/ph-mark-512.png`, mimeType: "image/png", sizes: ["512x512"] },
  { src: `${PUBLIC_ORIGIN}/img/ph-mark-192.png`, mimeType: "image/png", sizes: ["192x192"] },
  { src: `${PUBLIC_ORIGIN}/img/ph-mark-64.png`, mimeType: "image/png", sizes: ["64x64"] },
];

// Same non-secret web config the console itself uses (public/js/firebase-config.js)
// — the sign-in page below is a normal Firebase Auth client.
const WEB_API_KEY = "AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g";
const AUTH_DOMAIN = `${PROJECT_ID}.firebaseapp.com`;

// Mirrors firestore.rules' own bootstrap list: these two accounts are
// always admins even if consoleUsers is empty, so there is no way to lock
// every owner out of the thing that grants access. Everyone else is a
// consoleUsers doc. board-automation@ is intentionally NOT here — it is the
// Routine's service identity, not a person, and has no business holding an
// MCP token.
const STATIC_ADMINS = ["rob@offline2online.com", "rob@personalisationhub.com"];

const ROLE_RANK = { viewer: 1, editor: 2, admin: 3 };
const ACCESS_TOKEN_TTL_S = 60 * 60;            // 1 hour
const REFRESH_TOKEN_TTL_S = 60 * 60 * 24 * 60; // 60 days
const AUTH_CODE_TTL_S = 10 * 60;               // 10 minutes
const SCOPES = ["board.read", "board.write"];

// MCP protocol versions this server can speak, newest first. initialize
// echoes the client's version when we know it, and otherwise answers with
// the newest — which is what the spec tells a server to do when it does not
// support what the client asked for.
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// ── small helpers ─────────────────────────────────────────────────────────

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function sha256b64url(input) {
  return b64url(crypto.createHash("sha256").update(input).digest());
}
// Tokens and codes are random secrets; only their SHA-256 is ever written
// to Firestore, so a leaked database dump cannot be replayed against the
// board. (The doc id IS the hash — a lookup is one get(), no scan.)
function newSecret(prefix) {
  return `${prefix}_${b64url(crypto.randomBytes(32))}`;
}
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
function constantTimeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
// JSON destined for a <script> block: close out "</script>" and friends so
// a value can never end the element it lives in.
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
function nowSeconds() { return Math.floor(Date.now() / 1000); }
function tsToISO(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  return null;
}

function cors(req, res) {
  const origin = req.get("origin");
  res.set("Access-Control-Allow-Origin", origin || "*");
  if (origin) res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID");
  res.set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id");
  res.set("Access-Control-Max-Age", "3600");
}

function oauthError(res, status, error, description) {
  res.status(status).json({ error, error_description: description });
}

// ── who may connect, and as what ──────────────────────────────────────────
//
// One membership record per person, keyed by lowercased email:
//   consoleUsers/{email} = { email, displayName, role, disabled, mcpEnabled, ... }
// The same collection gates the browser console (auth-gate.js + the
// consoleUsers lookup in firestore.rules), so "added as a user to the
// platform" means exactly one thing in both places — add someone once and
// both their browser session and their agent work.

async function resolveConsoleUser(email) {
  const lower = String(email || "").trim().toLowerCase();
  if (!lower) return null;
  const isStaticAdmin = STATIC_ADMINS.includes(lower);
  let data = null;
  try {
    const snap = await db().collection("consoleUsers").doc(lower).get();
    if (snap.exists) data = snap.data() || {};
  } catch (err) {
    logger.error("consoleUsers lookup failed", { email: lower, error: String(err) });
    if (!isStaticAdmin) return null;
  }
  if (!data && !isStaticAdmin) return null;
  if (data && data.disabled === true) return null;
  const role = isStaticAdmin ? "admin" : (ROLE_RANK[data && data.role] ? data.role : "editor");
  return {
    email: lower,
    displayName: (data && data.displayName) || "",
    role,
    // Default-on: someone trusted with the console is trusted with their
    // own agent unless an admin explicitly says otherwise. The toggle
    // exists so access can be cut for one person without removing them
    // from the board entirely.
    mcpEnabled: !data || data.mcpEnabled !== false,
    bootstrapAdmin: isStaticAdmin && !data,
  };
}

function atLeast(role, needed) {
  return (ROLE_RANK[role] || 0) >= (ROLE_RANK[needed] || 0);
}

// Keep a custom claim on the Firebase Auth user in step with the
// consoleUsers doc. Firestore rules read the doc directly (so a brand-new
// member works the instant they are added, with no token refresh), but
// STORAGE rules cannot read Firestore at all — attachments would be
// uploadable only by the two bootstrap admins without this claim. It also
// makes the common rules path cheap: a claim check costs no document read.
exports.syncConsoleUserClaims = onDocumentWritten("consoleUsers/{userEmail}", async (event) => {
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  const email = String(event.params.userEmail || "").toLowerCase();
  if (!email) return;
  const role = after && after.disabled !== true ? (ROLE_RANK[after.role] ? after.role : "editor") : null;
  try {
    const user = await adminAuth().getUserByEmail(email);
    const claims = Object.assign({}, user.customClaims || {});
    if (role) { claims.consoleRole = role; claims.consoleEditor = atLeast(role, "editor"); }
    else { delete claims.consoleRole; delete claims.consoleEditor; }
    await adminAuth().setCustomUserClaims(user.uid, claims);
    logger.info("console claim synced", { email, role: role || "(removed)" });
  } catch (err) {
    // No Auth account yet is the normal case for someone invited before
    // their first sign-in — /mcp/claims/sync fills it in when they arrive.
    if (err && err.code === "auth/user-not-found") {
      logger.info("console claim deferred — no sign-in yet", { email });
      return;
    }
    logger.error("console claim sync failed", { email, error: String(err) });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// OAuth 2.1 authorization server
// ══════════════════════════════════════════════════════════════════════════
//
// Rolled here rather than bolted onto an external IdP because the identity
// we want IS the console's own Firebase Auth user. The browser half of the
// flow is a normal Firebase sign-in page (Google popup or email+password);
// this server only trades the resulting ID token for MCP credentials of its
// own, so an agent never holds a Firebase ID token and a leaked MCP token
// cannot be replayed against Firebase.

// ── discovery documents ───────────────────────────────────────────────────

function protectedResourceMetadata() {
  return {
    resource: RESOURCE_URL,
    authorization_servers: [PUBLIC_ORIGIN],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "PH Agent Console",
    resource_documentation: "https://github.com/offline2online/rob_ph_demos/blob/main/backlog-tracker/MCP.md",
  };
}

function authorizationServerMetadata() {
  return {
    issuer: PUBLIC_ORIGIN,
    authorization_endpoint: `${PUBLIC_ORIGIN}/mcp/authorize`,
    token_endpoint: `${PUBLIC_ORIGIN}/mcp/token`,
    registration_endpoint: `${PUBLIC_ORIGIN}/mcp/register`,
    revocation_endpoint: `${PUBLIC_ORIGIN}/mcp/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    // PKCE is mandatory, S256 only — OAuth 2.1 drops "plain" and so do we.
    code_challenge_methods_supported: ["S256"],
    service_documentation: "https://github.com/offline2online/rob_ph_demos/blob/main/backlog-tracker/MCP.md",
  };
}

// ── dynamic client registration (RFC 7591) ────────────────────────────────
//
// Open registration, deliberately: a client_id here is not a permission,
// it only names the piece of software asking. Nothing is readable until a
// real person completes a sign-in at /authorize, so the worst an unwanted
// registration achieves is a row in mcpClients.

function redirectUriAllowed(uri) {
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol === "https:") return true;
  // Loopback for desktop/CLI clients that spin up a local listener.
  if (u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname)) return true;
  // Private-use URI schemes (claude://, cursor://, vscode://…) are how
  // native apps get the callback back; anything that could execute in a
  // page is not.
  const banned = ["javascript:", "data:", "vbscript:", "file:", "blob:"];
  if (banned.includes(u.protocol)) return false;
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol);
}

async function handleRegister(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST only");
  const body = req.body || {};
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
  if (!uris.length) return oauthError(res, 400, "invalid_redirect_uri", "redirect_uris is required");
  if (uris.length > 10) return oauthError(res, 400, "invalid_redirect_uri", "too many redirect_uris");
  for (const uri of uris) {
    if (typeof uri !== "string" || uri.length > 2000 || !redirectUriAllowed(uri)) {
      return oauthError(res, 400, "invalid_redirect_uri", `unsupported redirect_uri: ${String(uri).slice(0, 120)}`);
    }
  }
  const clientId = newSecret("mcpc");
  const record = {
    clientId,
    clientName: String(body.client_name || "Unnamed MCP client").slice(0, 200),
    redirectUris: uris,
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"],
    tokenEndpointAuthMethod: "none",
    scope: SCOPES.join(" "),
    softwareId: body.software_id ? String(body.software_id).slice(0, 200) : null,
    softwareVersion: body.software_version ? String(body.software_version).slice(0, 80) : null,
    createdAt: FieldValue.serverTimestamp(),
  };
  await db().collection("mcpClients").doc(clientId).set(record);
  res.status(201).json({
    client_id: clientId,
    client_id_issued_at: nowSeconds(),
    redirect_uris: uris,
    client_name: record.clientName,
    grant_types: record.grantTypes,
    response_types: record.responseTypes,
    token_endpoint_auth_method: "none",
    scope: record.scope,
  });
}

// ── /authorize ────────────────────────────────────────────────────────────

function parseAuthorizeParams(req) {
  const q = req.query || {};
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  return {
    response_type: String(one(q.response_type) || ""),
    client_id: String(one(q.client_id) || ""),
    redirect_uri: String(one(q.redirect_uri) || ""),
    state: one(q.state) == null ? "" : String(one(q.state)),
    scope: String(one(q.scope) || SCOPES.join(" ")),
    code_challenge: String(one(q.code_challenge) || ""),
    code_challenge_method: String(one(q.code_challenge_method) || ""),
    resource: one(q.resource) == null ? "" : String(one(q.resource)),
  };
}

function redirectWithError(res, redirectUri, state, error, description) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  if (description) url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  res.redirect(302, url.toString());
}

function errorPage(res, status, title, detail) {
  res.status(status).set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)} — PH Agent Console</title>
<link rel="icon" type="image/svg+xml" href="/img/ph-mark.svg">${CONNECT_PAGE_CSS}</head>
<body><main class="card"><h1>${escapeHTML(title)}</h1><p class="muted">${escapeHTML(detail)}</p>
<p class="muted small">If you were connecting an AI agent, start the connection again from the agent. If it keeps failing, send this message to whoever administers the PH Agent Console.</p>
</main></body></html>`);
}

// One stylesheet shared by the consent page and the error page. Inline
// rather than linked: this page has to render correctly before any of the
// console's own assets are known-good, and it is the first thing a new team
// member ever sees of this system.
const CONNECT_PAGE_CSS = `<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --ink:#15181d; --muted:#5b6472; --line:#e3e6eb; --accent:#2f6df6; --danger:#c0392b; }
  @media (prefers-color-scheme: dark) { :root { --bg:#12141a; --card:#1b1e26; --ink:#eef1f6; --muted:#9aa4b4; --line:#2b3039; --accent:#5b8bff; --danger:#ff7a6b; } }
  * { box-sizing:border-box; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;
         background:var(--bg); color:var(--ink); font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { width:100%; max-width:440px; background:var(--card); border:1px solid var(--line); border-radius:14px; padding:28px; box-shadow:0 12px 32px rgba(0,0,0,.08); }
  h1 { margin:0 0 6px; font-size:20px; }
  h2 { margin:18px 0 8px; font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  p { margin:0 0 12px; }
  .muted { color:var(--muted); }
  .small { font-size:13px; }
  .client { border:1px solid var(--line); border-radius:10px; padding:12px 14px; margin:16px 0; background:rgba(127,127,127,.06); }
  .client strong { display:block; font-size:16px; }
  ul.perms { margin:10px 0 0; padding-left:18px; }
  ul.perms li { margin:3px 0; color:var(--muted); font-size:13.5px; }
  button, .btn { width:100%; padding:11px 14px; border-radius:9px; border:1px solid var(--line); background:var(--card); color:var(--ink);
                 font-size:15px; font-weight:600; cursor:pointer; margin-top:10px; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button[disabled] { opacity:.55; cursor:default; }
  button.link { border:none; background:none; color:var(--accent); font-weight:500; width:auto; padding:6px 0; margin:0; }
  label { display:block; font-size:13px; font-weight:600; margin:12px 0 4px; }
  input { width:100%; padding:10px 12px; border-radius:9px; border:1px solid var(--line); background:var(--bg); color:var(--ink); font-size:15px; }
  .status { margin-top:14px; font-size:13.5px; color:var(--muted); min-height:20px; }
  .status[data-kind="error"] { color:var(--danger); }
  .divider { display:flex; align-items:center; gap:10px; margin:18px 0 4px; color:var(--muted); font-size:12px; }
  .divider::before, .divider::after { content:""; flex:1; height:1px; background:var(--line); }
  [hidden] { display:none !important; }
</style>`;

function authorizePageHTML(params, client) {
  const req = {
    clientId: params.client_id,
    redirectUri: params.redirect_uri,
    state: params.state,
    scope: params.scope,
    codeChallenge: params.code_challenge,
    codeChallengeMethod: params.code_challenge_method,
    resource: params.resource,
  };
  const cfg = { apiKey: WEB_API_KEY, authDomain: AUTH_DOMAIN, projectId: PROJECT_ID };
  const canWrite = String(params.scope || "").includes("board.write");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect to PH Agent Console</title>
<link rel="icon" type="image/svg+xml" href="/img/ph-mark.svg">
<link rel="icon" type="image/png" sizes="64x64" href="/img/ph-mark-64.png">${CONNECT_PAGE_CSS}</head>
<body>
<main class="card">
  <h1>Connect your agent</h1>
  <p class="muted small">Sign in with the same Personalisation Hub account you use for the PH Agent Console. Your agent never sees your password.</p>

  <div class="client">
    <strong>${escapeHTML(client.clientName || "An MCP client")}</strong>
    <span class="muted small">wants to use the PH Agent Console as a tool</span>
    <ul class="perms">
      <li>Read your projects, backlog tickets and help-centre articles</li>
      ${canWrite ? "<li>Create tickets, edit their details and add comments — as you</li>" : ""}
      <li>Cannot deploy, merge, or trigger campaigns</li>
    </ul>
  </div>

  <div id="signed-out" hidden>
    <button class="primary" id="google-btn" type="button">Sign in with Google</button>
    <div class="divider">or use your email and password</div>
    <label for="email">Email</label>
    <input id="email" type="email" autocomplete="username" placeholder="you@personalisationhub.com">
    <label for="password">Password</label>
    <input id="password" type="password" autocomplete="current-password">
    <button id="password-btn" type="button">Sign in</button>
    <button class="link" id="reset-btn" type="button">Forgot your password?</button>
  </div>

  <div id="signed-in" hidden>
    <p class="small">Signed in as <strong id="who"></strong></p>
    <button class="primary" id="connect-btn" type="button">Connect</button>
    <button class="link" id="switch-btn" type="button">Use a different account</button>
  </div>

  <p class="status" id="status">Checking your sign-in…</p>
</main>
<script type="module">
const REQ = ${jsonForScript(req)};
const CFG = ${jsonForScript(cfg)};
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

const auth = getAuth(initializeApp(CFG));
setPersistence(auth, browserLocalPersistence).catch(() => {});

const $ = (id) => document.getElementById(id);
const statusEl = $("status");
function setStatus(text, kind) { statusEl.textContent = text || ""; statusEl.dataset.kind = kind || ""; }
function show(which) {
  $("signed-out").hidden = which !== "out";
  $("signed-in").hidden = which !== "in";
}

$("google-btn").addEventListener("click", async () => {
  setStatus("Opening Google sign-in…");
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err && err.code) || "";
    if (code === "auth/popup-blocked") { await signInWithRedirect(auth, provider); return; }
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") { setStatus(""); return; }
    setStatus("Google sign-in failed: " + (code || err), "error");
  }
});

$("password-btn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) { setStatus("Enter your email and password.", "error"); return; }
  setStatus("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const code = (err && err.code) || "";
    const friendly = {
      "auth/invalid-credential": "That email and password don't match an account.",
      "auth/wrong-password": "That email and password don't match an account.",
      "auth/user-not-found": "No account with that email — ask an admin to add you to the console.",
      "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
      "auth/operation-not-allowed": "Password sign-in isn't enabled for this project yet — use Google, or ask an admin.",
    }[code];
    setStatus(friendly || ("Sign-in failed: " + (code || err)), "error");
  }
});

$("reset-btn").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email) { setStatus("Type your email above first, then tap this again.", "error"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("Password reset email sent — check your inbox, then come back and sign in.");
  } catch (err) {
    setStatus("Couldn't send a reset email: " + ((err && err.code) || err), "error");
  }
});

$("switch-btn").addEventListener("click", async () => { await signOut(auth); setStatus(""); });

$("connect-btn").addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;
  $("connect-btn").disabled = true;
  setStatus("Connecting…");
  try {
    const idToken = await user.getIdToken(true);
    const resp = await fetch("/mcp/authorize/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ idToken }, REQ)),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      setStatus(data.error_description || data.error || ("Connection refused (" + resp.status + ")"), "error");
      $("connect-btn").disabled = false;
      return;
    }
    setStatus("Connected — returning to your agent…");
    window.location.replace(data.redirect);
  } catch (err) {
    setStatus("Connection failed: " + err, "error");
    $("connect-btn").disabled = false;
  }
});

getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, (user) => {
  if (!user) { show("out"); setStatus(""); return; }
  $("who").textContent = user.email || user.uid;
  show("in");
  setStatus("");
});
</script>
</body></html>`;
}

async function handleAuthorize(req, res) {
  if (req.method !== "GET") return errorPage(res, 405, "Method not allowed", "The authorization endpoint is opened in a browser.");
  const p = parseAuthorizeParams(req);
  if (!p.client_id) return errorPage(res, 400, "Missing client", "The agent didn't say which client it is (no client_id).");
  const clientSnap = await db().collection("mcpClients").doc(p.client_id).get();
  if (!clientSnap.exists) return errorPage(res, 400, "Unknown client", "This agent isn't registered with the PH Agent Console. Remove and re-add the connector so it registers again.");
  const client = clientSnap.data();
  // Until redirect_uri is known-good, errors have to be shown here rather
  // than sent onward — redirecting to an unvalidated URI is how open
  // redirectors get built.
  if (!p.redirect_uri || !(client.redirectUris || []).includes(p.redirect_uri)) {
    return errorPage(res, 400, "Redirect not allowed", "The address the agent asked to be sent back to isn't one it registered.");
  }
  if (p.response_type !== "code") return redirectWithError(res, p.redirect_uri, p.state, "unsupported_response_type", "only response_type=code is supported");
  if (!p.code_challenge || p.code_challenge_method !== "S256") {
    return redirectWithError(res, p.redirect_uri, p.state, "invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if (p.resource && p.resource.replace(/\/$/, "") !== RESOURCE_URL) {
    return redirectWithError(res, p.redirect_uri, p.state, "invalid_target", `this server only issues tokens for ${RESOURCE_URL}`);
  }
  res.status(200)
    .set("Content-Type", "text/html; charset=utf-8")
    .set("Cache-Control", "no-store")
    .send(authorizePageHTML(p, client));
}

// The consent page posts the signed-in user's Firebase ID token here. This
// is the only place a Firebase credential is accepted, and it is exchanged
// immediately for an authorization code — the agent never receives it.
async function handleAuthorizeComplete(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST only");
  const b = req.body || {};
  if (!b.idToken) return oauthError(res, 400, "invalid_request", "missing idToken");
  if (!b.clientId || !b.redirectUri || !b.codeChallenge || b.codeChallengeMethod !== "S256") {
    return oauthError(res, 400, "invalid_request", "missing or unsupported authorization parameters");
  }
  const clientSnap = await db().collection("mcpClients").doc(String(b.clientId)).get();
  if (!clientSnap.exists) return oauthError(res, 400, "invalid_client", "unknown client");
  if (!(clientSnap.data().redirectUris || []).includes(String(b.redirectUri))) {
    return oauthError(res, 400, "invalid_request", "redirect_uri is not registered for this client");
  }

  let decoded;
  try {
    decoded = await adminAuth().verifyIdToken(String(b.idToken), true);
  } catch (err) {
    return oauthError(res, 401, "access_denied", "Your sign-in could not be verified. Sign in again.");
  }
  const email = String(decoded.email || "").toLowerCase();
  if (!email) return oauthError(res, 401, "access_denied", "That account has no email address.");
  // Google accounts are always verified; a password account an admin
  // provisioned may not be, and we still let it in — the admin adding the
  // address IS the verification here, and requiring an inbox round-trip
  // would strand exactly the people this feature is for.
  const user = await resolveConsoleUser(email);
  if (!user) {
    return oauthError(res, 403, "access_denied", `${email} isn't on the PH Agent Console user list. Ask an admin to add you, then try again.`);
  }
  if (!user.mcpEnabled) {
    return oauthError(res, 403, "access_denied", `Agent access is turned off for ${email}. An admin can re-enable it in the console's Settings.`);
  }

  // Never grant board.write to a viewer, whatever the client asked for.
  const requested = String(b.scope || SCOPES.join(" ")).split(/\s+/).filter((s) => SCOPES.includes(s));
  let granted = requested.length ? requested : SCOPES.slice();
  if (!atLeast(user.role, "editor")) granted = granted.filter((s) => s !== "board.write");
  if (!granted.includes("board.read")) granted.unshift("board.read");

  const code = newSecret("mcpa");
  await db().collection("mcpAuthCodes").doc(hashToken(code)).set({
    clientId: String(b.clientId),
    redirectUri: String(b.redirectUri),
    codeChallenge: String(b.codeChallenge),
    scope: granted.join(" "),
    resource: b.resource ? String(b.resource) : RESOURCE_URL,
    email: user.email,
    uid: decoded.uid,
    role: user.role,
    used: false,
    expiresAt: nowSeconds() + AUTH_CODE_TTL_S,
    createdAt: FieldValue.serverTimestamp(),
  });

  // Best-effort: make sure the Storage-side claim exists for someone whose
  // first ever sign-in is this page rather than the console.
  ensureClaimsFor(email, user.role).catch(() => {});

  const url = new URL(String(b.redirectUri));
  url.searchParams.set("code", code);
  if (b.state) url.searchParams.set("state", String(b.state));
  logger.info("mcp authorization granted", { email: user.email, clientId: b.clientId, scope: granted.join(" ") });
  res.status(200).json({ redirect: url.toString() });
}

async function ensureClaimsFor(email, role) {
  const user = await adminAuth().getUserByEmail(email);
  const claims = Object.assign({}, user.customClaims || {});
  if (claims.consoleRole === role && claims.consoleEditor === atLeast(role, "editor")) return false;
  claims.consoleRole = role;
  claims.consoleEditor = atLeast(role, "editor");
  await adminAuth().setCustomUserClaims(user.uid, claims);
  return true;
}

// ── /token ────────────────────────────────────────────────────────────────

async function issueTokens(grant) {
  const accessToken = newSecret("mcpt");
  const refreshToken = newSecret("mcpr");
  const now = nowSeconds();
  const common = {
    clientId: grant.clientId,
    email: grant.email,
    uid: grant.uid || null,
    role: grant.role,
    scope: grant.scope,
    resource: grant.resource || RESOURCE_URL,
    createdAt: FieldValue.serverTimestamp(),
  };
  const batch = db().batch();
  batch.set(db().collection("mcpTokens").doc(hashToken(accessToken)),
    Object.assign({ type: "access", expiresAt: now + ACCESS_TOKEN_TTL_S }, common));
  batch.set(db().collection("mcpTokens").doc(hashToken(refreshToken)),
    Object.assign({ type: "refresh", expiresAt: now + REFRESH_TOKEN_TTL_S }, common));
  await batch.commit();
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_S,
    refresh_token: refreshToken,
    scope: grant.scope,
  };
}

async function handleToken(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST only");
  const b = req.body || {};
  const grantType = String(b.grant_type || "");

  if (grantType === "authorization_code") {
    const code = String(b.code || "");
    const verifier = String(b.code_verifier || "");
    const clientId = String(b.client_id || "");
    if (!code || !verifier || !clientId) return oauthError(res, 400, "invalid_request", "code, code_verifier and client_id are required");

    const ref = db().collection("mcpAuthCodes").doc(hashToken(code));
    let grant;
    try {
      // One redemption per code, enforced in a transaction — a replayed
      // code must fail even if two exchanges race.
      grant = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("invalid_grant:unknown code");
        const d = snap.data();
        if (d.used) throw new Error("invalid_grant:code already used");
        if (d.expiresAt < nowSeconds()) throw new Error("invalid_grant:code expired");
        if (d.clientId !== clientId) throw new Error("invalid_grant:code was issued to a different client");
        if (b.redirect_uri && String(b.redirect_uri) !== d.redirectUri) throw new Error("invalid_grant:redirect_uri mismatch");
        if (!constantTimeEqual(sha256b64url(verifier), d.codeChallenge)) throw new Error("invalid_grant:PKCE verification failed");
        tx.update(ref, { used: true, usedAt: FieldValue.serverTimestamp() });
        return d;
      });
    } catch (err) {
      const msg = String(err && err.message ? err.message : err);
      const [kind, detail] = msg.startsWith("invalid_grant:") ? ["invalid_grant", msg.slice(14)] : ["server_error", "could not redeem the code"];
      return oauthError(res, kind === "invalid_grant" ? 400 : 500, kind, detail);
    }

    // Membership is re-checked at exchange time, not just at sign-in: a
    // person removed between the two never gets a token.
    const user = await resolveConsoleUser(grant.email);
    if (!user || !user.mcpEnabled) return oauthError(res, 400, "invalid_grant", "that account no longer has agent access");
    res.set("Cache-Control", "no-store");
    return res.status(200).json(await issueTokens({
      clientId: grant.clientId, email: user.email, uid: grant.uid, role: user.role,
      scope: grant.scope, resource: grant.resource,
    }));
  }

  if (grantType === "refresh_token") {
    const token = String(b.refresh_token || "");
    if (!token) return oauthError(res, 400, "invalid_request", "refresh_token is required");
    const ref = db().collection("mcpTokens").doc(hashToken(token));
    const snap = await ref.get();
    if (!snap.exists) return oauthError(res, 400, "invalid_grant", "unknown refresh token");
    const d = snap.data();
    if (d.type !== "refresh") return oauthError(res, 400, "invalid_grant", "not a refresh token");
    if (d.revoked) return oauthError(res, 400, "invalid_grant", "refresh token was revoked");
    if (d.expiresAt < nowSeconds()) return oauthError(res, 400, "invalid_grant", "refresh token expired");
    if (b.client_id && String(b.client_id) !== d.clientId) return oauthError(res, 400, "invalid_grant", "refresh token belongs to a different client");
    const user = await resolveConsoleUser(d.email);
    if (!user || !user.mcpEnabled) return oauthError(res, 400, "invalid_grant", "that account no longer has agent access");
    // Rotate: the presented refresh token dies with the response that
    // replaces it, so a stolen one is usable at most once and its use is
    // visible as the legitimate holder suddenly being logged out.
    await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedReason: "rotated" });
    let scope = d.scope || SCOPES.join(" ");
    if (!atLeast(user.role, "editor")) scope = scope.split(/\s+/).filter((s) => s !== "board.write").join(" ");
    res.set("Cache-Control", "no-store");
    return res.status(200).json(await issueTokens({
      clientId: d.clientId, email: user.email, uid: d.uid, role: user.role, scope, resource: d.resource,
    }));
  }

  return oauthError(res, 400, "unsupported_grant_type", `unsupported grant_type: ${grantType || "(none)"}`);
}

// ── /revoke (RFC 7009) ────────────────────────────────────────────────────
async function handleRevoke(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST only");
  const token = String((req.body || {}).token || "");
  if (token) {
    const ref = db().collection("mcpTokens").doc(hashToken(token));
    const snap = await ref.get();
    if (snap.exists) await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedReason: "client" });
  }
  // RFC 7009: an unknown token is still a successful revocation.
  res.status(200).json({});
}

// ══════════════════════════════════════════════════════════════════════════
// Bearer authentication for the MCP endpoint
// ══════════════════════════════════════════════════════════════════════════

async function authenticateBearer(req) {
  const header = String(req.get("authorization") || "").trim();
  const m = /^Bearer\s+(\S+)$/i.exec(header);
  if (!m) return { ok: false, code: "missing_token", detail: "no bearer token" };
  const snap = await db().collection("mcpTokens").doc(hashToken(m[1])).get();
  if (!snap.exists) return { ok: false, code: "invalid_token", detail: "unknown token" };
  const d = snap.data();
  if (d.type !== "access") return { ok: false, code: "invalid_token", detail: "not an access token" };
  if (d.revoked) return { ok: false, code: "invalid_token", detail: "token revoked" };
  if (d.expiresAt < nowSeconds()) return { ok: false, code: "invalid_token", detail: "token expired" };
  // Access is re-derived from the live membership record on every call, so
  // removing someone (or switching off their agent access) takes effect at
  // once instead of whenever their token happens to expire.
  const user = await resolveConsoleUser(d.email);
  if (!user) return { ok: false, code: "invalid_token", detail: "account is no longer on the console user list" };
  if (!user.mcpEnabled) return { ok: false, code: "invalid_token", detail: "agent access is turned off for this account" };
  let scopes = String(d.scope || "").split(/\s+/).filter(Boolean);
  if (!atLeast(user.role, "editor")) scopes = scopes.filter((s) => s !== "board.write");
  // Touch lastUsedAt at most every five minutes — enough for "when did this
  // token last do anything", without a write on every single tool call.
  const last = d.lastUsedAt && typeof d.lastUsedAt.toMillis === "function" ? d.lastUsedAt.toMillis() : 0;
  if (Date.now() - last > 5 * 60 * 1000) {
    snap.ref.update({ lastUsedAt: FieldValue.serverTimestamp() }).catch(() => {});
  }
  return { ok: true, session: { email: user.email, displayName: user.displayName, role: user.role, scopes, clientId: d.clientId } };
}

function unauthorized(res, detail) {
  res.status(401)
    .set("WWW-Authenticate", `Bearer resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token", error_description="${String(detail || "").replace(/"/g, "'")}"`)
    .json({ error: "invalid_token", error_description: detail });
}

// ══════════════════════════════════════════════════════════════════════════
// The board, as tools
// ══════════════════════════════════════════════════════════════════════════

const CATEGORIES = [
  "Pricing & Offers", "Product Assets", "HQ Admin", "Retail Admin",
  "Menu Board", "Backend / Infrastructure", "Uncategorised",
];
const STATUSES = ["backlog", "ready-for-testing", "ready-to-publish", "published-live", "archived"];
const STATUS_LABELS = {
  "backlog": "Backlog",
  "ready-for-testing": "Ready for Testing",
  "ready-to-publish": "Approved for Deployment",
  "published-live": "Deployed / Main Branch (Live)",
  "archived": "Archived",
};
const TITLE_MAX = 70;
const MAX_READ_DOCS = 1500;

// Ported from public/js/app.js so a ticket an agent files is indexed the
// same way as one typed into the board — same title trimming, same
// best-guess area. Keep the two in step.
function generateTitle(desc) {
  const text = String(desc || "").trim().replace(/\s+/g, " ");
  if (text.length <= TITLE_MAX) return text;
  const cut = text.slice(0, TITLE_MAX);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + "…";
}
function suggestCategory(text) {
  const t = String(text || "").toLowerCase();
  const rules = [
    { cat: "Pricing & Offers", words: ["price", "pricing", "rrp", "offer", "discount", "local override"] },
    { cat: "Product Assets", words: ["magic edit", "crop", "brush", "background removal", "remove background", "enhance", "asset", "video", "image", "photo"] },
    { cat: "Menu Board", words: ["menu board", "customer-facing", "tile", "hero", "featured highlight"] },
    { cat: "Retail Admin", words: ["retail admin", "store", "stock"] },
    { cat: "HQ Admin", words: ["hq admin", "grid", "table", "column", "settings", "scheduling", "targeting"] },
    { cat: "Backend / Infrastructure", words: ["cloud function", "backend", "firebase", "deploy", "server"] },
  ];
  for (const r of rules) { if (r.words.some((w) => t.includes(w))) return r.cat; }
  return "Uncategorised";
}

async function loadProjectsById() {
  const snap = await db().collection("projects").get();
  const byId = new Map();
  snap.forEach((doc) => byId.set(doc.id, Object.assign({ id: doc.id }, doc.data())));
  return byId;
}

function itemSummary(id, d, projects) {
  const project = projects && projects.get(d.projectId);
  return {
    id,
    projectId: d.projectId || null,
    project: project ? project.name : null,
    title: d.title || "",
    type: d.type || "feature",
    category: d.category || "Uncategorised",
    status: d.status || "backlog",
    statusLabel: STATUS_LABELS[d.status] || d.status || "",
    updatedAt: tsToISO(d.updatedAt),
    createdAt: tsToISO(d.createdAt),
    comments: Array.isArray(d.notes) ? d.notes.length : 0,
  };
}

function itemDetail(id, d, projects) {
  const base = itemSummary(id, d, projects);
  return Object.assign(base, {
    desc: d.desc || "",
    previewUrl: d.previewUrl || null,
    testVersion: d.testVersion || null,
    archivedAt: tsToISO(d.archivedAt),
    noDeploymentRequired: d.noDeploymentRequired === true,
    // Read-only window onto the deployment train. An agent can see where a
    // ticket is in the pipeline; nothing here is writable through MCP.
    train: {
      revertRequested: d.revertRequested === true,
      revertBlockedBy: d.revertBlockedBy || null,
      mergeCommit: d.mergeCommit || null,
      prNumber: d.prNumber || null,
    },
    attachments: (Array.isArray(d.attachments) ? d.attachments : []).map((a) => ({
      name: a && a.name ? a.name : null, url: a && a.url ? a.url : null, contentType: a && a.contentType ? a.contentType : null,
    })),
    notes: (Array.isArray(d.notes) ? d.notes : []).map((n) => ({
      author: n && n.author ? n.author : "viewer",
      text: n && n.text ? n.text : "",
      at: tsToISO(n && n.at) || (n && typeof n.at === "string" ? n.at : null),
    })),
  });
}

function textResult(payload) {
  return { content: [{ type: "text", text: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) }] };
}
function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function audit(session, tool, detail) {
  try {
    await db().collection("mcpAuditLog").add(Object.assign({
      at: FieldValue.serverTimestamp(),
      email: session.email,
      clientId: session.clientId || null,
      tool,
    }, detail || {}));
  } catch (err) {
    logger.warn("mcp audit write failed", { tool, error: String(err) });
  }
}

const TOOLS = [
  {
    name: "whoami",
    description: "Who this connection is authenticated as on the PH Agent Console, and what it is allowed to do. Call this first if a write is refused.",
    scope: "board.read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run(_args, session) {
      return textResult({
        email: session.email,
        displayName: session.displayName || null,
        role: session.role,
        canWrite: session.scopes.includes("board.write"),
        scopes: session.scopes,
        board: PUBLIC_ORIGIN,
        note: "Deploys, merges, Notify Claude and campaign triggering are not available through MCP — they stay on the board's own buttons.",
      });
    },
  },
  {
    name: "list_projects",
    description: "Every project/program on the board, with how many tickets sit in each pipeline column. Use this to find the projectId other tools need.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: { includeArchived: { type: "boolean", description: "Include archived projects (default false)." } },
      additionalProperties: false,
    },
    async run(args) {
      const projects = await loadProjectsById();
      const programs = new Map();
      (await db().collection("programs").get()).forEach((d) => programs.set(d.id, (d.data() || {}).name || ""));
      const counts = new Map();
      const itemsSnap = await db().collection("backlogItems").limit(MAX_READ_DOCS).get();
      itemsSnap.forEach((doc) => {
        const d = doc.data() || {};
        const byStatus = counts.get(d.projectId) || {};
        byStatus[d.status || "backlog"] = (byStatus[d.status || "backlog"] || 0) + 1;
        counts.set(d.projectId, byStatus);
      });
      const out = [];
      projects.forEach((p) => {
        if (p.archived === true && !(args && args.includeArchived)) return;
        out.push({
          id: p.id,
          name: p.name || "",
          program: p.programId ? (programs.get(p.programId) || null) : null,
          archived: p.archived === true,
          deployBranch: p.deployBranch || null,
          trainStatus: p.trainStatus || null,
          trainLocked: p.trainLocked === true,
          artifactUrl: p.artifactUrl || null,
          counts: counts.get(p.id) || {},
        });
      });
      out.sort((a, b) => a.name.localeCompare(b.name));
      return textResult({ projects: out, statusKeys: STATUS_LABELS });
    },
  },
  {
    name: "list_backlog_items",
    description: "List tickets, newest-updated first. Filter by project, pipeline column, type, area or free text. Returns summaries — call get_backlog_item for the full description and comments.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Restrict to one project (from list_projects)." },
        status: { type: "string", enum: STATUSES, description: "Pipeline column key." },
        type: { type: "string", enum: ["feature", "bug"] },
        category: { type: "string", enum: CATEGORIES, description: "Area impacted." },
        search: { type: "string", description: "Case-insensitive match against title and description." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 25." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const a = args || {};
      const projects = await loadProjectsById();
      let q = db().collection("backlogItems");
      if (a.projectId) q = q.where("projectId", "==", a.projectId);
      const snap = await q.limit(MAX_READ_DOCS).get();
      const needle = String(a.search || "").trim().toLowerCase();
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if (a.status && (d.status || "backlog") !== a.status) return;
        // Archived tickets are off the board; only return them when asked
        // for by name, so an unfiltered list reads like the board does.
        if (!a.status && (d.status || "backlog") === "archived") return;
        if (a.type && d.type !== a.type) return;
        if (a.category && (d.category || "Uncategorised") !== a.category) return;
        if (needle && !`${d.title || ""}\n${d.desc || ""}`.toLowerCase().includes(needle)) return;
        rows.push({ doc, d });
      });
      rows.sort((x, y) => {
        const xa = x.d.updatedAt && x.d.updatedAt.toMillis ? x.d.updatedAt.toMillis() : 0;
        const ya = y.d.updatedAt && y.d.updatedAt.toMillis ? y.d.updatedAt.toMillis() : 0;
        return ya - xa;
      });
      const limit = Math.min(Math.max(parseInt(a.limit, 10) || 25, 1), 100);
      return textResult({
        matched: rows.length,
        returned: Math.min(limit, rows.length),
        items: rows.slice(0, limit).map((r) => itemSummary(r.doc.id, r.d, projects)),
      });
    },
  },
  {
    name: "get_backlog_item",
    description: "One ticket in full — description, area, pipeline column, preview link, attachments and every comment on it.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: { itemId: { type: "string", description: "Ticket id from list_backlog_items." } },
      required: ["itemId"], additionalProperties: false,
    },
    async run(args) {
      const snap = await db().collection("backlogItems").doc(String(args.itemId)).get();
      if (!snap.exists) return toolError(`No ticket with id ${args.itemId}.`);
      const projects = await loadProjectsById();
      return textResult(itemDetail(snap.id, snap.data() || {}, projects));
    },
  },
  {
    name: "create_backlog_item",
    description: "File a new ticket into a project's Backlog column, attributed to you. A title and area are derived from the description when you don't give them. Tickets always start in Backlog — nothing here can put work straight into testing or deployment.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Which project (from list_projects)." },
        desc: { type: "string", description: "What the feature or bug is, in plain language. Up to 2000 characters." },
        title: { type: "string", description: "Optional short title; derived from desc when omitted." },
        type: { type: "string", enum: ["feature", "bug"], description: "Default feature." },
        category: { type: "string", enum: CATEGORIES, description: "Area impacted; best-guessed from desc when omitted." },
      },
      required: ["projectId", "desc"], additionalProperties: false,
    },
    async run(args, session) {
      const desc = String(args.desc || "").trim();
      if (!desc) return toolError("desc is required.");
      if (desc.length > 2000) return toolError("desc is limited to 2000 characters (the board's own limit).");
      const projectSnap = await db().collection("projects").doc(String(args.projectId)).get();
      if (!projectSnap.exists) return toolError(`No project with id ${args.projectId}. Call list_projects first.`);
      const title = String(args.title || "").trim().slice(0, 200) || generateTitle(desc);
      const type = args.type === "bug" ? "bug" : "feature";
      const category = CATEGORIES.includes(args.category) ? args.category : suggestCategory(desc);
      const ref = await db().collection("backlogItems").add({
        projectId: String(args.projectId),
        title, desc, type, category,
        status: "backlog",
        // Provenance the board can show and an admin can audit: filed by a
        // person's agent, on their behalf, not by the board automation.
        createdVia: "mcp",
        createdByEmail: session.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        notes: [{ author: session.email, text: `Filed from ${session.email}'s agent via MCP.`, at: new Date() }],
      });
      await audit(session, "create_backlog_item", { itemId: ref.id, projectId: String(args.projectId), title });
      return textResult({
        created: true, itemId: ref.id, projectId: String(args.projectId),
        title, type, category, status: "backlog",
        board: `${PUBLIC_ORIGIN}/#item-${ref.id}`,
      });
    },
  },
  {
    name: "update_backlog_item",
    description: "Correct a ticket's title, description, type or area. Pipeline status, approval and deployment fields are deliberately not writable here — moving a ticket through testing and deployment stays on the board.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        title: { type: "string" },
        desc: { type: "string" },
        type: { type: "string", enum: ["feature", "bug"] },
        category: { type: "string", enum: CATEGORIES },
      },
      required: ["itemId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("backlogItems").doc(String(args.itemId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No ticket with id ${args.itemId}.`);
      const fields = {};
      if (args.title != null) {
        const t = String(args.title).trim();
        if (!t) return toolError("title cannot be emptied.");
        fields.title = t.slice(0, 200);
      }
      if (args.desc != null) {
        const d = String(args.desc).trim();
        if (!d) return toolError("desc cannot be emptied.");
        if (d.length > 2000) return toolError("desc is limited to 2000 characters.");
        fields.desc = d;
      }
      if (args.type != null) {
        if (!["feature", "bug"].includes(args.type)) return toolError("type must be feature or bug.");
        fields.type = args.type;
      }
      if (args.category != null) {
        if (!CATEGORIES.includes(args.category)) return toolError(`category must be one of: ${CATEGORIES.join(", ")}`);
        fields.category = args.category;
      }
      if (!Object.keys(fields).length) return toolError("Nothing to change — pass at least one of title, desc, type, category.");
      fields.updatedAt = FieldValue.serverTimestamp();
      fields.updatedByEmail = session.email;
      await ref.update(fields);
      await audit(session, "update_backlog_item", { itemId: ref.id, changed: Object.keys(fields).filter((k) => k !== "updatedAt" && k !== "updatedByEmail") });
      return textResult({ updated: true, itemId: ref.id, changed: Object.keys(fields) });
    },
  },
  {
    name: "add_item_comment",
    description: "Add a comment to a ticket. It shows on the board's own comment thread, labelled with your email, exactly like a comment typed there.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        itemId: { type: "string" },
        text: { type: "string", description: "The comment. Up to 4000 characters." },
      },
      required: ["itemId", "text"], additionalProperties: false,
    },
    async run(args, session) {
      const text = String(args.text || "").trim();
      if (!text) return toolError("text is required.");
      if (text.length > 4000) return toolError("A comment is limited to 4000 characters.");
      const ref = db().collection("backlogItems").doc(String(args.itemId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No ticket with id ${args.itemId}.`);
      // A plain Date, not serverTimestamp(): Firestore rejects the sentinel
      // inside arrayUnion — same reason app.js's addItemComment uses one.
      await ref.update({
        notes: FieldValue.arrayUnion({ author: session.email, text, at: new Date() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await audit(session, "add_item_comment", { itemId: ref.id, chars: text.length });
      return textResult({ added: true, itemId: ref.id, author: session.email });
    },
  },
  {
    name: "get_project_docs",
    description: "A project's Requirements and README markdown, its additional documents, and every interface contract it shares with another project.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        include: {
          type: "array", description: "Which blocks to return; default all.",
          items: { type: "string", enum: ["requirements", "readme", "docs", "interfaces"] },
        },
      },
      required: ["projectId"], additionalProperties: false,
    },
    async run(args) {
      const want = Array.isArray(args.include) && args.include.length ? args.include : ["requirements", "readme", "docs", "interfaces"];
      const projectId = String(args.projectId);
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) return toolError(`No project with id ${projectId}.`);
      const p = snap.data() || {};
      const out = { projectId, name: p.name || "" };
      if (want.includes("requirements")) out.requirementsMd = p.requirementsMd || "";
      if (want.includes("readme")) out.readmeMd = p.readmeMd || "";
      if (want.includes("docs")) {
        out.documents = [];
        (await db().collection("projectDocs").where("projectId", "==", projectId).get())
          .forEach((d) => out.documents.push({ id: d.id, name: (d.data() || {}).name || "", contentMd: (d.data() || {}).contentMd || "" }));
      }
      if (want.includes("interfaces")) {
        out.interfaces = [];
        (await db().collection("interfaces").where("projectIds", "array-contains", projectId).get())
          .forEach((d) => {
            const i = d.data() || {};
            out.interfaces.push({ id: d.id, name: i.name || "", projectIds: i.projectIds || [], contentMd: i.contentMd || "" });
          });
      }
      return textResult(out);
    },
  },
  {
    name: "search_faq",
    description: "Search the published Personalisation Hub help centre (the same articles help.personalisationhub.com serves). Use it to answer product questions from the documented answer rather than guessing.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for in titles, summaries, keywords and body text." },
        limit: { type: "integer", minimum: 1, maximum: 25, description: "Default 8." },
        includeDrafts: { type: "boolean", description: "Include unpublished drafts (default false)." },
      },
      required: ["query"], additionalProperties: false,
    },
    async run(args) {
      const terms = String(args.query || "").toLowerCase().split(/\s+/).filter((t) => t.length > 1);
      if (!terms.length) return toolError("query is required.");
      const cats = new Map();
      (await db().collection("faqCategories").get()).forEach((d) => cats.set(d.id, (d.data() || {}).name || ""));
      const hits = [];
      (await db().collection("faqArticles").limit(MAX_READ_DOCS).get()).forEach((doc) => {
        const a = doc.data() || {};
        if (a.status !== "published" && !args.includeDrafts) return;
        const title = String(a.title || "");
        const hay = `${title}\n${a.summary || ""}\n${(a.keywords || []).join(" ")}\n${a.bodyMd || ""}`.toLowerCase();
        let score = 0;
        for (const t of terms) {
          if (title.toLowerCase().includes(t)) score += 5;
          if (String(a.summary || "").toLowerCase().includes(t)) score += 3;
          if ((a.keywords || []).some((k) => String(k).toLowerCase().includes(t))) score += 3;
          if (hay.includes(t)) score += 1;
        }
        if (score > 0) hits.push({ score, id: doc.id, title, summary: a.summary || "", docType: a.docType || null, category: cats.get(a.categoryId) || null, slug: a.slug || null, status: a.status });
      });
      hits.sort((x, y) => y.score - x.score);
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 8, 1), 25);
      return textResult({ matched: hits.length, results: hits.slice(0, limit) });
    },
  },
  {
    name: "get_faq_article",
    description: "The full markdown body of one help-centre article, by id or slug.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        articleId: { type: "string", description: "Article id from search_faq." },
        slug: { type: "string", description: "Article slug, if you don't have the id." },
      },
      additionalProperties: false,
    },
    async run(args) {
      let snap = null;
      if (args.articleId) {
        const s = await db().collection("faqArticles").doc(String(args.articleId)).get();
        if (s.exists) snap = s;
      }
      if (!snap && args.slug) {
        const q = await db().collection("faqArticles").where("slug", "==", String(args.slug)).limit(1).get();
        if (!q.empty) snap = q.docs[0];
      }
      if (!snap) return toolError("No article with that id or slug. Use search_faq to find one.");
      const a = snap.data() || {};
      const cat = a.categoryId ? await db().collection("faqCategories").doc(a.categoryId).get() : null;
      return textResult({
        id: snap.id, title: a.title || "", slug: a.slug || "", docType: a.docType || null,
        category: cat && cat.exists ? (cat.data() || {}).name : null,
        status: a.status || null, summary: a.summary || "", keywords: a.keywords || [],
        bodyMd: a.bodyMd || "",
        hasPendingRevision: !!a.pendingRevision,
      });
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ══════════════════════════════════════════════════════════════════════════
// MCP over Streamable HTTP (JSON-RPC 2.0)
// ══════════════════════════════════════════════════════════════════════════
//
// Stateless: every POST carries its own bearer token and is answered on the
// spot, so there is no session to resume and no server-initiated stream to
// keep open. That is a deliberate fit for Cloud Functions, where a long-held
// SSE connection is billed wall-clock and dies at the instance's timeout
// anyway.

const SERVER_INSTRUCTIONS = [
  "This is the PH Agent Console — the Personalisation Hub prototype backlog board and help centre.",
  "You are connected as a specific team member; every ticket you file and comment you add is attributed to their email.",
  "Start with list_projects to get a projectId, then list_backlog_items / get_backlog_item to read work, or create_backlog_item to file new work into a project's Backlog column.",
  "Use search_faq / get_faq_article to answer Personalisation Hub product questions from the published help centre instead of guessing.",
  "Deployment is out of scope on purpose: nothing here moves a ticket through testing, merges a train, or triggers a campaign. Those stay on the board's own buttons and its triggered Routine.",
].join(" ");

function rpcError(id, code, message, data) {
  const err = { code, message };
  if (data !== undefined) err.data = data;
  return { jsonrpc: "2.0", id: id === undefined ? null : id, error: err };
}
function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

async function dispatchRpc(msg, session, ctx) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg && msg.id, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  const params = msg.params || {};

  switch (msg.method) {
    case "initialize": {
      const asked = String(params.protocolVersion || "");
      const version = SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : SUPPORTED_PROTOCOL_VERSIONS[0];
      ctx.protocolVersion = version;
      return rpcResult(msg.id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: "ph-agent-console",
          title: "PH Agent Console",
          version: "1.1.0",
          websiteUrl: PUBLIC_ORIGIN,
          description: "The Personalisation Hub prototype backlog board and help centre.",
          icons: SERVER_ICONS,
        },
        instructions: SERVER_INSTRUCTIONS,
      });
    }
    case "ping":
      return isNotification ? null : rpcResult(msg.id, {});
    case "notifications/initialized":
    case "notifications/cancelled":
    case "notifications/progress":
      return null;
    case "tools/list":
      return rpcResult(msg.id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description + (t.scope === "board.write" && !session.scopes.includes("board.write")
            ? " (Unavailable: this connection is read-only.)" : ""),
          inputSchema: t.inputSchema,
          annotations: {
            readOnlyHint: t.scope !== "board.write",
            destructiveHint: false,
            idempotentHint: t.name.startsWith("get_") || t.name.startsWith("list_") || t.name === "whoami",
            openWorldHint: false,
          },
        })),
      });
    case "tools/call": {
      const tool = TOOLS_BY_NAME.get(String(params.name || ""));
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${params.name}`);
      if (tool.scope === "board.write" && !session.scopes.includes("board.write")) {
        return rpcResult(msg.id, toolError(
          `${session.email} has read-only access to the PH Agent Console, so ${tool.name} is not available. An admin can change the role to editor in the console's Settings → Team & agent access.`));
      }
      try {
        const result = await tool.run(params.arguments || {}, session);
        return rpcResult(msg.id, result);
      } catch (err) {
        logger.error("mcp tool failed", { tool: tool.name, email: session.email, error: String(err && err.stack ? err.stack : err) });
        return rpcResult(msg.id, toolError(`${tool.name} failed: ${err && err.message ? err.message : err}`));
      }
    }
    // Declared-but-empty so a client that probes them gets an answer rather
    // than a "method not found" it has to special-case.
    case "resources/list":
      return rpcResult(msg.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(msg.id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(msg.id, { prompts: [] });
    default:
      return isNotification ? null : rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

async function handleMcp(req, res) {
  if (req.method === "GET") {
    // No server-initiated SSE stream on this transport — the spec's answer
    // for that is 405, and clients fall back to plain POST.
    res.status(405).set("Allow", "POST, DELETE, OPTIONS").json({ error: "SSE streaming is not supported; POST JSON-RPC requests instead" });
    return;
  }
  if (req.method === "DELETE") { res.status(204).send(""); return; }
  if (req.method !== "POST") { res.status(405).set("Allow", "POST, DELETE, OPTIONS").json({ error: "method not allowed" }); return; }

  const auth = await authenticateBearer(req);
  if (!auth.ok) return unauthorized(res, auth.detail);

  const body = req.body;
  const ctx = {};
  if (Array.isArray(body)) {
    const responses = [];
    for (const msg of body) {
      const out = await dispatchRpc(msg, auth.session, ctx);
      if (out) responses.push(out);
    }
    if (!responses.length) { res.status(202).send(""); return; }
    res.status(200).json(responses);
    return;
  }
  const out = await dispatchRpc(body, auth.session, ctx);
  if (!out) { res.status(202).send(""); return; }
  res.status(200).json(out);
}

// ══════════════════════════════════════════════════════════════════════════
// Console-side endpoints (called by the browser, not by an agent)
// ══════════════════════════════════════════════════════════════════════════
//
// These authenticate with a Firebase ID token in X-Firebase-ID-Token rather
// than an MCP bearer token — the header is deliberately different so the
// two credential kinds can never be confused for one another.

async function requireConsoleUser(req, minRole) {
  const idToken = String(req.get("x-firebase-id-token") || "");
  if (!idToken) return { ok: false, status: 401, error: "missing X-Firebase-ID-Token" };
  let decoded;
  try { decoded = await adminAuth().verifyIdToken(idToken, true); } catch { return { ok: false, status: 401, error: "invalid sign-in" }; }
  const user = await resolveConsoleUser(decoded.email);
  if (!user) return { ok: false, status: 403, error: "not on the console user list" };
  if (minRole && !atLeast(user.role, minRole)) return { ok: false, status: 403, error: `requires ${minRole} access` };
  return { ok: true, user, uid: decoded.uid };
}

// A member added before they ever signed in has no Auth account to carry a
// custom claim, so the claim-sync trigger skipped them. auth-gate.js calls
// this once after such a sign-in and then force-refreshes its ID token.
async function handleClaimsSync(req, res) {
  if (req.method !== "POST") return oauthError(res, 405, "invalid_request", "POST only");
  const who = await requireConsoleUser(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  let changed = false;
  try { changed = await ensureClaimsFor(who.user.email, who.user.role); } catch (err) {
    logger.warn("claims sync failed", { email: who.user.email, error: String(err) });
  }
  res.status(200).json({ email: who.user.email, role: who.user.role, claimUpdated: changed });
}

// What an agent connection looks like from the console: one row per client
// a person has connected, backed by their live refresh tokens.
async function handleMyConnections(req, res) {
  const who = await requireConsoleUser(req);
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }

  if (req.method === "GET") {
    const snap = await db().collection("mcpTokens")
      .where("email", "==", who.user.email).where("type", "==", "refresh").limit(200).get();
    const byClient = new Map();
    const clientNames = new Map();
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (d.revoked || d.expiresAt < nowSeconds()) continue;
      if (!clientNames.has(d.clientId)) {
        const c = await db().collection("mcpClients").doc(d.clientId).get();
        clientNames.set(d.clientId, c.exists ? (c.data() || {}).clientName : d.clientId);
      }
      const prev = byClient.get(d.clientId) || { clientId: d.clientId, clientName: clientNames.get(d.clientId), connections: 0, connectedAt: null, lastUsedAt: null, scope: d.scope };
      prev.connections += 1;
      const created = tsToISO(d.createdAt);
      const used = tsToISO(d.lastUsedAt);
      if (created && (!prev.connectedAt || created > prev.connectedAt)) prev.connectedAt = created;
      if (used && (!prev.lastUsedAt || used > prev.lastUsedAt)) prev.lastUsedAt = used;
      byClient.set(d.clientId, prev);
    }
    res.status(200).json({ email: who.user.email, role: who.user.role, clients: [...byClient.values()] });
    return;
  }

  if (req.method === "POST") {
    // Revoke: your own connections always; an admin may pass another
    // member's email to cut theirs off.
    const body = req.body || {};
    const target = String(body.email || who.user.email).toLowerCase();
    if (target !== who.user.email && !atLeast(who.user.role, "admin")) {
      res.status(403).json({ error: "only an admin can revoke someone else's agent access" });
      return;
    }
    const clientId = body.clientId ? String(body.clientId) : null;
    const snap = await db().collection("mcpTokens").where("email", "==", target).limit(500).get();
    let revoked = 0;
    let batch = db().batch();
    let pending = 0;
    for (const doc of snap.docs) {
      const d = doc.data() || {};
      if (d.revoked) continue;
      if (clientId && d.clientId !== clientId) continue;
      batch.update(doc.ref, { revoked: true, revokedAt: FieldValue.serverTimestamp(), revokedReason: `revoked by ${who.user.email}` });
      revoked += 1;
      if (++pending >= 400) { await batch.commit(); batch = db().batch(); pending = 0; }
    }
    if (pending) await batch.commit();
    logger.info("mcp tokens revoked", { by: who.user.email, target, clientId, revoked });
    res.status(200).json({ revoked, email: target, clientId });
    return;
  }

  res.status(405).json({ error: "method not allowed" });
}

// Admin: make sure a member can actually sign in.
//
// Google sign-in needs nothing here — Firebase creates the account on first
// use. This exists for the "login credentials" half: an admin adds someone
// with no Google account, this creates their Firebase Auth user with an
// unguessable random password, and the console then sends them a password
// reset email so they choose their own. Nobody ever emails a password.
async function handleAdminProvision(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const who = await requireConsoleUser(req, "admin");
  if (!who.ok) { res.status(who.status).json({ error: who.error }); return; }
  const email = String((req.body || {}).email || "").trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { res.status(400).json({ error: "a valid email is required" }); return; }
  const member = await resolveConsoleUser(email);
  if (!member) { res.status(400).json({ error: `${email} is not on the console user list yet — add them first` }); return; }

  let created = false;
  let user;
  try {
    user = await adminAuth().getUserByEmail(email);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      user = await adminAuth().createUser({
        email,
        emailVerified: false,
        displayName: member.displayName || undefined,
        password: b64url(crypto.randomBytes(24)) + "aA1!",
      });
      created = true;
    } else {
      logger.error("provision failed", { email, error: String(err) });
      res.status(502).json({ error: "could not reach Firebase Auth" });
      return;
    }
  }
  try { await ensureClaimsFor(email, member.role); } catch (err) { logger.warn("claim set failed during provision", { email, error: String(err) }); }
  logger.info("console member provisioned", { by: who.user.email, email, created });
  res.status(200).json({ email, uid: user.uid, created, role: member.role });
}

// ══════════════════════════════════════════════════════════════════════════
// Router
// ══════════════════════════════════════════════════════════════════════════

// The same function answers at three different path shapes: behind the
// hosting rewrite (/mcp/...), at the raw function URL (/...), and at the
// legacy cloudfunctions.net form (/mcpServer/...). The two well-known
// documents keep their root paths untouched — RFC 9728 and RFC 8414 both
// specify where they live, and a client will not look anywhere else.
function routePath(req) {
  let p = String(req.path || "/");
  p = p.replace(/^\/mcpServer(?=\/|$)/, "");
  if (p.startsWith("/.well-known/")) return p;
  p = p.replace(/^\/mcp(?=\/|$)/, "");
  if (!p.startsWith("/")) p = `/${p}`;
  return p.length > 1 ? p.replace(/\/+$/, "") || "/" : "/";
}

exports.mcpServer = onRequest({ cors: false, timeoutSeconds: 120, memory: "256MiB", maxInstances: 20 }, async (req, res) => {
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).send(""); return; }
  const path = routePath(req);
  try {
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      res.status(200).set("Cache-Control", "public, max-age=300").json(protectedResourceMetadata());
      return;
    }
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      res.status(200).set("Cache-Control", "public, max-age=300").json(authorizationServerMetadata());
      return;
    }
    switch (path) {
      case "/": return await handleMcp(req, res);
      case "/register": return await handleRegister(req, res);
      case "/authorize": return await handleAuthorize(req, res);
      case "/authorize/complete": return await handleAuthorizeComplete(req, res);
      case "/token": return await handleToken(req, res);
      case "/revoke": return await handleRevoke(req, res);
      case "/claims/sync": return await handleClaimsSync(req, res);
      case "/me/connections": return await handleMyConnections(req, res);
      case "/admin/provision": return await handleAdminProvision(req, res);
      default:
        res.status(404).json({ error: "not_found", error_description: `no endpoint at ${path}` });
    }
  } catch (err) {
    logger.error("mcpServer request failed", { path, error: String(err && err.stack ? err.stack : err) });
    if (!res.headersSent) res.status(500).json({ error: "server_error" });
  }
});

// Exported for the unit tests in test/mcp-server.test.js — none of these
// touch Firestore or Auth, so they can be checked without an emulator.
exports.__test = {
  routePath, redirectUriAllowed, generateTitle, suggestCategory, atLeast,
  sha256b64url, authorizationServerMetadata, protectedResourceMetadata,
  TOOLS, CATEGORIES, STATUS_LABELS, SUPPORTED_PROTOCOL_VERSIONS, SERVER_ICONS,
};
