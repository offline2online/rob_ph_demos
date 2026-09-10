// backlog-tracker Cloud Functions — its own Firebase project and its own
// "default" functions codebase (see ../firebase.json), entirely separate
// from menu-board-demo/functions. Deploying this never touches, and can
// never be touched by, anything in the menu-board-demo Firebase project.
//
// This is the piece the Claude Artifact board can't do on its own: an
// Artifact page has no server of its own, so getting Claude's attention
// needs a person to click "Notify Claude" and then tell Claude in chat.
// A real backend can skip the person — the moment a document lands in
// Firestore with status "backlog", this function fires automatically.

const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

// Stored as a Firebase secret, never committed — set it with:
//   firebase functions:secrets:set NOTIFY_WEBHOOK_URL
// What you point it at is up to you; a few real options, roughly in order
// of how much extra plumbing they need (see README.md "Wiring up NOTIFY_WEBHOOK_URL"):
//   1. A Slack "Incoming Webhook" URL — simplest, a human relays it to Claude.
//   2. A `watch_url` webhook from a live Claude Code Remote session (the
//      same mechanism this session used to watch this artifact) — wakes
//      that specific session directly, but the URL is session-scoped and
//      needs re-registering whenever the session it points at ends.
//   3. Your own small relay service that calls the Claude API / triggers a
//      Routine — the most durable option, but code you'd write and host
//      yourself; out of scope for this scaffold.
const NOTIFY_WEBHOOK_URL = defineSecret("NOTIFY_WEBHOOK_URL");

// The one line every stage prompt below repeats: the board's own "no
// publish step, a Firestore write is live immediately" behavior (see repo
// root CLAUDE.md) applies to the BOARD's own data only. It does not apply
// to the actual product code these cards track — that only ships via a
// real `git push`/merge to GitHub, same as everywhere else in this repo.
// Called out explicitly on every payload below so a stage notification is
// never mistaken for "this is already live."
const GITHUB_DEPLOY_REMINDER =
  "Reminder: moving a card on this board never deploys anything by itself " +
  "— it only records progress. The real deployment step is always a " +
  "`git push`/merge on GitHub (to the project's feature branch, then to " +
  "`main`). Cloud Functions changes additionally need a separate manual " +
  "`firebase deploy --only functions` — see repo root CLAUDE.md.";

