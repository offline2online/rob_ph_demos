// Sign-in for the admin editor. Returns { getToken(), signOut(), user } once someone is signed in.
//
// mode 'firebase': Firebase Auth (Google or email and password). The ID token goes to the API as a Bearer
//   token; the API checks the `admin` custom claim on every call, so signing in is not enough on its own.
// mode 'token': a pasted access token, for local development against admin/tools/dev-server.mjs only. It is
//   kept in sessionStorage (this tab only) so a reload doesn't ask again.

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const TOKEN_KEY = 'ps-admin-dev-token';

const $ = (id) => document.getElementById(id);

function show(view, message) {
  $('gate').hidden = false;
  for (const v of ['gateLoading', 'gateFirebase', 'gateToken', 'gateBlocked']) $(v).hidden = v !== view;
  $('gateMsg').textContent = message || '';
  $('gateMsg').hidden = !message;
}

/** Shown when the API refuses this account (not an admin) or sign-in can't work here. */
export function showBlocked(title, message, { signOut } = {}) {
  show('gateBlocked');
  $('gateTitle').textContent = title;
  $('gateBlockedTx').textContent = message;
  $('gateSignOut').hidden = !signOut;
  if (signOut) $('gateSignOut').onclick = () => signOut().then(() => location.reload());
}

async function tokenMode() {
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch {}
  if (!token) {
    show('gateToken');
    token = await new Promise((resolve) => {
      $('gateToken').onsubmit = (e) => {
        e.preventDefault();
        const v = $('gateTokenIn').value.trim();
        if (v) resolve(v);
      };
    });
    try { sessionStorage.setItem(TOKEN_KEY, token); } catch {}
  }
  const signOut = async () => { try { sessionStorage.removeItem(TOKEN_KEY); } catch {} };
  return { getToken: async () => token, signOut, user: { email: null } };
}

async function firebaseMode(cfg) {
  if (!cfg || !cfg.apiKey || !cfg.projectId) {
    showBlocked('Sign-in is not set up', 'This editor has no Firebase web app configuration yet. Set auth.firebase in admin/config.js.');
    return new Promise(() => {});
  }
  show('gateLoading');
  let app, A;
  try {
    const { initializeApp } = await import(`${FIREBASE_SDK}/firebase-app.js`);
    A = await import(`${FIREBASE_SDK}/firebase-auth.js`);
    app = initializeApp(cfg);
  } catch (e) {
    showBlocked('Sign-in could not load', 'The sign-in service could not be reached. Check your connection and reload.');
    return new Promise(() => {});
  }
  const auth = A.getAuth(app);
  const user = await new Promise((resolve) => {
    const off = A.onAuthStateChanged(auth, (u) => {
      if (u) { off(); resolve(u); return; }
      show('gateFirebase');
    });
    $('gateGoogle').onclick = async () => {
      try { await A.signInWithPopup(auth, new A.GoogleAuthProvider()); } catch (e) { show('gateFirebase', 'Google sign-in did not complete. Try again.'); }
    };
    $('gateEmailForm').onsubmit = async (e) => {
      e.preventDefault();
      try { await A.signInWithEmailAndPassword(auth, $('gateEmail').value.trim(), $('gatePassword').value); }
      catch (err) { show('gateFirebase', 'That email and password did not match an account.'); }
    };
  });
  return { getToken: () => user.getIdToken(), signOut: () => A.signOut(auth), user: { email: user.email } };
}

export async function signIn(authCfg) {
  const mode = (authCfg && authCfg.mode) || 'firebase';
  const session = mode === 'token' ? await tokenMode() : await firebaseMode(authCfg && authCfg.firebase);
  show('gateLoading');
  return session;
}

export function hideGate() { $('gate').hidden = true; }
