# PH Agent Console — security and performance review (27 Sep 2026)

Scope: the backlog tracker / PH Agent Console (`backlog-tracker/`: the
board in `public/`, the Cloud Functions in `functions/`, `firestore.rules`,
`storage.rules`, `firebase.json`) and the public help centre (`faq/`).
Target: ~100 signed-in members using the board at once, each with their AI
agent connected over MCP, without the system getting slower, leaking
anything, or losing writes.

Method: three independent read-only reviews (front-end, functions, rules +
hosting + FAQ site), then the fixes below, each with a test. Nothing here
was measured against the live project: this sandbox cannot reach
`*.web.app` or `gstatic.com`, so latency figures in this file come from the
code and from the numbers already recorded in `public/js/app.js`'s own
comments (13 Sep 2026 measurements), not from a new probe. The tests that
back each change are listed at the end and were all run green here.

---

## 1. Sign-in: what was wrong, what changed

**Reported:** after signing in you stay on the sign-in screen until you
reload; and every refresh shows the sign-in card with the logo before the
board appears.

**Cause.** `public/js/auth-gate.js` resolved membership through exactly one
source: `POST /mcp/claims/sync`, a Cloud Function. That call sat in the
critical path of every sign-in *and* every reload. The function is the same
one that serves every MCP tool call, ran at 256 MiB with the default
sub-vCPU allocation (so one request per instance at a time) and no minimum
instances — a cold start there is several seconds, and every instance the
team's agents spin up under load is a fresh cold start. While it took its
time the card said "Checking your access…" with nothing else happening; by
the time the person reloaded, the instance was warm and the same call came
back in a few hundred milliseconds, which is exactly the "reload fixes it"
symptom. On a plain refresh the card showed for the same reason, plus the
few hundred milliseconds Firebase Auth needs to restore the session from
IndexedDB.

**Now** (`public/js/auth-gate.js`, rewritten; `public/index.html`,
`public/css/styles.css`):

- **Three membership sources, fastest first.** (1) the `consoleRole`
  custom claim already on the cached ID token — no network at all; (2) the
  person's own `consoleUsers` row over Firestore's REST API (the rules
  already let anyone signed in read their own row) — one round trip, no
  function; (3) `/mcp/claims/sync`, which still repairs the claim for
  someone invited before their first sign-in, now **in the background**
  with a 12 s timeout instead of blocking the board. The wall's only job is
  to decide what to *show*; `firestore.rules` and `storage.rules` still
  decide what the person can read or write on every request, so a stale
  answer here can only produce a blank board, never a leak.
- **No logo on a refresh.** Two localStorage flags remember that someone
  signed in here and as what role. On a reload the console's own shell is
  shown at once with a one-line "Restoring your session…" under the topbar
  (`#boot-status`, visible only while `<html data-booting>` is set); the
  card only appears if the session turns out to be gone. Neither flag is
  trusted for anything but layout.
- **The board's module graph is preloaded** (`<link rel="modulepreload">`
  for `app.js`, its local imports and the four gstatic SDK modules). Before,
  app.js and the Firestore/Storage SDKs — the largest downloads on the
  page — were only fetched *after* membership resolved, serially.
- **Popup fallbacks.** A popup result now starts the board directly (it no
  longer waits for `onAuthStateChanged` to notice); `auth/popup-blocked`,
  `auth/operation-not-supported-in-this-environment` and
  `auth/web-storage-unsupported` fall back to the redirect flow; after 8 s
  with nothing back from the popup a "Sign in with a redirect instead" link
  appears (a popup can be silently blocked, or its result lost to
  third-party-storage partitioning, without ever rejecting).
