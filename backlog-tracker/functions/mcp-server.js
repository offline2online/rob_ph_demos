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

// ── FAQ / Help Center write limits ───────────────────────────────────────
// Mirrors firestore.rules' isValidPendingRevision / the faqArticles create-
// update rule exactly, so a write this server accepts is never one the
// console's own client-side rules would then reject as oversized — see
// REQUIREMENTS.md -> "FAQ revision review".
const FAQ_TITLE_MAX = 200;
const FAQ_SLUG_MAX = 200;
const FAQ_SUMMARY_MAX = 400;
const FAQ_BODY_MAX = 60000;
const FAQ_KEYWORDS_MAX = 30;
const FAQ_REASON_MAX = 2000;
const FAQ_DOC_TYPES = ["faq", "how-to", "reference", "explanation"];

// ── Skills library write limits ──────────────────────────────────────────
// An organisation-wide, unscoped-to-any-project library of shareable
// skills (e.g. this repo's own ph-designer skill) — see firestore.rules'
// `match /skills/{skillId}` for the mirrored top-level checks. Firestore
// rules can't practically iterate a variable-length `files` list to
// re-check every element's own size, so the per-file cap below is the real
// enforcement; rules only check the list's own shape/length. 100,000
// characters comfortably covers a real skill's largest reference file
// (ph-designer's are all under 20 KB) with headroom for a much bigger one.
const SKILL_NAME_MAX = 120;
const SKILL_SLUG_MAX = 60;
const SKILL_SUMMARY_MAX = 400;
const SKILL_VERSION_MAX = 40;
const SKILL_FILES_MAX = 20;
const SKILL_FILE_PATH_MAX = 200;
const SKILL_FILE_MAX = 100000;

// Informational "owning team" tag (tGsm6lsBRsGtyoMZS3rn) — which functional
// team maintains/optimises a skill, so someone deciding whether to touch it
// knows who to loop in. Soft ownership only: this list is not a permission
// gate anywhere (any editor may still create/update/delete any skill,
// mirrored in firestore.rules' own check below) — it's purely a label shown
// on the Skills page card and returned by list_skills/get_skill. Mirrored in
// firestore.rules' `match /skills/{skillId}` and the console's Add/Edit
// skill modal (public/js/app.js); keep all three in step if this list
// changes. Optional/nullable — a skill created before this existed, or one
// nobody has claimed yet, simply has no owningTeam set.
const SKILL_OWNING_TEAMS = ["Product/Design", "Engineering", "Cybersecurity"];

// Shared by upload_skill and update_skill: normalizes and bounds-checks a
// files array, returning either { files } or { error }. Never throws — every
// tool that calls this turns a bad `files` argument into a toolError instead
// of a 500.
function validateSkillFiles(input) {
  if (!Array.isArray(input) || !input.length) {
    return { error: "files must be a non-empty array of {path, content}." };
  }
  if (input.length > SKILL_FILES_MAX) {
    return { error: `files is limited to ${SKILL_FILES_MAX} entries; that was ${input.length}.` };
  }
  const files = [];
  const seenPaths = new Set();
  for (const raw of input) {
    const path = String((raw && raw.path) || "").trim();
    if (!path) return { error: "Every file needs a non-empty path." };
    if (path.length > SKILL_FILE_PATH_MAX) return { error: `A file path is limited to ${SKILL_FILE_PATH_MAX} characters: ${path}` };
    if (seenPaths.has(path)) return { error: `Duplicate file path: ${path}` };
    seenPaths.add(path);
    const content = String((raw && raw.content) == null ? "" : raw.content);
    if (content.length > SKILL_FILE_MAX) return { error: `${path} is limited to ${SKILL_FILE_MAX} characters; that was ${content.length}.` };
    files.push({ path, content });
  }
  return { files };
}

