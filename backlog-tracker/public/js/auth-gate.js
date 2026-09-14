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
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const ALLOWED_EDITORS = [
  "rob@offline2online.com",
  "rob@personalisationhub.com",
];

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

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
  gate.hidden = true;
  appRoot.hidden = false;
  document.documentElement.classList.add("signed-in");
  const who = document.getElementById("topbar-user");
  if (who) who.textContent = user.email;
  await import("./app.js");
}

signInBtn.addEventListener("click", signIn);
signOutBtn.addEventListener("click", async () => { await signOut(auth); window.location.reload(); });
document.addEventListener("click", (e) => {
  if (e.target.closest("#topbar-signout")) signOut(auth).then(() => window.location.reload());
});

getRedirectResult(auth).catch(() => { /* handled by onAuthStateChanged */ });
onAuthStateChanged(auth, (user) => {
  if (!user) {
    gate.hidden = false; appRoot.hidden = true; signOutBtn.hidden = true;
    setStatus("");
    return;
  }
  if (!isAllowed(user)) {
    gate.hidden = false; appRoot.hidden = true; signOutBtn.hidden = false;
    setStatus(`${user.email} is not on the editor list for this console. Sign out and use an authorised account.`, "error");
    return;
  }
  if (started) { const who = document.getElementById("topbar-user"); if (who) who.textContent = user.email; return; }
  startApp(user);
});
