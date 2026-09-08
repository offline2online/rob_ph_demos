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
//   3. Firing a Claude Code Routine's API trigger directly — see
//      notifyOnProjectReadyForReview below, which does exactly this for the
//      manual/batched notify path. This per-item notify still just posts a
//      plain webhook; point it at the same Routine's fire URL too if you
//      want every single new item to trigger a fresh session on its own,
//      not only a manual "Notify Claude" click.
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

    // Multi-project items carry a projectId rather than embedding the
    // project's own name — one extra read here keeps the notification
    // readable ("New item in Products and Pricing: ...") instead of
    // surfacing an opaque id, and this only runs once per new item, not
    // once per page view.
    let projectName = item.projectId || "Unknown project";
    if (item.projectId) {
      try {
        const projectSnap = await getFirestore().collection("projects").doc(item.projectId).get();
        if (projectSnap.exists && projectSnap.data().name) {
          projectName = projectSnap.data().name;
        }
      } catch (err) {
        logger.warn("Could not look up project name for notification", {
          itemId: event.params.itemId,
          projectId: item.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const payload = {
      text: `New backlog item in ${projectName}: "${item.title}" (${item.type === "bug" ? "Bug" : "Feature"}, ${item.category || "Uncategorised"})`,
      itemId: event.params.itemId,
      projectId: item.projectId || null,
      projectName,
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

// The per-item notify above fires immediately on every new card, which is
// the wrong shape when someone wants to add several backlog items first and
// only then say "this project is ready to look at" — this is the manual,
// batched counterpart: the board's "Notify Claude" button (per-project ⋮
// menu) writes projects/{id}.notifyRequestedAt, and this fires once on that
// write.
//
// Unlike the per-item notify (a plain webhook someone still has to relay
// into a conversation), this one actually closes the loop end to end: it
// calls a Claude Code Routine's API-trigger "fire" endpoint directly, which
// starts a fresh Claude Code session immediately, no human relay required.
// The Routine (see Anthropic's claude.ai/code/routines) owns its own prompt
// — this function's job is only to hand it which project and what's
// currently in that project's Backlog column, as the fire request's `text`.
//
// CLAUDE_ROUTINE_FIRE_URL and CLAUDE_ROUTINE_TOKEN are both per-Routine and
// both secret in effect (the URL embeds the Routine's trigger id; the token
// is the bearer credential that can fire it) — both are Firebase secrets,
// synced from GitHub Actions repo secrets of the same name exactly like
// NOTIFY_WEBHOOK_URL already is. Never commit either value directly.
const CLAUDE_ROUTINE_FIRE_URL = defineSecret("CLAUDE_ROUTINE_FIRE_URL");
const CLAUDE_ROUTINE_TOKEN = defineSecret("CLAUDE_ROUTINE_TOKEN");

exports.notifyOnProjectReadyForReview = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN] },
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

    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    if (!fireUrl || !token) {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping manual project notify request",
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

    if (items.length === 0) {
      logger.info("Notify requested but Backlog is empty — nothing to fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";
    const itemLines = items
      .map((i, idx) => `${idx + 1}. [${i.type === "bug" ? "Bug" : "Feature"}] ${i.title} — ${i.desc}`)
      .join("\n");

    // Per-project override/addendum to the Routine's own fixed prompt (see
    // the Docs page's "Routine instructions" block, projects/{id}
    // .routinePromptMd) — lets one project hand the Routine extra
    // instructions specific to it (a different branch convention, a note
    // about which parts of the repo it owns, anything the generic workflow
    // wouldn't know) without needing a second Routine or editing the
    // Routine's own prompt for every project that wants something custom.
    const projectPromptBlock = (after.routinePromptMd || "").trim()
      ? `=== PROJECT-SPECIFIC INSTRUCTIONS FOR "${projectName}" (from this project's Docs page) ===\n${after.routinePromptMd.trim()}\n=== END PROJECT-SPECIFIC INSTRUCTIONS ===\n\n`
      : "";

    const text = `${projectPromptBlock}Project: "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board has ${items.length} item${items.length === 1 ? "" : "s"} in Backlog:\n\n${itemLines}`;

    try {
      const res = await fetch(fireUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          // Research-preview API trigger feature — these header names/values
          // may change; if firing starts failing with an auth/version error,
          // check Anthropic's current docs for the routine-fire headers.
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        logger.error("Routine fire endpoint responded with a non-2xx status", {
          projectId: event.params.projectId,
          status: res.status,
          body: await res.text().catch(() => "<unreadable>"),
        });
        return;
      }
      logger.info("Fired Claude Code Routine for manual project notify request", {
        projectId: event.params.projectId,
        itemCount: items.length,
      });
    } catch (err) {
      logger.error("Failed to call Routine fire endpoint for manual notify", {
        projectId: event.params.projectId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
);

// A shipped feature can leave the FAQ articles that document it stale.
// Opt-in per project (Docs page → "FAQ review automation", projects/{id}
// .faqAutoFlagOnLive) — when on, the moment one of that project's backlog
// items is actually merged to main (status flips to "published-live", the
// one irreversible transition of the three — ready-for-testing and
// ready-to-publish can still be reverted), every faqArticles doc whose own
// optional `projectId` link points at this project gets needsReview:true,
// the same flag the FAQ Center's own manual toggle sets.
exports.onBacklogItemPublishedLive = onDocumentUpdated(
  "backlogItems/{itemId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) {
      return;
    }
    if (before.status === "published-live" || after.status !== "published-live") {
      return;
    }
    if (!after.projectId) {
      return;
    }

    const db = getFirestore();
    const projectSnap = await db.collection("projects").doc(after.projectId).get();
    if (!projectSnap.exists || !projectSnap.data().faqAutoFlagOnLive) {
      return;
    }

    const articlesSnap = await db.collection("faqArticles")
      .where("projectId", "==", after.projectId)
      .get();
    if (articlesSnap.empty) {
      logger.info("FAQ auto-flag enabled but no linked articles for this project", {
        itemId: event.params.itemId,
        projectId: after.projectId,
      });
      return;
    }

    const batch = db.batch();
    articlesSnap.docs.forEach((articleDoc) => {
      batch.set(articleDoc.ref, {
        needsReview: true,
        updatedAt: new Date(),
      }, { merge: true });
    });
    await batch.commit();

    logger.info("Flagged linked FAQ articles for review after merge to main", {
      itemId: event.params.itemId,
      projectId: after.projectId,
      articleCount: articlesSnap.size,
    });
  }
);
