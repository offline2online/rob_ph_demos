// Sign-in wall for the whole console.
//
// Nothing on the board loads until a member has signed in: this module
// waits for Firebase Auth, resolves the account against the console's
// member list, and only then imports app.js (which starts every Firestore
// listener).
//
// WHO IS A MEMBER is no longer a constant in this file. It is the
// consoleUsers Firestore collection, managed from Settings → Team & agent
// access, and enforced by firestore.rules. The same collection gates a team
// member's AI agent over MCP (see ../../MCP.md), so someone is added — or
// removed — once, for both.
//
// HOW MEMBERSHIP IS RESOLVED (27 Sep 2026 rewrite) — three sources, fastest
// first, because the wall's only job is to decide what to SHOW. What the
// person may actually read or write is enforced by firestore.rules and
// storage.rules on every request, so a stale answer here can only ever
// produce a blank board, never a leak:
//
//   1. The ID token's own custom claim (consoleRole). Firebase caches the
//      token, so this is a synchronous-feeling local read — no network at
//      all — and it is what lets a reload land straight on the board.
//   2. A direct read of the person's OWN consoleUsers row over Firestore's
//      REST API (firestore.rules lets anyone signed in read their own row).
//      One round trip to firestore.googleapis.com, no Cloud Function in the
//      path, so no cold start.
//   3. POST /mcp/claims/sync — the console's own Cloud Function, which also
//      repairs the custom claim for anyone added before their first
//      sign-in. Previously this was the ONLY source, and it sat in the
//      critical path of every sign-in and every reload: a cold start of
//      that function (several seconds on 256 MiB, and every cold start is a
//      new instance under load) is exactly the "signed in but stuck on the
//      sign-in screen until I reload" report — by the time the person
//      reloaded, the instance was warm. It now runs in the background,
//      bounded by a timeout, and never blocks the board.
//
// A removed or disabled member is caught by the same background sync (403
// → signed out with a message), by firestore.rules refusing their reads,
// and by the MCP server's own per-call check.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, sendPasswordResetEmail, sendEmailVerification, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// The two owner accounts, mirrored from firestore.rules' own bootstrap
// list. Only used as a fallback when neither membership source can be
// reached — an owner must never be locked out of the console by an outage
// in the very function that grants access.
export const OWNER_ACCOUNTS = [
  "rob@offline2online.com",
  "rob@personalisationhub.com",
];

const ROLES = ["admin", "editor", "viewer"];

// What role the signed-in person holds: "admin" | "editor" | "viewer".
// app.js reads document.documentElement.dataset.consoleRole (kept in step
// with these) to decide whether to show the read-only banner and the Team &
// agent access admin block.
export let consoleRole = null;
export let consoleEmail = null;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
// Keep the session across reloads and browser restarts (this is the SDK
// default, made explicit so a reload never lands back on the sign-in card).
setPersistence(auth, browserLocalPersistence).catch(() => { /* falls back to in-memory */ });

// Firebase Auth restores the session asynchronously, so for the first few
// hundred milliseconds of every load the user is unknown. Two localStorage
// flags remember that someone was signed in here before, and as what role,
// so a reload shows the console's own shell straight away — never the
// sign-in card and its logo — and app.js takes over the moment the session
// is confirmed. If the session turns out to be gone, the card appears then.
// Neither value is trusted for anything but layout: the rules decide.
const REMEMBER_KEY = "ph-console-signed-in";
const ROLE_KEY = "ph-console-role";
// Set by app.js just before it reloads the page because a Firestore
// listener came back permission-denied (the person was removed or
// disabled while signed in). Read once here: on such a load the cached
// role claim is not to be trusted, so the token is refreshed and
// membership goes to the network. app.js keeps its own count so a second
// refusal is shown rather than reloaded again.
const DENIED_KEY = "ph-console-denied";
let deniedBefore = false;
try { deniedBefore = Number(sessionStorage.getItem(DENIED_KEY) || 0) > 0; } catch { /* ignore */ }
// How long the network membership sources get before we stop waiting on
// them. The REST read normally answers in well under a second; the function
// may cold-start. Both keep running past this for their side effects, but
// the person is not kept staring at a spinner for them.
const MEMBERSHIP_TIMEOUT_MS = 12000;
// After this long on "Opening Google sign-in…" with nothing back from the
// popup, offer the full-page redirect flow — the popup can be silently
// blocked, or its result lost to third-party-storage partitioning, without
// ever rejecting the promise.
const POPUP_HINT_AFTER_MS = 8000;

