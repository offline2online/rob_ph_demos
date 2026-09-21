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
`get_backlog_item`, `get_project_docs`, `list_doc_revisions`,
`get_doc_revision`, `search_faq`, `get_faq_article`,
`list_pending_faq_revisions`, `get_faq_revision`, `list_skills`,
`get_skill`.

**Can — write (editor and admin only):**

| Tickets | Documentation | Help centre | Skills library |
| --- | --- | --- | --- |
| `create_backlog_item` (always into the Backlog column) | `set_project_requirements` | `create_faq_article` (always a draft) | `upload_skill` (slug must be unique) |
| `update_backlog_item` (title, description, type, area) | `set_project_readme` | `update_faq_article` (always a pending revision) | `update_skill` (rename/re-version/replace files) |
| `add_item_comment` | `set_project_artifact` | `comment_on_faq_revision` | `delete_skill` |
| | `create_project_document` / `update_project_document` / `delete_project_document` | | |
| | `create_interface` / `update_interface` / `delete_interface` | | |

**The skills library is organisation-wide, not per-project** — a shared
place to publish packaged instructions (like this repo's own `ph-designer`
front-end skill) that any team member's agent can pull in, listed in the
console under **Skills**. Unlike documentation above, `list_skills` and
`get_skill` need only `board.read`, so even a viewer's agent can read every
skill; only `upload_skill`/`update_skill`/`delete_skill` need
`board.write`. `update_skill`/`delete_skill` record the file set they
replace to `docRevisions` first (`target: "skill"` / `"skill.deleted"`),
recoverable the same way as a documentation write — `list_doc_revisions`
takes an optional `skillId` filter alongside `projectId`/`docId`/
`interfaceId`. Each file is `{path, content}`; a skill holds 1–20 files,
each up to 100,000 characters (`SKILL_FILE_MAX`).