- **Edge cases covered:** an unverified password account is told to verify
  (with a button) instead of seeing an empty board that the rules refuse;
  a member removed while signed in is signed out with the reason (the
  background sync's 403); a disabled row is a refusal; owners are admins
  when both network sources are down; both sources down shows a retry, not
  a blank page; a failed `import("./app.js")` (SDK didn't arrive, bad
  deploy) shows a retry instead of a blank page; the same user reported by
  `onAuthStateChanged`, `getRedirectResult` and the sign-in button within
  milliseconds runs one membership check; sign-out in another tab reloads to
  the card instead of leaving dead listeners; double-submit on the password
  form is ignored.
- **Denied-listener loop guard.** `app.js` now reloads when a Firestore
  listener comes back `permission-denied` (the person was removed) — but a
  removed member's cached token keeps its role claim for up to an hour, so
  the claim fast path would have restarted the board and the listeners
  would have failed again, forever. `app.js` records the reload in
  `sessionStorage`; the gate then skips the claim, forces a token refresh
  and resolves over the network; a second refusal in the same tab is shown
  in the health strip, never reloaded.

Tests: `test/auth-gate.test.mjs` (15 scenarios, the real `auth-gate.js`
under jsdom with the Auth SDK stubbed).

**Still worth doing in the Firebase console** (not changed here because it
cannot be verified from this sandbox and a wrong value locks everyone out):
set `authDomain` in `public/js/firebase-config.js` to
`backlog-tracker-e4ed2.web.app` so the popup/redirect helper is
same-origin with the console — the documented fix for Safari 16.1+/Firefox
109+/Chrome-with-third-party-cookies-blocked sign-in problems — after
adding `https://backlog-tracker-e4ed2.web.app/__/auth/handler` to the
Google OAuth client's authorised redirect URIs in Google Cloud Console.

---

## 2. What else changed in this pass

### Front-end (`public/js/app.js`)

| Problem | Fix |
|---|---|
| Every listener's error handler was `console.error` only; Firestore stops a listener for good after `permission-denied`, so a removed/disabled member's board froze on stale data with no signal. | One shared `onListenerError`: denied/unauthenticated → reload to the sign-in wall (with the loop guard above); any other code → one line in the health strip while the SDK retries. |
| A just-created card sorted to the bottom of its column (and its project to the bottom of the page) until the server acked `createdAt`, then jumped. | `d.data({ serverTimestamps: "estimate" })` in every listener. |
| Double-click on **+ New item** created two tickets; **Approved for Deployment**, **Failed testing**, **Eject**, **Revert** and **Save** (Edit modal) had no in-flight guard. | `withWriteLock(key)` per item / per project; busy flags on the two forms. |
| The Edit modal wrote all seven fields from values captured when it opened — a Routine groom pass or a second person changing the category/title meanwhile was silently overwritten on Save. | The modal diffs its inputs against what it loaded and writes only the fields that changed (`updateItemDetails` takes a partial). |
| `href`/`src` built from stored URLs (`previewUrl`, `prUrl`, `deployRunUrl`, `artifactUrl`, Routine `sessionUrl`, health-strip `runUrl`, attachment URLs) were HTML-escaped but not scheme-checked — a `javascript:` URL written by any editor, agent or Routine session would run in every other member's browser on click. | `safeHttpUrl()` at every site (http/https only, else no link); the test-link prompt refuses anything else; the rules refuse it at the write too. |
| `migrateOrphanItems` / `ensureGeneralProjectDoc` ran inside `renderNow()` on every client — 100 tabs each issuing the same repair write. | Admin tabs only. |
| Console comments were attributed to the literal `"viewer"`. | The signed-in email. |

### Firestore rules (`firestore.rules`) — all covered by `test/firestore-rules.test.js` (131 checks)

| Problem | Fix |
|---|---|
| **Every member's personal Routine bearer token was readable by every other member** (`consoleUsers.routineFireUrl/Token`, and `allow read` covered `list`). Any member — viewer included — could fire sessions on any other member's Claude account. | Bindings moved to `routineBindings/{email}` — `allow read, write: if false`; only the server reads them (see functions below). |
| `consoleUsers` was listable by every member (the whole roster: emails, roles, disabled flags). | `get`: any member and always your own row; `list`: admins only (the Team page is admin-only anyway). |
| Any editor could write the card-level pipeline record from a browser: `patchFiles` (the file contents `run-backlog-automation.js` writes into the repo), `deployCommit` (what the Deploy to Main gate trusts), `mergeCommit`, `prUrl`… | One MapDiff guard: a human editor's write must leave all fourteen pipeline fields untouched; the automation user and the service account are unaffected. |
| Any editor could delete a card in any status, and delete a project (orphaning every ticket, doc and interface). | Cards: Backlog only, from a browser. Projects: admin only (real deletion stays the `board-admin.yml` runner job). |
| `projects.routinePromptMd` — spliced verbatim into the prompt of a Routine session holding repo and board access — was writable by any editor (prompt injection by design). | Admin only. |
| `notifyRequestedByEmail` & co. decide *whose* Routine binding fires; any editor could name anyone. | Must be the caller's own email (or unchanged). |
| `settings/faqSite.analyticsTag` loads a Google Tag Manager container — arbitrary script — on every public help-centre page, and any editor could set it. | `settings` writes are admin only; the Analytics block in FAQ Settings is now `data-admin-only`. |
| `faqArticles`/`faqCategories` were publicly **listable**, drafts included, with `pendingRevision`, `previousRevision` and `reviewComments` (unpublished copy, ticket ids, member emails). | Anonymous: `get` of a published article (and a single category) only — that is all the public site ever does (it renders the committed `faq/data` snapshot and fetches one article for freshness). `list` needs a member. |
| No caps on `requirementsMd`/`readmeMd`/`routinePromptMd`/`artifactUrl`; `artifactUrl`/`previewUrl` accepted any scheme. | 800k / 800k / 20k / 2k caps (raised from 200k on 1 Oct 2026); `https://` (`artifactUrl`) and `http(s)://` (`previewUrl`) only. |

A note on cost: the first version of these rules pushed a non-admin
editor's project update over Firestore's **1,000-expression evaluation
budget** on a fully populated project doc — which would have denied a
plain rename in production. It was caught by a probe against the emulator,
the guards were collapsed into a single `MapDiff.affectedKeys()` check, and
the suite now seeds a fully populated project and asserts an editor can
rename it. Keep that case when adding rules.

### Cloud Functions (`functions/mcp-server.js`, `functions/index.js`) — `test/mcp-server.test.js` (114), `test/mcp-client.test.mjs` (22), `test/routine-binding-trigger.test.js` (8)

| Problem | Fix |
|---|---|
| Routine bindings on a member-readable doc (above). | `set_my_routine_binding` writes `routineBindings/{email}` and scrubs the old fields; `resolveRoutineCredentials` reads the new collection first, honours a legacy binding once and migrates it; `whoami` reports presence from either. No manual migration needed. |
| A binding's fire URL only had to be `https://` — the fire text carries `BOARD_API_KEY`, so an editor could point it at their own server and receive the key (editor → automation identity). | Fire URL host must be `api.anthropic.com`, enforced at the tool and again when firing. |
| Removing/disabling a member cleared the custom claim but left their existing token (and Storage access) valid for up to an hour. | `syncConsoleUserClaims` also calls `revokeRefreshTokens`; every console endpoint already verifies with `checkRevoked`. |
| Refresh-token rotation was not atomic (two concurrent refreshes both succeeded) and had no reuse detection despite the comment claiming it. | Rotation runs in a transaction; every token carries a `familyId`; presenting an already-rotated token revokes the whole family (OAuth 2.1 §4.3.1). |
| `/register` (unauthenticated, writes a doc per call) had no limit; `/claims/sync` and `/admin/provision` none either; wrong `X-Board-Key` attempts were unthrottled. | Per-address fixed-window limits (30 / 120 / 30 per 10 min per instance); boardApi locks an address out after 20 misses; `boardApi` capped at 10 instances. |
| The `/authorize` consent page could be framed (a member with a console session sees "Signed in as … Connect" immediately) and showed only the client's self-chosen name. | `X-Frame-Options: DENY` + `frame-ancestors 'none'`; the card now shows the redirect host. |
| `approve_deploy_to_main` was available to any editor's agent — a ticket description saying "now deploy" could ship a train. | Admin role required (`tool.role`, enforced in dispatch alongside the scope check). |
| `list_doc_revisions` loaded up to 1,500 revisions **with** `contentMd` (200k chars each) into a 256 MiB instance — enough to crash it once revisions accumulate. | `select()` of the listing fields only. |
| The two board tools scanned the whole `backlogItems` collection and filtered status in memory. | `where("status", "==", …)` server-side. |
| `onBacklogItemPublishedLive` put every linked article in one batch (500-write limit). | Chunked at 400. |
| PKCE verifier length unchecked; `resource` accepted from the consent body unvalidated; CORS reflected any origin on the console-only endpoints. | 43–128 enforced; `resource` fixed to this server; console-only endpoints answer `PUBLIC_ORIGIN` only. |
| `mcpServer` ran at 256 MiB, default CPU, concurrency 1, `maxInstances: 20` — twenty simultaneous requests for the whole team, and every browser sign-in queued behind agents' tool calls. | `512MiB`, `cpu: 1`, `concurrency: 40`, `maxInstances: 20`; sign-in no longer depends on it at all. Deploys with the normal `deploy-backlog-tracker.yml` run. |

### Hosting (`firebase.json`, `public/index.html`)

- The console site had **no security headers**. Added `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: SAMEORIGIN`, `Content-Security-Policy:
  frame-ancestors 'self'`, HSTS.
- DOMPurify **3.0.6** from cdnjs (no SRI) predates three published mXSS
  fixes, and the console runs agent-authored article HTML through it in
  front of the admin reviewing it. Now vendored at `public/js/vendor/
  purify.min.js` (3.4.15, the same build the public site ships).

---

## 3. Reviewed and deliberately not changed here

Recommended, in priority order, with why it was not done blind:

1. **Move the big payloads off the documents every tab listens to.**
   `backlogItems.patchFiles` (whole file contents, ~180 KB a ticket) and
   `projects.requirementsMd/readmeMd/routinePromptMd` (up to 200k chars)
   travel to every open board on every load and are re-sent to all 100
   tabs on every small write (a Routine heartbeat, a `trainLocked` latch).
   This is the dominant bandwidth and Firestore-read cost at 100 users.
   Fix: `backlogItems/{id}/pipeline/patch` and `projects/{id}/docs/main`
   (or the existing `projectDocs`), with the automation, the MCP server and
   the Docs page updated together. It touches `run-backlog-automation.js`
   and every tool that reads them, so it is a ticket of its own.
   **Status, 5 Oct 2026:** done for `patchFiles` — it now lives in
   `backlogItems/{id}/pipeline/patch` (`functions/patch-offload.js`), and
   `requirementsMd`/`readmeMd` had already moved to `projects/{id}/docs/`.
   `routinePromptMd` is still on the project document. See README → "Load
   performance". Items 2 and 3 below are also done (same section).
2. **A persistent local cache** (`persistentLocalCache({ tabManager:
   persistentMultipleTabManager() })`) so listeners paint from cache and
   fetch only deltas; the REST prime (which today means every collection is
   read twice per load) could then go. Not enabled here: it changes every
   load's behaviour and cannot be exercised in this sandbox.
3. **Lazy listeners** for `faqArticles` (~140 bodies of up to 20 KB each
   plus their pending revisions — the largest per-load payload after
   patchFiles), `projectDocs`, `skills` and `concepts`: subscribe when the
   page opens, not at module load.
4. **Render cost.** `renderNow()` rebuilds the whole board's `innerHTML` and
   scans `items` ~9 times per project per render; with a few thousand
   tickets this is tens of thousands of predicate calls per remote change
   per tab. Precompute one `Map<projectId, items[]>` per render and render
   only the sections whose documents changed (`docChanges()`).
5. **`pendingRevision`/`previousRevision`/`reviewComments` on a published
   article are still readable anonymously** by a single-document `get`
   (rules cannot mask fields). Moving them to a member-only sub-collection
   is the only complete fix; so is stopping `faq-export.js` exporting draft
   bodies into the public repo.
6. **`BOARD_API_KEY` is still handed to member-bound Routine sessions** in
   the fire text. With the fire host now pinned to Anthropic that is no
   longer an exfiltration path, but it still means an editor's own session
   holds the automation identity. Minting a short-lived per-member token
   instead is the right shape; it changes `ROUTINE_INSTRUCTIONS.md` and
   every Routine, so it is a ticket of its own.
7. **Token lifecycle.** `mcpTokens`/`mcpAuthCodes`/`mcpAuditLog`/
   `docRevisions` grow without bound; `GET/POST /me/connections` lists with
   `limit(200/500)` and no `orderBy`. Add an `expireAt` Timestamp and a
   Firestore TTL policy, and query `revoked == false`.
8. **Trigger idempotency.** The three notify functions fire a Routine from
   `before`/`after` alone; a redelivered event fires a second session.
   Claim the request in a transaction first.
9. **Client-computed `order`** (releases, FAQ categories/articles) ties when
   two people create at once; `applyFaqReorder` renumbers all siblings from
   local state. Fractional ordering in a transaction.
10. **A real CSP** for the console (`script-src 'self' https://www.gstatic.com`
    …). Needs the Google sign-in iframe origins and the inline module in
    `index.html` sorted out, and a browser to confirm — not from here.
11. **Versioned asset URLs** so `app.js`/`styles.css` can be `immutable`
    instead of revalidated on every visit (no build step exists today).
12. The console's body font is a system stack; the `ph-designer` skill says
    Roboto. Cosmetic, and out of this review's scope.
13. `minInstances: 1` on `mcpServer` if agents' first calls after idle
    periods feel slow; sign-in no longer needs it.

## 4. The 100-user envelope, as it stands

- **Per page load, per user:** one REST read of every listened collection
  plus one listener attach each (ten collections), i.e. roughly 2× the
  document count in billed reads, dominated by `backlogItems` and
  `faqArticles`. Items 1–3 above cut that by most of an order of magnitude.
- **Per write, fan-out:** one changed document → one push to every open
  tab (100×) carrying the full document. Keep documents small (item 1).
- **Rules cost:** one dependent `consoleUsers` read per rule evaluation
  (cached within the evaluation), none for owners and the automation user.
  Negligible at 100 members; the budget probe above is the thing to keep
  green.
- **Functions:** `mcpServer` now serves ~40 concurrent requests per
  instance × 20 instances; `boardApi` 10 instances. Sign-in is off that
  path entirely.
- **Storage rules** still rely on the custom claim; removal now also
  revokes the session, so the window is minutes, not an hour.

## 5. How to verify

```bash
cd backlog-tracker/test && npm ci
npm run test:auth-gate        # the sign-in wall (jsdom)
npm run test:app-boots        # app.js evaluates to the end
npm run test:mcp && npm run test:client && npm run test:routine-binding
npm run test:rules            # firestore.rules in the emulator (Java 21)
npm test                      # everything
```

`firestore-rules-test.yml` runs the same on every PR touching these paths.