const REST_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

function readLocal(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeLocal(key, value) {
  try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* ignore */ }
}

const gate = document.getElementById("auth-gate");
const status = document.getElementById("auth-gate-status");
const signInBtn = document.getElementById("auth-gate-signin");
const signOutBtn = document.getElementById("auth-gate-signout");
const passwordForm = document.getElementById("auth-gate-password");
const emailInput = document.getElementById("auth-gate-email");
const passwordInput = document.getElementById("auth-gate-password-input");
const passwordBtn = document.getElementById("auth-gate-password-signin");
const resetBtn = document.getElementById("auth-gate-reset");
const retryBtn = document.getElementById("auth-gate-retry");
const redirectBtn = document.getElementById("auth-gate-redirect");
const verifyBtn = document.getElementById("auth-gate-verify");
const appRoot = document.querySelector(".app");
const bootStatus = document.getElementById("boot-status");

function setStatus(text, kind) {
  status.textContent = text;
  status.dataset.kind = kind || "";
}
function setBootStatus(text) {
  if (bootStatus) bootStatus.textContent = text || "";
}
function hideAll() {
  signInBtn.hidden = true; signOutBtn.hidden = true;
  if (passwordForm) passwordForm.hidden = true;
  if (retryBtn) retryBtn.hidden = true;
  if (redirectBtn) redirectBtn.hidden = true;
  if (verifyBtn) verifyBtn.hidden = true;
}
function applyRole(role) {
  if (!ROLES.includes(role)) role = "editor";
  document.documentElement.dataset.consoleRole = role;
  return role;
}
// A first visit, or a session we know is gone: the sign-in card, with a
// neutral status until Firebase has actually answered.
function showResolving() {
  gate.hidden = false; appRoot.hidden = true;
  delete document.documentElement.dataset.booting;
  hideAll();
  setStatus("Checking sign-in…");
}
// A reload by someone who was signed in here before: the console's own
// shell, with a one-line "Restoring your session…" under the topbar and
// the last-known role applied so the layout doesn't jump when app.js lands.
function showRestoring() {
  gate.hidden = true; appRoot.hidden = false;
  document.documentElement.dataset.booting = "1";
  const role = readLocal(ROLE_KEY);
  if (ROLES.includes(role)) applyRole(role);
  setBootStatus("Restoring your session…");
}
function showSignIn() {
  gate.hidden = false; appRoot.hidden = true;
  delete document.documentElement.dataset.booting;
  hideAll();
  signInBtn.hidden = false;
  if (passwordForm) passwordForm.hidden = false;
  setStatus("");
}
function showRejected(message, { canRetry = false, canVerify = false } = {}) {
  gate.hidden = false; appRoot.hidden = true;
  delete document.documentElement.dataset.booting;
  hideAll();
  signOutBtn.hidden = false;
  if (retryBtn) retryBtn.hidden = !canRetry;
  if (verifyBtn) verifyBtn.hidden = !canVerify;
  setStatus(message, "error");
}

if (readLocal(REMEMBER_KEY) === "1") showRestoring(); else showResolving();

// ── Signing in ────────────────────────────────────────────────────────────

