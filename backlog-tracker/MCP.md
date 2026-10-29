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

### Stop the approval prompts: set the tools to *Always allow*

Whether a tool needs approving is decided by the **Claude client**, not by
this server — the server can describe its tools but cannot force a client's
setting. Do this once, straight after connecting, so voice and text
conversations never stop to ask:

1. In Claude (claude.ai or Desktop) open **Settings → Connectors**, click
   the **PH Agent Console** connector, and open its **tool permissions**.
2. Set the connector's tools to **Always allow** (there is a per-tool choice
   and, on most clients, a group setting for the read-only tools and for the
   write tools). Set both groups: ticket writes (`create_backlog_item`,
   `add_item_comment`, the documentation tools) are what prompt in voice mode
   otherwise.
3. In Claude Code, add `mcp__ph-console` (the name you gave in
   `claude mcp add`) to `permissions.allow` in `.claude/settings.json`, or
   choose "always allow" the first time it asks.

What the server does on its side so clients can be less cautious:

- **Every tool carries MCP annotations** (`tools/list`): `readOnlyHint: true`
  on read tools (`whoami`, `list_*`, `get_*`, `search_*`), `false` on writes;
  `destructiveHint: true` only on the `delete_*` tools; `idempotentHint` on
  reads and `set_*`; `openWorldHint: false` everywhere. Clients that
  auto-approve read-only tools do so from these hints. The destructive ones
  are the only tools a client should keep asking about.
- **No repeat sign-in between conversations.** The access token lasts 1 hour
  but the client refreshes it silently with a refresh token; each refresh
  issues a new 60-day refresh token, so a connector in regular use stays
  signed in indefinitely. A person is only asked to sign in again after 60
  days unused, when an admin removes them or switches their agent off, or
  when a refresh token is replayed (a security revoke).
