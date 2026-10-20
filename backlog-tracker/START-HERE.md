# Start here — Backlog Tracker & FAQs

This is the index of every operating document for the PH Agent Console
(the Prototype Backlog board, its MCP server, the deployment train) and the
Help Centre. It is mirrored to this project's documents on the console as
"0 — Start here: reading order, ticket flow and deploy map", so a person or
an agent opening the project sees it first.

**The repo wins.** Each document below marked *copy* is rewritten from its
repo file, so edit the file in `offline2online/rob_ph_demos`, never the
board copy: the next rewrite overwrites it. Which files are copied, how they
are cut and what they are called is declared in
`backlog-tracker/board-docs.json` and checked by
`backlog-tracker/test/bt-handover-docs.test.js`.

The board holds at most 20,000 characters per document, so a longer file
is copied in parts, cut at its headings. A part's name says which part it is.

## Reading order

The documents on the console, in the order they list:

- **0 — Start here: reading order, ticket flow and deploy map** — this file.
- **1 — Project rules, CLAUDE.md** — *copy, 5 parts* · `CLAUDE.md`
- **2 — Console MCP guide** — *copy, 4 parts* · `backlog-tracker/MCP.md`
- **3 — Help Centre (faq/): how it works and how it is edited** — *copy* ·
  `faq/README.md`
- **4 — Documentation standard** — *copy, 2 parts* · `docs/CONTRIBUTING-docs.md`
- **5 — Console security and performance review** — *copy, 2 parts* ·
  `backlog-tracker/SECURITY-PERFORMANCE.md`
- The project's **README** and **Requirements** blocks, which sit beside the
  documents: `backlog-tracker/README.md` and `backlog-tracker/REQUIREMENTS.md`.

Every copy, by the exact name the console lists it under:

- 0 — Start here: reading order, ticket flow and deploy map · `backlog-tracker/START-HERE.md`
- 1 — Project rules, CLAUDE.md (1/5): site, WordPress MCP, deploys, help centre · `CLAUDE.md`
- 1 — Project rules, CLAUDE.md (2/5): two projects, one repo; board basics · `CLAUDE.md`
- 1 — Project rules, CLAUDE.md (3/5): linking projects, the train, board access · `CLAUDE.md`
- 1 — Project rules, CLAUDE.md (4/5): MCP server, project header, Docs page, archive · `CLAUDE.md`
- 1 — Project rules, CLAUDE.md (5/5): iframed prototypes, ph-designer, docs in step, secrets · `CLAUDE.md`
- 2 — Console MCP guide (1/4): connect an agent, add a member · `backlog-tracker/MCP.md`
- 2 — Console MCP guide (2/4): what the agent can and can't do (read tools) · `backlog-tracker/MCP.md`
- 2 — Console MCP guide (3/4): write tools and what the agent can't do · `backlog-tracker/MCP.md`
- 2 — Console MCP guide (4/4): client view, authentication, files, deploy, tests · `backlog-tracker/MCP.md`
- 3 — Help Centre (faq/): how it works and how it is edited · `faq/README.md`
- 4 — Documentation standard (1/2): principles, types, repository rules, FAQ standard · `docs/CONTRIBUTING-docs.md`
- 4 — Documentation standard (2/2): user guides, accessibility, templates, checklist · `docs/CONTRIBUTING-docs.md`
- 5 — Console security and performance review (1/2): sign-in and what changed · `backlog-tracker/SECURITY-PERFORMANCE.md`
- 5 — Console security and performance review (2/2): not changed here, the 100-user envelope, how to verify · `backlog-tracker/SECURITY-PERFORMANCE.md`

Where to begin, by role:

- **Anyone new**: this file, then the Requirements block for what the
  console is for, then the README's "Deployment" section.
- **Connecting an agent over MCP**: "2 — Console MCP guide (1/4)" to connect,
  then "(2/4)" and "(3/4)" for what the agent can and can't do.
- **Writing or editing help-centre articles**: "3 — Help Centre (faq/)",
  then "4 — Documentation standard (1/2)" before writing a word. Classify
  every article's `docType` as that standard says.
- **Changing sign-in, rules or the MCP server**: "5 — Console security and
  performance review (1/2)" and "(2/2)", then "2 — Console MCP guide (4/4)"
  for how authentication works. Read them before touching
  `backlog-tracker/public/js/auth-gate.js`, `backlog-tracker/firestore.rules`
  or `backlog-tracker/functions/mcp-server.js`.
