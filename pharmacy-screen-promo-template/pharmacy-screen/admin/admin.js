// Pharmacy Screen admin — sign-in gate and Settings (PH API base URL and
// write-only token). The full editor (pharmacies, promotions, templates)
// builds on this page.
//
// Sign-in: Firebase Auth (Google). The Firebase web config comes from the
// Hosting site itself (/__/firebase/init.json), so nothing project-specific is
// hard-coded here. Access: the server decides. GET /api/admin/me (config API)
// answers 403 for an account without the admin custom claim, and every
// settings call is checked again by the PH API proxy. This page never
// receives the saved token: the API returns only whether one is set and its
// last 4 characters.

const SDK = "https://www.gstatic.com/firebasejs/12.9.0";

const $ = (id) => document.getElementById(id);
const views = ["loading", "signin", "refused", "settings"];
function show(view) {
  for (const v of views) $(`view-${v}`).hidden = v !== view;
  $("app").setAttribute("aria-busy", view === "loading" ? "true" : "false");
}

let auth, fb;
let saved = { baseUrls: [], token: { set: false, last4: null } };
let replacing = false;

async function api(method, path, body) {
  const user = auth.currentUser;
  if (!user) throw Object.assign(new Error("Sign in required"), { status: 401 });
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: `Bearer ${await user.getIdToken()}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || `Request failed (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json;
}

// ── settings form ─────────────────────────────────────────────────────────

const parseUrls = (text) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

function draft() {
  return { baseUrls: parseUrls($("base-urls").value), token: $("token-input").value.trim() };
}

function isDirty() {
  const d = draft();
  return d.token !== "" || d.baseUrls.join("\n") !== saved.baseUrls.join("\n");
}

function refreshSaveBar() {
  const dirty = isDirty();
  $("save-btn").disabled = !dirty;
  $("cancel-btn").disabled = !dirty && !replacing;
  const status = $("save-status");
  status.textContent = dirty ? "You have unsaved changes." : "No changes to save.";
  status.classList.toggle("dirty", dirty);
}

function renderSettings() {
  $("base-urls").value = saved.baseUrls.join("\n");
  $("base-urls").rows = Math.max(2, saved.baseUrls.length);
  $("token-input").value = "";
  const set = !!(saved.token && saved.token.set);
  $("token-set").hidden = !set || replacing;
  $("token-last4").textContent = set ? saved.token.last4 : "";
  $("token-input").hidden = set && !replacing;
  $("token-input").placeholder = set ? "Paste the new API token" : "Paste the API token";
  refreshSaveBar();
}

function showError(message) {
  $("settings-error").hidden = !message;
  $("settings-error-text").textContent = message || "";
}

async function loadSettings() {
  const out = await api("GET", "/api/settings/ph-api");
  saved = out.settings;
  replacing = false;
  renderSettings();
}

async function onSave(e) {
  e.preventDefault();
  if (!isDirty()) return;
  const d = draft();
  const body = {};
  if (d.baseUrls.join("\n") !== saved.baseUrls.join("\n")) body.baseUrls = d.baseUrls;
  if (d.token) body.token = d.token;
  $("save-btn").disabled = true;
  try {
    const out = await api("PUT", "/api/settings/ph-api", body);
    saved = out.settings;
    replacing = false;
    showError("");
    renderSettings();
  } catch (err) {
    showError(err.message);
    refreshSaveBar();
  } finally {
    $("token-input").value = ""; // never keep a typed token around after a save attempt
    refreshSaveBar();
  }
}

async function onRemoveConfirmed() {
  $("remove-dialog").close();
  try {
    const out = await api("DELETE", "/api/settings/ph-api/token");
    saved = out.settings;
    replacing = false;
    showError("");
    renderSettings();
  } catch (err) {
    showError(err.message);
  }
}

// ── auth gate ─────────────────────────────────────────────────────────────

async function onUser(user) {
  if (!user) return show("signin");
  show("loading");
  try {
    const me = await api("GET", "/api/admin/me");
    $("settings-who").textContent = me.email || "";
    show("settings");
    await loadSettings();
  } catch (err) {
    if (err.status === 401 || err.status === 403) {
      $("refused-who").textContent = user.email || "This account";
      return show("refused");
    }
    show("settings");
    showError(err.message);
  }
}

async function start() {
  const [{ initializeApp }, authMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
  ]);
  fb = authMod;
  const config = await (await fetch("/__/firebase/init.json", { cache: "no-store" })).json();
  auth = fb.getAuth(initializeApp(config));

  $("signin-btn").addEventListener("click", async () => {
    try {
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
    } catch (err) {
      if (err && err.code === "auth/popup-blocked") await fb.signInWithRedirect(auth, new fb.GoogleAuthProvider());
    }
  });
  for (const b of document.querySelectorAll("[data-signout]")) b.addEventListener("click", () => fb.signOut(auth));

  $("settings-form").addEventListener("submit", onSave);
  $("settings-form").addEventListener("input", refreshSaveBar);
  $("cancel-btn").addEventListener("click", () => { replacing = false; showError(""); renderSettings(); });
  $("token-replace").addEventListener("click", () => { replacing = true; renderSettings(); $("token-input").focus(); });
  $("token-remove").addEventListener("click", () => $("remove-dialog").showModal());
  $("remove-cancel").addEventListener("click", () => $("remove-dialog").close());
  $("remove-confirm").addEventListener("click", onRemoveConfirmed);

  fb.onAuthStateChanged(auth, onUser);
}

start().catch((err) => {
  show("settings");
  showError(`Could not start: ${err.message}`);
});
