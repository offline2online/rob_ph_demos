// Sign-in for the admin editor. Returns { getToken(), signOut(), user } once someone is signed in.
//
// mode 'firebase': Firebase Auth (Google or email and password). The ID token goes to the API as a Bearer
//   token; the API checks the `admin` custom claim on every call, so signing in is not enough on its own.
// mode 'oidc': OpenID Connect, authorization code with PKCE (the AWS deployment: Amazon Cognito, or the
//   retailer's own identity provider; aws/README.md). The ID token goes to the API as a Bearer token; the API
//   checks the admin claim on every call. Tokens are kept in sessionStorage (this tab only), never the PH API token.
// mode 'token': a pasted access token, for local development against admin/tools/dev-server.mjs only. It is
//   kept in sessionStorage (this tab only) so a reload doesn't ask again.

const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
const TOKEN_KEY = 'ps-admin-dev-token';
const OIDC_KEY = 'ps-admin-oidc';
const OIDC_PENDING_KEY = 'ps-admin-oidc-pending';

const $ = (id) => document.getElementById(id);

function show(view, message) {
  $('gate').hidden = false;
  for (const v of ['gateLoading', 'gateFirebase', 'gateOidc', 'gateToken', 'gateBlocked']) $(v).hidden = v !== view;
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

// ── OIDC (authorization code + PKCE) ──────────────────────────────────────

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { sessionStorage.removeItem(k); } catch {} },
};

function claimsOf(idToken) {
  try { return JSON.parse(decodeURIComponent(escape(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; }
}

function sessionFrom(tokens, previous) {
  const idToken = tokens.id_token;
  if (!idToken) return null;
  const c = claimsOf(idToken);
  const exp = typeof c.exp === 'number' ? c.exp * 1000 : Date.now() + (Number(tokens.expires_in) || 3600) * 1000;
  return { idToken, refreshToken: tokens.refresh_token || (previous && previous.refreshToken) || null, exp, email: c.email || null };
}

async function tokenRequest(cfg, body) {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: cfg.clientId, ...body }).toString(),
  });
  if (!res.ok) throw new Error(`token endpoint returned ${res.status}`);
  return res.json();
}

async function beginOidc(cfg, redirectUri) {
  const verifier = randomString(48);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = randomString(16);
  // `back`: the page's own query (e.g. ?store=VIC-MP-002), put back after the provider returns.
  store.set(OIDC_PENDING_KEY, { state, verifier, redirectUri, back: location.search });
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    scope: cfg.scopes || 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  location.assign(`${cfg.authorizeUrl}${cfg.authorizeUrl.includes('?') ? '&' : '?'}${q}`);
  return new Promise(() => {});
}

async function oidcMode(cfg) {
  if (!cfg || !cfg.clientId || !cfg.authorizeUrl || !cfg.tokenUrl) {
    showBlocked('Sign-in is not set up', 'This editor has no sign-in configuration yet. Set auth.oidc in admin/config.js.');
    return new Promise(() => {});
  }
  show('gateLoading');
  const redirectUri = location.origin + location.pathname;
  let session = store.get(OIDC_KEY);

  // Back from the sign-in page: swap the one-time code for tokens, then drop it from the address bar.
  const params = new URLSearchParams(location.search);
  if (params.has('code') || params.has('error')) {
    const pending = store.get(OIDC_PENDING_KEY);
    store.del(OIDC_PENDING_KEY);
    const back = pending && typeof pending.back === 'string' && pending.back.startsWith('?') ? pending.back : '';
    history.replaceState(null, '', redirectUri + back + location.hash);
    if (params.has('error') || !pending || params.get('state') !== pending.state) {
      session = null;
      store.del(OIDC_KEY);
      show('gateOidc', 'Sign-in did not complete. Try again.');
    } else {
      try {
        session = sessionFrom(await tokenRequest(cfg, { grant_type: 'authorization_code', code: params.get('code'), redirect_uri: pending.redirectUri, code_verifier: pending.verifier }));
        if (!session) throw new Error('no ID token');
        session.issuedAt = Date.now();
        store.set(OIDC_KEY, session);
      } catch (e) {
        session = null;
        show('gateOidc', 'Sign-in did not complete. Try again.');
      }
    }
  }

  // One refresh at a time: the editor asks for a token for several requests at once. A token just issued is
  // used until shortly before it expires, even when the provider issues tokens shorter than the 60 s margin.
  let refreshing = null;
  const refresh = () => (refreshing = refreshing || (async () => {
    if (!session || !session.refreshToken) return false;
    try {
      const next = sessionFrom(await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: session.refreshToken }), session);
      if (!next) return false;
      session = { ...next, issuedAt: Date.now() };
      store.set(OIDC_KEY, session);
      return true;
    } catch (e) {
      return false;
    }
  })().finally(() => { refreshing = null; }));
  const valid = (marginMs) => !!session && session.exp - marginMs > Date.now();
  const fresh = () => valid(60000) || (!!session && Date.now() - (session.issuedAt || 0) < 30000 && valid(5000));

  if (!fresh() && !(await refresh())) {
    session = null;
    store.del(OIDC_KEY);
    if ($('gateOidc').hidden) show('gateOidc');
    await new Promise((resolve) => { $('gateOidcBtn').onclick = resolve; });
    return beginOidc(cfg, redirectUri);
  }

  const getToken = async () => {
    if (fresh() || (await refresh())) return session.idToken;
    return beginOidc(cfg, redirectUri); // signed out at the provider, or the refresh token expired
  };
  const signOut = async () => {
    const idToken = session && session.idToken;
    store.del(OIDC_KEY);
    session = null;
    if (!cfg.logoutUrl) return;
    const q = new URLSearchParams({ client_id: cfg.clientId, [cfg.logoutParam || 'post_logout_redirect_uri']: redirectUri });
    if (idToken && (cfg.logoutParam || 'post_logout_redirect_uri') === 'post_logout_redirect_uri') q.set('id_token_hint', idToken);
    location.assign(`${cfg.logoutUrl}${cfg.logoutUrl.includes('?') ? '&' : '?'}${q}`);
    return new Promise(() => {});
  };
  return { getToken, signOut, user: { email: session.email } };
}

export async function signIn(authCfg) {
  const mode = (authCfg && authCfg.mode) || 'firebase';
  const session = mode === 'token' ? await tokenMode() : mode === 'oidc' ? await oidcMode(authCfg && authCfg.oidc) : await firebaseMode(authCfg && authCfg.firebase);
  show('gateLoading');
  return session;
}

export function hideGate() { $('gate').hidden = true; }