// Shared send + error handling so each stage below only has to build its
// own payload, not repeat the fetch/log/swallow boilerplate four times.
async function sendNotify(webhookUrl, payload, logCtx) {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Logged, not thrown — a bad webhook target shouldn't retry-loop
      // this function forever, it should just show up in Cloud Logging.
      logger.error("Notify webhook responded with a non-2xx status", {
        ...logCtx,
        status: res.status,
        body: await res.text().catch(() => "<unreadable>"),
      });
      return;
    }
    logger.info("Notified webhook", logCtx);
  } catch (err) {
    logger.error("Failed to call notify webhook", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Multi-project items carry a projectId rather than embedding the
// project's own name — one lookup here keeps every notification readable
// ("... in Products and Pricing") instead of surfacing an opaque id.
async function lookupProjectName(projectId) {
  if (!projectId) return "Unknown project";
  try {
    const snap = await getFirestore().collection("projects").doc(projectId).get();
    if (snap.exists && snap.data().name) return snap.data().name;
  } catch (err) {
    logger.warn("Could not look up project name for notification", {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return projectId;
}

exports.notifyOnBacklogItemCreated = onDocumentCreated(
  { document: "backlogItems/{itemId}", secrets: [NOTIFY_WEBHOOK_URL] },
  async (event) => {
    const item = event.data?.data();
    if (!item) {
      return;
    }
    // Only the actual "landed in Backlog" moment should notify — a card
    // created directly into some other status (shouldn't normally happen,
    // but the UI shouldn't be the only thing enforcing that) stays quiet.
    if (item.status !== "backlog") {
      return;
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      logger.warn(
        "NOTIFY_WEBHOOK_URL is not set — skipping notification for new backlog item",
        { itemId: event.params.itemId }
      );
      return;
    }

    const projectName = await lookupProjectName(item.projectId);

    const payload = {
      stage: "new-backlog-item",
      text: `New backlog item in ${projectName}: "${item.title}" (${item.type === "bug" ? "Bug" : "Feature"}, ${item.category || "Uncategorised"}). ${GITHUB_DEPLOY_REMINDER}`,
      itemId: event.params.itemId,
      projectId: item.projectId || null,
      projectName,
      title: item.title,
      desc: item.desc,
      type: item.type,
      category: item.category || "Uncategorised",
      createdAt: item.createdAt || null,
    };

    await sendNotify(webhookUrl, payload, { itemId: event.params.itemId, stage: "new-backlog-item" });
  }
);

// The per-item notify above fires immediately on every new card, which is
// the wrong shape when someone wants to add several backlog items first and
// only then say "this project is ready to look at" — this is the manual,
// batched counterpart: the board's "Notify Claude" button (per-project ⋮
// menu) writes projects/{id}.notifyRequestedAt, and this fires once on that
// write with everything currently sitting in that project's Backlog column.
exports.notifyOnProjectReadyForReview = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after?.notifyRequestedAt) {
      return;
    }
    // Any other field on the project doc (rename, requirementsMd edit) also
    // triggers this update handler — only a genuinely new notifyRequestedAt
    // value (not just re-saved unchanged) should actually notify.
    const beforeMs = before?.notifyRequestedAt?.toMillis?.() ?? 0;
    const afterMs = after.notifyRequestedAt?.toMillis?.() ?? 0;
    if (afterMs <= beforeMs) {
      return;
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      logger.warn(
        "NOTIFY_WEBHOOK_URL is not set — skipping manual project notify request",
        { projectId: event.params.projectId }
      );
      return;
    }

    // Two equality filters ("==" on projectId and status) — this needs no
    // composite index, unlike an equality + range/order combination would.
    const itemsSnap = await getFirestore().collection("backlogItems")
      .where("projectId", "==", event.params.projectId)
      .where("status", "==", "backlog")
      .get();
    const items = itemsSnap.docs.map((d) => d.data());

    const payload = {
      stage: "backlog-ready-for-review",
      text: `${after.name || "A project"} has ${items.length} item${items.length === 1 ? "" : "s"} in Backlog ready for you to investigate. For each item: find the root cause, implement the fix, and \`git push\` your commit(s) to the project's feature branch on GitHub. Then move that card from Backlog to Ready for Testing on the board so it's queued for testing on the branch. ${GITHUB_DEPLOY_REMINDER}`,
      projectId: event.params.projectId,
      projectName: after.name || null,
      items: items.map((i) => ({
        title: i.title, desc: i.desc, type: i.type, category: i.category || "Uncategorised",
      })),
    };

    await sendNotify(webhookUrl, payload, {
      projectId: event.params.projectId,
      stage: "backlog-ready-for-review",
      itemCount: items.length,
    });
  }
);

// Fires the instant a card is confirmed working on its feature branch (the
// "Confirm live on branch" button — ready-for-testing → ready-to-publish).
// The prompt at this stage is deliberately different from the Backlog one
// above: there's no more investigating to do, the next real-world action is
// merging that feature branch into `main` and pushing on GitHub.
exports.notifyOnItemConfirmedLiveOnBranch = onDocumentUpdated(
  { document: "backlogItems/{itemId}", secrets: [NOTIFY_WEBHOOK_URL] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    if (!(before.status === "ready-for-testing" && after.status === "ready-to-publish")) {
      return;
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      logger.warn(
        "NOTIFY_WEBHOOK_URL is not set — skipping confirmed-live-on-branch notification",
        { itemId: event.params.itemId }
      );
      return;
    }

    const projectName = await lookupProjectName(after.projectId);
    const payload = {
      stage: "confirmed-live-on-branch",
      text: `"${after.title}" (${projectName}) has been confirmed working on its feature branch and is ready to ship. Merge that feature branch into \`main\` and \`git push origin main\` on GitHub — that push is what actually deploys it. Once pushed, click "Merge to main" on the card to move it to Merged to Main (Live). ${GITHUB_DEPLOY_REMINDER}`,
      itemId: event.params.itemId,
      projectId: after.projectId || null,
      projectName,
      title: after.title,
      desc: after.desc,
      type: after.type,
      category: after.category || "Uncategorised",
    };

    await sendNotify(webhookUrl, payload, { itemId: event.params.itemId, stage: "confirmed-live-on-branch" });
  }
);

// Fires the instant a card is marked merged to main (the "Merge to main"
// button — ready-to-publish → published-live). By this point the GitHub
// push has already happened (per the previous stage's prompt); this one is
// a completion/verification prompt, not a work request to push code again.
exports.notifyOnItemMergedToMain = onDocumentUpdated(
  { document: "backlogItems/{itemId}", secrets: [NOTIFY_WEBHOOK_URL] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    if (!(before.status === "ready-to-publish" && after.status === "published-live")) {
      return;
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      logger.warn(
        "NOTIFY_WEBHOOK_URL is not set — skipping merged-to-main notification",
        { itemId: event.params.itemId }
      );
      return;
    }

    const projectName = await lookupProjectName(after.projectId);
    const payload = {
      stage: "merged-to-main",
      text: `"${after.title}" (${projectName}) is marked Merged to Main (Live) — confirm the \`main\` branch on GitHub actually has the merge commit, and that the change is visible wherever it publishes to (GitHub Pages, etc). If this touched \`menu-board-demo/functions\`, remember pushing to \`main\` alone does NOT make a Cloud Functions change live — someone with Firebase deploy access still has to run \`firebase deploy --only functions\` separately (see repo root CLAUDE.md). Once confirmed, report back that it's done.`,
      itemId: event.params.itemId,
      projectId: after.projectId || null,
      projectName,
      title: after.title,
      desc: after.desc,
      type: after.type,
      category: after.category || "Uncategorised",
    };

    await sendNotify(webhookUrl, payload, { itemId: event.params.itemId, stage: "merged-to-main" });
  }
);
