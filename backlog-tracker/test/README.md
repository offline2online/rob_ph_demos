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
| Run MCP App view test | `test:mcp-app` | mcp-app-view, faq-editor-load (`test:editor`) |
| Run console start-up smoke test | `test:app-boots` | app-boots, header-phase, build-batches, ticket-intake (`test:build-batches`), follow-up (Failed testing's two outcomes), then the Chromium click-through suite (`test:ui`) |
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
