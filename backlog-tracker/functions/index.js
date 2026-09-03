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

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

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

    const payload = {
      text: `New backlog item: "${item.title}" (${item.type === "bug" ? "Bug" : "Feature"}, ${item.category || "Uncategorised"})`,
      itemId: event.params.itemId,
      title: item.title,
      desc: item.desc,
      type: item.type,
      category: item.category || "Uncategorised",
      createdAt: item.createdAt || null,
    };

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
          itemId: event.params.itemId,
          status: res.status,
          body: await res.text().catch(() => "<unreadable>"),
        });
        return;
      }
      logger.info("Notified webhook of new backlog item", {
        itemId: event.params.itemId,
      });
    } catch (err) {
      logger.error("Failed to call notify webhook", {
        itemId: event.params.itemId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);