let popupHintTimer = null;
function clearPopupHint() {
  if (popupHintTimer) { clearTimeout(popupHintTimer); popupHintTimer = null; }
  if (redirectBtn) redirectBtn.hidden = true;
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

async function signInViaRedirect() {
  clearPopupHint();
  setStatus("Taking you to Google sign-in…");
  try {
    await signInWithRedirect(auth, googleProvider());
  } catch (err) {
    setStatus(`Sign-in failed: ${(err && err.code) || err}`, "error");
  }
}

async function signIn() {
  signInBtn.disabled = true;
  setStatus("Opening Google sign-in…");
  clearPopupHint();
  popupHintTimer = setTimeout(() => {
    if (redirectBtn) redirectBtn.hidden = false;
    setStatus("Still waiting for the Google window. If it didn't open, or closed without signing you in, try the redirect instead.");
  }, POPUP_HINT_AFTER_MS);
  try {
    const result = await signInWithPopup(auth, googleProvider());
    clearPopupHint();
    // Don't wait for onAuthStateChanged to notice — it normally fires first,
    // but handleUser is idempotent, so calling it here too closes the gap
    // where the popup resolved and nothing on this page reacted.
    if (result && result.user) handleUser(result.user);
  } catch (err) {
    clearPopupHint();
    const code = (err && err.code) || "";
    if (code === "auth/popup-blocked"
      || code === "auth/operation-not-supported-in-this-environment"
      || code === "auth/web-storage-unsupported") {
      await signInViaRedirect();
      return;
    }
    if (code === "auth/operation-not-allowed") {
      setStatus("Google sign-in is not enabled for this Firebase project yet (Authentication → Sign-in method → Google).", "error");
    } else if (code === "auth/network-request-failed") {
      setStatus("Couldn't reach Google sign-in — check your connection and try again.", "error");
    } else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") {
      setStatus(`Sign-in failed: ${code || err}`, "error");
    } else {
      setStatus("");
    }
  } finally {
    signInBtn.disabled = false;
  }
}

// The other half of "Google login or the login credentials": a member an
// admin invited who has no Google account signs in with the password they
// set from Firebase's own setup email.
const PASSWORD_ERRORS = {
  "auth/invalid-credential": "That email and password don't match an account.",
  "auth/wrong-password": "That email and password don't match an account.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/user-not-found": "No account with that email — ask an admin to add you to the console.",
  "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
  "auth/user-disabled": "This account has been disabled. Ask an admin if that's not expected.",
  "auth/network-request-failed": "Couldn't reach the sign-in service — check your connection and try again.",
  "auth/operation-not-allowed": "Password sign-in isn't enabled for this project yet — use Google instead.",
};

let passwordSubmitting = false;
async function signInWithPassword() {
  if (passwordSubmitting) return;
  const email = (emailInput.value || "").trim();
  const password = passwordInput.value || "";
  if (!email || !password) { setStatus("Enter your email and password.", "error"); return; }
  passwordSubmitting = true;
  passwordBtn.disabled = true;
  setStatus("Signing in…");
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    if (cred && cred.user) handleUser(cred.user);
  } catch (err) {
    const code = (err && err.code) || "";
    setStatus(PASSWORD_ERRORS[code] || `Sign-in failed: ${code || err}`, "error");
  } finally {
    passwordSubmitting = false;
    passwordBtn.disabled = false;
  }
}

async function sendReset() {
  const email = (emailInput.value || "").trim();
  if (!email) { setStatus("Type your email above first, then tap this again.", "error"); return; }
  resetBtn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("Password reset email sent — follow it to set a password, then come back and sign in.");
  } catch (err) {
    setStatus(`Couldn't send a reset email: ${(err && err.code) || err}`, "error");
  } finally {
    resetBtn.disabled = false;
  }
}

async function sendVerification() {
  const user = auth.currentUser;
  if (!user) return;
  verifyBtn.disabled = true;
  try {
    await sendEmailVerification(user);
    setStatus(`Verification email sent to ${user.email}. Open the link in it, then come back and sign in again.`, "error");
  } catch (err) {
    setStatus(`Couldn't send a verification email: ${(err && err.code) || err}`, "error");
  } finally {
    verifyBtn.disabled = false;
  }
}

// ── Membership ────────────────────────────────────────────────────────────
//
// Each source returns { role, email } for a member, null for a definite
// refusal (not on the list, or disabled), or undefined when it genuinely
// could not tell (endpoint down, offline, timed out).

function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}

// Source 1: the custom claim already on the cached ID token.
async function membershipFromClaims(user) {
  try {
    const result = await user.getIdTokenResult();
    const role = result && result.claims && result.claims.consoleRole;
    if (ROLES.includes(role)) return { role, email: (user.email || "").toLowerCase(), source: "claim" };
  } catch { /* fall through */ }
  return undefined;
}

