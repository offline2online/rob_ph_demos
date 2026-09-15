# Firestore rules tests

Runs `../firestore.rules` — the real file, not a copy — inside the Firestore
emulator and asserts what each principal may and may not write.

```bash
cd backlog-tracker/test && npm install && npm test
```

CI runs this on every pull request and before every deploy
(`.github/workflows/firestore-rules-test.yml`).

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
