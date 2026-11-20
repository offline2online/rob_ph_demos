# Signing in from Personalisation Hub

The admin editor has no sign-in of its own on our Firebase environment. It runs inside Personalisation Hub (PH),
in HQ Admin (**Pharmacy Promos**, `/hq-admin/iframe`) and Retail Admin (**Display Promotions**,
`/retail-admin-web/iframe`), and uses the PH session of the person looking at it. This page is the contract
between the two: what the PH pages send, what the editor does with it, and what each role may do.

## What PH's iframe pages must do

Both PH pages already hold the signed-in user's session token (`hq-admin-auth-token` in HQ Admin, `auth-token` in
Retail Admin). They hand it to the editor's frame with `window.postMessage`, only when the editor asks and only to
the editor's own origin. **Never put the token in the iframe URL.**

```js
// In the PH page that renders <iframe src="https://<editor host>/admin/…">
const EDITOR_ORIGIN = 'https://rob-ph-demos-pharmacy-screen.web.app'   // the iframe's origin
const HOST = 'hq-admin'                                                // 'retail-admin' in Retail Admin

function postSession(frame) {
  const token = loginUtils.getAuthToken()
  if (!token) return
  frame.contentWindow.postMessage({ type: 'ph-pharmacy-screen:session', token, host: HOST }, EDITOR_ORIGIN)
}

window.addEventListener('message', (e) => {
  if (e.origin !== EDITOR_ORIGIN || e.source !== frame.contentWindow) return
  if (e.data && e.data.type === 'ph-pharmacy-screen:ready') postSession(frame)
})

// When PH refreshes its token: postSession(frame) again.
// When the user signs out of PH:
frame.contentWindow.postMessage({ type: 'ph-pharmacy-screen:signed-out' }, EDITOR_ORIGIN)
```

| Message | Direction | Body | When |
|---|---|---|---|
| `ph-pharmacy-screen:ready` | editor → PH page | `{type, version: 1}` | On load (repeated every 0.5 s until answered, up to 8 s) and again a few minutes before the editor session runs out |
| `ph-pharmacy-screen:session` | PH page → editor | `{type, token, host}` | In answer to `ready`, and whenever PH has a newer token |
| `ph-pharmacy-screen:signed-out` | PH page → editor | `{type}` | The user signed out of PH |

The third argument of `postMessage` must be the editor's origin, never `'*'`: it is what stops any other page
from receiving the token. The editor sends `ready` to PH's origin by name for the same reason, and ignores every
message that does not come from its own parent window at an origin in `auth.ph.parentOrigins`.

Retail Admin keeps passing `?store=<store code>` in the iframe URL. It says which store to open; it grants nothing.

## What the editor does with it

1. The token goes, in a request body over HTTPS, to `POST /api/auth/ph-session` on the editor's own server. It is
   never written to storage, a URL or a log.
2. The server asks PH whose session it is (PH signs these tokens with a key only PH holds):
   `GET /auth-api/v1/me` for an HQ Admin session, `GET /retail-admin-api/v1/me/store` for a Retail Admin one.
   PH's two APIs do not accept each other's tokens, so the API that accepts it decides the role; the `host` label
   only says which to try first.
3. The server issues a short editor session carrying the role and stores, and every later call to the config API
   and the PH API settings is checked against it **on the server**.
4. The editor session lasts at most an hour before the editor asks the PH page for the session again and the server
   re-checks it with PH, so signing out of PH ends access on the next check and always on the next load.

| PH session | Editor role | May do |
|---|---|---|
| HQ Admin, role `ADMIN` (`PH_SESSION_HQ_ROLES`) | Administrator | Everything: all pharmacies, the master template, promotions, templates, Settings |
| Retail Admin, any role, for a store with a store code (`dealer_code`) | Store user for that one store | See that pharmacy only; edit its own copy of each promotion, choose which sections it manages itself, **Restore to default**. Nothing else: not the master, not another store, not pharmacy details, logo, tokens or Settings |
| Anything else, no session, or opened outside PH | None | "Access denied" |

A store code in the URL that is not the user's own store shows "Access denied"; the server would refuse it in any
case (`403`), because it filters and checks by the session, not by the URL.

The editor can only be framed by PH (`Content-Security-Policy: frame-ancestors`, `firebase.json`).

## Switching it on

`PS_ADMIN_AUTH` at deploy time ([CONFIGURATION.md](CONFIGURATION.md) → Deploy scripts):

1. **`ph+firebase`** (the default): PH sign-in where the PH page hands a session over; otherwise the previous
   Firebase sign-in after a 2.5 s wait. Use it until both PH pages send the session.
2. **`ph`**: PH sign-in only. Set `PS_REQUIRE_PH_SESSION=true` and `PH_REQUIRE_PH_SESSION=true` in the two
   functions' `.env.<project>` files in the same deploy, so the APIs refuse any other sign-in as well.

One-time set-up on the Firebase project: the functions' service account needs
`roles/iam.serviceAccountTokenCreator` on itself to sign editor sessions. Without it
`POST /api/auth/ph-session` answers `503 SESSION_SIGNING_FAILED`.

The AWS deployment keeps its OIDC sign-in (`aws/README.md`); PH sign-in is not wired there yet.

## Trying it locally

```bash
cd pharmacy-screen && node admin/tools/dev-server.mjs 8790 ph
# As HQ Admin:     http://localhost:8790/__ph-host.html?as=hq
# As Retail Admin: http://localhost:8790/__ph-host.html?as=store&store=VIC-MP-003
```

`/__ph-host.html` plays the PH page; the PH auth API and the token service are mocks. Tests:
`npm --prefix pharmacy-screen/admin run test:ph`, `ph-proxy/test/ph-session.test.js`,
`config-api/test/store-scope.test.js`.