// Source 2: the person's own consoleUsers row, straight from Firestore.
async function membershipFromOwnRow(user) {
  const email = (user.email || "").toLowerCase();
  if (!email) return undefined;
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch(`${REST_BASE}/consoleUsers/${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (resp.status === 404) {
      // No row. The two owners are members by the rules' own bootstrap.
      return OWNER_ACCOUNTS.includes(email) ? { role: "admin", email, source: "owner" } : null;
    }
    if (!resp.ok) return undefined;
    const data = await resp.json();
    const f = (data && data.fields) || {};
    if (f.disabled && f.disabled.booleanValue === true) return null;
    const role = f.role && f.role.stringValue;
    // Owners are admins whatever their row says (firestore.rules isOwnerAccount).
    if (OWNER_ACCOUNTS.includes(email)) return { role: "admin", email, source: "owner" };
    return { role: ROLES.includes(role) ? role : "editor", email, source: "row" };
  } catch {
    return undefined;
  }
}

// Source 3: the console's own membership endpoint, which also repairs the
// custom claim that storage.rules depends on. Returns the same shape plus
// `claimUpdated`.
async function membershipFromFunction(user) {
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch("/mcp/claims/sync", {
      method: "POST",
      headers: { "X-Firebase-ID-Token": idToken, "Content-Type": "application/json" },
      body: "{}",
    });
    if (resp.ok) {
      const data = await resp.json();
      return {
        role: ROLES.includes(data.role) ? data.role : "editor",
        email: data.email || (user.email || "").toLowerCase(),
        claimUpdated: data.claimUpdated === true,
        source: "function",
      };
    }
    if (resp.status === 403 || resp.status === 401) return null;
  } catch { /* fall through */ }
  return undefined;
}

// The claim repair used to block the board; now it runs behind it. If it
// says the claim changed, mint a fresh token so storage.rules (which can
// only see claims) agrees with the board at once rather than in an hour.
// If it refuses — the person was removed or disabled while signed in —
// the board is torn down and they are told why.
function syncMembershipInBackground(user) {
  membershipFromFunction(user).then(async (m) => {
    if (m === undefined) return; // outage: the rules are still in charge
    if (m === null) {
      if (OWNER_ACCOUNTS.includes((user.email || "").toLowerCase())) return;
      writeLocal(REMEMBER_KEY, null); writeLocal(ROLE_KEY, null);
      try { await signOut(auth); } catch { /* ignore */ }
      showRejected(`${user.email} is no longer on the PH Agent Console user list. Ask an admin to add you in Settings → Team & agent access.`);
      return;
    }
    if (m.claimUpdated) { try { await user.getIdToken(true); } catch { /* not fatal */ } }
    if (m.role !== consoleRole) {
      consoleRole = applyRole(m.role);
      writeLocal(ROLE_KEY, consoleRole);
    }
  }).catch(() => { /* never surfaces */ });
}

async function resolveMembership(user) {
  if (deniedBefore) {
    // A stale claim is the likeliest reason the rules and the wall
    // disagreed; a forced refresh picks up a claim the sync trigger has
    // since removed, and the network sources below decide.
    try { await user.getIdToken(true); } catch { /* the sources below will say */ }
  } else {
    const claimed = await membershipFromClaims(user);
    if (claimed) return claimed;
  }
  // No claim yet — first sign-in after being invited, or an owner with no
  // row. Ask both network sources at once and take the first definite
  // answer; the row read is normally back long before the function.
  const own = membershipFromOwnRow(user);
  const fn = membershipFromFunction(user);
  const first = await withTimeout(own, MEMBERSHIP_TIMEOUT_MS);
  if (first !== undefined) return first;
  const second = await withTimeout(fn, MEMBERSHIP_TIMEOUT_MS);
  if (second !== undefined) return second;
  const email = (user.email || "").toLowerCase();
  if (OWNER_ACCOUNTS.includes(email)) return { role: "admin", email, source: "owner" };
  return undefined;
}

// ── Starting the console ──────────────────────────────────────────────────

let started = false;
let appImport = null;
async function startApp(user, membership) {
  if (started) return;
  started = true;
  consoleRole = applyRole(membership.role);
  consoleEmail = membership.email;
  writeLocal(REMEMBER_KEY, "1");
  writeLocal(ROLE_KEY, consoleRole);
  gate.hidden = true;
  appRoot.hidden = false;
  document.documentElement.classList.add("signed-in");
  const who = document.getElementById("topbar-user");
  if (who) who.textContent = user.email;
  setBootStatus("Loading the board…");
  syncMembershipInBackground(user);
  try {
    appImport = import("./app.js");
    await appImport;
    delete document.documentElement.dataset.booting;
    setBootStatus("");
  } catch (err) {
    // A failed dynamic import (the Firestore SDK didn't arrive, a syntax
    // error in a bad deploy) used to leave a blank page with no way on.
    started = false;
    console.error("backlog-tracker: app.js failed to load", err);
    showRejected("The console didn't finish loading. Check your connection and try again.", { canRetry: true });
  }
}

let inFlight = null;
function handleUser(user) {
  if (!user) return Promise.resolve();
  if (started) {
    const who = document.getElementById("topbar-user");
    if (who) who.textContent = user.email;
    return Promise.resolve();
  }
  // onAuthStateChanged, getRedirectResult and the sign-in buttons can all
  // report the same user within a few milliseconds of each other; only one
  // membership check runs, and the rest wait on it.
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!user.emailVerified) {
        // firestore.rules requires a verified address, so letting this
        // person through would only show them an empty board.
        showRejected(`${user.email} hasn't been verified yet. Verify the address, then sign in again.`, { canVerify: true });
        return;
      }
      if (gate.hidden) setBootStatus("Checking your access…"); else setStatus("Checking your access…");
      const membership = await resolveMembership(user);
      if (membership === null) {
        writeLocal(REMEMBER_KEY, null); writeLocal(ROLE_KEY, null);
        showRejected(`${user.email} isn't on the PH Agent Console user list. Ask an admin to add you in Settings → Team & agent access, then sign in again.`);
        return;
      }
      if (membership === undefined) {
        showRejected("Couldn't check your access just now — the console's membership service didn't answer. Try again in a moment.", { canRetry: true });
        return;
      }
      await startApp(user, membership);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

signInBtn.addEventListener("click", signIn);
if (redirectBtn) redirectBtn.addEventListener("click", signInViaRedirect);
if (passwordBtn) passwordBtn.addEventListener("click", signInWithPassword);
if (passwordInput) passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); signInWithPassword(); } });
if (emailInput) emailInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); signInWithPassword(); } });
if (resetBtn) resetBtn.addEventListener("click", sendReset);
if (verifyBtn) verifyBtn.addEventListener("click", sendVerification);
if (retryBtn) retryBtn.addEventListener("click", async () => {
  if (!auth.currentUser) { showSignIn(); return; }
  retryBtn.hidden = true;
  // Pick up a verification completed in another tab since this one loaded.
  try { await auth.currentUser.reload(); } catch { /* ignore */ }
  handleUser(auth.currentUser);
});

async function doSignOut() {
  writeLocal(REMEMBER_KEY, null);
  writeLocal(ROLE_KEY, null);
  try { await signOut(auth); } catch { /* the reload lands on the card either way */ }
  window.location.reload();
}
signOutBtn.addEventListener("click", doSignOut);
document.addEventListener("click", (e) => {
  if (e.target.closest("#topbar-signout")) doSignOut();
});

// A redirect sign-in lands back here with its result; a popup one never
// produces a redirect result. Errors are reported by onAuthStateChanged.
getRedirectResult(auth).then((result) => {
  if (result && result.user) handleUser(result.user);
}).catch((err) => {
  const code = (err && err.code) || "";
  if (code && code !== "auth/no-auth-event") setStatus(`Sign-in failed: ${code}`, "error");
});

onAuthStateChanged(auth, (user) => {
  if (user) { handleUser(user); return; }
  if (started) {
    // Signed out in another tab, or the session was revoked server-side.
    // app.js's listeners are live and would now fail one by one; a clean
    // reload tears them down and shows the card.
    writeLocal(REMEMBER_KEY, null); writeLocal(ROLE_KEY, null);
    window.location.reload();
    return;
  }
  writeLocal(REMEMBER_KEY, null);
  showSignIn();
});