- **Building tickets or changing the pipeline**: the ticket flow below, then
  "1 — Project rules, CLAUDE.md (3/5)" (the train) and "(4/5)" (the MCP
  server and the board's screens).

## The ticket flow

One line per step, with the file and function that owns it. Functions are in
`backlog-tracker/scripts/run-backlog-automation.js` (the automation, run by
`backlog-automation.yml`) or `backlog-tracker/functions/index.js` (Cloud
Functions) unless a file is named.

1. **Intake**: a new card is checked for Outcome, Test steps, Dependencies
   and Spec reference. `onBacklogItemIntake()` in `backlog-tracker/functions/index.js`,
   rule in `backlog-tracker/functions/intake.js`; the same rule runs in the
   browser from `backlog-tracker/public/js/ticket-intake.js`.
2. **Ready for Dev**: a person clicks it and `notifyOnProjectReadyForReview()`
   fires the Routine.
3. **One Routine session per ticket** reads the code and builds the change,
   following `backlog-tracker/ROUTINE_INSTRUCTIONS.md`.
4. **Patch hand-off**: the session writes `patchFiles` and sets `patchReady`.
   A patch over about 700 KB goes in `patchParts`,
   read by `backlog-tracker/scripts/run-backlog-automation.js`; the files
   leave the card itself via `backlog-tracker/functions/patch-offload.js`.
   The session never pushes.
5. **Train commit**: `processApplyPatch()` lands it as one commit on the
   project's `deploy/<folder>` branch, after `syncTrainWithMain()` brings
   the branch up to date with main and `rebasePatchFilesOnto()` carries the
   patch onto the synced files by a three-way merge.
6. **Train tests**: `trainTestsFor()` picks the workflows for the paths the
   train changed. When one is red, `trainTestsRed()` reads it and
   `ejectRedCulprits()` re-runs the failed run once and, only if it fails
   again, sends the ticket that broke it back to Backlog.
7. **Ready for Testing**: `notifyOnItemsReadyForTesting()` presents the
   column for testing, with test links pinned to the landing commit.
8. **Approve, or Failed testing**: ticking the cards and approving is the
   only gate. Failed testing writes `revertRequested`, and the automation
   reverts that card's commits.
9. **Deploy to Main**: shown only when the whole train is approved.
   `notifyOnProjectReadyToDeploy()` fires the Deploy Routine, which verifies
   the train and reviews the help centre for affected articles (FAQ impact review).
10. **Merge**: `processDeployTrain()` merges the train PR once its checks
    pass and `finishTrain()` flips the cards to Merged to Main, resets the
    branch to main and dispatches the deploy when the train touched
    `backlog-tracker/`.
11. **Deploy**: `.github/workflows/deploy-backlog-tracker.yml` (see the deploy map).
12. **Docs sync**: `syncDocsAfterMerge()` calls `syncProjectDocs()` in
    `backlog-tracker/scripts/docs-sync-lib.js`, which runs
    `reconcileManifest()` to rewrite every copy declared in
    `backlog-tracker/board-docs.json`. Separately every console deploy runs
    `backlog-tracker/scripts/sync-board-docs.js`, which copies only this
    project's README and Requirements.

Also in the flow: `.github/workflows/e2e-quick.yml` (a required check on every
pull request to main, a passing no-op unless the change is for the Display
Types project), `.github/workflows/e2e-nightly.yml` (02:00 Sydney on main,
files tickets for failures) and the MCP tool `demote_project`, which turns a
project back into a concept (see "2 — Console MCP guide (2/4)").

### When a copy refreshes

A copy is rewritten after a Backlog Tracker train merges (step 12), with the
rewrite read back byte for byte; the result is `projects/<id>.docsSync`, and
`error` is null when it worked. A change that reaches main another way (a
person's direct merge or a hotfix) refreshes the copies at the next train
merge. Once the ticket "Sync every project's docs and mirrors whenever main
moves" is live, any merge to main refreshes them. Until then, check
`docsSync.mergeCommit` before trusting a copy over the file.

## The Routine flows

All live in `backlog-tracker/ROUTINE_INSTRUCTIONS.md`, which stays in the
repo and is fetched fresh by every Routine fire, so a pull request changes
the Routine's behaviour:
<https://github.com/offline2online/rob_ph_demos/blob/main/backlog-tracker/ROUTINE_INSTRUCTIONS.md>

- **Build** ("Setup", "Parallel builds — one ticket per session", "Complete the
  intake sections first", "For each Backlog item found"): one session owns one
  ticket, reads at a pinned `patchBaseSha` and hands back a patch.
- **Deploy** ("The Notify Claude — Deploy flow", with "FAQ impact review"):
  verifies the approved train and parks corrected help-centre text on the
  affected articles as `pendingRevision` for a person to approve.
- **Review Batch** ("The Review Batch flow"): the code-review gate between
  Ready for Testing and approval; it writes `reviewStatus` on each ticket.
- **Run E2E** ("The Run E2E flow"): runs the end-to-end journeys and reports.
- **Groom Backlog** ("The Groom Backlog flow"): classifies and summarizes
  every Backlog card, with no code investigation.
- **Ready for Testing** ("The Ready for Testing flow"): presents the column
  with the PH Agent Console connector's board tools ("Board tools over MCP").
- **Reporting** ("When done"): what every run writes back to the card.

## Where each rule lives

- **How the train works, approvals, reverts, locks**: `CLAUDE.md` → "Prototype
  Backlog"; `backlog-tracker/REQUIREMENTS.md` → "The deployment train".
- **MCP tools, roles, what an agent may never do**: `CLAUDE.md` → "The PH Agent
  Console is also an MCP server"; `backlog-tracker/MCP.md`.
- **Sign-in, rules, rate limits, the 100-member envelope**:
  `backlog-tracker/SECURITY-PERFORMANCE.md`.
- **Docs mirrors and copies**: `CLAUDE.md` → "Keep each project's README
  current"; `backlog-tracker/README.md`.
- **Help centre content and structure**: `faq/README.md`;
  `docs/CONTRIBUTING-docs.md`; `backlog-tracker/REQUIREMENTS.md` →
  "FAQ / Help Center".
- **Any UI change**: the `ph-designer` skill, per `CLAUDE.md`.

## Deploy map

What deploys each top-level folder of `offline2online/rob_ph_demos`, when, and
how to confirm it is live. A merge alone is never proof: look at the run.

| Folder | Deployed by | When | Confirm it is live |
|---|---|---|---|
| `backlog-tracker/` | `.github/workflows/deploy-backlog-tracker.yml`: hosting, functions, Firestore and storage rules | On push to main for `backlog-tracker/**` or `faq/**`, or dispatched by `finishTrain()` after a train that touched `backlog-tracker/` or `faq/` | That run is green; the board's health strip |
| `faq/` | GitHub Pages on merge, and Hosting site `ph-help-centre` (help.personalisationhub.com) with the console deploy; `.github/workflows/faq-content.yml` syncs Firestore and `faq/data` | On merge to main; content hourly or on demand | The page itself; the deploy run for the Hosting site |
| `dsp-integration/` | `.github/workflows/dsp-api-deploy.yml` (hosted API), `.github/workflows/dsp-prototype.yml` (rebuilds the checked-in prototype), `.github/workflows/dsp-board.yml` (board writes) | Source push, ticket landing, merge and every ten minutes | `dsp-integration/prototype/build-info.json` names the commit the bundle came from |
| `menu-board-demo/` | GitHub Pages for the pages; `menu-board-demo/functions` is **manual only**: `firebase deploy --only functions` | Pages on merge; functions never by merge | Pages: the URL. Functions: whoever holds Firebase access must deploy; ask |
| `Retail-media-insights/` | GitHub Pages; tests in `.github/workflows/retail-media-insights-tests.yml` | On merge | The URL; the tests run on the train PR |
| `visitor-profile/` | GitHub Pages | On merge | The URL |
| `Brands-Suppliers-Assets/` (legacy, superseded by `menu-board-demo/`) | GitHub Pages | On merge | The URL |
| `space-invaders/` | GitHub Pages for the static pages; `space-invaders/session-server.js` runs where `space-invaders/railway.json` points, not from a workflow here | Pages on merge | The URL |
| `kanban-staff-board/` (Concept Incubator prototype, no board project yet) | GitHub Pages | On merge | The URL |
| `shared/`, `docs/` | Not deployed: documents only | | |

A change to anything under `.github/workflows/` cannot be merged by the
pipeline: a person merges the train PR.

## Keeping this file honest

`backlog-tracker/test/bt-handover-docs.test.js` fails when a path or workflow
cited here no longer exists, a function named here is gone, a top-level
folder is missing from the deploy map, or a copy no longer fits the board's
20,000-character limit when cut. When it fails, fix this file or the manifest.
