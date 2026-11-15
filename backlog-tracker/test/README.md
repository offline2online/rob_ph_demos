# Firestore rules tests

Runs `../firestore.rules` — the real file, not a copy — inside the Firestore
emulator and asserts what each principal may and may not write.

```bash
cd backlog-tracker/test && npm install && npm test
```

CI runs this on every pull request and before every deploy
(`.github/workflows/firestore-rules-test.yml`).

This directory also holds the MCP server suite (`mcp-server.test.js`,
`mcp-client.test.mjs` — see `../MCP.md`) and the deployment train's
suite (`npm run test:train-lock`): the lock-recompute tests
(`train-lock.test.js`, `train-lock-trigger.test.js`,
`train-lock-branch-archive.test.js` — see `../README.md` → "trainLocked
clearing isn't only a successful-merge thing any more") and
`train-carried.test.js`, which pins the rule that a card whose content a
sibling's commit delivered rides on that commit and goes live only when
its train merges — never `noDeploymentRequired`, never live on approval
(see `../REQUIREMENTS.md` → "A card carried by a sibling's commit follows
that train"). All of these run on plain `node`, no emulator, no Java, no
credentials, no network (the two git-backed ones build a disposable local
repo pair under the OS temp dir) — only this file's own rules suite below
needs the emulator.

`auth-gate.test.mjs` (`npm run test:auth-gate`, also on every PR touching
`backlog-tracker/public/**`) is the sign-in wall's decision logic as a
test: the real `public/js/auth-gate.js` under jsdom with the Firebase Auth
SDK stubbed and `fetch` scripted — claim-first start, own-row fallback,
refusals, the background claim sync, popup fallbacks, and the guard that
stops a denied listener becoming a reload loop. Added 27 Sep 2026 with the
rewrite that stopped sign-in waiting on a Cloud Function cold start (see
`../SECURITY-PERFORMANCE.md`). `routine-binding-trigger.test.js`
(`npm run test:routine-binding`) covers the server-only `routineBindings`
lookup in `functions/index.js` from the same day.

`ui/ticket-detail-overflow.test.mjs` (also run by `npm run test:ui`) opens a
ticket with a very long description, 24 long-URL comments, code and
attachments in the Edit item and Comments modals at 390, 820, 1180 and 1440 px
and fails on any horizontal overflow (page, panel, inner lists, or an element
past the viewport edge).

`ui/console-click.test.mjs` (`npm run test:ui`, also the last step of
`test:app-boots`, so it runs on every PR touching `backlog-tracker/public/**`
or `backlog-tracker/test/**` and on every backlog-tracker train push) is the
console **clicked through in Chromium**. jsdom does no layout or hit-testing,
so a button hidden under a modal backdrop still "clicks" there (the FAQ Save
that did nothing until the second click, `YMgx4isCGjfPyj1RaYCq`); Playwright's
click only succeeds when the element is visible and really receives the event.
It needs a Chromium: a cloud session has one (`/opt/pw-browsers`), or set
`PLAYWRIGHT_CHROMIUM`. No credentials, no network.

- `ui/harness.mjs` serves the real, unchanged `public/` over a local static
  server and launches Chromium. `page.route()` answers the four
  `www.gstatic.com/firebasejs/10.13.2/` modules from the stub, Quill 1.3.7 from
  the `quill` dev dependency, Google Fonts with empty CSS and `/mcp/*`
  locally; `firestore.googleapis.com` is refused, so `app.js`'s REST prime
  falls back to the listeners. **A run fails** on a page error, a console error
  (other than that refused prime) or a request to any host that is neither
  local nor routed — the message names the URL or error.
- `ui/firebase-stub.mjs` is one module served at all four SDK URLs: an
  in-memory Firestore (collections, docs, `query`/`where` (`==`, `!=`)/`orderBy`,
  `onSnapshot`, `getDoc(s)`, `addDoc`, `setDoc` with merge, `updateDoc`,
  `deleteDoc`, `writeBatch`, `serverTimestamp`, `arrayUnion`, `deleteField`) and
  an Auth that signs in the seeded user with a `consoleRole` claim. It records
  every write in `window.__fbStub.writes`. Anything it does not implement
  throws `firebase-stub: <name> not implemented` — never a silent no-op.
- `ui/console-click.test.mjs` runs the self-checks first (the stub exports
  every name `app.js` and `auth-gate.js` import from gstatic, parsed from their
  import lists; an unrouted host fails the run; an unimplemented stub function
  throws its name), then every scenario at 1280 px and 390 px, one `PASS` or
  `FAIL` line each. A failure prints the scenario, width, step and selector,
  any page errors and the recorded writes, and saves a screenshot to
  `ui/out/` (gitignored).

**Adding a scenario**: add an object to `scenarios` in
`ui/console-click.test.mjs` — a `name`, a `seed()` (the collections the page
starts with, in their real shapes; `only("r1")` keeps just the cards you name)
and an async `run(c)` that drives the page with `c.click`, `c.visible`,
`c.waitText`, `c.waitWrites` and asserts on `c.writes()`. Every wait is a
condition with a timeout; never add a fixed sleep. **A ticket that changes
console UI adds or updates a scenario here** — if it adds a Firebase SDK call
the stub lacks, implement it in `firebase-stub.mjs`.

`ui/staff-kanban.test.mjs` (the last file of `npm run test:ui`) is the Staff
Kanban test plan against the real console, every case in every profile of the
viewport matrix, four profiles at a time (`kanban-staff-board/docs/E2E-TEST-PLAN.md`
has the cases and the `KB_*` switches). Two rules keep it reliable on a shared
runner, both learned on 12 Nov 2026 when three runs failed on three different
cases with nothing in the board changed:

- **Wait on the condition, never for a time.** The board redraws on the next
  animation frame (or a 100 ms timer) and CSS transitions only advance when a
  frame is drawn; a busy runner can hold a frame back longer than any sleep.
  Wrap what you are about to assert in `eventually(...)` (it repeats the
  assertion and, when time runs out, throws the assertion's own message) or
  `until(...)`. TC-18 measured a column 250 ms into a 200 ms transition that
  had not finished.
- **Never compare milliseconds with a fixed limit.** KB-SCALE times the 2,000
  and 5,000-ticket boards beside the 39-ticket board on the same runner and
  limits the ratio (`SCALE` in the file), and counts the cards and elements a
  redraw makes. It prints the milliseconds, so a trend is still visible.

A case that passes only on its retry is printed as `FLAKY`: treat that as a
defect in the case and fix it the same way.

## Flaky tests

UI (Playwright) cases get **one retry inside the run**; nothing else retries.

- `ui/flaky.mjs` has the wrapper (`retryCase`) and the recorder
  (`recordFlaky`). `ui/console-click.test.mjs` retries a failed scenario on a
  fresh page; the Staff Kanban suites retry a failed case in a fresh context;
  every other UI file is run through `ui/run-ui.mjs`, which runs a failed
  file once more. That is what the `test:ui:*` and `test:mcp-app` scripts
  call. `UI_RETRIES=0` (and `KB_RETRIES=0`) turns the retry off.
- A pass on the retry prints `# FLAKY <case>` and appends one line to
  `flaky-tests.jsonl` (`FLAKY_TESTS_FILE`). `npm run test:flaky-report`
  writes `flaky-tests.json` and the job summary line; CI uploads it as the
  `flaky-tests-<job>` artifact. Both files are git-ignored.
- The backlog automation adds each run's flakes to the board
  (`settings/flakyTests`, `scripts/flaky-ledger.js`); the console's health
  strip shows "Flaky tests: N this week"; three flakes of one case in 7 days
  file one "Flaky test: <case>" bug.
- `ui/harness.mjs` waits for the console to have started (`appRendered`)
  before `open()` returns, so a case's first selector never races the
  sign-in stub and `app.js`.
- To check a case you fixed, run it repeatedly with the retry off, e.g.
  `for i in $(seq 20); do KB_RETRIES=0 KB_ONLY=TC-55 node ui/staff-kanban.test.mjs || break; done`
  or `UI_RETRIES=0 SCENARIO="Modals" node ui/console-click.test.mjs`.
- Tests: `ui-retry.test.mjs` (the wrapper, the report, and that no non-UI
  test retries), `flaky-ledger.test.js` (the ledger and the ticket at three),
  `train-housekeeping.test.js` (`train-base/*` pruning; held pull-request
  runs are not the gate).

CI runs the console tests as five parallel jobs (`rules`, `offline`,
`ui-console`, `ui-touch`, `ui-kanban`), each with a timeout; locally
`npm run test:offline` still runs everything but the emulator in one go.
`ci-coverage.test.js` fails when a test file is run by two jobs or a job has
no `timeout-minutes`.

`app-boots.test.mjs` (`npm run test:app-boots`, also on every PR touching
`backlog-tracker/public/**`) is the console's start-up as a test: it
imports the real `public/js/app.js` under jsdom with the Firebase SDK
stubbed and fails if module evaluation stops early, then opens the
hamburger drawer and clicks every item in it. Added after 25 Sep 2026,
when a `createDictationController()` call placed above
`SpeechRecognitionCtor`'s `const` threw at start-up, every handler
registered after it never ran, and the menu was dead on every device while
the board still rendered — nothing in the pipeline had ever executed
`app.js`. It needs only `node` and the `jsdom` dev dependency.

Also here, needing a Chromium on the machine:
`npm run test:editor` (`faq-editor-load.test.mjs`) opens every article in
`faq/data/articles/` in the console's real FAQ editor code against the
real quill@1.3.7 build and fails if a word, list item, table, callout,
code block or heading doesn't survive the load or the first keystroke —
the class of bug that emptied seven articles' Steps lists on 2026-09-17.
It runs in CI inside `test:mcp-app`, which already launches Chrome. Set
`PLAYWRIGHT_CHROMIUM=/path/to/chrome` if playwright-core can't find a
browser itself. If an exported article stops surviving a load, the log
line `FAIL <id> — <title>` names it: fix the article or the editor.

## Which CI step runs each test

`.github/workflows/firestore-rules-test.yml` runs nine npm scripts, and
`npm test` runs the same nine in the same order. `ci-coverage.test.js`
(inside `test:train-lock`) fails if any `*.test.js` / `*.test.mjs` here is
not reached from them, naming the file; fix it by adding `node <file>` to
one of the scripts below, or list it in `EXCLUDED` with a reason.

| CI step | Script | Test files |
| --- | --- | --- |
| Run MCP server tests | `test:mcp` | mcp-server, intake |
| Run MCP client integration test | `test:client` | mcp-client |
| Run MCP App view test (job `ui-console`) | `test:mcp-app` | mcp-app-view, faq-editor-load |
| Run console start-up smoke test (job `offline`) | `test:app-boots:unit` | app-boots, header-phase, build-batches, ticket-intake (`test:build-batches`), follow-up (Failed testing's two outcomes), ui-retry. Locally `test:app-boots` runs these and then `test:ui` |
| Run console click-through suites (job `ui-console`) | `test:ui:console` | mobile-shell, mobile-theme, console-click, ticket-detail-overflow, apple-redesign, leads-apple, support-inbox |
| Run touch and small UI suites (job `ui-touch`) | `test:ui:touch` | support-touch, nav-rotation, nav-touch, stale-page, page-load-error, new-item-voice, avatars, whiteboard, whiteboard-tablet, media-keys |
| Run Staff Kanban console suite (job `ui-kanban`) | `test:ui:kanban` | staff-kanban, minified |
| Run sign-in wall tests | `test:auth-gate` | auth-gate |
| Run Routine binding tests | `test:routine-binding` | routine-binding-trigger, skill-history-trigger (`test:skill-history`) |
| Run Ready for Testing hand-off tests | `test:ready-for-testing` | ready-for-testing-trigger, notify-fanout |
| Run deployment train tests | `test:train-lock` | notes-append (notes only ever appended via `:commit`), train-lock, train-lock-trigger, train-lock-branch-archive, train-carried, train-sync, docs-sync, migrate-project-docs, train-checks, train-tests, parallel-builds, train-follow-up, patch-offload, train-resume, deploy-heal, generated-builds, patch-paths, preview-url-page, preview-url-pin, faq-index, e2e-run, ci-coverage, push-workflow-guard |
| Run rules tests against the emulator | `test:rules` | firestore-rules, notes-append-emulator (`notesCommitWrite` against real Firestore) |

## Why this exists

The deployment train shipped with a rules bug that took the Deploy to Main
button out of service entirely: every train field was guarded as "unchanged
unless the writer bypasses rules", on the assumption that all train writes
come from `run-backlog-automation.js` through the Firebase service account.

They don't. `trainReady` — the single signal that starts a deploy — is
written by the Notify Claude Routine, which signs in as the board automation
*user* over Identity Toolkit (`ROUTINE_INSTRUCTIONS.md` → "Board access")
and is an ordinary signed-in account the rules very much apply to. So the
Routine got `PERMISSION_DENIED`, nothing was dispatched, and cards sat in
Approved for Deployment while the button spun and reverted.

Nothing caught it: the pipeline's own end-to-end harness stubs Firestore, so
it validates every stage against a database that permits everything. Rules
were the one part shipped on reasoning alone, and the reasoning was wrong.

**The three principals, which is the distinction the rules turn on:**

| principal | how it authenticates | rules apply? |
|---|---|---|
| `run-backlog-automation.js` | Firebase service account | no — bypasses entirely |
| Notify Claude Routine | `board-automation@…` user, Identity Toolkit | **yes** |
| a person on the board | their own Google account | **yes** |

Only the first bypasses rules. Tests that matter most are the ones asserting
the second can do its job while the third cannot.
