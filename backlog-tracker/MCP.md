# Connecting an AI agent to the PH Agent Console (MCP)

The console at **https://backlog-tracker-e4ed2.web.app/** is now also an
**MCP server**, so a team member's own AI agent — Claude Desktop, Claude
Code, a claude.ai custom connector, or anything else that speaks the Model
Context Protocol — can use the board and the help centre as a tool.

The point of it is the authentication. There is no key to mint, paste,
share or rotate. Someone added to the console signs into their agent with
**the same Personalisation Hub / offline2online account they already use for
the board** — Google, or an email and password — and that is the whole
setup. Everything their agent does is recorded under their email, and
removing them from the console cuts their agent off in the same act.

```
   Team member's agent                 This console                  Firebase
  ┌────────────────────┐        ┌──────────────────────────┐      ┌──────────┐
  │ Claude / other MCP │ OAuth  │ /mcp/authorize           │      │   Auth   │
  │ client             │───────▶│  ↳ Google or password ───┼─────▶│ sign-in  │
  │                    │        │ /mcp/token  (PKCE)       │      └──────────┘
  │                    │◀───────│  ↳ access + refresh      │      ┌──────────┐
  │  tools/call ───────┼───────▶│ /mcp  (Streamable HTTP)  │─────▶│consoleUsers
  └────────────────────┘        └──────────────────────────┘      │ + board  │
                                                                  └──────────┘
```

---

## For a team member: connect your agent

**Server URL:** `https://backlog-tracker-e4ed2.web.app/mcp`

| Client | How |
| --- | --- |
| **Claude Code** | `claude mcp add --transport http ph-console https://backlog-tracker-e4ed2.web.app/mcp` then `/mcp` and authenticate |
| **Claude Desktop / claude.ai** | Settings → Connectors → Add custom connector → paste the URL |
| **Anything else** | Add it as a *remote* / *HTTP* / *streamable* MCP server at that URL |

The client opens a sign-in page. Use **Sign in with Google** with your
Personalisation Hub account, or your email and password if that is how you
sign into the console. Press **Connect** and you are done — the agent gets
its own token and never sees your password.

The same page is reachable from the console: **Settings → Connect your AI
agent**, which also lists every agent you have connected and lets you
disconnect any of them.

**If you see "isn't on the PH Agent Console user list"** you have not been
added yet — ask an admin (Settings → Team & agent access).

---

## For an admin: add someone

**Settings → Team & agent access**, visible only to admins.

1. Type their email, optionally their name, pick a role, **Add**.
2. If they have a Google account on that address, they can sign in
   immediately — to the board and to their agent. Nothing else to do.
3. If they do not, press **Send sign-in setup** on their row. That creates
   their Firebase Auth login and emails them a link to choose their own
   password. Nobody ever types or sends a password on their behalf.

| Role | Board | Agent |
| --- | --- | --- |
| **admin** | read + write, and manages this list | read + write |
| **editor** | read + write | read + write |
| **viewer** | read only (the board shows a read-only banner) | read only — write tools are refused |

**Agent on/off** turns just the MCP half off, leaving browser access
untouched, and kills that person's existing agent tokens at the same time.
**Disconnect agents** revokes their tokens without changing anything else —
they can reconnect by signing in again. **Remove** takes away both halves.

All of this is one Firestore doc per person, `consoleUsers/<lowercased
email>`, which is what `firestore.rules` and the MCP server both resolve
against. Two owner accounts (`rob@offline2online.com`,
`rob@personalisationhub.com`) are hard-coded as admins in the rules so an
empty or mis-edited collection can never lock everyone out.

---

## What the agent can and can't do

**Can — read:** `whoami`, `list_projects`, `list_backlog_items`,
`get_backlog_item`, `get_project_docs`, `search_faq`, `get_faq_article`.

**Can — write (editor and admin only):** `create_backlog_item` (always into
the Backlog column), `update_backlog_item` (title, description, type,
area), `add_item_comment`.

**Cannot, deliberately:** deploy, merge a train, approve a ticket out of
Ready for Testing, move a card's status, write any train field
(`trainReady`, `patchReady`, `mergeReady`, `revertReady`), fire the Notify
Claude Routine, or trigger a campaign. **Campaign triggering stays on the
triggered Routine, and the release pipeline keeps its human gates** — an
agent files, reads, enriches and comments; it does not ship.

There is no tool for those and no field an existing tool could reach to get
at them: `update_backlog_item`'s schema has no `status`, and the MCP server
writes nothing to `projects` at all. `test/mcp-server.test.js` asserts this
about the tool surface rather than leaving it to review.

Every write records the person's email on the document (`createdByEmail`,
`updatedByEmail`, and the comment's own `author`) and appends a row to
`mcpAuditLog`, which admins can read.

---

## How the authentication actually works

An OAuth 2.1 authorization server, implemented in
`functions/mcp-server.js` and served at the console's own origin.

