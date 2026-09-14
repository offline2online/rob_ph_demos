// Sign-in wall for the whole console.
//
// Nothing on the board loads until a Google account on the editor allowlist
// has signed in: this module shows the sign-in screen, waits for Firebase
// Auth, checks the email against ALLOWED_EDITORS, and only then imports
// app.js (which starts every Firestore listener). firestore.rules and
// storage.rules enforce the same allowlist server-side — keep the three in
// sync when adding or removing a person.
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut,
  setPersistence, browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const ALLOWED_EDITORS = [
  "rob@offline2online.com",
  "rob@personalisationhub.com",
];

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
let authResolved = false;

const gate = document.getElementById("auth-gate");
const status = document.getElementById("auth-gate-status");
const signInBtn = document.getElementById("auth-gate-signin");
const signOutBtn = document.getElementById("auth-gate-signout");
const appRoot = document.querySelector(".app");

function isAllowed(user) {
  return !!(user && user.email && user.emailVerified && ALLOWED_EDITORS.includes(user.email.toLowerCase()));
}

function setStatus(text, kind) {
  status.textContent = text;
  status.dataset.kind = kind || "";
}
function showResolving() {
  gate.hidden = false; appRoot.hidden = true;
  signInBtn.hidden = true; signOutBtn.hidden = true;
  let remembered = false;
  try { remembered = localStorage.getItem(REMEMBER_KEY) === "1"; } catch { /* ignore */ }
  setStatus(remembered ? "Restoring your session…" : "Checking sign-in…");
}
function showSignIn() {
  gate.hidden = false; appRoot.hidden = true;
  signInBtn.hidden = false; signOutBtn.hidden = true;
  setStatus("");
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

let started = false;
async function startApp(user) {
  if (started) return;
  started = true;
  try { localStorage.setItem(REMEMBER_KEY, "1"); } catch { /* ignore */ }
  gate.hidden = true;
  appRoot.hidden = false;
  document.documentElement.classList.add("signed-in");
  const who = document.getElementById("topbar-user");
  if (who) who.textContent = user.email;
  await import("./app.js");
}

signInBtn.addEventListener("click", signIn);
async function doSignOut() {
  try { localStorage.removeItem(REMEMBER_KEY); } catch { /* ignore */ }
  await signOut(auth);
  window.location.reload();
}
signOutBtn.addEventListener("click", doSignOut);
document.addEventListener("click", (e) => {
  if (e.target.closest("#topbar-signout")) doSignOut();
});

getRedirectResult(auth).catch(() => { /* handled by onAuthStateChanged */ });
onAuthStateChanged(auth, (user) => {
  authResolved = true;
  if (!user) {
    showSignIn();
    return;
  }
  if (!isAllowed(user)) {
    gate.hidden = false; appRoot.hidden = true; signInBtn.hidden = true; signOutBtn.hidden = false;
    setStatus(`${user.email} is not on the editor list for this console. Sign out and use an authorised account.`, "error");
    return;
  }
  if (started) { const who = document.getElementById("topbar-user"); if (who) who.textContent = user.email; return; }
  startApp(user);
});
