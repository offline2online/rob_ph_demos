// backlog-tracker Cloud Functions — its own Firebase project and its own
// "default" functions codebase (see ../firebase.json), entirely separate
// from menu-board-demo/functions. Deploying this never touches, and can
// never be touched by, anything in the menu-board-demo Firebase project.
//
// This is the piece the Claude Artifact board can't do on its own: an
// Artifact page has no server of its own, so getting Claude's attention
// needs a person to click "Notify Claude" and then tell Claude in chat.
// A real backend can skip the person — clicking the board's own Notify
// Claude button (per-project) fires this automatically.

const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

initializeApp();

// Stored as a Firebase secret, never committed — set it with:
//   firebase functions:secrets:set NOTIFY_WEBHOOK_URL
// A Slack "Incoming Webhook" URL is the simplest target; point it wherever
// you like (see README.md "Wiring up NOTIFY_WEBHOOK_URL"). Used below,
// once per Notify Claude click — not per backlog item. An earlier version
// of this function also posted here automatically on every single new
// backlogItems doc, which was noisy (one Slack message per item typed or
// dictated, long before a project was actually "ready" for anyone to look
// at) — removed in favor of the single per-click post below, alongside the
// Routine fire that click already triggers.
const NOTIFY_WEBHOOK_URL = defineSecret("NOTIFY_WEBHOOK_URL");

// The board's "Notify Claude" button (per-project ⋮ menu) writes
// projects/{id}.notifyRequestedAt, and this fires once on that write —
// posting one Slack message (naming the project and exactly how many
// Backlog items will be actioned) and firing a Claude Code Routine's
// API-trigger "fire" endpoint directly, which starts a fresh Claude Code
// session immediately, no human relay required. The Routine (see
// Anthropic's claude.ai/code/routines) owns its own prompt — this
// function's job is only to hand it which project and what's currently in
// that project's Backlog column, as the fire request's `text`. The Slack
// post and the Routine fire are independent: either one no-ops on its own
// if its secret(s) aren't set, without blocking the other.
//
// CLAUDE_ROUTINE_FIRE_URL and CLAUDE_ROUTINE_TOKEN are both per-Routine and
// both secret in effect (the URL embeds the Routine's trigger id; the token
// is the bearer credential that can fire it) — both are Firebase secrets,
// synced from GitHub Actions repo secrets of the same name exactly like
// NOTIFY_WEBHOOK_URL already is. Never commit either value directly.
const CLAUDE_ROUTINE_FIRE_URL = defineSecret("CLAUDE_ROUTINE_FIRE_URL");
const CLAUDE_ROUTINE_TOKEN = defineSecret("CLAUDE_ROUTINE_TOKEN");