function slugifyFaq(s) {
  return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// Appends -2, -3, … until a free slug is found, rather than rejecting the
// call outright — an agent filing a draft has no reason to know what slugs
// already exist, and the console's own editor doesn't enforce uniqueness
// either, so this is a courtesy, not a rule the schema requires.
async function uniqueFaqSlug(base) {
  const wanted = base || "article";
  let candidate = wanted;
  for (let n = 2; n < 50; n += 1) {
    const hit = await db().collection("faqArticles").where("slug", "==", candidate).limit(1).get();
    if (hit.empty) return candidate;
    candidate = `${wanted}-${n}`;
  }
  return `${wanted}-${Date.now()}`;
}

// ── Documentation limits ─────────────────────────────────────────────────
// A project's own Requirements and README live as fields on its projects/{id}
// doc, so every one of them shares that doc's 1 MiB Firestore ceiling. The
// real files today are ~95 KB (REQUIREMENTS.md) and ~80 KB (README.md), so
// 200k characters each is generous headroom while keeping the worst case well
// clear of the limit — which is also why a replaced version is written to
// docRevisions rather than kept as a second copy on the project doc.
const PROJECT_MD_MAX = 200000;
// projectDocs and interfaces are capped at what firestore.rules already
// allows the BROWSER to write (20000). Going higher here would let an agent
// author a document a person could then never save an edit to from the Docs
// page, because the rules would reject their write. Keep the two in step.
const DOC_MD_MAX = 20000;
const DOC_NAME_MAX = 120;

// The ONLY fields on a projects/{id} doc that any tool here may write.
//
// Everything absent is absent deliberately. The train fields (deployBranch,
// trainReady, trainStatus, trainPrNumber, trainNote, trainLocked,
// needsHumanMerge) and the notify triggers (notifyRequestedAt,
// deployNotifyRequestedAt) would each start or redirect a real deployment,
// which is the one thing this server must never be able to do — and the
// documentation tools below are the first tools that write to `projects` at
// all, so the guarantee now needs enforcing rather than being a consequence
// of never touching the collection. updateProjectFields is the only path to
// a project write, and it refuses anything not on this list.
const PROJECT_WRITABLE_FIELDS = new Set([
  "requirementsMd", "requirementsUpdatedByEmail",
  "readmeMd", "readmeUpdatedByEmail",
  "artifactUrl", "artifactUpdatedAt",
]);

async function updateProjectFields(projectId, fields) {
  for (const key of Object.keys(fields)) {
    if (!PROJECT_WRITABLE_FIELDS.has(key)) {
      throw new Error(`refusing to write projects.${key} — not a documentation field`);
    }
  }
  await db().collection("projects").doc(String(projectId)).set(
    Object.assign({}, fields, { updatedAt: FieldValue.serverTimestamp() }),
    { merge: true },
  );
}

// Every documentation write records what it replaced, so an agent that
// truncates a 95 KB requirements doc at 3am has not destroyed it. This is
// the whole reason delete_* tools are safe to offer at all: a delete writes
// the content here first. Server-only — firestore.rules lets members read it
// and nobody write it.
async function recordDocRevision(session, target, meta, previousContentMd) {
  if (previousContentMd === undefined || previousContentMd === null || previousContentMd === "") return null;
  const ref = await db().collection("docRevisions").add(Object.assign({
    target,
    contentMd: String(previousContentMd),
    chars: String(previousContentMd).length,
    replacedAt: FieldValue.serverTimestamp(),
    replacedByEmail: session.email,
    via: "mcp",
  }, meta || {}));
  return ref.id;
}

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

// ── Composable UI resources (embedded HTML cards) ───────────────────────────
// get_ready_for_testing_board and get_approved_for_deployment_board (below)
// return, alongside the usual JSON, a self-contained HTML "card list" as an
// MCP embedded resource (content type "resource", mimeType "text/html") —
// the standard MCP tool-result content block, not a bespoke extension — so a
// client that renders embedded HTML resources inline can show the column as
// cards right in the conversation instead of only as text. A client that
// doesn't render resources still gets the same data as the plain-text/JSON
// blocks that come with it.
//
// No <script>, no external stylesheet/font fetch, no <form> — everything is
// inline-styled static markup. Every user-authored string (title/desc/
// testSummary — recall backlogItems.desc is publicly, unauthenticatedly
// writable, see this file's own header) goes through escapeHTML() before it
// reaches the markup, and a URL is only ever linked when it parses as
// https:// (safeHref) — a malicious previewUrl set to a javascript: URI is
// rendered as plain text, never as a clickable href.
//
// Colours/type below are Personalisation Hub's own measured tokens (see the
// ph-designer skill's tokens.md) — this widget isn't an iframed prototype
// page (nothing here is iframed into HQ Admin), so the prototyping.md "content
// frame only" rules don't apply, but the brand palette and Roboto still
// should, for the same reason any other Claude-built surface for this board
// would want to look like it belongs to it.
const PH_TOKENS = {
  primary: "#169bc2", accent: "#38b0cf", text: "#333333",
  muted: "rgba(0,0,0,0.45)", border: "#d9d9d9", bg: "#ffffff",
  success: "#52c41a", warning: "#faad14",
};

function safeHref(url) {
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
}

function pillHTML(label, kind) {
  const styles = {
    primary: "background:#169bc21a;color:#169bc2;",
    accent: "background:#38b0cf1a;color:#0d7691;",
    neutral: "background:rgba(0,0,0,0.06);color:#333333;",
  };
  return `<span style="display:inline-block;font-size:11px;font-weight:600;line-height:1;padding:3px 8px;border-radius:9999px;margin:0 6px 6px 0;${styles[kind] || styles.neutral}">${escapeHTML(label)}</span>`;
}

function cardShellHTML(headline, subhead, bodyHTML) {
  return `<div style="font-family:Roboto,'Helvetica Neue',Helvetica,Arial,sans-serif;color:${PH_TOKENS.text};background:${PH_TOKENS.bg};max-width:640px;">
  <div style="font-size:16px;font-weight:700;margin-bottom:2px;">${escapeHTML(headline)}</div>
  <div style="font-size:13px;color:${PH_TOKENS.muted};margin-bottom:12px;">${escapeHTML(subhead)}</div>
  ${bodyHTML}
</div>`;
}

// One ticket, as a card. `extraPillsHTML` lets a caller add train/PR context
// (see get_approved_for_deployment_board) without this function needing to
// know about the deployment train at all.
function ticketCardHTML(item, extraPillsHTML) {
  const bodyText = item.testSummary || item.desc || "";
  const hasBoth = item.testSummary && item.desc && item.testSummary !== item.desc;
  const testHref = safeHref(item.previewUrl);
  const testLink = testHref
    ? `<a href="${escapeHTML(testHref)}" target="_blank" rel="noopener" style="color:${PH_TOKENS.primary};font-weight:600;text-decoration:none;font-size:13px;">Test this &rarr;</a>`
    : "";
  const boardHref = safeHref(item.board);
  const boardLink = boardHref
    ? `<a href="${escapeHTML(boardHref)}" target="_blank" rel="noopener" style="color:${PH_TOKENS.muted};text-decoration:none;font-size:12px;">View ticket &#8599;</a>`
    : "";
  const versionPill = item.testVersion ? pillHTML(`Test version: v${item.testVersion}`, "accent") : "";
  return `<div style="border:1px solid ${PH_TOKENS.border};border-radius:8px;padding:12px 14px;margin-bottom:10px;">
    <div style="font-size:14px;font-weight:700;margin-bottom:4px;">${escapeHTML(item.title || "(untitled)")}</div>
    <div style="font-size:12px;color:${PH_TOKENS.muted};margin-bottom:8px;">${escapeHTML(item.project || "")}${item.project ? " &middot; " : ""}${escapeHTML(item.id)}</div>
    <div style="font-size:13px;line-height:1.45;white-space:pre-wrap;margin-bottom:8px;">${escapeHTML(bodyText)}</div>
    ${hasBoth ? `<details style="margin-bottom:8px;"><summary style="cursor:pointer;font-size:12px;color:${PH_TOKENS.primary};">Show original request</summary><div style="font-size:13px;line-height:1.45;white-space:pre-wrap;margin-top:6px;">${escapeHTML(item.desc)}</div></details>` : ""}
    <div style="margin-bottom:2px;">${versionPill}${extraPillsHTML || ""}</div>
    <div style="display:flex;gap:14px;align-items:center;">${testLink}${boardLink}</div>
  </div>`;
}

// Mirrors public/js/app.js's deployNotifyButtonHTML gate exactly
// (pendingTrainRevertsForProject + trainItemsForProject +
// legacyDeployItemsForProject) — see that file. Both
// get_approved_for_deployment_board and approve_deploy_to_main call this so
// the two can never disagree about whether the console's own Deploy to Main
// button would be showing right now.
async function deployGuardForProject(pid) {
  const snap = await db().collection("backlogItems").where("projectId", "==", pid).get();
  const items = [];
  snap.forEach((doc) => items.push(Object.assign({ id: doc.id }, doc.data())));

  const pendingReverts = items.filter((i) => i.revertRequested === true && i.deployCommit);
  if (pendingReverts.length) {
    return {
      ok: false, deployItems: [],
      reason: `${pendingReverts.length} ticket(s) on this project's deployment train have a pending revert not yet resolved (e.g. "${pendingReverts[0].title}"). The board's own Deploy to Main button is hidden for the same reason — resolve it there first.`,
    };
  }

  const trainItems = items.filter((i) => i.deployCommit && (i.status === "ready-for-testing" || i.status === "ready-to-publish"));
  if (trainItems.length) {
    const stillTesting = trainItems.filter((i) => i.status !== "ready-to-publish");
    if (stillTesting.length) {
      return {
        ok: false, deployItems: [],
        reason: `${stillTesting.length} ticket(s) on this project's deployment train are still in Ready for Testing (e.g. "${stillTesting[0].title}") — merging now would ship them untested too. The board's own Deploy to Main button is hidden until Ready for Testing is empty for this project.`,
      };
    }
    return { ok: true, deployItems: trainItems, reason: null };
  }

  const legacyItems = items.filter((i) => i.status === "ready-to-publish" && !i.deployCommit && !i.noDeploymentRequired);
  if (!legacyItems.length) {
    return { ok: false, deployItems: [], reason: "Nothing is Approved for Deployment for this project yet — the board's own Deploy to Main button is hidden for the same reason." };
  }
  return { ok: true, deployItems: legacyItems, reason: null };
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
  // ── Composable UI: review the pipeline's two "waiting on a human" columns
  // in-agent, without leaving the conversation ─────────────────────────────
  // Read-only, same as list_backlog_items/get_backlog_item above — nothing
  // here can move a ticket. See the "Composable UI resources" comment above
  // TOOLS for what the embedded HTML resource is and isn't.
  {
    name: "get_ready_for_testing_board",
    description: "A composable view of the Ready for Testing column: every ticket a build just landed in, shown as a card (title, testSummary/desc, test link, testVersion, and a link back to the ticket). Returns an embedded HTML resource a supporting client renders inline in the conversation, alongside the same data as plain text/JSON for a client that can't. Read-only — reviewing here never changes a ticket's status; approve or reject it on the board itself.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Restrict to one project (from list_projects). Omit to see every project's Ready for Testing column at once." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const a = args || {};
      const projects = await loadProjectsById();
      if (a.projectId && !projects.has(String(a.projectId))) return toolError(`No project with id ${a.projectId}. Call list_projects first.`);
      let q = db().collection("backlogItems");
      if (a.projectId) q = q.where("projectId", "==", String(a.projectId));
      const snap = await q.limit(MAX_READ_DOCS).get();
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if ((d.status || "backlog") !== "ready-for-testing") return;
        rows.push({ doc, d });
      });
      rows.sort((x, y) => (y.d.updatedAt?.toMillis?.() || 0) - (x.d.updatedAt?.toMillis?.() || 0));

      const cards = rows.map(({ doc, d }) => {
        const project = projects.get(d.projectId);
        return {
          id: doc.id,
          projectId: d.projectId || null,
          project: project ? project.name : null,
          title: d.title || "",
          testSummary: d.testSummary || null,
          desc: d.desc || "",
          previewUrl: d.previewUrl || null,
          testVersion: d.testVersion || null,
          board: `${PUBLIC_ORIGIN}/#item-${doc.id}`,
        };
      });

      const projectLabel = a.projectId ? ((projects.get(String(a.projectId)) || {}).name || a.projectId) : "every project";
      const headline = `Ready for Testing — ${projectLabel}`;
      const subhead = cards.length
        ? `${cards.length} ticket${cards.length === 1 ? "" : "s"} waiting on review. Read-only — approve or reject on the board.`
        : "Nothing in Ready for Testing right now.";
      const bodyHTML = cards.map((c) => ticketCardHTML(c)).join("\n")
        || `<div style="font-size:13px;color:${PH_TOKENS.muted};">Nothing to show.</div>`;
      const html = cardShellHTML(headline, subhead, bodyHTML);

      return {
        content: [
          { type: "text", text: `${headline}: ${cards.length} ticket(s). Read-only — this view can't change status.` },
          { type: "resource", resource: { uri: `ui://backlog-tracker/ready-for-testing/${a.projectId || "all"}`, mimeType: "text/html", text: html } },
          { type: "text", text: JSON.stringify({ projectId: a.projectId || null, count: cards.length, items: cards }, null, 2) },
        ],
      };
    },
  },
  {
    name: "get_approved_for_deployment_board",
    description: "A composable view of the Approved for Deployment column: every ticket already tested and confirmed, just waiting to be merged, shown as a card with its deploy/train context (on the train + which branch, or its own PR). Returns an embedded HTML resource a supporting client renders inline in the conversation, alongside the same data as plain text/JSON. Read-only — this view can't change status; when a project's whole train is approved and Ready for Testing is empty for it, this names approve_deploy_to_main as the tool that actually fires Deploy to Main.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Restrict to one project (from list_projects). Omit to see every project's Approved for Deployment column at once — deploy-readiness can only be reported with a projectId, since it's a per-project question." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const a = args || {};
      const projects = await loadProjectsById();
      if (a.projectId && !projects.has(String(a.projectId))) return toolError(`No project with id ${a.projectId}. Call list_projects first.`);
      let q = db().collection("backlogItems");
      if (a.projectId) q = q.where("projectId", "==", String(a.projectId));
      const snap = await q.limit(MAX_READ_DOCS).get();
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        if ((d.status || "backlog") !== "ready-to-publish") return;
        rows.push({ doc, d });
      });
      rows.sort((x, y) => (y.d.updatedAt?.toMillis?.() || 0) - (x.d.updatedAt?.toMillis?.() || 0));

      const guard = a.projectId ? await deployGuardForProject(String(a.projectId)) : null;

      const cards = rows.map(({ doc, d }) => {
        const project = projects.get(d.projectId);
        return {
          id: doc.id,
          projectId: d.projectId || null,
          project: project ? project.name : null,
          title: d.title || "",
          testSummary: d.testSummary || null,
          desc: d.desc || "",
          previewUrl: d.previewUrl || null,
          testVersion: d.testVersion || null,
          onTrain: !!d.deployCommit,
          deployCommit: d.deployCommit || null,
          prNumber: d.prNumber || null,
          deployBranch: (project && project.deployBranch) || null,
          board: `${PUBLIC_ORIGIN}/#item-${doc.id}`,
        };
      });

      const projectLabel = a.projectId ? ((projects.get(String(a.projectId)) || {}).name || a.projectId) : "every project";
      const readyLine = guard ? (guard.ok
        ? "This project's whole train is Approved for Deployment — ask your agent to call approve_deploy_to_main to fire Deploy to Main."
        : guard.reason) : null;
      const headline = `Approved for Deployment — ${projectLabel}`;
      const subhead = cards.length
        ? `${cards.length} ticket${cards.length === 1 ? "" : "s"} waiting to ship.`
        : "Nothing Approved for Deployment right now.";
      const readyBannerHTML = readyLine
        ? `<div style="font-size:12px;font-weight:600;color:${guard.ok ? PH_TOKENS.success : PH_TOKENS.warning};margin-bottom:10px;">${escapeHTML(readyLine)}</div>`
        : "";
      const cardsHTML = cards.map((c) => ticketCardHTML(c, c.onTrain
        ? pillHTML(`On train: ${c.deployBranch || "?"}`, "primary")
        : (c.prNumber ? pillHTML(`PR #${c.prNumber}`, "neutral") : ""))).join("\n")
        || `<div style="font-size:13px;color:${PH_TOKENS.muted};">Nothing to show.</div>`;
      const html = cardShellHTML(headline, subhead, readyBannerHTML + cardsHTML);

      return {
        content: [
          { type: "text", text: `${headline}: ${cards.length} ticket(s).${readyLine ? ` ${readyLine}` : ""}` },
          { type: "resource", resource: { uri: `ui://backlog-tracker/approved-for-deployment/${a.projectId || "all"}`, mimeType: "text/html", text: html } },
          { type: "text", text: JSON.stringify({ projectId: a.projectId || null, count: cards.length, readyToDeploy: guard ? guard.ok : null, items: cards }, null, 2) },
        ],
      };
    },
  },
  // ── The one deliberate, logged exception to "nothing here deploys" ──────
  // Every other tool in this file is read/file/comment/documentation only —
  // see this file's own header. This is the single, narrowly-scoped carve-
  // out: it fires the exact same trigger the console's own "Deploy to Main"
  // button writes (projects/{id}.deployNotifyRequestedAt, watched by
  // notifyOnProjectReadyToDeploy in index.js), so it merges nothing itself —
  // the existing Routine still verifies the train and the existing pipeline
  // still does the real merge. Gated to board.write (never a viewer, same as
  // every other write tool) and logged to mcpAuditLog like every other write
  // here. The one thing that's genuinely new is the guard below, which this
  // tool must enforce itself since notifyOnProjectReadyToDeploy does not —
  // deployGuardForProject mirrors deployNotifyButtonHTML's client-side gate
  // exactly, so calling this tool directly can never fire a deploy the
  // console's own button would currently be hiding.
  {
    name: "approve_deploy_to_main",
    description: "Fire this project's Deploy to Main trigger — exactly the same action as clicking the board's own 'Deploy to Main' button. It does not merge anything itself: it only fires the existing Routine, which verifies the train and the existing pipeline then merges it. Only offered when every ticket on this project's deployment train is already Approved for Deployment and Ready for Testing is empty for it — the same condition that shows the console's own button — and refuses otherwise, naming what's blocking it. Logged to mcpAuditLog under your email.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: { projectId: { type: "string", description: "Which project (from list_projects)." } },
      required: ["projectId"], additionalProperties: false,
    },
    async run(args, session) {
      const projectId = String(args.projectId || "");
      const projectSnap = await db().collection("projects").doc(projectId).get();
      if (!projectSnap.exists) return toolError(`No project with id ${projectId}. Call list_projects first.`);

      const guard = await deployGuardForProject(projectId);
      if (!guard.ok) return toolError(guard.reason);

      await db().collection("projects").doc(projectId).set({
        deployNotifyRequestedAt: FieldValue.serverTimestamp(),
        // Provenance, same spirit as create_backlog_item's createdVia/
        // createdByEmail — not a train field (see PROJECT_WRITABLE_FIELDS'
        // own comment on what counts as one) and not read by the pipeline,
        // just an audit trail on the project doc itself.
        deployNotifyRequestedVia: "mcp",
        deployNotifyRequestedByEmail: session.email,
      }, { merge: true });

      await audit(session, "approve_deploy_to_main", {
        projectId, deployCount: guard.deployItems.length,
        itemIds: guard.deployItems.map((i) => i.id),
      });

      return textResult({
        fired: true, projectId, deployCount: guard.deployItems.length,
        itemIds: guard.deployItems.map((i) => i.id),
        note: "This fires the same Routine the console's own Deploy to Main button fires — it verifies the train and merges it. This call returns before that finishes; check the project's trainStatus (list_projects) or the board itself afterward.",
      });
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
      out.artifactUrl = p.artifactUrl || null;
      out.artifactUpdatedAt = tsToISO(p.artifactUpdatedAt);
      if (want.includes("docs")) {
        out.documents = [];
        (await db().collection("projectDocs").where("projectId", "==", projectId).get())
          .forEach((d) => {
            const v = d.data() || {};
            out.documents.push({ id: d.id, name: v.name || "", contentMd: v.contentMd || "", updatedAt: tsToISO(v.updatedAt), updatedByEmail: v.updatedByEmail || null });
          });
        out.documents.sort((a, b) => a.name.localeCompare(b.name));
      }
      if (want.includes("interfaces")) {
        out.interfaces = [];
        (await db().collection("interfaces").where("projectIds", "array-contains", projectId).get())
          .forEach((d) => {
            const i = d.data() || {};
            out.interfaces.push({ id: d.id, name: i.name || "", projectIds: i.projectIds || [], contentMd: i.contentMd || "", updatedAt: tsToISO(i.updatedAt), updatedByEmail: i.updatedByEmail || null });
          });
      }
      return textResult(out);
    },
  },
  // ── Documentation: full read/write ──────────────────────────────────────
  // A project's documentation is meant to be kept current by whoever is doing
  // the work, including an agent — so these are real read/write tools, gated
  // by the same per-person OAuth session as everything else. No separate
  // token, no shared key.
  //
  // What they can reach: a project's Requirements and README, its additional
  // documents (architecture notes, API specs, ADRs), the interface contracts
  // it shares with another project, and its Artifact link. What they cannot
  // reach, by construction rather than convention: anything to do with
  // shipping — see PROJECT_WRITABLE_FIELDS above.
  {
    name: "set_project_requirements",
    description: "Replace a project's Requirements markdown (the board-native home of its REQUIREMENTS.md). Send the COMPLETE new document — this overwrites, it does not append. The previous version is kept in the revision history, so a bad write is recoverable with list_doc_revisions.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "From list_projects." },
        contentMd: { type: "string", description: `The whole document, markdown. Up to ${PROJECT_MD_MAX} characters.` },
      },
      required: ["projectId", "contentMd"], additionalProperties: false,
    },
    async run(args, session) {
      const projectId = String(args.projectId);
      const md = String(args.contentMd == null ? "" : args.contentMd);
      if (md.length > PROJECT_MD_MAX) return toolError(`Requirements are limited to ${PROJECT_MD_MAX} characters; that was ${md.length}.`);
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) return toolError(`No project with id ${projectId}. Call list_projects first.`);
      const before = (snap.data() || {}).requirementsMd || "";
      const revisionId = await recordDocRevision(session, "project.requirementsMd", { projectId, name: (snap.data() || {}).name || "" }, before);
      await updateProjectFields(projectId, { requirementsMd: md, requirementsUpdatedByEmail: session.email });
      await audit(session, "set_project_requirements", { projectId, chars: md.length, replacedChars: before.length, revisionId });
      return textResult({ updated: true, projectId, chars: md.length, replacedChars: before.length, revisionId, note: "Keep the repo's REQUIREMENTS.md in sync — a divergence is a bug in whichever is stale." });
    },
  },
  {
    name: "set_project_readme",
    description: "Replace a project's README markdown (the board-native counterpart of its README.md). Send the COMPLETE new document — this overwrites, it does not append. The previous version is kept in the revision history.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        contentMd: { type: "string", description: `The whole document, markdown. Up to ${PROJECT_MD_MAX} characters.` },
      },
      required: ["projectId", "contentMd"], additionalProperties: false,
    },
    async run(args, session) {
      const projectId = String(args.projectId);
      const md = String(args.contentMd == null ? "" : args.contentMd);
      if (md.length > PROJECT_MD_MAX) return toolError(`A README is limited to ${PROJECT_MD_MAX} characters; that was ${md.length}.`);
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) return toolError(`No project with id ${projectId}. Call list_projects first.`);
      const before = (snap.data() || {}).readmeMd || "";
      const revisionId = await recordDocRevision(session, "project.readmeMd", { projectId, name: (snap.data() || {}).name || "" }, before);
      await updateProjectFields(projectId, { readmeMd: md, readmeUpdatedByEmail: session.email });
      await audit(session, "set_project_readme", { projectId, chars: md.length, replacedChars: before.length, revisionId });
      return textResult({ updated: true, projectId, chars: md.length, replacedChars: before.length, revisionId, note: "Keep the repo's README.md in sync — a divergence is a bug in whichever is stale." });
    },
  },
  {
    name: "set_project_artifact",
    description: "Set (or clear) a project's published Artifact link — the 'View Artifact' entry in its board menu. Pass artifactUrl: null to remove it.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        artifactUrl: { type: ["string", "null"], description: "An https URL to the published Artifact, or null to clear." },
      },
      required: ["projectId"], additionalProperties: false,
    },
    async run(args, session) {
      const projectId = String(args.projectId);
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) return toolError(`No project with id ${projectId}.`);
      const raw = args.artifactUrl == null ? null : String(args.artifactUrl).trim();
      if (raw) {
        let u;
        try { u = new URL(raw); } catch { return toolError("artifactUrl must be a full URL, or null to clear it."); }
        if (u.protocol !== "https:") return toolError("artifactUrl must be https.");
        if (raw.length > 2000) return toolError("artifactUrl is too long.");
      }
      await updateProjectFields(projectId, { artifactUrl: raw, artifactUpdatedAt: raw ? FieldValue.serverTimestamp() : null });
      await audit(session, "set_project_artifact", { projectId, artifactUrl: raw });
      return textResult({ updated: true, projectId, artifactUrl: raw });
    },
  },
  {
    name: "create_project_document",
    description: "Add a named document to a project — an architecture note, an API spec, a decision record, anything that isn't its Requirements or README. Appears under 'Additional documents' on that project's Docs page.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string", description: `What it's called, e.g. "Event schema v2". Up to ${DOC_NAME_MAX} characters.` },
        contentMd: { type: "string", description: `Markdown. Up to ${DOC_MD_MAX} characters — the same ceiling the board's own editor has, so a person can still edit what you write.` },
      },
      required: ["projectId", "name", "contentMd"], additionalProperties: false,
    },
    async run(args, session) {
      const projectId = String(args.projectId);
      const name = String(args.name || "").trim();
      const md = String(args.contentMd == null ? "" : args.contentMd);
      if (!name) return toolError("name is required.");
      if (name.length > DOC_NAME_MAX) return toolError(`name is limited to ${DOC_NAME_MAX} characters.`);
      if (md.length > DOC_MD_MAX) return toolError(`A project document is limited to ${DOC_MD_MAX} characters; that was ${md.length}. Split it, or put it in the project's Requirements instead.`);
      const snap = await db().collection("projects").doc(projectId).get();
      if (!snap.exists) return toolError(`No project with id ${projectId}.`);
      const ref = await db().collection("projectDocs").add({
        projectId, name, contentMd: md,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdByEmail: session.email,
        updatedByEmail: session.email,
        createdVia: "mcp",
      });
      await audit(session, "create_project_document", { projectId, docId: ref.id, name, chars: md.length });
      return textResult({ created: true, docId: ref.id, projectId, name, chars: md.length });
    },
  },
  {
    name: "update_project_document",
    description: "Rename a project document, replace its contents, or both. Sending contentMd overwrites the whole document; the previous version is kept in the revision history.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        docId: { type: "string", description: "From get_project_docs." },
        name: { type: "string" },
        contentMd: { type: "string", description: `The whole document. Up to ${DOC_MD_MAX} characters.` },
      },
      required: ["docId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("projectDocs").doc(String(args.docId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No project document with id ${args.docId}. Call get_project_docs to list them.`);
      const current = snap.data() || {};
      const fields = { updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email };
      let revisionId = null;
      if (args.name != null) {
        const name = String(args.name).trim();
        if (!name) return toolError("name cannot be emptied.");
        if (name.length > DOC_NAME_MAX) return toolError(`name is limited to ${DOC_NAME_MAX} characters.`);
        fields.name = name;
      }
      if (args.contentMd != null) {
        const md = String(args.contentMd);
        if (md.length > DOC_MD_MAX) return toolError(`A project document is limited to ${DOC_MD_MAX} characters; that was ${md.length}.`);
        revisionId = await recordDocRevision(session, "projectDoc", { projectId: current.projectId || null, docId: snap.id, name: current.name || "" }, current.contentMd || "");
        fields.contentMd = md;
      }
      if (!("name" in fields) && !("contentMd" in fields)) return toolError("Nothing to change — pass name, contentMd, or both.");
      await ref.update(fields);
      await audit(session, "update_project_document", { docId: snap.id, projectId: current.projectId || null, changed: Object.keys(fields), revisionId });
      return textResult({ updated: true, docId: snap.id, changed: Object.keys(fields), revisionId });
    },
  },
  {
    name: "delete_project_document",
    description: "Remove a project document from the board. Its contents are written to the revision history first, so this is recoverable with list_doc_revisions and create_project_document.",
    scope: "board.write",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { docId: { type: "string" } },
      required: ["docId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("projectDocs").doc(String(args.docId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No project document with id ${args.docId}.`);
      const current = snap.data() || {};
      const revisionId = await recordDocRevision(session, "projectDoc.deleted", { projectId: current.projectId || null, docId: snap.id, name: current.name || "" }, current.contentMd || "");
      await ref.delete();
      await audit(session, "delete_project_document", { docId: snap.id, projectId: current.projectId || null, name: current.name || "", revisionId });
      return textResult({ deleted: true, docId: snap.id, name: current.name || "", revisionId, note: revisionId ? "Contents saved to the revision history — get_doc_revision can bring them back." : "The document was empty; nothing to recover." });
    },
  },
  {
    name: "create_interface",
    description: "Create a maintained contract document between exactly two projects — the board-native counterpart of a shared markdown file like shared/interface-contract.md. Visible and editable from either project's Docs page.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        projectIds: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2, description: "Exactly two project ids." },
        name: { type: "string", description: 'e.g. "Live Visitor Profile ↔ Experience Templates".' },
        contentMd: { type: "string", description: `Markdown. Up to ${DOC_MD_MAX} characters.` },
      },
      required: ["projectIds", "name", "contentMd"], additionalProperties: false,
    },
    async run(args, session) {
      const ids = Array.isArray(args.projectIds) ? args.projectIds.map(String) : [];
      if (ids.length !== 2) return toolError("projectIds must name exactly two projects — an interface is a contract between two.");
      if (ids[0] === ids[1]) return toolError("An interface spans two different projects.");
      const name = String(args.name || "").trim();
      const md = String(args.contentMd == null ? "" : args.contentMd);
      if (!name) return toolError("name is required.");
      if (name.length > DOC_NAME_MAX) return toolError(`name is limited to ${DOC_NAME_MAX} characters.`);
      if (md.length > DOC_MD_MAX) return toolError(`An interface document is limited to ${DOC_MD_MAX} characters; that was ${md.length}.`);
      for (const id of ids) {
        const snap = await db().collection("projects").doc(id).get();
        if (!snap.exists) return toolError(`No project with id ${id}.`);
      }
      const ref = await db().collection("interfaces").add({
        name, projectIds: ids, contentMd: md,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdByEmail: session.email,
        updatedByEmail: session.email,
        createdVia: "mcp",
      });
      await audit(session, "create_interface", { interfaceId: ref.id, projectIds: ids, name, chars: md.length });
      return textResult({ created: true, interfaceId: ref.id, projectIds: ids, name, chars: md.length });
    },
  },
  {
    name: "update_interface",
    description: "Rename an interface contract, replace its contents, or both. Sending contentMd overwrites the whole document; the previous version is kept in the revision history. Changing a contract affects BOTH projects — say so in the change.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        interfaceId: { type: "string", description: "From get_project_docs." },
        name: { type: "string" },
        contentMd: { type: "string", description: `The whole document. Up to ${DOC_MD_MAX} characters.` },
      },
      required: ["interfaceId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("interfaces").doc(String(args.interfaceId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No interface with id ${args.interfaceId}.`);
      const current = snap.data() || {};
      const fields = { updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email };
      let revisionId = null;
      if (args.name != null) {
        const name = String(args.name).trim();
        if (!name) return toolError("name cannot be emptied.");
        if (name.length > DOC_NAME_MAX) return toolError(`name is limited to ${DOC_NAME_MAX} characters.`);
        fields.name = name;
      }
      if (args.contentMd != null) {
        const md = String(args.contentMd);
        if (md.length > DOC_MD_MAX) return toolError(`An interface document is limited to ${DOC_MD_MAX} characters; that was ${md.length}.`);
        revisionId = await recordDocRevision(session, "interface", { interfaceId: snap.id, projectIds: current.projectIds || [], name: current.name || "" }, current.contentMd || "");
        fields.contentMd = md;
      }
      if (!("name" in fields) && !("contentMd" in fields)) return toolError("Nothing to change — pass name, contentMd, or both.");
      await ref.update(fields);
      await audit(session, "update_interface", { interfaceId: snap.id, projectIds: current.projectIds || [], changed: Object.keys(fields), revisionId });
      return textResult({ updated: true, interfaceId: snap.id, projectIds: current.projectIds || [], changed: Object.keys(fields), revisionId });
    },
  },
  {
    name: "delete_interface",
    description: "Remove an interface contract from the board. Its contents are written to the revision history first, so this is recoverable. It belongs to two projects — deleting it removes it from both.",
    scope: "board.write",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { interfaceId: { type: "string" } },
      required: ["interfaceId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("interfaces").doc(String(args.interfaceId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No interface with id ${args.interfaceId}.`);
      const current = snap.data() || {};
      const revisionId = await recordDocRevision(session, "interface.deleted", { interfaceId: snap.id, projectIds: current.projectIds || [], name: current.name || "" }, current.contentMd || "");
      await ref.delete();
      await audit(session, "delete_interface", { interfaceId: snap.id, projectIds: current.projectIds || [], name: current.name || "", revisionId });
      return textResult({ deleted: true, interfaceId: snap.id, name: current.name || "", revisionId });
    },
  },
  {
    name: "list_doc_revisions",
    description: "Every previous version of a project's documentation that a write has replaced — newest first, metadata only. Use this to find what a change overwrote, then get_doc_revision to read it back.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Restrict to one project's documentation." },
        docId: { type: "string", description: "Restrict to one project document." },
        interfaceId: { type: "string", description: "Restrict to one interface contract." },
        skillId: { type: "string", description: "Restrict to one skill." },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "Default 20." },
      },
      additionalProperties: false,
    },
    async run(args) {
      const a = args || {};
      let q = db().collection("docRevisions");
      if (a.docId) q = q.where("docId", "==", String(a.docId));
      else if (a.interfaceId) q = q.where("interfaceId", "==", String(a.interfaceId));
      else if (a.skillId) q = q.where("skillId", "==", String(a.skillId));
      else if (a.projectId) q = q.where("projectId", "==", String(a.projectId));
      const snap = await q.limit(MAX_READ_DOCS).get();
      const rows = [];
      snap.forEach((d) => {
        const v = d.data() || {};
        rows.push({
          revisionId: d.id, target: v.target || null, name: v.name || null,
          projectId: v.projectId || null, docId: v.docId || null, interfaceId: v.interfaceId || null,
          skillId: v.skillId || null,
          chars: v.chars || 0, replacedAt: tsToISO(v.replacedAt), replacedByEmail: v.replacedByEmail || null,
        });
      });
      rows.sort((x, y) => String(y.replacedAt || "").localeCompare(String(x.replacedAt || "")));
      const limit = Math.min(Math.max(parseInt(a.limit, 10) || 20, 1), 50);
      return textResult({ matched: rows.length, revisions: rows.slice(0, limit) });
    },
  },
  {
    name: "get_doc_revision",
    description: "The full markdown of one replaced version, from list_doc_revisions. To restore it, pass this content back to whichever set_/update_ tool it came from.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: { revisionId: { type: "string" } },
      required: ["revisionId"], additionalProperties: false,
    },
    async run(args) {
      const snap = await db().collection("docRevisions").doc(String(args.revisionId)).get();
      if (!snap.exists) return toolError(`No revision with id ${args.revisionId}.`);
      const v = snap.data() || {};
      return textResult({
        revisionId: snap.id, target: v.target || null, name: v.name || null,
        projectId: v.projectId || null, docId: v.docId || null, interfaceId: v.interfaceId || null,
        skillId: v.skillId || null,
        replacedAt: tsToISO(v.replacedAt), replacedByEmail: v.replacedByEmail || null,
        contentMd: v.contentMd || "",
      });
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
  // ── FAQ / Help Center: write tools ───────────────────────────────────────
  // Reuses the SAME pendingRevision/needsReview mechanism the Deploy flow's
  // own "FAQ impact review" already writes (ROUTINE_INSTRUCTIONS.md ->
  // "FAQ impact review (Deploy flow, step 3b)"; promotion logic in
  // functions/index.js -> promoteFaqRevisionIfReady) rather than inventing a
  // second one — that function is what makes "approve it and the hourly
  // export publishes it" actually true. Only create_faq_article writes a
  // faqArticles doc directly, and only ever with status "draft"; every
  // other write here only ever touches pendingRevision/needsReview, never
  // the live fields, never reviewStatus: "approved", never previousRevision,
  // and never deletes anything — approval and publishing stay human, in the
  // console. See REQUIREMENTS.md -> "FAQ revision review" for the full
  // shape and why sourceItemIds is omitted for an MCP-originated proposal.
  {
    name: "create_faq_article",
    description: "Create a new help-centre article as a draft. It is never published by this tool — a person reviews and publishes it from FAQ Management, exactly like an article typed there.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: `Up to ${FAQ_TITLE_MAX} characters.` },
        categoryId: { type: "string", description: "An existing faqCategories doc id (the console's Settings page manages categories; there is no MCP tool to list them yet)." },
        slug: { type: "string", description: "URL slug. Derived from the title when omitted; a slug already in use gets -2, -3, … appended." },
        summary: { type: "string", description: `Shown in search results. Up to ${FAQ_SUMMARY_MAX} characters.` },
        keywords: { type: "array", items: { type: "string" }, description: `Search terms. Up to ${FAQ_KEYWORDS_MAX}.` },
        docType: { type: "string", enum: FAQ_DOC_TYPES, description: "This article's Diátaxis type per docs/CONTRIBUTING-docs.md §2. Defaults to 'faq'." },
        bodyMd: { type: "string", description: `The article body — the same HTML shape the console's rich-text editor saves (paragraphs, headings, lists, callouts; see REQUIREMENTS.md -> "Rich formatting in article bodies"). Up to ${FAQ_BODY_MAX} characters.` },
        programId: { type: "string", description: "An existing programs doc id. Required unless projectId is given and that project itself has a programId set (used as the default) — every article needs to resolve to a program so FAQ impact review on a deploy can find it." },
        projectId: { type: "string", description: "Optional — an existing project id, from list_projects. Also supplies the default programId (see above) when programId is omitted." },
      },
      required: ["title", "categoryId", "bodyMd"], additionalProperties: false,
    },
    async run(args, session) {
      const title = String(args.title || "").trim();
      if (!title) return toolError("title is required.");
      if (title.length > FAQ_TITLE_MAX) return toolError(`title is limited to ${FAQ_TITLE_MAX} characters.`);
      const bodyMd = String(args.bodyMd == null ? "" : args.bodyMd);
      if (!bodyMd.trim()) return toolError("bodyMd is required.");
      if (bodyMd.length > FAQ_BODY_MAX) return toolError(`bodyMd is limited to ${FAQ_BODY_MAX} characters (the same ceiling the console editor has); that was ${bodyMd.length}.`);
      const categoryId = String(args.categoryId || "").trim();
      if (!categoryId) return toolError("categoryId is required.");
      const catSnap = await db().collection("faqCategories").doc(categoryId).get();
      if (!catSnap.exists) return toolError(`No FAQ category with id ${categoryId}. categoryId must be an existing faqCategories doc — check the console's Settings page.`);
      const summary = args.summary == null ? "" : String(args.summary).trim();
      if (summary.length > FAQ_SUMMARY_MAX) return toolError(`summary is limited to ${FAQ_SUMMARY_MAX} characters.`);
      let keywords = [];
      if (args.keywords != null) {
        if (!Array.isArray(args.keywords)) return toolError("keywords must be an array of strings.");
        keywords = args.keywords.map((k) => String(k).trim()).filter(Boolean);
        if (keywords.length > FAQ_KEYWORDS_MAX) return toolError(`keywords is limited to ${FAQ_KEYWORDS_MAX} entries.`);
      }
      const docType = args.docType != null ? String(args.docType) : "faq";
      if (!FAQ_DOC_TYPES.includes(docType)) return toolError(`docType must be one of: ${FAQ_DOC_TYPES.join(", ")}.`);
      let projectId = null;
      let projectData = null;
      if (args.projectId != null && String(args.projectId).trim()) {
        projectId = String(args.projectId).trim();
        const projSnap = await db().collection("projects").doc(projectId).get();
        if (!projSnap.exists) return toolError(`No project with id ${projectId}. Call list_projects first.`);
        projectData = projSnap.data() || {};
      }
      let programId = null;
      if (args.programId != null && String(args.programId).trim()) {
        programId = String(args.programId).trim();
        if (!(await db().collection("programs").doc(programId).get()).exists) return toolError(`No program with id ${programId}.`);
      } else if (projectData && projectData.programId) {
        programId = projectData.programId;
      }
      // Every article needs to resolve to a program (see faq/README.md ->
      // "Article scoping") so a deploy's FAQ impact review can ever find
      // it — an unscoped article was exactly the gap that left every
      // console-related article invisible to that review (backlog item
      // GiceSVMWdEiETinAVLVM).
      if (!programId) {
        return toolError("programId is required (or pass projectId for a project whose own programId can be used as the default). Call list_projects to see each project's programId, or ask a person which program this article belongs to.");
      }
      const slugBase = slugifyFaq(String(args.slug || "").trim() || title);
      if (!slugBase) return toolError("Could not derive a slug — give a title with at least one letter or number, or pass slug explicitly.");
      if (slugBase.length > FAQ_SLUG_MAX) return toolError(`slug is limited to ${FAQ_SLUG_MAX} characters.`);
      const slug = await uniqueFaqSlug(slugBase);

      // Same "max existing order + 1" rule the console's own saveFaqArticle
      // uses (public/js/app.js), so a new draft sorts after everything else
      // until a person deliberately reorders it.
      let maxOrder = -1;
      (await db().collection("faqArticles").limit(MAX_READ_DOCS).get()).forEach((d) => {
        const o = (d.data() || {}).order;
        if (typeof o === "number" && o > maxOrder) maxOrder = o;
      });

      const ref = await db().collection("faqArticles").add({
        categoryId, projectId, programId,
        title, slug, summary, bodyMd, docType, keywords,
        status: "draft",
        needsReview: false,
        order: maxOrder + 1,
        createdVia: "mcp",
        createdByEmail: session.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await audit(session, "create_faq_article", { articleId: ref.id, title, slug, categoryId });
      return textResult({
        created: true, articleId: ref.id, title, slug, categoryId, docType, status: "draft",
        note: "Created as a draft. Nothing is published until a person reviews and publishes it from FAQ Management.",
      });
    },
  },
  {
    name: "update_faq_article",
    description: "Propose a change to an existing article's title, summary, keywords, doc type and/or body. This never edits the live article — it parks the change as a pendingRevision for a person to review and approve in FAQ Management, the exact mechanism the Deploy flow's own FAQ impact review already uses. Only title/summary/bodyMd/keywords/docType are revisable this way; category, slug, project and program links are live-only fields this review mechanism doesn't carry, so changing those stays a direct console edit. Use create_faq_article for a brand-new article instead.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        articleId: { type: "string", description: "From search_faq, get_faq_article or list_pending_faq_revisions." },
        reason: { type: "string", description: `Why this change is needed — shown to the person reviewing it. Required. Up to ${FAQ_REASON_MAX} characters.` },
        title: { type: "string", description: `Up to ${FAQ_TITLE_MAX} characters.` },
        summary: { type: "string", description: `Up to ${FAQ_SUMMARY_MAX} characters.` },
        keywords: { type: "array", items: { type: "string" }, description: `Up to ${FAQ_KEYWORDS_MAX}.` },
        docType: { type: "string", enum: FAQ_DOC_TYPES },
        bodyMd: { type: "string", description: `Up to ${FAQ_BODY_MAX} characters.` },
      },
      required: ["articleId", "reason"], additionalProperties: false,
    },
    async run(args, session) {
      const reason = String(args.reason || "").trim();
      if (!reason) return toolError("reason is required — it's shown to whoever reviews this change.");
      if (reason.length > FAQ_REASON_MAX) return toolError(`reason is limited to ${FAQ_REASON_MAX} characters.`);
      const ref = db().collection("faqArticles").doc(String(args.articleId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No FAQ article with id ${args.articleId}. Use search_faq to find one.`);
      const a = snap.data() || {};
      if (a.pendingRevision && a.pendingRevision.reviewStatus === "approved") {
        return toolError("This article already has an approved update waiting to go live — a person has signed that off. Wait for it to be promoted, or have them withdraw it in FAQ Management, before proposing another change.");
      }
      // An existing awaiting-review proposal (from this tool, or from the
      // Deploy flow's own FAQ impact review) is the base to build on, not
      // the live text — same rule ROUTINE_INSTRUCTIONS.md gives the
      // Routine itself, so two proposals in a row don't clobber each other.
      const base = a.pendingRevision && a.pendingRevision.reviewStatus === "awaiting-review" ? a.pendingRevision : a;
      const rev = {
        title: base.title || a.title || "",
        summary: typeof base.summary === "string" ? base.summary : (a.summary || ""),
        bodyMd: typeof base.bodyMd === "string" ? base.bodyMd : (a.bodyMd || ""),
      };
      if (Array.isArray(base.keywords)) rev.keywords = base.keywords;
      else if (Array.isArray(a.keywords)) rev.keywords = a.keywords;
      if (base.docType || a.docType) rev.docType = base.docType || a.docType;

      let changed = false;
      if (args.title != null) {
        const t = String(args.title).trim();
        if (!t) return toolError("title cannot be emptied.");
        if (t.length > FAQ_TITLE_MAX) return toolError(`title is limited to ${FAQ_TITLE_MAX} characters.`);
        rev.title = t; changed = true;
      }
      if (args.summary != null) {
        const s = String(args.summary).trim();
        if (s.length > FAQ_SUMMARY_MAX) return toolError(`summary is limited to ${FAQ_SUMMARY_MAX} characters.`);
        rev.summary = s; changed = true;
      }
      if (args.bodyMd != null) {
        const b = String(args.bodyMd);
        if (!b.trim()) return toolError("bodyMd cannot be emptied.");
        if (b.length > FAQ_BODY_MAX) return toolError(`bodyMd is limited to ${FAQ_BODY_MAX} characters; that was ${b.length}.`);
        rev.bodyMd = b; changed = true;
      }
      if (args.keywords != null) {
        if (!Array.isArray(args.keywords)) return toolError("keywords must be an array of strings.");
        const kw = args.keywords.map((k) => String(k).trim()).filter(Boolean);
        if (kw.length > FAQ_KEYWORDS_MAX) return toolError(`keywords is limited to ${FAQ_KEYWORDS_MAX} entries.`);
        rev.keywords = kw; changed = true;
      }
      if (args.docType != null) {
        if (!FAQ_DOC_TYPES.includes(args.docType)) return toolError(`docType must be one of: ${FAQ_DOC_TYPES.join(", ")}.`);
        rev.docType = args.docType; changed = true;
      }
      if (!changed) return toolError("Nothing to propose — pass at least one of title, summary, bodyMd, keywords, docType.");

      // No sourceItemIds: no backlog ticket triggered this, unlike a Deploy-
      // flow proposal. promoteFaqRevisionIfReady (functions/index.js) treats
      // a missing/empty sourceItemIds as nothing left to wait on, so
      // approval alone promotes it — see REQUIREMENTS.md -> "FAQ revision
      // review". proposedBy carries the real signed-in email (not the
      // literal "claude" the Routine uses) so FAQ Management's "Proposed
      // by" line shows who actually asked for this; proposedVia is the
      // explicit, machine-readable marker of which path wrote it, same
      // "via: mcp" convention recordDocRevision already uses above.
      const pendingRevision = Object.assign({}, rev, {
        reason,
        proposedBy: session.email,
        proposedVia: "mcp",
        proposedAt: new Date().toISOString(),
        reviewStatus: "awaiting-review",
      });
      await ref.update({ pendingRevision, needsReview: true, updatedAt: FieldValue.serverTimestamp() });
      await audit(session, "update_faq_article", { articleId: ref.id, reasonChars: reason.length });
      return textResult({
        proposed: true, articleId: ref.id, needsReview: true, reviewStatus: "awaiting-review",
        note: "The live article is unchanged. A person reviews this in FAQ Management (Review proposed update); approving it publishes on the next hourly FAQ export — no ticket or deploy train needed, since no sourceItemIds are attached.",
      });
    },
  },
  {
    name: "list_pending_faq_revisions",
    description: "Every FAQ article with a proposed update waiting for a person's review — written by the Deploy flow's own FAQ impact review as well as by update_faq_article. Use get_faq_revision for the full old-vs-new comparison on one.",
    scope: "board.read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const snap = await db().collection("faqArticles").where("needsReview", "==", true).limit(MAX_READ_DOCS).get();
      const rows = [];
      snap.forEach((doc) => {
        const a = doc.data() || {};
        const rev = a.pendingRevision;
        // needsReview can also be set with no concrete proposal attached —
        // the older, coarser per-project "something changed, go look"
        // safety net (see onBacklogItemPublishedLive in functions/index.js).
        // There's nothing to diff there, so it's out of scope for this tool.
        if (!rev) return;
        rows.push({
          articleId: doc.id,
          title: a.title || rev.title || "",
          isNewArticle: !!rev.isNew,
          reviewStatus: rev.reviewStatus || null,
          proposedBy: rev.proposedBy || null,
          proposedVia: rev.proposedVia || null,
          proposedAt: rev.proposedAt || null,
          reason: rev.reason || null,
          sourceItemIds: Array.isArray(rev.sourceItemIds) ? rev.sourceItemIds : [],
        });
      });
      rows.sort((x, y) => String(y.proposedAt || "").localeCompare(String(x.proposedAt || "")));
      return textResult({ matched: rows.length, revisions: rows });
    },
  },
  {
    name: "get_faq_revision",
    description: "The live text and the proposed pendingRevision for one article, side by side, so a caller can see exactly what a review would compare.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: { articleId: { type: "string" } },
      required: ["articleId"], additionalProperties: false,
    },
    async run(args) {
      const snap = await db().collection("faqArticles").doc(String(args.articleId)).get();
      if (!snap.exists) return toolError(`No FAQ article with id ${args.articleId}.`);
      const a = snap.data() || {};
      const rev = a.pendingRevision;
      if (!rev) return toolError("That article has no pending revision to compare.");
      return textResult({
        articleId: snap.id,
        isNewArticle: !!rev.isNew,
        // A proposal that creates a brand-new article has no live text yet.
        live: rev.isNew ? null : {
          title: a.title || "", summary: a.summary || "", bodyMd: a.bodyMd || "",
          keywords: a.keywords || [], docType: a.docType || null, status: a.status || null,
        },
        proposed: {
          title: rev.title || "", summary: rev.summary || "", bodyMd: rev.bodyMd || "",
          keywords: rev.keywords || [], docType: rev.docType || null,
        },
        reason: rev.reason || null,
        reviewStatus: rev.reviewStatus || null,
        proposedBy: rev.proposedBy || null,
        proposedVia: rev.proposedVia || null,
        proposedAt: rev.proposedAt || null,
        sourceItemIds: Array.isArray(rev.sourceItemIds) ? rev.sourceItemIds : [],
      });
    },
  },
  {
    name: "comment_on_faq_revision",
    description: "Add a comment about a proposed FAQ update, attributed to you. Recorded on the article as an audit trail — the console's FAQ Management review page does not render this thread yet, so treat it as a note for later rather than a live conversation.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        articleId: { type: "string" },
        text: { type: "string", description: "The comment. Up to 4000 characters." },
      },
      required: ["articleId", "text"], additionalProperties: false,
    },
    async run(args, session) {
      const text = String(args.text || "").trim();
      if (!text) return toolError("text is required.");
      if (text.length > 4000) return toolError("A comment is limited to 4000 characters.");
      const ref = db().collection("faqArticles").doc(String(args.articleId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No FAQ article with id ${args.articleId}.`);
      if (!(snap.data() || {}).pendingRevision) return toolError("That article has no pending revision to comment on.");
      // A plain Date, not serverTimestamp(): Firestore rejects the sentinel
      // inside arrayUnion — same reason add_item_comment above uses one.
      await ref.update({
        reviewComments: FieldValue.arrayUnion({ author: session.email, text, at: new Date() }),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await audit(session, "comment_on_faq_revision", { articleId: ref.id, chars: text.length });
      return textResult({ added: true, articleId: ref.id, author: session.email });
    },
  },
  // ── Skills library ────────────────────────────────────────────────────
  // Organisation-wide, unscoped to any one project (unlike backlogItems/
  // projectDocs) — a shared library of packaged instructions any team
  // member's agent can pull in over MCP, and the console's own Skills page
  // (public/js/app.js) renders for a human. Read is any signed-in member,
  // viewer included, matching firestore.rules' `isBoardReader()` on
  // `skills`; only an editor may add, replace or remove one.
  {
    name: "list_skills",
    description: "Every skill in the shared organisation-wide skills library — name, slug, summary, version, file count and when it was last updated. Returns light summaries, not file contents; call get_skill for the full files of one.",
    scope: "board.read",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    async run() {
      const snap = await db().collection("skills").limit(MAX_READ_DOCS).get();
      const rows = [];
      snap.forEach((doc) => {
        const d = doc.data() || {};
        rows.push({
          id: doc.id,
          name: d.name || "",
          slug: d.slug || "",
          summary: d.summary || "",
          version: d.version || "",
          owningTeam: d.owningTeam || null,
          fileCount: Array.isArray(d.files) ? d.files.length : 0,
          updatedAt: tsToISO(d.updatedAt),
        });
      });
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return textResult({ matched: rows.length, skills: rows });
    },
  },
  {
    name: "get_skill",
    description: "One skill in full, including every file's path and content, by id or slug.",
    scope: "board.read",
    inputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "From list_skills." },
        slug: { type: "string", description: "The skill's slug, if you don't have the id." },
      },
      additionalProperties: false,
    },
    async run(args) {
      if (!args.skillId && !args.slug) return toolError("Pass skillId or slug. Use list_skills to find one.");
      let snap = null;
      if (args.skillId) {
        const s = await db().collection("skills").doc(String(args.skillId)).get();
        if (s.exists) snap = s;
      }
      if (!snap && args.slug) {
        const q = await db().collection("skills").where("slug", "==", String(args.slug)).limit(1).get();
        if (!q.empty) snap = q.docs[0];
      }
      if (!snap) return toolError("No skill with that id or slug. Use list_skills to find one.");
      const d = snap.data() || {};
      return textResult({
        id: snap.id,
        name: d.name || "",
        slug: d.slug || "",
        summary: d.summary || "",
        version: d.version || "",
        owningTeam: d.owningTeam || null,
        files: Array.isArray(d.files) ? d.files : [],
        createdVia: d.createdVia || null,
        createdByEmail: d.createdByEmail || null,
        updatedByEmail: d.updatedByEmail || null,
        createdAt: tsToISO(d.createdAt),
        updatedAt: tsToISO(d.updatedAt),
      });
    },
  },
  {
    name: "upload_skill",
    description: "Publish a new skill to the shared organisation-wide skills library, so any team member's agent — and the console's own Skills page — can read it. slug must be unique; use update_skill to change an existing one instead of re-uploading.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: `What it's called, e.g. "Personalisation Hub Front & Design". Up to ${SKILL_NAME_MAX} characters.` },
        slug: { type: "string", description: `Lowercase letters, numbers and hyphens only, e.g. "ph-designer" — must not already be taken. Up to ${SKILL_SLUG_MAX} characters.` },
        summary: { type: "string", description: `One-line description shown in lists. Up to ${SKILL_SUMMARY_MAX} characters.` },
        version: { type: "string", description: `e.g. "1.0.0". Up to ${SKILL_VERSION_MAX} characters.` },
        owningTeam: { type: "string", enum: SKILL_OWNING_TEAMS, description: `Informational only — which functional team maintains this skill. One of: ${SKILL_OWNING_TEAMS.join(", ")}. Optional; leave unset if no team has claimed it.` },
        files: {
          type: "array",
          minItems: 1,
          maxItems: SKILL_FILES_MAX,
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"], additionalProperties: false,
          },
          description: `The skill's files, e.g. [{path:"SKILL.md",content:"..."}, {path:"references/tokens.md",content:"..."}]. Up to ${SKILL_FILES_MAX} files, each up to ${SKILL_FILE_MAX} characters.`,
        },
      },
      required: ["name", "slug", "summary", "version", "files"], additionalProperties: false,
    },
    async run(args, session) {
      const name = String(args.name || "").trim();
      if (!name) return toolError("name is required.");
      if (name.length > SKILL_NAME_MAX) return toolError(`name is limited to ${SKILL_NAME_MAX} characters.`);
      const slug = String(args.slug || "").trim().toLowerCase();
      if (!slug) return toolError("slug is required.");
      if (!/^[a-z0-9-]+$/.test(slug)) return toolError("slug must contain only lowercase letters, numbers and hyphens.");
      if (slug.length > SKILL_SLUG_MAX) return toolError(`slug is limited to ${SKILL_SLUG_MAX} characters.`);
      const summary = String(args.summary || "").trim();
      if (!summary) return toolError("summary is required.");
      if (summary.length > SKILL_SUMMARY_MAX) return toolError(`summary is limited to ${SKILL_SUMMARY_MAX} characters.`);
      const version = String(args.version || "").trim();
      if (!version) return toolError("version is required.");
      if (version.length > SKILL_VERSION_MAX) return toolError(`version is limited to ${SKILL_VERSION_MAX} characters.`);
      let owningTeam = null;
      if (args.owningTeam != null) {
        owningTeam = String(args.owningTeam).trim();
        if (!SKILL_OWNING_TEAMS.includes(owningTeam)) return toolError(`owningTeam must be one of: ${SKILL_OWNING_TEAMS.join(", ")}.`);
      }
      const filesResult = validateSkillFiles(args.files);
      if (filesResult.error) return toolError(filesResult.error);
      const existing = await db().collection("skills").where("slug", "==", slug).limit(1).get();
      if (!existing.empty) return toolError(`A skill with slug "${slug}" already exists (id ${existing.docs[0].id}). Use update_skill to change it, or pick a different slug.`);
      const ref = await db().collection("skills").add({
        name, slug, summary, version, owningTeam, files: filesResult.files,
        createdVia: "mcp",
        lastWriteVia: "mcp",
        createdByEmail: session.email,
        updatedByEmail: session.email,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      await audit(session, "upload_skill", { skillId: ref.id, slug, name, fileCount: filesResult.files.length });
      return textResult({ created: true, skillId: ref.id, slug, name, version, owningTeam, fileCount: filesResult.files.length });
    },
  },
  {
    name: "update_skill",
    description: "Rename a skill, change its summary/version, and/or replace its files entirely. slug cannot be changed here — delete_skill and upload_skill under a new slug instead. Replacing files overwrites the whole file set (not a merge); the previous file set is kept in the revision history.",
    scope: "board.write",
    inputSchema: {
      type: "object",
      properties: {
        skillId: { type: "string", description: "From list_skills or get_skill." },
        name: { type: "string", description: `Up to ${SKILL_NAME_MAX} characters.` },
        summary: { type: "string", description: `Up to ${SKILL_SUMMARY_MAX} characters.` },
        version: { type: "string", description: `Up to ${SKILL_VERSION_MAX} characters.` },
        owningTeam: { type: "string", enum: SKILL_OWNING_TEAMS.concat([""]), description: `Informational only. One of: ${SKILL_OWNING_TEAMS.join(", ")} — or "" to clear it back to no team set.` },
        files: {
          type: "array",
          maxItems: SKILL_FILES_MAX,
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"], additionalProperties: false,
          },
          description: `Replaces the WHOLE file set. Up to ${SKILL_FILES_MAX} files, each up to ${SKILL_FILE_MAX} characters.`,
        },
      },
      required: ["skillId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("skills").doc(String(args.skillId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No skill with id ${args.skillId}. Use list_skills to find one.`);
      const current = snap.data() || {};
      const fields = { updatedAt: FieldValue.serverTimestamp(), updatedByEmail: session.email, lastWriteVia: "mcp" };
      let revisionId = null;
      if (args.name != null) {
        const name = String(args.name).trim();
        if (!name) return toolError("name cannot be emptied.");
        if (name.length > SKILL_NAME_MAX) return toolError(`name is limited to ${SKILL_NAME_MAX} characters.`);
        fields.name = name;
      }
      if (args.summary != null) {
        const summary = String(args.summary).trim();
        if (!summary) return toolError("summary cannot be emptied.");
        if (summary.length > SKILL_SUMMARY_MAX) return toolError(`summary is limited to ${SKILL_SUMMARY_MAX} characters.`);
        fields.summary = summary;
      }
      if (args.version != null) {
        const version = String(args.version).trim();
        if (!version) return toolError("version cannot be emptied.");
        if (version.length > SKILL_VERSION_MAX) return toolError(`version is limited to ${SKILL_VERSION_MAX} characters.`);
        fields.version = version;
      }
      if (args.owningTeam != null) {
        const owningTeam = String(args.owningTeam).trim();
        if (owningTeam && !SKILL_OWNING_TEAMS.includes(owningTeam)) return toolError(`owningTeam must be one of: ${SKILL_OWNING_TEAMS.join(", ")} (or "" to clear it).`);
        fields.owningTeam = owningTeam || null;
      }
      if (args.files != null) {
        const filesResult = validateSkillFiles(args.files);
        if (filesResult.error) return toolError(filesResult.error);
        revisionId = await recordDocRevision(
          session, "skill",
          { skillId: snap.id, slug: current.slug || null, name: current.name || "" },
          JSON.stringify(Array.isArray(current.files) ? current.files : []),
        );
        fields.files = filesResult.files;
      }
      const changedKeys = Object.keys(fields).filter((k) => k !== "updatedAt" && k !== "updatedByEmail" && k !== "lastWriteVia");
      if (!changedKeys.length) return toolError("Nothing to change — pass at least one of name, summary, version, owningTeam, files.");
      await ref.update(fields);
      await audit(session, "update_skill", { skillId: snap.id, slug: current.slug || null, changed: changedKeys, revisionId });
      return textResult({ updated: true, skillId: snap.id, changed: changedKeys, revisionId });
    },
  },
  {
    name: "delete_skill",
    description: "Remove a skill from the shared library. Its full contents (name, summary, version, files) are written to the revision history first, so this is recoverable with list_doc_revisions / get_doc_revision, then upload_skill to restore it under the same slug.",
    scope: "board.write",
    destructive: true,
    inputSchema: {
      type: "object",
      properties: { skillId: { type: "string" } },
      required: ["skillId"], additionalProperties: false,
    },
    async run(args, session) {
      const ref = db().collection("skills").doc(String(args.skillId));
      const snap = await ref.get();
      if (!snap.exists) return toolError(`No skill with id ${args.skillId}.`);
      const current = snap.data() || {};
      const revisionId = await recordDocRevision(
        session, "skill.deleted",
        { skillId: snap.id, slug: current.slug || null, name: current.name || "" },
        JSON.stringify({
          name: current.name || "", slug: current.slug || "", summary: current.summary || "",
          version: current.version || "", files: Array.isArray(current.files) ? current.files : [],
        }),
      );
      await ref.delete();
      await audit(session, "delete_skill", { skillId: snap.id, slug: current.slug || null, name: current.name || "", revisionId });
      return textResult({
        deleted: true, skillId: snap.id, name: current.name || "", revisionId,
        note: revisionId ? "Contents saved to the revision history — get_doc_revision can bring them back, then upload_skill to restore it." : "Nothing to recover.",
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
  "You have full read/write access to project DOCUMENTATION and are expected to keep it current as you work: get_project_docs to read a project's Requirements, README, additional documents and interface contracts, then set_project_requirements / set_project_readme / create_project_document / update_project_document / create_interface / update_interface to update them.",
  "Documentation writes REPLACE the whole document, so read it first and send back the complete revised text — never a fragment. The version you replace is kept, and list_doc_revisions / get_doc_revision can recover it.",
  "Where a project's documentation also exists as a file in the repo (REQUIREMENTS.md, README.md, shared/interface-contract.md), the two are meant to match: update both, and treat a divergence as a bug in whichever is stale.",
  "Use search_faq / get_faq_article to answer Personalisation Hub product questions from the published help centre instead of guessing.",
  "You can also write to the help centre: create_faq_article files a brand-new draft, and update_faq_article proposes a change to an existing one as a pendingRevision — never live. Either way a person still reviews and approves it in FAQ Management before anything publishes; list_pending_faq_revisions and get_faq_revision let you check on a proposal's status.",
  "There is also a shared, organisation-wide skills library — NOT scoped to any one project. list_skills / get_skill read it (any signed-in member, including a viewer); upload_skill / update_skill / delete_skill write to it (editor role). Use this to publish or fetch a reusable piece of packaged instructions any team member's agent can pull in, e.g. this console's own ph-designer front-end skill.",
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
          version: "1.3.0",
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
            // Only the two delete_* tools. A client that asks a person before
            // running a destructive tool should ask before those and not
            // before a documentation update.
            destructiveHint: t.destructive === true,
            // set_* replaces a whole document, so running it twice with the
            // same input lands in the same place; create_*/add_* do not.
            idempotentHint: t.name.startsWith("get_") || t.name.startsWith("list_") || t.name.startsWith("set_") || t.name === "whoami",
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
  PROJECT_WRITABLE_FIELDS, PROJECT_MD_MAX, DOC_MD_MAX, updateProjectFields,
  FAQ_TITLE_MAX, FAQ_SUMMARY_MAX, FAQ_BODY_MAX, FAQ_KEYWORDS_MAX, FAQ_REASON_MAX, FAQ_DOC_TYPES,
};
