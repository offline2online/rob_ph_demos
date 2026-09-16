// Sign-in wall for the whole console.
//
// Nothing on the board loads until a member has signed in: this module
// shows the sign-in screen, waits for Firebase Auth, resolves the account
// against the console's member list, and only then imports app.js (which
// starts every Firestore listener).
//
// WHO IS A MEMBER is no longer a constant in this file. It is the
// consoleUsers Firestore collection, managed from Settings → Team & agent
// access, and enforced by firestore.rules. The same collection gates a team
// member's AI agent over MCP (see ../../MCP.md), so someone is added — or
// removed — once, for both.
//
// Membership is resolved through the console's own /mcp/claims/sync
// endpoint rather than a direct Firestore read, for three reasons: it is
// same-origin (no CORS, no SDK to initialise before app.js gets to pick its
// own Firestore transport), it answers with the person's ROLE and not just
// yes/no, and it repairs the custom auth claim that storage.rules depends
// on for anyone added before their first sign-in.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  signInWithEmailAndPassword, sendPasswordResetEmail, setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// The two owner accounts, mirrored from firestore.rules' own bootstrap
// list. Only used as a fallback when the membership endpoint can't be
// reached — an owner must never be locked out of the console by an outage
// in the very function that grants access.
export const OWNER_ACCOUNTS = [
  "rob@offline2online.com",
  "rob@personalisationhub.com",
];

// What role the signed-in person holds: "admin" | "editor" | "viewer".
// app.js imports this to decide whether to show the read-only banner and
// the Team & agent access admin block.
export let consoleRole = null;
export let consoleEmail = null;

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
// Keep the session across reloads and browser restarts (this is the SDK
// default, made explicit so a reload never lands back on the sign-in card).
setPersistence(auth, browserLocalPersistence).catch(() => { /* falls back to in-memory */ });

// Firebase Auth restores the session asynchronously, so for the first few
// hundred milliseconds of every load the user is unknown. Showing the
// sign-in card during that window reads as "logged out again" on every
// refresh. While auth is resolving we show a neutral "Loading…" state
// instead, and only reveal the sign-in button once we KNOW there is no
// session. A localStorage flag remembers that someone was signed in here
// before, so even the loading state can say so.
const REMEMBER_KEY = "ph-console-signed-in";

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
const appRoot = document.querySelector(".app");

function setStatus(text, kind) {
  status.textContent = text;
  status.dataset.kind = kind || "";
}
function showResolving() {
  gate.hidden = false; appRoot.hidden = true;
  signInBtn.hidden = true; signOutBtn.hidden = true;
  if (passwordForm) passwordForm.hidden = true;
  if (retryBtn) retryBtn.hidden = true;
  let remembered = false;
  try { remembered = localStorage.getItem(REMEMBER_KEY) === "1"; } catch { /* ignore */ }
  setStatus(remembered ? "Restoring your session…" : "Checking sign-in…");
}
function showSignIn() {
  gate.hidden = false; appRoot.hidden = true;
  signInBtn.hidden = false; signOutBtn.hidden = true;
  if (passwordForm) passwordForm.hidden = false;
  if (retryBtn) retryBtn.hidden = true;
  setStatus("");
}
function showRejected(message, { canRetry = false } = {}) {
  gate.hidden = false; appRoot.hidden = true;
  signInBtn.hidden = true; signOutBtn.hidden = false;
  if (passwordForm) passwordForm.hidden = true;
  if (retryBtn) retryBtn.hidden = !canRetry;
  setStatus(message, "error");
}
showResolving();

async function signIn() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  signInBtn.disabled = true;
  setStatus("Opening Google sign-in…");
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    const code = (err && err.code) || "";
    if (code === "auth/popup-blocked") {
      await signInWithRedirect(auth, provider);
      return;
    }
    if (code === "auth/operation-not-allowed") {
      setStatus("Google sign-in is not enabled for this Firebase project yet (Authentication → Sign-in method → Google).", "error");
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
  "auth/operation-not-allowed": "Password sign-in isn't enabled for this project yet — use Google instead.",
};