exports.notifyOnProjectReadyForReview = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN] },
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

    // Two equality filters ("==" on projectId and status) — this needs no
    // composite index, unlike an equality + range/order combination would.
    const itemsSnap = await getFirestore().collection("backlogItems")
      .where("projectId", "==", event.params.projectId)
      .where("status", "==", "backlog")
      .get();
    const items = itemsSnap.docs.map((d) => d.data());

    if (items.length === 0) {
      logger.info("Notify requested but Backlog is empty — nothing to notify or fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";

    // Slack (or whatever NOTIFY_WEBHOOK_URL points at) and the Routine fire
    // below are independent — each posts only if its own secret(s) are set,
    // and one being unset never blocks the other.
    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Notify Claude clicked for ${projectName}: ${items.length} item${items.length === 1 ? "" : "s"} in Backlog will be actioned.`,
            projectId: event.params.projectId,
            projectName,
            itemCount: items.length,
          }),
        });
        if (!res.ok) {
          logger.error("Notify webhook responded with a non-2xx status", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          logger.info("Notified webhook of Notify Claude click", {
            projectId: event.params.projectId,
            itemCount: items.length,
          });
        }
      } catch (err) {
        logger.error("Failed to call notify webhook", {
          projectId: event.params.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn("NOTIFY_WEBHOOK_URL is not set — skipping Slack notification for Notify Claude click", {
        projectId: event.params.projectId,
      });
    }

    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    if (!fireUrl || !token) {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping Routine fire for manual project notify request",
        { projectId: event.params.projectId }
      );
      return;
    }

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

// The board's "Notify Claude — Deploy" button (per-project header, shown
// only when a project has items Live on Feature Branch) writes
// projects/{id}.deployNotifyRequestedAt, and this fires once on that write
// — same Slack-post-plus-Routine-fire shape as notifyOnProjectReadyForReview
// above, but for the opposite end of the pipeline: these items are already
// implemented, tested, and confirmed on their feature branches — nothing
// here should be investigated or re-implemented, only merged to main. See
// backlog-tracker/README.md for why the fire `text` says so explicitly
// rather than relying on the Routine's own shared prompt (which is written
// for a Backlog-shaped request) to infer that on its own.
exports.notifyOnProjectReadyToDeploy = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after?.deployNotifyRequestedAt) {
      return;
    }
    const beforeMs = before?.deployNotifyRequestedAt?.toMillis?.() ?? 0;
    const afterMs = after.deployNotifyRequestedAt?.toMillis?.() ?? 0;
    if (afterMs <= beforeMs) {
      return;
    }

    const itemsSnap = await getFirestore().collection("backlogItems")
      .where("projectId", "==", event.params.projectId)
      .where("status", "==", "ready-to-publish")
      .get();
    const items = itemsSnap.docs.map((d) => d.data());

    if (items.length === 0) {
      logger.info("Deploy notify requested but nothing is Live on Feature Branch — nothing to notify or fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Notify Claude — Deploy clicked for ${projectName}: ${items.length} item${items.length === 1 ? "" : "s"} Live on Feature Branch will be merged to main.`,
            projectId: event.params.projectId,
            projectName,
            itemCount: items.length,
          }),
        });
        if (!res.ok) {
          logger.error("Deploy notify webhook responded with a non-2xx status", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          logger.info("Notified webhook of Notify Claude — Deploy click", {
            projectId: event.params.projectId,
            itemCount: items.length,
          });
        }
      } catch (err) {
        logger.error("Failed to call notify webhook for deploy request", {
          projectId: event.params.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn("NOTIFY_WEBHOOK_URL is not set — skipping Slack notification for Notify Claude — Deploy click", {
        projectId: event.params.projectId,
      });
    }

    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    if (!fireUrl || !token) {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping Routine fire for deploy notify request",
        { projectId: event.params.projectId }
      );
      return;
    }

    const itemLines = items
      .map((i, idx) => `${idx + 1}. [${i.type === "bug" ? "Bug" : "Feature"}] ${i.title} — ${i.desc}`)
      .join("\n");

    // Same per-project addendum mechanism as the Backlog notify fire above
    // (a project's own Docs page can hand the Routine extra context either
    // request should know, e.g. which branch/PR naming convention to expect).
    const projectPromptBlock = (after.routinePromptMd || "").trim()
      ? `=== PROJECT-SPECIFIC INSTRUCTIONS FOR "${projectName}" (from this project's Docs page) ===\n${after.routinePromptMd.trim()}\n=== END PROJECT-SPECIFIC INSTRUCTIONS ===\n\n`
      : "";

    const text = `${projectPromptBlock}=== DEPLOY REQUEST for "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board ===\n` +
      `These ${items.length} item${items.length === 1 ? "" : "s"} are already implemented, tested, and confirmed "Live on Feature Branch" (ready-to-publish). Do NOT investigate, re-implement, or re-test them.\n\n` +
      `For each item below:\n` +
      `1. Find its pull request in offline2online/rob_ph_demos (check the item's own notes for a branch/PR reference, or search open PRs referencing its title).\n` +
      `2. If its CI is green and it's mergeable, merge that PR to main.\n` +
      `3. PATCH its backlogItems doc: status -> "published-live", updatedAt -> now.\n` +
      `If a PR can't be found, or its CI is red, or it's not mergeable, leave its status as ready-to-publish and add a note explaining why instead of guessing.\n\n` +
      `Items:\n${itemLines}`;

    try {
      const res = await fetch(fireUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          "anthropic-beta": "experimental-cc-routine-2026-04-01",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        logger.error("Routine fire endpoint responded with a non-2xx status for deploy request", {
          projectId: event.params.projectId,
          status: res.status,
          body: await res.text().catch(() => "<unreadable>"),
        });
        return;
      }
      logger.info("Fired Claude Code Routine for deploy notify request", {
        projectId: event.params.projectId,
        itemCount: items.length,
      });
    } catch (err) {
      logger.error("Failed to call Routine fire endpoint for deploy notify request", {
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