| Endpoint | What it is |
| --- | --- |
| `/.well-known/oauth-protected-resource[/mcp]` | RFC 9728 resource metadata — how a client discovers the rest |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization-server metadata |
| `POST /mcp/register` | RFC 7591 dynamic client registration — clients register themselves, no manual setup |
| `GET /mcp/authorize` | the sign-in + consent page (Firebase Auth: Google or email/password) |
| `POST /mcp/authorize/complete` | the page posts the signed-in Firebase ID token here; it is exchanged for an authorization code and never leaves the browser |
| `POST /mcp/token` | authorization code + PKCE verifier → access token (1h) + refresh token (60d, rotating) |
| `POST /mcp/revoke` | RFC 7009 revocation |
| `POST /mcp` | the MCP endpoint itself, JSON-RPC over Streamable HTTP |

Things worth knowing:

- **PKCE with S256 is mandatory** — `plain` is not offered, and an
  `/authorize` request without a challenge is refused.
- **The agent never holds a Firebase credential.** A Firebase ID token is
  accepted at exactly one endpoint, from the browser, and is traded
  immediately for a token of this server's own. A leaked MCP token cannot be
  replayed against Firebase, Firestore or Storage.
- **Only hashes are stored.** Authorization codes and both token kinds live
  in Firestore as SHA-256 doc ids; the raw secret exists only in the
  response that issued it. `firestore.rules` denies every client read and
  write of those collections outright, and `boardApi`'s collection
  allowlist does not include them.
- **Codes are single-use**, enforced in a transaction, so a replayed code
  fails even in a race.
- **Refresh tokens rotate** — using one revokes it, so a stolen refresh
  token is usable at most once and its use is visible as the legitimate
  holder being logged out.
- **Membership is re-checked on every single call**, not just at sign-in.
  Removing someone, disabling them, switching their agent off, or demoting
  them to viewer takes effect on their agent's next request.
- **`board.write` is never granted to a viewer**, whatever scope the client
  asks for — it is filtered at issue time and again at use time.
- **The server is stateless.** No MCP session to resume and no
  server-initiated SSE stream: a `GET /mcp` answers `405`, which is what the
  spec tells a client to expect from a server that does not offer one. That
  suits Cloud Functions, where a held-open stream is billed wall-clock and
  dies at the instance timeout anyway.

### The custom claim, and why it exists

`firestore.rules` resolves membership by reading the `consoleUsers` doc, so
a new member works the instant they are added. **Storage rules cannot read
Firestore**, so attachments would be uploadable only by the two owner
accounts. Membership therefore also rides as a custom auth claim
(`consoleRole`, `consoleEditor`), kept in step by:

- `syncConsoleUserClaims`, a Firestore trigger on `consoleUsers/{email}`, and
- `POST /mcp/claims/sync`, which `auth-gate.js` calls on every sign-in and
  which repairs the claim for someone added before they had an Auth account
  at all — then force-refreshes their ID token so Storage sees it at once.

A claim can be up to an hour stale after a role change. That only ever
delays *granting* something: removal is enforced by the Firestore membership
read and by the MCP server's own per-call check, neither of which is cached.

---

## Files

| File | What |
| --- | --- |
| `functions/mcp-server.js` | the whole server — OAuth endpoints, sign-in page, MCP protocol, tools, admin endpoints, claim sync |
| `functions/index.js` | exports `mcpServer` and `syncConsoleUserClaims` |
| `firebase.json` | hosting rewrites putting it at `/mcp` and the two `/.well-known` paths |
| `firestore.rules` | `consoleUsers` membership model; `mcp*` collections denied to every client |
| `storage.rules` | the `consoleEditor` claim check |
| `public/js/auth-gate.js` | the console's own sign-in wall, now membership-based, with password sign-in |
| `public/js/app.js` | Settings → Team & agent access, and Connect your AI agent |
| `test/mcp-server.test.js` | end-to-end test of the whole flow, no emulator needed (`npm run test:mcp` in `test/`) |
| `test/mcp-stubs.js` | in-memory Firebase SDKs that test uses |

## Deploying it

It ships with everything else: merging to `main` runs
`.github/workflows/deploy-backlog-tracker.yml`, which deploys
`hosting,functions,firestore:rules` and then `storage`. No new secrets.

Two one-time things to check the first time it goes out, both in the
Firebase console for `backlog-tracker-e4ed2`:

1. **Authentication → Sign-in method** has both **Google** and
   **Email/Password** enabled. (Password already is — the board automation
   user signs in with one.)
2. The functions runtime service account can manage Auth users — it needs
   to set custom claims and create an invited member's login. The default
   runtime account normally can; if `syncConsoleUserClaims` logs a
   permission error, grant it **Firebase Authentication Admin**.

## Testing it here

`test/mcp-server.test.js` drives registration → sign-in → PKCE exchange →
`initialize` → `tools/list` → `tools/call` and the refusals that matter,
against the stubbed SDKs in `test/mcp-stubs.js`. It needs no emulator, no
credentials and no network:

```bash
cd backlog-tracker/test && npm run test:mcp
```

What it cannot cover, and what to check on the real deployment: the browser
half of `/mcp/authorize` (a real Google popup and a real Firebase sign-in),
and a real MCP client's own discovery sequence.
