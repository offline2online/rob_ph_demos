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
lock-recompute suite (`train-lock.test.js`, `train-lock-trigger.test.js`,
`train-lock-branch-archive.test.js` — `npm run test:train-lock`; see
`../README.md` → "trainLocked clearing isn't only a successful-merge thing
any more"). All three run on plain `node`, no emulator, no Java, no
credentials, no network — only this file's own rules suite below needs the
emulator.

Also here, opt-in because it needs a Chromium on the machine:
`npm run test:editor` (`faq-editor-load.test.mjs`) opens every article in
`faq/data/articles/` in the console's real FAQ editor code against the
real quill@1.3.7 build and fails if a word, list item, table, callout,
code block or heading doesn't survive the load or the first keystroke —
the class of bug that emptied seven articles' Steps lists on 2026-09-17.
Set `PLAYWRIGHT_CHROMIUM=/path/to/chrome` if playwright-core can't find
a browser itself.

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