**The help centre tools never publish anything.** `create_faq_article`
always writes `status: "draft"`; `update_faq_article` always writes a
`pendingRevision` + `needsReview: true` and never touches the live article
fields — it's the exact same review mechanism the Deploy flow's own "FAQ
impact review" already uses (see `ROUTINE_INSTRUCTIONS.md` and
`REQUIREMENTS.md` → "FAQ revision review"), just with the caller's own email
as `proposedBy` (plus `proposedVia: "mcp"` so FAQ Management can tell it
apart from the Routine's `"claude"`) and no `sourceItemIds`, since no
backlog ticket triggered it — approving it in FAQ Management is enough on
its own, and the next hourly `faq-content.yml` export publishes it. A
person still does that approving, in the console; no MCP tool can.

**Documentation is meant to be kept current by whoever is doing the work,
including an agent** — that is why these are full read/write, gated by the
same per-person OAuth session as everything else. No separate token, no
shared key, and every write is attributed to the person the agent is acting
for.

Three things worth knowing before pointing an agent at them:

- **Writes replace the whole document.** Read it first with
  `get_project_docs`, revise, send the complete text back. An agent that
  sends a fragment overwrites the document with that fragment.
- **Nothing is lost when that happens.** Every write records what it
  replaced, and a delete records the whole document, in `docRevisions` —
  `list_doc_revisions` then `get_doc_revision` reads it back, and restoring
  is just writing that text back. This is the only reason the two `delete_`
  tools are safe to offer at all; they are also the only tools flagged
  `destructiveHint`, so a client that asks before destructive actions will
  ask before those and not before an ordinary update.
- **Size ceilings differ, on purpose.** Requirements and README allow 200k
  characters (they live on the project doc, which shares Firestore's 1 MiB
  limit). Project documents and interfaces allow 20k — the same ceiling
  `firestore.rules` gives the board's own editor, because a longer document
  would be one a person could never save an edit to from the Docs page.

Where a project's documentation also exists as a repo file
(`REQUIREMENTS.md`, `README.md`, `shared/interface-contract.md`), the two
are meant to match. Update both; a divergence is a bug in whichever is
stale.

**Cannot, deliberately:** deploy, merge a train, approve a ticket out of
Ready for Testing, move a card's status, write any train field
(`trainReady`, `patchReady`, `mergeReady`, `revertReady`), fire the Notify
Claude Routine, approve or publish an FAQ article, or trigger a campaign.
**Campaign triggering stays on the triggered Routine, and the release
pipeline keeps its human gates** — an agent files, reads, enriches and
comments; it does not ship. The same is true of the help centre: an agent
can draft or propose, never approve or publish — that stays a person,
in FAQ Management.

There is no tool for those and no field an existing tool could reach to get
at them. `update_backlog_item`'s schema has no `status`. The documentation
tools DO write to `projects` — that is where `requirementsMd`, `readmeMd`
and `artifactUrl` live — so "it never touches that collection" stopped being
the guarantee and had to become an enforced one: **`updateProjectFields` is
the only path to a project write and refuses any field not on
`PROJECT_WRITABLE_FIELDS`**, which holds documentation fields and nothing
else. `test/mcp-server.test.js` asserts the allowlist's contents, that the
guard throws on a train field, that no documentation tool's schema can even
express one, and that a full pass of the documentation tools leaves the
project's own `deployBranch` untouched.

Every write records the person's email on the document (`createdByEmail`,
`updatedByEmail`, and the comment's own `author`) and appends a row to
`mcpAuditLog`, which admins can read.

---

## How it appears in a client

`initialize` answers with the server's identity, so a client shows the
Personalisation Hub mark and a readable name rather than a placeholder and a
slug:

```json
"serverInfo": {
  "name": "ph-agent-console",
  "title": "PH Agent Console",
  "version": "1.1.0",
  "websiteUrl": "https://backlog-tracker-e4ed2.web.app",
  "icons": [
    { "src": ".../img/ph-mark.svg", "mimeType": "image/svg+xml", "sizes": ["any"] },
    { "src": ".../img/ph-mark-512.png", "mimeType": "image/png", "sizes": ["512x512"] }
  ]
}
```

The mark is `public/img/ph-mark.svg` — the four bars from
`ph-agent-console-logo.svg`, lifted out of the wordmark and normalised to a
square viewBox, with PNGs rendered from it for clients that won't draw SVG.
Its centre is transparent rather than white, so it reads on a dark UI as well
as a light one. The same files are the console's favicon and the consent
page's, which is what a client falls back to if it ignores `icons`.

**A client reads `serverInfo` once, at connect.** After this ships, an
already-connected client keeps showing whatever it cached — reconnect it (or
restart the client) to pick the icon up. No re-authentication needed; the
token is unaffected.

If the logo ever changes, re-extract the mark from the wordmark rather than
re-keying the colours by eye, and re-render the PNGs from the SVG.

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
| `test/mcp-server.test.js` | in-process test of the whole flow, no emulator needed (`npm run test:mcp` in `test/`) |
| `test/mcp-client.test.mjs` | the real MCP client SDK against the real server over HTTP (`npm run test:client`) |
| `test/mcp-live-server.js` | serves the real server on localhost for that test |
| `test/mcp-stubs.js` | in-memory Firebase SDKs both tests use |
| `public/img/ph-mark.*` | the PH mark on its own — the server's icon and the console's favicon |

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

Two suites, neither needing the emulator, credentials or network access:

```bash
cd backlog-tracker/test && npm install
npm run test:mcp      # in-process: the logic
npm run test:client   # over HTTP: a real MCP client
```

- **`mcp-server.test.js`** calls the request handler directly and drives
  registration → sign-in → PKCE exchange → `initialize` → `tools/list` →
  `tools/call`, plus every refusal that matters (wrong verifier, replayed
  code, unregistered redirect, unknown member, viewer write, revoked access).
- **`mcp-client.test.mjs`** points the real `@modelcontextprotocol/sdk`
  client at the real server running on localhost (`mcp-live-server.js`). The
  SDK does its own discovery, dynamic registration, PKCE and token handling —
  none of it simulated — so this is what catches a metadata document a real
  client won't accept, a redirect it won't follow, or a transport detail
  (405 on `GET`, 202 on a notification, the `WWW-Authenticate` hint) that an
  in-process test would never reach.

Between them the only untested step is the human's click on the consent page,
which both suites script by POSTing the signed-in Firebase ID token to
`/mcp/authorize/complete` exactly as that page's own JavaScript does. **What
to check on the real deployment:** a real Google popup and a real Firebase
sign-in on `/mcp/authorize`.
