// Sign-in for the admin editor. Returns { getToken(), signOut(), user } once someone is signed in.
//
// mode 'ph': the Personalisation Hub session of the page that embeds the editor (HQ Admin or Retail Admin).
//   No sign-in of its own: the editor tells its parent it is ready, the parent posts the signed-in user's PH
//   session token (window.postMessage, only ever from an origin in auth.ph.parentOrigins), and the server
//   swaps it for a short editor session that carries the user's role and stores (ph-proxy/src/ph-session.js).
//   The PH token is held in memory only: never in storage, a URL or a log. docs/PH-EMBED.md is the contract
//   the PH pages implement. Opened outside Personalisation Hub it shows "Access denied", unless
//   auth.ph.fallback is 'firebase' (while the PH pages are being updated), which then offers that sign-in.
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

// ── Personalisation Hub session ───────────────────────────────────────────

export const PH_READY = 'ph-pharmacy-screen:ready';
export const PH_SESSION = 'ph-pharmacy-screen:session';
export const PH_SIGNED_OUT = 'ph-pharmacy-screen:signed-out';
const PH_DENIED = ['Access denied', 'Open this page from Personalisation Hub, signed in. It cannot be used on its own.'];

/** The parent page's messages, filtered to the PH origins and to this page's own parent window. */
function phChannel(origins) {
  const allowed = new Set(origins);
  const waiting = new Set();
  let onSignedOut = null;
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || !allowed.has(e.origin)) return;
    const d = e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === PH_SIGNED_OUT) { if (onSignedOut) onSignedOut(); return; }
    if (d.type !== PH_SESSION || typeof d.token !== 'string' || !d.token) return;
    const msg = { token: d.token, host: d.host === 'retail-admin' ? 'retail-admin' : d.host === 'hq-admin' ? 'hq-admin' : null };
    for (const w of [...waiting]) w(msg);
    if (!waiting.size && channel.onPush) channel.onPush(msg);
  });
  const channel = {
    onPush: null,
    set onSignedOut(fn) { onSignedOut = fn; },
    /** Ask the parent for the session; resolves null if it does not answer in time. Asked of each PH origin by
     *  name, so no other page that happens to frame the editor ever sees the request. */
    request(timeoutMs) {
      return new Promise((resolve) => {
        let done = false;
        const finish = (v) => { if (done) return; done = true; waiting.delete(finish); clearInterval(again); clearTimeout(giveUp); resolve(v); };
        const ask = () => { for (const o of allowed) { try { window.parent.postMessage({ type: PH_READY, version: 1 }, o); } catch {} } };
        waiting.add(finish);
        const again = setInterval(ask, 500); // the parent may attach its listener after the frame loads
        const giveUp = setTimeout(() => finish(null), timeoutMs);
        ask();
      });
    },
  };
  return channel;
}

async function phMode(authCfg) {
  const cfg = (authCfg && authCfg.ph) || {};
  const origins = (Array.isArray(cfg.parentOrigins) ? cfg.parentOrigins : []).filter((o) => /^https?:\/\/[^/]+$/.test(o));
  const fallback = async () => {
    if (cfg.fallback === 'firebase') return firebaseMode(authCfg.firebase);
    showBlocked(...PH_DENIED);
    return new Promise(() => {});
  };
  if (window.parent === window || !origins.length) return fallback();
  show('gateLoading');
  const channel = phChannel(origins);
  const first = await channel.request(cfg.fallback === 'firebase' ? 2500 : 8000);
  if (!first) return fallback();

  const base = String(authCfg.apiBase || '').replace(/\/+$/, '');
  /** PH session token -> { token (Firebase custom token), expiresAt, role, admin, stores }. Throws with .status. */
  const exchange = async (msg) => {
    const res = await fetch(`${base}/api/auth/ph-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg), cache: 'no-store', credentials: 'omit' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.session) { const e = new Error((data && data.error && data.error.message) || `The server answered ${res.status}.`); e.status = res.status; throw e; }
    return data.session;
  };

  let granted;
  try { granted = await exchange(first); }
  catch (e) {
    if (e.status === 401 || e.status === 403) showBlocked('Access denied', e.status === 403 ? e.message : 'Your Personalisation Hub session was not accepted. Sign in to Personalisation Hub again.');
    else showBlocked('The editor could not load', e.message);
    return new Promise(() => {});
  }

  // The editor session itself: the server's token swapped for a one-hour ID token (Identity Toolkit, one request,
  // no SDK). Nothing is stored and there is no refresh token: when it runs low the editor asks its parent for the
  // PH session again and the server re-checks it with Personalisation Hub, so a PH sign-out ends it.
  const fb = authCfg.firebase || {};
  const identityUrl = cfg.identityUrl || `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(fb.apiKey || '')}`;
  const idTokenFor = async (customToken) => {
    const res = await fetch(identityUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }), cache: 'no-store', credentials: 'omit' });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.idToken) { const e = new Error('The sign-in service did not start a session.'); e.status = res.status === 400 ? 401 : 0; throw e; }
    return { idToken: data.idToken, until: Date.now() + (Number(data.expiresIn) || 3600) * 1000 };
  };
  const open = async (msg, already) => {
    const g = already || await exchange(msg);
    const t = await idTokenFor(g.token);
    return { idToken: t.idToken, until: Math.min(t.until, Date.parse(g.expiresAt) || t.until) };
  };

  let live;
  try { live = await open(first, granted); }
  catch (e) {
    showBlocked('The editor could not load', 'The sign-in service could not be reached. Check your connection and reload.');
    return new Promise(() => {});
  }

  let ended = false;
  const end = () => { ended = true; live = null; showBlocked('Signed out', 'You are signed out of Personalisation Hub. Sign in again to keep editing.'); };
  channel.onSignedOut = end;
  // One renewal at a time. A renewal that fails for a passing reason keeps the current session until it ends.
  let renewing = null;
  const renew = (msg) => (renewing = renewing || (async () => {
    try { live = await open(msg); return true; }
    catch (e) { if (e.status === 401 || e.status === 403) end(); return false; }
  })().finally(() => { renewing = null; }));
  channel.onPush = (msg) => { if (!ended) renew(msg); }; // the parent refreshed its session and posted the new one

  const getToken = async () => {
    if (!ended && live.until - Date.now() < 300000) {
      const msg = await channel.request(5000);
      if (msg) await renew(msg);
      if (!ended && live.until <= Date.now()) end(); // the parent no longer answers and the session is over
    }
    if (ended) return new Promise(() => {});
    return live.idToken;
  };
  return { getToken, signOut: null, user: { email: null }, ph: { role: granted.role, admin: granted.admin, stores: granted.stores } };
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
  const session = mode === 'token' ? await tokenMode() : mode === 'oidc' ? await oidcMode(authCfg && authCfg.oidc) : mode === 'ph' ? await phMode(authCfg) : await firebaseMode(authCfg && authCfg.firebase);
  show('gateLoading');
  return session;
}

export function hideGate() { $('gate').hidden = true; }