- **Connector-wide or organisation-wide default:** as far as we could
  establish, Claude has no setting that makes *Always allow* the default for a
  newly added custom connector — it is a per-connector choice each person makes
  after connecting (step 2). We could not verify this from the sandbox
  (no access to Claude's admin settings); if an organisation owner finds such a
  default under Organization settings → Connectors, record it here.

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
`get_backlog_item`, `get_ready_for_testing_board`,
`get_approved_for_deployment_board`, `get_project_docs`,
`list_project_documents`, `get_project_document`,
`list_doc_revisions`, `get_doc_revision`, `search_faq`, `get_faq_article`,
`list_pending_faq_revisions`, `get_faq_revision`, `list_skills`,
`get_skill`, `list_skill_misses`, `get_routine_setup_instructions`,
`list_concepts`, `get_concept`.

### Staff Kanban (the team's own task board)

The human task board at `#staff-kanban` (kanban-staff-board/REQUIREMENTS.md
→ KB-MCP-1; code in `functions/kanban.js`), separate from the Agent Board's
tickets above. Every write is attributed to the calling member and logged in
the ticket's activity; a viewer gets the read tools only. Staff can add,
move and report on tasks by talking to their agent ("add a bug for Huy:
the offer sweep ignores the store's time zone, about 4 hours, this release").

**Which board is for what.** Staff Kanban is for staff tasks only — work a
human staff member does. Agent work (agent-built product, docs, prototype
and tooling changes, including for the Staff Kanban project itself) is filed
in the agent backlog with `create_backlog_item`. Agents can still create and
assign staff tasks with `kanban_create_task`; nothing blocks that. The
delimitation is one sentence per board, so every description says the same
thing: `KANBAN_SCOPE` (`functions/kanban.js`) is appended to every `kanban_*`
tool description, including tools added later, and `BACKLOG_SCOPE`
(`functions/mcp-server.js`) is in `create_backlog_item`'s description and the
server instructions. `test/kanban-mcp.test.js` checks both.

| Read | Write (editor and admin) |
| --- | --- |
| `kanban_list_people` (members by first name, releases, sprints, current release, tester) | `kanban_create_task` (always into Backlog, next PH-n key) |
| `kanban_list_tasks` (the board's filters: assignee or `me`, release, status, type, priority, sprint, label, flagged, search) | `kanban_update_task` (any field but the column) |
| `kanban_get_task` (everything, with comments, activity, `descriptionHtml`, links in both directions and an epic's children) | `kanban_move_task` (status, plus `completed` / `withdrawn` for the last column; applies the testing hand-off) |
| `kanban_search_tickets` (number or words, best 50, server-side) | `kanban_assign_task`, `kanban_flag_task` |
| `kanban_release_report` (outstanding, remaining effort, per-person capacity) | `kanban_comment` (`mention` notifies people on the board's bell) |
| | `kanban_attach_file` (a screenshot, image or pdf as base64; see below) |

**Attaching a screenshot or file — `kanban_attach_file`** (`key`, `name`, `contentType`, `data`; optional `inline`, `caption`). `data` is the file's bytes in base64 (a `data:` prefix naming the same type is tolerated). Allowed: png, jpeg, webp and gif images, and pdf as a plain attachment, at most 5 MB decoded; anything else, an oversized file, bytes that don't match the declared type or a ticket that already has 50 attachments is refused with the reason and nothing is written. Nothing is ever fetched from a URL, so there is no server-side request to forge. The file is stored at `kanban/{PH-n}/{timestamp}-{safe name}` (images whose longest side is over 1400 px are shrunk first, as the board does for a pasted screenshot; a gif is kept as it is to keep its animation), and `{name, url, path, contentType, size}` (plus `caption`) is appended to the ticket's `attachments` with the card's `attachmentCount` in the same transaction. `kanban_get_task` lists it with its URL, and the ticket's modal shows it under Attachments. `inline: true` also adds the image to the description as an `<img>` pointing at the Storage URL (never a `data:` URI), with the caption beneath. The activity log reads "attached <name> over MCP", the call is in `mcpAuditLog`, and each member may attach 60 files an hour (`kanbanAttachLimits/{email}`, server only). Needs `board.write`; viewers are refused.

Example prompt, for an agent that has just finished a page of the project artifact: *"Screenshot the Pricing page of the finished artifact, create a Staff Kanban epic 'Pricing page' with kanban_create_task, then attach the screenshot to it with kanban_attach_file (inline, caption 'Pricing page as designed')."*

The board reads a light card per ticket (`kanbanCards/{PH-n}`, the fields a card shows); every write above puts the ticket and its card in the same batch or transaction. `kanban_list_tasks` and `kanban_release_report` read cards (a `search` reads tickets, since cards hold no description), `kanban_get_task` and `kanban_search_tickets` read the full ticket. While the cards are behind the tickets (before `POST /mcp/kanban/backfill` has run) the tools read the tickets.

Every member is on the board, including the bootstrap admins, who have no `consoleUsers` row. Anywhere a person is named (`assignee`, `reporter`) `me` means the authenticated member. An alias address (`PERSON_ALIASES` in `public/js/kanban/kanban-core.js`: `rob@personalisationhub.com` is Rob, `rob@offline2online.com`) is never listed as a person: naming it, mentioning it, or connecting an agent signed in as it all resolve to its owner.

**Reading ticket history.** `list_backlog_items` pages: it returns at most
100 tickets per call (default 25), newest-updated first and then by id, plus
`matched` (the total) and `nextCursor` — pass that back as `cursor` until it
is `null`. A ticket updated during the walk can move. A `search` also covers
archived tickets (`includeArchived`, default true when searching, false
otherwise; `status` still decides when given, and `archivedHidden` says how
many were left out) and, with `searchIn: ["notes"]`, comments; each hit then
carries `matchedIn` and a `snippet`. `truncated: true` means the 1,500-ticket
read limit was hit, so pass `projectId`. `get_backlog_item` includes
`lastFailureReason` (why it last failed testing or was ejected). Example:
`list_backlog_items({projectId: "mIPdOCAWevhrgD8g2tCZ", search: "Failed testing", searchIn: ["notes"]})`.

**What the agent is told on connect.** The server instructions (`SERVER_INSTRUCTIONS`
in `functions/mcp-server.js`) are the first text a connected agent reads. They
say what each role can do, name every `board.write` and admin tool, tell the
agent to read documents with `list_project_documents` / `get_project_document`
rather than `get_project_docs`, say which side wins for a repo-mirrored
document (the repo file; a board-only edit is lost, except for a project with
no single folder, whose Requirements and README are not synced), and say that
release actions stay on the board apart from `send_to_build`,
`approve_for_deployment`, `fail_testing` and `approve_deploy_to_main` (all admin) and
`set_my_routine_binding`. `whoami`'s note and the notes returned by
`set_project_requirements` / `set_project_readme` say the same from the
project's own fields. `test/mcp-server.test.js` keeps them in step with the
tool list: every name in them is a registered tool, every write and admin tool
is named, and the instructions stay within 3,600 characters (what Claude Code
delivers whole).

**Test and link state (server 1.5.0).** All read-only; every URL goes through
`safeHref` (https only, else `null`).

- `get_ready_for_testing_board` and `get_approved_for_deployment_board` return,
  per card, `deployCommit`, `previewState` (`"rebuilding"`, `"ready"`,
  `"stale"` or `null`), `previewSha`, `previewUpdatedAt`, `trainTest`
  (`{state, workflows:[{name, conclusion, runUrl}]}`, `null` unless it describes
  the card's current `deployCommit`), `approvedByEmail` and `approvedAt`. Their
  first text line adds counts, e.g. "3 ticket(s) waiting on review; 1 link
  rebuilding, 1 with tests running." The MCP App card shows a link pill ("Test
  link rebuilding — don't test yet", "Test link ready · build abc1234", "Test
  link may be out of date") and "Test this (previous build)" while rebuilding.
- `get_backlog_item`'s `train` block adds `previewState`, `previewSha`,
  `previewUpdatedAt`.
- `list_projects` adds per project `trainTestsRed` (workflow → `{sha, url, at}`
  or `null`; hides Deploy to Main), `trainHold` (`"tests-running"`,
  `"tests-red"` or `null`) and `trainNote`, `e2eStatus`
  (`{runAt, mode, commit, pass, fail, gap, resultsUrl}` or `null`, no
  breakdown) and `handOff` (`{heldItemIds, since, waitingOn}` from the
  `readyForTestingPending*` / `readyForTestingWaitingOn` project fields, or
  `null` when nothing is held).

**Start document and manifest fields.** `list_projects` returns
`startHereDocId` per project (`"readme"`, `"requirements"`, a document id, or
`null` when unset) and `get_project_docs`' `docsSync` returns `manifestPath`
(the repo's `board-docs.json` that declares the project's mirrored documents)
and `unlisted` (`{id, name}` of documents the manifest doesn't classify).
All are written by the post-merge sync from the repo manifest; none is
writable over MCP.

**Reading a project's documents without loading them all.**
`get_project_docs` returns the full text of every document (600 KB for a
project with 47), which a host cannot show. For anything large use the two
paging tools, scope `board.read` (viewers included), which write nothing to
`mcpAuditLog`:

- `list_project_documents({projectId, query?, offset?})` lists Requirements,
  README, every additional document and the interfaces the project shares,
  with `chars`, `updatedAt`, and for a document `sourcePath`, `sourceCommit`
  and `kind` (`"mirror"` = the next repo sync overwrites it, `"board"` = lives
  only on the board) — no text. Long lists page by `nextOffset` (a row index,
  `null` on the last page). With `query` (2–200 characters) it searches names
  and text of all of them, case-insensitively, and returns
  `{matchedTotal, matches:[{docId, docName, heading, offset, snippet}]}` — at
  most 5 per document and 50 in all.
- `get_project_document({projectId, docId, section?, offset?, maxChars?, outline?})`
  reads one: `docId` is `"requirements"`, `"readme"`, a document id or an
  interface id. It returns `content` a page at a time (`maxChars` default
  40,000, max 50,000, shortened so the whole result text stays under 60,000
  characters including JSON escaping) with `nextOffset`, plus `metadata`
  (`sourcePath`, `sourceSlices`, `sourcePrefix`, `sourceCommit`, `updatedAt`,
  `updatedByEmail`). The first page, or `outline: true`, also lists the
  headings with their offsets; `section` returns one heading's part (matched
  case-insensitively, exact then prefix) up to the next heading of the same or
  higher level, with `offset`/`nextOffset` relative to the section and
  `sectionOffset` giving where it starts.

Lengths and offsets are JavaScript string lengths (UTF-16 code units); pages
never end inside a surrogate pair and joined in order equal the stored text.

`get_ready_for_testing_board` and `get_approved_for_deployment_board` are
**composable — they are MCP Apps** (SEP-1865, the MCP UI extension
`io.modelcontextprotocol/ui`). Each tool carries `_meta.ui.resourceUri`
naming a `ui://backlog-tracker/…` resource this server serves through
`resources/list` / `resources/read` (mimeType `text/html;profile=mcp-app`,
sandbox settings under `_meta.ui`), and its result carries the column as
`structuredContent`. A host that supports MCP Apps — claude.ai and Claude
Desktop today — fetches the view, renders it in a sandboxed iframe inline
in the conversation, and pushes the tool result into it, so the column
appears as ticket cards (title, summary, type/area, test link, test
version, a link back to the ticket; train/PR context and the
deploy-readiness line for Approved for Deployment) instead of the agent
describing it in prose. Every host, including one without MCP Apps, also
gets the same data as plain text/JSON. **Claude Code does not render MCP
Apps yet**: its CLI validates and forwards the binding, and advertises the
extension only behind its own host switch, so in a Claude Code session the
tools answer as text until Anthropic switches that host on
(anthropics/claude-code#95149). Both are read-only in the fullest sense:
the view has no form and no write — its only actions are opening a link
through the host and re-running the same read-only tool to refresh — so
reviewing there is exactly as inert as reading the JSON.
`get_approved_for_deployment_board` additionally names
`approve_deploy_to_main` (see below) when a project's whole train is ready
for it. The views live in `functions/mcp-app-views.js`; the first cut of
this (PR #208, 24 Sep 2026) returned an embedded `text/html` block in the
tool result instead, which no host renders — which is why it never showed.
The column is also presented **without being asked for**: once the
pipeline has landed a build in Ready for Testing and its tests and test link have finished (40-minute limit), `notifyOnItemsReadyForTesting`
fires a Routine session that calls `get_ready_for_testing_board` (see
`ROUTINE_INSTRUCTIONS.md` → "The 'Ready for Testing' flow"). For that
session to have these tools, the Routine at claude.ai/code/routines needs
the **PH Agent Console** connector attached; without it the session
presents the same column as text.

**Try it.** Type into your agent: *"Show me what's ready for testing on
Backlog Tracker & FAQs."* In claude.ai or Claude Desktop the column renders
inline as ticket cards — title, summary, type/area, test link, test
version and a link back to the ticket. In Claude Code the same tool answers
as text until Anthropic switches on its MCP Apps host.

### Write tools

**Can — write (editor and admin only):**

| Tickets | Documentation | Help centre | Skills library | Release (admin only) | Your own routine binding |
| --- | --- | --- | --- | --- | --- |
| `create_backlog_item` (always into the Backlog column) | `set_project_requirements` | `create_faq_article` (always a draft) | `upload_skill` (slug must be unique) | `send_to_build`, `approve_for_deployment`, `fail_testing`, `approve_deploy_to_main` | `set_my_routine_binding` |
| `update_backlog_item` (title, description, type, area) | `set_project_readme` | `update_faq_article` (always a pending revision) | `update_skill` (rename/re-version/replace files) | | |
| `add_item_comment` | `set_project_artifact`, `set_project_description`, `snapshot_project_artifact` (sign-off: the next frozen, numbered artifact version) | `comment_on_faq_revision` | `delete_skill` | | |
| | `create_project_document` / `update_project_document` / `delete_project_document` | | `report_skill_miss` (tags a real gap, never edits the skill's own content) | | |
| | `create_interface` / `update_interface` / `delete_interface` (an interface joins any two projects or concepts: pass `endpoints` `[{type, id}, {type, id}]`, or `projectIds` for two projects; `update_interface` can re-point with `endpoints`) | | | | |
| | `demote_project` (project → new concept carrying its docs; re-points its interfaces; archives the project; refused with open tickets unless `acknowledgeOpenTickets`) | | `mark_skill_reviewed` (clears the review nudge and restarts the clock) | | |
| | `create_concept` / `add_concept_comment` / `set_concept_readme` / `set_concept_requirements` / `set_concept_artifact` / `set_concept_description` (Concept Incubator; the last four refused once a concept is promoted, except comments) | | | | |
| | `add_concept_critique` (a structured review of a concept: verdict, arguments for/against, assumptions, recommended changes, optional free-text `role`) | `list_concept_critiques` (also returns every role already used, to reuse) / `synthesise_concept_critiques` (agreement, disagreement, recommended adjustments; optional `role` filter) | | | |

**Setting up your own personal Notify Claude Routine** (so board clicks you
make fire a session under your own Claude account instead of the one
shared project token) is a two-call, one-manual-step flow: call
`get_routine_setup_instructions` and follow it — it walks you through
creating a Routine at claude.ai/code/routines with the exact bootstrap
prompt to use, getting its API trigger's fire URL and token, then calling
`set_my_routine_binding` with both. There's no way to automate the
claude.ai/code/routines step itself: the routines API has no delegated-OAuth
"fire on behalf of" flow, so a Routine's fire URL/token is per-Routine and
hand-generated once — this is the closest one-click setup the API allows.
`set_my_routine_binding` is **write-only**: your stored `fireUrl`/`token`
are never returned by this or any other tool — `whoami`'s
`hasRoutineBinding` only ever says whether one is set, never its value.
Pass both as `""` to clear your binding and go back to the shared token.
`functions/index.js`'s `resolveRoutineCredentials` checks the clicking
member's binding first on every Notify Claude / Notify Claude — Deploy /
Groom Backlog click, falling back to the shared `CLAUDE_ROUTINE_FIRE_URL`/
`CLAUDE_ROUTINE_TOKEN` secrets when they have none. The binding lives in
`routineBindings/{email}` (server-only: `allow read, write: if false`) and
its fire URL must be on `api.anthropic.com` — until 27 Sep 2026 it lived on
`consoleUsers`, which every member could read, and any `https://` host was
accepted (see `SECURITY-PERFORMANCE.md`).

**`approve_deploy_to_main` is a deliberate, narrowly-scoped exception to
"nothing here deploys" (below), not a loosening of it — and since 27 Sep
2026 it requires the `admin` role, not just `board.write`: an editor's
agent reading a ticket that says "now deploy" must not be able to.** It fires the exact
same trigger the console's own **Deploy to Main** button writes
(`projects/{id}.deployNotifyRequestedAt`) — it never merges anything
itself; the existing Routine still verifies the train and the existing
pipeline still does the real merge. It enforces the same condition that
shows that button in the first place — every ticket on the project's
deployment train already Approved for Deployment, and Ready for Testing
empty for that project — and refuses otherwise, naming what's blocking it,
so calling it directly can never fire a deploy the console's own button
would currently be hiding. Gated to `board.write` like every other write
tool here (never a viewer), and every call is logged to `mcpAuditLog`
under the caller's email, same as any other write.

**`send_to_build` and `approve_for_deployment` (20 Oct 2026, Rob's decision on
ticket `Ysh0yuU9z643E0uisr51`) are the same kind of exception, for the two
approvals that come before Deploy to Main, so all three can be given by voice.
Both need the `admin` role over and above `board.write` (editors and viewers
get neither), take tickets named by id — never "everything" — and refuse the
whole call, writing nothing, if any one ticket fails a guard. Every call is
logged to `mcpAuditLog` under the caller's email.**

- **`send_to_build`** (`projectId`, `itemIds`) makes the writes the board's
  **Ready for Dev** click makes: `projects/{id}.notifyRequestedAt` and
  `notifyItemIds` (plus `notifyRequestedByEmail`, so a member's own bound
  Routine fires, and `notifyRequestedVia: "mcp"`). The existing Cloud Function
  then starts one build session per ticket; the tool moves no card. It
  refuses when the project's train is locked (a release is closing — the
  board hides Ready for Dev for the same reason), or a ticket is not in this
  project's Backlog, is blocked (e.g. waiting on an answer), is already
  packaged (`patchReady`), or is already being built.
- **`approve_for_deployment`** (`projectId`, `itemIds`, optional
  `acknowledgeTests`) makes the writes the board's **Approved for
  Deployment** click makes: each ticket goes to `ready-to-publish` with
  `approvedByEmail`, `approvedAt` (and `approvedVia: "mcp"`), and the project
  gets `trainLocked: true`. It deploys nothing; `approve_deploy_to_main` still
  does that. It refuses a ticket that is not in this project's Ready for
  Testing, is marked for revert, or needs no deployment (that has its own
  confirm-tested path on the board). It also refuses a ticket whose train
  tests are not green (running, failed or not run, for the commit now on the
  train) unless `acknowledgeTests` is `true` — the agent must tell the person
  first, because an approved ticket that goes red is not sent back
  automatically.

- **`fail_testing`** (25 Oct 2026; `projectId`, `itemIds`, optional `reason`
  and `category`) is the board's **Failed testing → "Something's wrong — send
  it back"**, admin only like the two above. Each named Ready for Testing
  ticket goes to Backlog with `revertRequested: true` (the automation reverts
  its commits off the train), `lastFailureReason` `{category, text, action:
  "failed-testing", at}` and a note, and `rebuildAfterRevert: true`, so a
  rebuild is queued by itself once the revert has landed (the board button
  leaves that to a later Ready for Dev). `category` is one of the board's
  failure categories, default `Other`. It refuses the whole call if a ticket
  is not in this project's Ready for Testing or is already marked for revert,
  and logs to `mcpAuditLog` with the reason. It does not offer the dialog's
  "it works, but I want something more" choice; file that with
  `create_backlog_item`.

No MCP tool moves a card any other way, and `update_backlog_item` still has
no `status`.

**The skills library is organisation-wide, not per-project** — a shared
place to publish packaged instructions (like this repo's own `ph-designer`
front-end skill) that any team member's agent can pull in, listed in the
console under **Skills**. Unlike documentation above, `list_skills` and
`get_skill` need only `board.read`, so even a viewer's agent can read every
skill; only `upload_skill`/`update_skill`/`delete_skill` need
`board.write`, as does `mark_skill_reviewed` — it records that the owning
team has just revisited a skill, clearing its `reviewDue` nudge on
`list_skills`/`get_skill` and restarting its review clock (optionally
overriding `reviewCadenceDays` / `reviewDeployThreshold`).
`update_skill`/`delete_skill` record the file set they
replace to `docRevisions` first (`target: "skill"` / `"skill.deleted"`),
recoverable the same way as a documentation write — `list_doc_revisions`
takes an optional `skillId` filter alongside `projectId`/`docId`/
`interfaceId`. Each file is `{path, content}`; a skill holds 1–20 files,
each up to 100,000 characters (`SKILL_FILE_MAX`).

**The Concept Incubator gets the same "documentation, full read/write" tools
a project does, but no ticket-shaped tools at all.** A concept
(`concepts/{conceptId}`) is the pre-project stage — a name plus
README/Requirements/discussion — and has no `backlogItems` of its own until
someone promotes it, so there is deliberately no `list_backlog_items`- or
`create_backlog_item`-shaped tool for it. `list_concepts`/`get_concept` read
it; `add_concept_comment` posts to its discussion thread (works even after
promotion); `set_concept_artifact` sets (or clears with `null`) one https mockup/prototype link, shown as **View Artifact** on the concept's card and page; `set_concept_description` sets (or clears with `null`) its short description (up to 300 characters, like a project's; shown in the system map hover tooltip and on its tile); `set_concept_readme`/`set_concept_requirements` replace its
docs the same way `set_project_readme`/`set_project_requirements` do,
including the same `list_doc_revisions`/`get_doc_revision` recovery path
(pass `conceptId` instead of `projectId`) — except both are refused once
`status` is `"promoted"`, matching the console's own read-only view of a
promoted concept: from that point `promotedProjectId` is the real project,
and its own documentation tools are the ones to use. `create_concept` makes a new
one (a name, plus optional `readmeMd`, `requirementsMd` and a `description`
posted as its first comment), always `active`, and returns its `conceptId`
so the write tools can seed it. There is deliberately no
`promote_concept_to_project` tool — this server has no `create_project` tool
either, so promoting a concept into a project stays a board/human action.

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
  `get_project_document` (or `get_project_docs`), revise, send the complete text back. An agent that
  sends a fragment overwrites the document with that fragment.
- **Nothing is lost when that happens.** Every write records what it
  replaced, and a delete records the whole document, in `docRevisions` —
  `list_doc_revisions` then `get_doc_revision` reads it back, and restoring
  is just writing that text back. This is the only reason the two `delete_`
  tools are safe to offer at all; they are also the only tools flagged
  `destructiveHint`, so a client that asks before destructive actions will
  ask before those and not before an ordinary update.
- **Size ceilings differ, on purpose.** Requirements and README allow 800k
  characters each. They live in `projects/{id}/docs/{kind}` (one document
  per kind, so each has Firestore's 1 MiB to itself); the project doc
  carries only a pointer (`docs.<kind>`: size, hash, source commit). Project documents and interfaces allow 20k — the same ceiling
  `firestore.rules` gives the board's own editor, because a longer document
  would be one a person could never save an edit to from the Docs page.

**Where a document is copied from a repo file, the repo file wins.** A
mirror (a `projectDocs` row with `sourcePath`), a Requirements/README that
the post-merge sync writes (its `docs/{kind}` block has a `sourcePath`, or
the project's `docsSync` has a `requirementsCommit` / `readmeCommit`) and an
interface record with a `sourcePath` are read-only over MCP:
`update_project_document`, `delete_project_document`,
`set_project_requirements`, `set_project_readme`, `update_interface` and
`delete_interface` refuse them, write nothing and record no revision, and
the error names the repo file. To change one, edit the file on a branch; the
board copy follows when it merges. To retire a mirror, remove its entry from the
project's `board-docs.json` first. A project with no synced copy (Backlog Tracker &
FAQs' Requirements and README today) is written as before.

Every change to a mirror, by the sync or by a person on the Docs page, is
kept: the `onProjectDocWritten` trigger records the text it replaced in
`docRevisions` (`target` `projectDoc`, or `projectDoc.deleted`), so
`list_doc_revisions` with the `docId` finds it. Sync writes to
Requirements/README are not recorded — they reach 800k characters, which
may not fit through a trigger event.

**Cannot, deliberately, apart from the one exception above:** merge a
train, approve a ticket out of Ready for Testing, move a card's status,
write any train field (`trainReady`, `patchReady`, `mergeReady`,
`revertReady`), fire the Notify Claude Routine directly, approve or
publish an FAQ article, or trigger a campaign. **Campaign triggering stays
on the triggered Routine, and the release pipeline keeps its human gates**
— beyond the one narrow deploy trigger described above, an agent files,
reads, enriches and comments; it does not ship, and even that one trigger
only ever hands off to the same human-gated pipeline a click on the
console would. The same is true of the help centre: an agent can draft or
propose, never approve or publish — that stays a person, in FAQ
Management.

There is no tool for those and no field an existing tool could reach to get
at them, `approve_deploy_to_main` included — it writes exactly one field
(`deployNotifyRequestedAt`, plus its own provenance) via its own dedicated
code path, never through `updateProjectFields`; `send_to_build` and
`approve_for_deployment` likewise write only what the board's own buttons
write, through their own code paths. `update_backlog_item`'s
schema has no `status`. The documentation tools DO write to `projects` —
that is where `requirementsMd`, `readmeMd` and `artifactUrl` live — so "it
never touches that collection" stopped being the guarantee and had to
become an enforced one: **`updateProjectFields` is the only path to a
project write through the documentation tools, and refuses any field not
on `PROJECT_WRITABLE_FIELDS`**, which holds documentation fields and
nothing else — `deployNotifyRequestedAt` is deliberately not on it, and
never will be, since `approve_deploy_to_main` doesn't need it to be.
`test/mcp-server.test.js` asserts the allowlist's contents, that the guard
throws on a train field, that no documentation tool's schema can even
express one, that a full pass of the documentation tools leaves the
project's own `deployBranch` untouched, and — separately — that
`approve_deploy_to_main`, `send_to_build` and `approve_for_deployment` are the
only `board.write` tools whose names may mention deploying, merging,
approving or building at all, and that all three are admin-only.

Every write records the person's email on the document (`createdByEmail`,
`updatedByEmail`, and the comment's own `author`) and appends a row to
`mcpAuditLog`, which admins can read.

---

## The `project_handover` prompt

`prompts/list` offers one prompt, **Project handover**, with one required
argument, `project` (a project id or name; case-insensitive; a unique prefix
is enough). `prompts/get` returns one user message: a reading plan built on
the server, at most 20,000 characters — the project's name, description,
deploy branch and ticket counts (archived left out); the start-here document
to read first (`startHereDocId`, or the README when the project declares
none); every project document by name and id, start-here first, with
"mirror of <sourcePath>" on mirrors; its interfaces; the Requirements outline
(level 1–2 headings, at most 60); and a closing instruction to read the
start-here document, then the documents it lists, then summarise the project.
Errors are JSON-RPC `-32602`: unknown prompt, missing `project`, no match, or
more than one (the message lists up to 20 names).

**A person starts it, not the agent.** In Claude Code it is the slash command
`/mcp__<connection name>__project_handover`; Claude Desktop and claude.ai
list it as a prompt to attach. An agent never calls `prompts/get` by itself,
which is why the server instructions also say to read a project's start-here
document first. Prompts are read-only and work for every role, viewer
included; nothing is written, not even to `mcpAuditLog`.

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
- `POST /mcp/claims/sync`, which `auth-gate.js` calls **in the background**
  after every sign-in (since 27 Sep 2026 — it used to block the board, and
  a cold start of this function was the "signed in but stuck until I
  reload" report; see `SECURITY-PERFORMANCE.md`). It repairs the claim for
  someone added before they had an Auth account at all, then the wall
  force-refreshes their ID token so Storage sees it at once. The wall
  itself decides from the cached `consoleRole` claim first, then the
  person's own `consoleUsers` row over REST.

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
| `public/js/auth-gate.js` | the console's own sign-in wall — claim-first, own-row fallback, claim sync in the background, password sign-in (`test/auth-gate.test.mjs`) |
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

## Blocked flag and phase skill bindings

- `set_blocked` / `clear_blocked` (editor): flag a Backlog ticket as `needs-decision` or `waiting-on-input` with a one-line note. Blocked tickets are skipped by Notify Claude and the build routine, show a flag on the card, and are counted as "need your decision" in the Backlog column header. The flag clears when it is cleared from the card, or when anyone other than whoever set it comments on the ticket. Pipeline status is never touched.
- `set_phase_skill_bindings` (admin): add/remove skill slugs bound to the `build` or `deploy` phase in `settings/phaseSkillBindings` (the doc's Firestore rules are admin-only because it feeds the Routine's prompt).

## Artifact snapshots on sign-off (PH-20)

`snapshot_project_artifact` (editor; `projectId`, optional `note`) signs off
a project's artifact: it captures the next numbered version of the link set
with `set_project_artifact`. `list_artifact_versions` and
`get_artifact_version` read them (any member, viewers included), and
`list_projects` shows `latestArtifactVersion`. Epics, screenshots and
descriptions should cite the version, so a ticket does not drift when the
prototype changes later.

- **What is frozen.** A GitHub Pages artifact of this repo
  (`offline2online.github.io/rob_ph_demos/<path>`) is pinned to the commit
  `main` is on at sign-off, as
  `https://rawcdn.githack.com/offline2online/rob_ph_demos/<sha>/<path>` — an
  immutable, commit-sha link (CLAUDE.md → test links). Any other URL cannot
  be frozen: `pinnedUrl` is the same link, `frozen` is `false`, and the reply
  carries a warning saying so.
- **Where it lives.** Append-only documents at
  `projects/{id}/artifactVersions/{n}` — `{version, projectId, sourceUrl,
  pinnedUrl, commitSha, frozen, signedOffBy, signedOffAt, note}`. They are
  written only by the MCP server's admin SDK: `firestore.rules` lets members
  read and nobody write from a browser, and the board reads the latest of each
  project with one collection-group listener for its ⋮ menu's
  "v<n>, signed off <date>" line.
- **Project writes.** The tool writes no project field, so
  `PROJECT_WRITABLE_FIELDS` is unchanged (`docs`, `artifactUrl`,
  `artifactUpdatedAt`, `description`); `test/mcp-server.test.js` asserts it.