async function signInWithPassword() {
  const email = (emailInput.value || "").trim();
  const password = passwordInput.value || "";
  if (!email || !password) { setStatus("Enter your email and password.", "error"); return; }
  passwordBtn.disabled = true;
  setStatus("Signing in…");
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    const code = (err && err.code) || "";
    setStatus(PASSWORD_ERRORS[code] || `Sign-in failed: ${code || err}`, "error");
  } finally {
    passwordBtn.disabled = false;
  }
}

async function sendReset() {
  const email = (emailInput.value || "").trim();
  if (!email) { setStatus("Type your email above first, then tap this again.", "error"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("Password reset email sent — follow it to set a password, then come back and sign in.");
  } catch (err) {
    setStatus(`Couldn't send a reset email: ${(err && err.code) || err}`, "error");
  }
}

// Returns { role, email } for a member, null for a definite refusal, or
// undefined when we genuinely could not tell (endpoint down, offline).
async function resolveMembership(user) {
  try {
    const idToken = await user.getIdToken();
    const resp = await fetch("/mcp/claims/sync", {
      method: "POST",
      headers: { "X-Firebase-ID-Token": idToken, "Content-Type": "application/json" },
      body: "{}",
    });
    if (resp.ok) {
      const data = await resp.json();
      // A claim we just created only reaches storage.rules after the token
      // is minted again, so force a refresh before the board loads rather
      // than leaving attachments broken for up to an hour.
      if (data.claimUpdated) { try { await user.getIdToken(true); } catch { /* not fatal */ } }
      return { role: data.role || "editor", email: data.email || (user.email || "").toLowerCase() };
    }
    if (resp.status === 403 || resp.status === 401) return null;
  } catch { /* fall through to the owner fallback */ }
  const email = (user.email || "").toLowerCase();
  if (OWNER_ACCOUNTS.includes(email)) return { role: "admin", email };
  return undefined;
}

let started = false;
async function startApp(user, membership) {
  if (started) return;
  started = true;
  consoleRole = membership.role;
  consoleEmail = membership.email;
  try { localStorage.setItem(REMEMBER_KEY, "1"); } catch { /* ignore */ }
  gate.hidden = true;
  appRoot.hidden = false;
  document.documentElement.classList.add("signed-in");
  // app.js and styles.css both key off this — a viewer sees the board and
  // a read-only banner, an admin additionally sees the team admin block.
  document.documentElement.dataset.consoleRole = membership.role;
  const who = document.getElementById("topbar-user");
  if (who) who.textContent = user.email;
  await import("./app.js");
}

signInBtn.addEventListener("click", signIn);
if (passwordBtn) passwordBtn.addEventListener("click", signInWithPassword);
if (passwordInput) passwordInput.addEventListener("keydown", (e) => { if (e.key === "Enter") signInWithPassword(); });
if (resetBtn) resetBtn.addEventListener("click", sendReset);
if (retryBtn) retryBtn.addEventListener("click", () => { if (auth.currentUser) handleUser(auth.currentUser); });

async function doSignOut() {
  try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
  await signOut(auth);
  window.location.reload();
}
signOutBtn.addEventListener("click", doSignOut);
document.addEventListener("click", (e) => {
  if (e.target.closest("#topbar-signout")) doSignOut();
});

async function handleUser(user) {
  if (started) {
    const who = document.getElementById("topbar-user");
    if (who) who.textContent = user.email;
    return;
  }
  setStatus("Checking your access…");
  const membership = await resolveMembership(user);
  if (membership === null) {
    showRejected(`${user.email} isn't on the PH Agent Console user list. Ask an admin to add you in Settings → Team & agent access, then sign in again.`);
    return;
  }
  if (membership === undefined) {
    showRejected("Couldn't check your access just now — the console's membership service didn't answer. Try again in a moment.", { canRetry: true });
    return;
  }
  startApp(user, membership);
}

getRedirectResult(auth).catch(() => { /* handled by onAuthStateChanged */ });
onAuthStateChanged(auth, (user) => {
  if (!user) {
    showSignIn();
    return;
  }
  handleUser(user);
});
