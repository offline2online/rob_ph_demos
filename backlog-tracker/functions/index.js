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

    const db = getFirestore();

    // Two equality filters ("==" on projectId and status) — this needs no
    // composite index, unlike an equality + range/order combination would.
    const itemsSnap = await db.collection("backlogItems")
      .where("projectId", "==", event.params.projectId)
      .where("status", "==", "backlog")
      .get();
    let items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // The board's own Backlog checkboxes (see public/js/app.js
    // requestNotify) can narrow a click to a hand-picked subset instead of
    // the whole column — written alongside notifyRequestedAt as
    // notifyItemIds. A present, non-empty array filters down to just those
    // ids (still re-checked against what's actually in Backlog right now,
    // in case one was moved/deleted since it was selected); anything else
    // (unset, null, or an empty array) keeps the original "notify
    // everything currently in Backlog" behavior.
    if (Array.isArray(after.notifyItemIds) && after.notifyItemIds.length > 0) {
      const wantedIds = new Set(after.notifyItemIds);
      items = items.filter((i) => wantedIds.has(i.id));
    }

    if (items.length === 0) {
      logger.info("Notify requested but Backlog is empty — nothing to notify or fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";
    const sentItemIds = items.map((i) => i.id);

    // Fire the Routine BEFORE posting to Slack (reversed from the original
    // order) so a resolved session id/url can ride along in the Slack
    // message, and so projects/{id}.notifyRoutine — which the board's
    // Notify Claude button reads to show a spinner, then itself becomes the
    // session link once a session id resolves — reflects the real outcome
    // of this specific click.
    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    let sessionId = null;
    let sessionUrl = null;
    let fireError = null;

    if (fireUrl && token) {
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

      const selfReportHint = `\n\nWhen you finish this run (whether you completed everything or stopped early on a blocker), PATCH projects/${event.params.projectId} with notifyRoutine.status set to "done" (or "error" with an errorMessage, if you stopped early) and notifyRoutine.finishedAt set to now — the board shows a working/spinning state on its Notify Claude button until it sees this.`;

      const text = `${projectPromptBlock}Project: "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board has ${items.length} item${items.length === 1 ? "" : "s"} in Backlog:\n\n${itemLines}${selfReportHint}`;

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
          fireError = `Routine fire endpoint responded with status ${res.status}`;
          logger.error("Routine fire endpoint responded with a non-2xx status", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          // `claude_code_session_id` is the field name confirmed by a live
          // curl test against the real fire endpoint (see README.md) —
          // this is a research-preview API, so if session links stop
          // showing up, re-confirm the response shape with curl before
          // assuming the board's code is wrong.
          const body = await res.json().catch(() => null);
          sessionId = body?.claude_code_session_id || null;
          sessionUrl = sessionId ? `https://claude.ai/code/${sessionId}` : null;
          logger.info("Fired Claude Code Routine for manual project notify request", {
            projectId: event.params.projectId,
            itemCount: items.length,
            sessionId,
          });
        }
      } catch (err) {
        fireError = err instanceof Error ? err.message : String(err);
        logger.error("Failed to call Routine fire endpoint for manual notify", {
          projectId: event.params.projectId,
          error: fireError,
        });
      }

      // Lets the board show a spinner (or a visible error) instead of the
      // button just looking idle after a click. A fired session is asked
      // (see selfReportHint above) to flip this to "done"/"error" itself;
      // the frontend also treats a stale "in-progress" — older than the
      // typical run length — as done on its own, so a session running an
      // older prompt without that instruction, or one that crashes, can't
      // wedge the button permanently.
      await db.collection("projects").doc(event.params.projectId).set({
        notifyRoutine: {
          status: fireError ? "error" : "in-progress",
          firedAt: new Date(),
          sessionId,
          sessionUrl,
          itemCount: items.length,
          sentItemIds,
          errorMessage: fireError,
        },
      }, { merge: true });
    } else {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping Routine fire for manual project notify request",
        { projectId: event.params.projectId }
      );
    }

    // Slack (or whatever NOTIFY_WEBHOOK_URL points at) is independent of
    // the fire above — posts (with a session link if one was resolved)
    // regardless of whether the fire succeeded, since "notify was
    // requested" is itself useful information even when the fire failed.
    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (webhookUrl) {
      // "Claude was assigned N items..." rather than "Notify Claude clicked
      // for..." — reads as a status report on what's happening, not a log
      // line about the click itself. Leads with the session link when one
      // resolved (the whole point of firing before posting, above); falls
      // back to a plain explanation when it didn't.
      const trackLine = sessionUrl
        ? `Click here to track their progress: ${sessionUrl}`
        : (fireUrl && token ? "(session link unavailable)" : "(Routine fire not configured — no Claude session started)");
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Claude was assigned ${items.length} item${items.length === 1 ? "" : "s"} from the Backlog for "${projectName}". ${trackLine}`,
            projectId: event.params.projectId,
            projectName,
            itemCount: items.length,
            sessionUrl,
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
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

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

    // Deliberately data-only, same philosophy as notifyOnProjectReadyForReview
    // above: this used to also embed a full step-by-step "how to find/verify/
    // merge a PR" procedure directly in this string, duplicating (and, once
    // ROUTINE_INSTRUCTIONS.md was updated to fix a real bug in that
    // procedure, silently diverging from) the Deploy flow section of
    // ROUTINE_INSTRUCTIONS.md — the file every fired session's own bootstrap
    // prompt already fetches and is told to follow exactly. Two copies of
    // "how" can only ever go stale relative to each other; this function's
    // only job is "what" (which project, which items) and the `=== DEPLOY
    // REQUEST ===` marker ROUTINE_INSTRUCTIONS.md's own Deploy flow section
    // keys off of.
    const itemLines = items
      .map((i, idx) => `${idx + 1}. [id: ${i.id}] [${i.type === "bug" ? "Bug" : "Feature"}] ${i.title} — ${i.desc}${i.patchBranch ? ` (patchBranch: ${i.patchBranch})` : ""}`)
      .join("\n");

    // Same per-project addendum mechanism as the Backlog notify fire above
    // (a project's own Docs page can hand the Routine extra context either
    // request should know, e.g. which branch/PR naming convention to expect).
    const projectPromptBlock = (after.routinePromptMd || "").trim()
      ? `=== PROJECT-SPECIFIC INSTRUCTIONS FOR "${projectName}" (from this project's Docs page) ===\n${after.routinePromptMd.trim()}\n=== END PROJECT-SPECIFIC INSTRUCTIONS ===\n\n`
      : "";

    const text = `${projectPromptBlock}=== DEPLOY REQUEST for "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board ===\n` +
      `These ${items.length} item${items.length === 1 ? "" : "s"} are already implemented, tested, and confirmed "Live on Feature Branch" (ready-to-publish). Do NOT investigate, re-implement, or re-test them — follow ROUTINE_INSTRUCTIONS.md's "Notify Claude — Deploy" flow section for exactly what to do with each one.\n\n` +
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

// The board's "Deploy to Feature" project action (see deployToFeature() in
// public/js/app.js) writes projects/{id}.deployToFeatureRequestedAt (plus
// deployToFeatureItemTitles), and this fires once on that write to post a
// Slack confirmation. Deliberately the odd one out among the three notify
// functions in this file: it never fires the Routine, because there's no
// AI work to do here — the feature branch and PR for every item involved
// already exist (created automatically back at the Backlog stage); this
// action only advances the board's own status once a human has confirmed
// testing. But deployToFeature() is a silent, one-round-trip client write
// with no in-progress state to watch (unlike Ready for Dev/Deploy to Main,
// which both spin on a Routine session) — without this, a click could
// easily look like it did nothing at all, which is exactly what happened
// in production before this existed.
exports.notifyOnItemsDeployedToFeature = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after?.deployToFeatureRequestedAt) {
      return;
    }
    const beforeMs = before?.deployToFeatureRequestedAt?.toMillis?.() ?? 0;
    const afterMs = after.deployToFeatureRequestedAt?.toMillis?.() ?? 0;
    if (afterMs <= beforeMs) {
      return;
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (!webhookUrl) {
      logger.warn(
        "NOTIFY_WEBHOOK_URL is not set — skipping Slack notification for Deploy to Feature",
        { projectId: event.params.projectId }
      );
      return;
    }

    const projectName = after.name || "A project";
    const titles = Array.isArray(after.deployToFeatureItemTitles) ? after.deployToFeatureItemTitles : [];
    const text = `Deploy to Feature clicked for ${projectName}: ${titles.length} item${titles.length === 1 ? "" : "s"} moved to Feature Branch (Live)` +
      (titles.length ? `:\n${titles.map((t) => `• ${t}`).join("\n")}` : ".") +
      ` No new GitHub push happened — each item's code was already on its own feature branch from the Backlog stage.`;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, projectId: event.params.projectId, projectName, itemTitles: titles }),
      });
      if (!res.ok) {
        logger.error("Deploy to Feature notify webhook responded with a non-2xx status", {
          projectId: event.params.projectId,
          status: res.status,
          body: await res.text().catch(() => "<unreadable>"),
        });
        return;
      }
      logger.info("Notified webhook of Deploy to Feature click", {
        projectId: event.params.projectId,
        itemCount: titles.length,
      });
    } catch (err) {
      logger.error("Failed to call notify webhook for Deploy to Feature", {
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
