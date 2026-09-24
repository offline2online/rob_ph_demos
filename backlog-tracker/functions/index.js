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

const { onDocumentUpdated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { isTrainRelevantItem, trainLockShouldClear } = require("./train-lock");

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

// The GitHub token onBacklogItemReadyForAutomation (bottom of this file)
// uses to dispatch backlog-automation.yml the moment an item is ready for
// it, instead of that item waiting out the workflow's own schedule. Needs
// only this repo's Actions read/write scope — it can start a workflow and
// nothing else.
//
// Named GH_ and not GITHUB_ because the value reaches Firebase Secret
// Manager from a GitHub Actions repo secret of the same name (see
// ../../.github/workflows/deploy-backlog-tracker.yml), and GitHub refuses
// to create any repo secret whose name starts with GITHUB_ — that prefix is
// reserved for the variables it injects itself.
const GH_DISPATCH_TOKEN = defineSecret("GH_DISPATCH_TOKEN");

// Shared key for the boardApi Firestore proxy (see the bottom of this file).
// Handed to each Routine-fired session inside the fire text, because the
// board's Firestore rules now require sign-in and a Claude session cannot
// sign in with Google — the proxy is how it reads and updates the board.
const BOARD_API_KEY = defineSecret("BOARD_API_KEY");
// The project's public web API key (same value as public/js/firebase-config.js) —
// identifies the project for Identity Toolkit sign-in; not a secret.
const BOARD_WEB_API_KEY = "AIzaSyDzG5MzavLWyKU7NXfTPskuWbFYFlc5W3g";
function boardAccessBlock() {
  const key = BOARD_API_KEY.value();
  const project = process.env.GCLOUD_PROJECT || "backlog-tracker-e4ed2";
  if (!key || key === "unset") return "\n\n(BOARD ACCESS: not configured — BOARD_API_KEY is unset — so the board's Firestore rules will deny every call; report this and stop.)";
  return `\n\nBOARD ACCESS: the board's Firestore requires sign-in. Sign in as the board automation user over Google's Identity Toolkit REST API, then call Firestore's normal REST API with the returned ID token (both on *.googleapis.com):\n` +
    `  1. POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${BOARD_WEB_API_KEY}\n` +
    `     body: {"email":"board-automation@${project}.firebaseapp.com","password":"${key}","returnSecureToken":true}\n` +
    `     → use the "idToken" field (valid 1 hour; sign in again if you get 401).\n` +
    `  2. Every Firestore call: header  Authorization: Bearer <idToken>\n` +
    `     base: https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents\n` +
    `Fallback if identitytoolkit is unreachable: the boardApi proxy at https://${project}.web.app/boardApi/v1/projects/${project}/databases/(default)/documents (or https://us-central1-${project}.cloudfunctions.net/boardApi/...) with header  X-Board-Key: ${key}  — same paths and JSON, no sign-in.\n` +
    `See backlog-tracker/ROUTINE_INSTRUCTIONS.md → "Board access".`;
}

// Phase-bound skills (l5mjAANU0dfveGhxmDjm) — settings/phaseSkillBindings
// holds { build: string[], deploy: string[] } of skills.slug values (see
// firestore.rules' `match /settings/{docId}`). Deliberately NOT the full
// skill content: a skill can carry up to 20 files at 100,000 characters
// each, and inlining that into every single Notify Claude fire — even for
// a project that never touches what the skill covers — would be the same
// "duplicated 'how' text going stale" problem notifyOnProjectReadyToDeploy's
// own DEPLOY REQUEST text deliberately avoids elsewhere in this file (see
// its own comment on staying "data-only"). This only points at the skills
// by slug; ROUTINE_INSTRUCTIONS.md tells a fired session to fetch each
// one's real content itself, fresh, via its existing board access, the
// moment it actually needs it.
async function phaseSkillsBlock(db, phase, phaseLabel) {
  const snap = await db.collection("settings").doc("phaseSkillBindings").get().catch(() => null);
  const slugs = snap && snap.exists ? snap.data()[phase] : null;
  if (!Array.isArray(slugs) || slugs.length === 0) return "";
  const list = slugs.map((s) => `- ${s}`).join("\n");
  return `=== SKILLS BOUND TO THE ${phaseLabel} PHASE ===\n` +
    `Before finishing this phase's work, fetch each of these from the shared, organisation-wide skills library (skills/{skillId} — query where slug == the name below, via your existing board access) and follow it. See ROUTINE_INSTRUCTIONS.md for exactly when in this phase to apply each one; a slug here that doesn't resolve to a skill yet is not an error, just note it and move on.\n` +
    `${list}\n` +
    `=== END SKILLS BOUND TO THE ${phaseLabel} PHASE ===\n\n`;
}

// The repo backlog-automation.yml lives in, and the event_type its
// repository_dispatch trigger listens for. Hard-coded rather than
// configurable: this function exists to start one specific workflow in one
// specific repo, and a dispatch target worth making configurable would be a
// dispatch target worth authenticating differently.
const AUTOMATION_REPO = "offline2online/rob_ph_demos";
const AUTOMATION_DISPATCH_EVENT = "backlog-automation";

exports.notifyOnProjectReadyForReview = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN, BOARD_API_KEY] },
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
      const skillsBlock = await phaseSkillsBlock(db, "build", "BUILD");

      const selfReportHint = `\n\nWhen you finish this run (whether you completed everything or stopped early on a blocker), PATCH projects/${event.params.projectId} with notifyRoutine.status set to "done" (or "error" with an errorMessage, if you stopped early) and notifyRoutine.finishedAt set to now — the board shows a working/spinning state on its Notify Claude button until it sees this.`;

      const text = `${projectPromptBlock}${skillsBlock}Project: "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board has ${items.length} item${items.length === 1 ? "" : "s"} in Backlog:\n\n${itemLines}${selfReportHint}${boardAccessBlock()}`;

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
// only when a project has items Approved for Deployment) writes
// projects/{id}.deployNotifyRequestedAt, and this fires once on that write
// — same Slack-post-plus-Routine-fire shape as notifyOnProjectReadyForReview
// above, but for the opposite end of the pipeline: these items are already
// implemented, tested, and confirmed on their feature branches — nothing
// here should be investigated or re-implemented, only merged to main. See
// backlog-tracker/README.md for why the fire `text` says so explicitly
// rather than relying on the Routine's own shared prompt (which is written
// for a Backlog-shaped request) to infer that on its own.
exports.notifyOnProjectReadyToDeploy = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN, BOARD_API_KEY] },
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
      logger.info("Deploy notify requested but nothing is Approved for Deployment — nothing to notify or fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";

    // Fire the Routine BEFORE posting to Slack — same reordering
    // notifyOnProjectReadyForReview above already does, and for the same
    // reason: post the Slack message after the session id has resolved so
    // it can carry a real "track their progress" link instead of going out
    // blind. This function used to post first (Slack, then fire), which
    // meant sessionUrl was always null by the time the message was built —
    // a "Notify Claude — Deploy clicked" line with no session link and no
    // indication of which items, ever (FWHlgviqZxearPMvE9G2).
    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    let sessionId = null;
    let sessionUrl = null;
    let fireError = null;

    if (fireUrl && token) {
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
        .map((i, idx) => `${idx + 1}. [id: ${i.id}] [${i.type === "bug" ? "Bug" : "Feature"}] ${i.title} — ${i.desc}${i.deployCommit ? ` (commit ${i.deployCommit})` : ""}`)
        .join("\n");

      // Since the deployment train there is no per-item branch or PR to
      // find: every ticket this project has built is a commit on ONE
      // integration branch, and deploying means merging that branch once.
      // The Routine's job is to verify the train, not to match N PRs.
      const trainLine = `Integration branch (the deployment train): ${after.deployBranch || "(not set yet — this project has never built a ticket)"}\n`;

      // Same per-project addendum mechanism as the Backlog notify fire above
      // (a project's own Docs page can hand the Routine extra context either
      // request should know, e.g. which branch/PR naming convention to expect).
      const projectPromptBlock = (after.routinePromptMd || "").trim()
        ? `=== PROJECT-SPECIFIC INSTRUCTIONS FOR "${projectName}" (from this project's Docs page) ===\n${after.routinePromptMd.trim()}\n=== END PROJECT-SPECIFIC INSTRUCTIONS ===\n\n`
        : "";

      // Same self-report mechanism as notifyOnProjectReadyForReview's own
      // selfReportHint above, targeting deployRoutine instead of notifyRoutine
      // — until this existed, the "Deploy to Main" button had nothing to read
      // an in-progress state from at all, so it looked identical whether a
      // deploy was actually running or hadn't been requested yet.
      const selfReportHint = `\n\nWhen you finish this run (whether you completed everything or stopped early on a blocker), PATCH projects/${event.params.projectId} with deployRoutine.status set to "done" (or "error" with an errorMessage, if you stopped early) and deployRoutine.finishedAt set to now — the board shows a working/spinning state on its Deploy to Main button until it sees this.`;

      // Which product/program this project belongs to — the Deploy flow's
      // FAQ impact review (ROUTINE_INSTRUCTIONS.md step 3b) scopes the help
      // centre articles it may propose changes to by this. A hint only: the
      // Routine re-reads projects/{id}.programId itself as the authority.
      let programLine = "Product/Program: (none set on this project — only articles linked directly to this projectId are in scope for the FAQ impact review)\n";
      if (after.programId) {
        const programSnap = await getFirestore().collection("programs").doc(after.programId).get().catch(() => null);
        const pname = programSnap && programSnap.exists ? (programSnap.data().name || "") : "";
        programLine = `Product/Program: "${pname || "(unnamed)"}" (programId: ${after.programId}) — FAQ impact review scope: faqArticles with this programId, plus any with projectId ${event.params.projectId}\n`;
      }

      const skillsBlock = await phaseSkillsBlock(getFirestore(), "deploy", "DEPLOY");

      const text = `${projectPromptBlock}${skillsBlock}=== DEPLOY REQUEST for "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board ===\n` +
        trainLine +
        programLine +
        `These ${items.length} item${items.length === 1 ? "" : "s"} are already implemented, tested, and confirmed "Approved for Deployment" (ready-to-publish). Do NOT investigate, re-implement, or re-test them — follow ROUTINE_INSTRUCTIONS.md's "Notify Claude — Deploy" flow section for exactly what to do with each one, including its FAQ impact review step (3b), which proposes help-centre updates for a human to approve.\n\n` +
        `Items:\n${itemLines}${selfReportHint}${boardAccessBlock()}`;

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
          fireError = `Routine fire endpoint responded with status ${res.status}`;
          logger.error("Routine fire endpoint responded with a non-2xx status for deploy request", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          // Same response shape as notifyOnProjectReadyForReview's own fire
          // call above — see that function's comment for the research-preview
          // caveat on this field name.
          const body = await res.json().catch(() => null);
          sessionId = body?.claude_code_session_id || null;
          sessionUrl = sessionId ? `https://claude.ai/code/${sessionId}` : null;
          logger.info("Fired Claude Code Routine for deploy notify request", {
            projectId: event.params.projectId,
            itemCount: items.length,
            sessionId,
          });
        }
      } catch (err) {
        fireError = err instanceof Error ? err.message : String(err);
        logger.error("Failed to call Routine fire endpoint for deploy notify request", {
          projectId: event.params.projectId,
          error: fireError,
        });
      }

      // Lets the board show a spinner (or a visible error) instead of the
      // Deploy to Main button just looking idle after a click — see
      // deployNotifyButtonHTML in public/js/app.js. Same stale-after-20-minutes
      // client fallback as notifyRoutine protects this from ever wedging.
      await getFirestore().collection("projects").doc(event.params.projectId).set({
        deployRoutine: {
          status: fireError ? "error" : "in-progress",
          firedAt: new Date(),
          sessionId,
          sessionUrl,
          itemCount: items.length,
          errorMessage: fireError,
        },
      }, { merge: true });
    } else {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping Routine fire for deploy notify request",
        { projectId: event.params.projectId }
      );
    }

    // Slack (or whatever NOTIFY_WEBHOOK_URL points at) is independent of the
    // fire above — posts (with a session link if one was resolved) regardless
    // of whether the fire succeeded, same as notifyOnProjectReadyForReview's
    // own webhook post. Previously posted BEFORE the fire (so sessionUrl was
    // always null here) with a single bare "N items... will be merged" line
    // and no indication of which items — enriched per FWHlgviqZxearPMvE9G2 to
    // actually name each item (title, and its PR if one's already open, since
    // an Approved for Deployment item's fix was already pushed back at the
    // Backlog stage — see ROUTINE_INSTRUCTIONS.md) instead of only a count.
    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (webhookUrl) {
      const itemBullets = items
        .map((i) => `• ${i.title || i.desc || i.id}${i.prUrl ? ` (<${i.prUrl}|PR>)` : ""}`)
        .join("\n");
      const trackLine = sessionUrl
        ? `Click here to track their progress: ${sessionUrl}`
        : (fireUrl && token ? "(session link unavailable)" : "(Routine fire not configured — no Claude session started)");
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Claude was asked to deploy ${items.length} item${items.length === 1 ? "" : "s"} Approved for Deployment for "${projectName}":\n${itemBullets}\n${trackLine}`,
            projectId: event.params.projectId,
            projectName,
            itemCount: items.length,
            itemTitles: items.map((i) => i.title || i.desc || i.id),
            sessionUrl,
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
  }
);

// The board's "Groom Backlog" column-header CTA (Backlog column, shown only
// when that project's Backlog is non-empty — see groomNotifyButtonHTML in
// public/js/app.js) writes projects/{id}.groomRequestedAt, and this fires
// once on that write — same webhook-post + Routine-fire shape as
// notifyOnProjectReadyForReview above (fire the Routine before posting, so a
// resolved session id/url can ride along in the Slack message), but for a
// narrower, read-mostly request: classify and summarize every item currently
// in Backlog (correct `category`, write a plain-language summary of what the
// ticket is asking for and what's still missing before it could be built) —
// it must NOT investigate code, write patchFiles, set patchReady, or change
// status on anything. See ROUTINE_INSTRUCTIONS.md's own "Groom Backlog" flow
// section (keyed off the `=== GROOM REQUEST ===` marker in the fire text
// below) for exactly what a fired session does with this.
exports.notifyOnProjectReadyForGrooming = onDocumentUpdated(
  { document: "projects/{projectId}", secrets: [NOTIFY_WEBHOOK_URL, CLAUDE_ROUTINE_FIRE_URL, CLAUDE_ROUTINE_TOKEN, BOARD_API_KEY] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after?.groomRequestedAt) {
      return;
    }
    // Same "only a genuinely new timestamp fires this" guard as
    // notifyOnProjectReadyForReview above — any other write to the project
    // doc also lands on this update handler.
    const beforeMs = before?.groomRequestedAt?.toMillis?.() ?? 0;
    const afterMs = after.groomRequestedAt?.toMillis?.() ?? 0;
    if (afterMs <= beforeMs) {
      return;
    }

    const db = getFirestore();

    // Same two-equality-filter query (needs no composite index) as
    // notifyOnProjectReadyForReview's own Backlog count above — the ticket's
    // own "when there's items in the backlog" gate.
    const itemsSnap = await db.collection("backlogItems")
      .where("projectId", "==", event.params.projectId)
      .where("status", "==", "backlog")
      .get();
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (items.length === 0) {
      logger.info("Groom requested but Backlog is empty — nothing to groom or fire the Routine for", {
        projectId: event.params.projectId,
      });
      return;
    }

    const projectName = after.name || "A project";

    const fireUrl = CLAUDE_ROUTINE_FIRE_URL.value();
    const token = CLAUDE_ROUTINE_TOKEN.value();
    let sessionId = null;
    let sessionUrl = null;
    let fireError = null;

    if (fireUrl && token) {
      // Full id/title/desc per item — model on notifyOnProjectReadyForReview's
      // own itemLines above — so the fired session has everything it needs to
      // classify/summarize without a second Firestore round-trip.
      const itemLines = items
        .map((i, idx) => `${idx + 1}. [id: ${i.id}] [${i.type === "bug" ? "Bug" : "Feature"}] ${i.title} — ${i.desc}`)
        .join("\n");

      // Same per-project override/addendum mechanism as the other two Routine
      // fires (see their own comments above) — a project's Docs page can hand
      // the Routine extra context this generic request wouldn't otherwise know.
      const projectPromptBlock = (after.routinePromptMd || "").trim()
        ? `=== PROJECT-SPECIFIC INSTRUCTIONS FOR "${projectName}" (from this project's Docs page) ===\n${after.routinePromptMd.trim()}\n=== END PROJECT-SPECIFIC INSTRUCTIONS ===\n\n`
        : "";

      const selfReportHint = `\n\nWhen you finish this run (whether you groomed every item or stopped early on a blocker), PATCH projects/${event.params.projectId} with groomRoutine.status set to "done" (or "error" with an errorMessage, if you stopped early) and groomRoutine.finishedAt set to now — the board shows a working/spinning state on its Groom Backlog button until it sees this.`;

      const text = `${projectPromptBlock}=== GROOM REQUEST for "${projectName}" (projectId: ${event.params.projectId}) on the Backlog Tracker & FAQs board ===\n` +
        `This is a classify-and-summarize-only request, not an investigate-and-fix one. Do NOT investigate code, do NOT write patchFiles, do NOT set patchReady, do NOT change status on any item — follow ROUTINE_INSTRUCTIONS.md's own "Groom Backlog" flow section for exactly what to write on each item instead.\n\n` +
        `${items.length} item${items.length === 1 ? "" : "s"} in Backlog:\n${itemLines}${selfReportHint}${boardAccessBlock()}`;

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
          fireError = `Routine fire endpoint responded with status ${res.status}`;
          logger.error("Routine fire endpoint responded with a non-2xx status for groom request", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          // Same response shape as the other two fires above — see
          // notifyOnProjectReadyForReview's own comment for the
          // research-preview caveat on this field name.
          const body = await res.json().catch(() => null);
          sessionId = body?.claude_code_session_id || null;
          sessionUrl = sessionId ? `https://claude.ai/code/${sessionId}` : null;
          logger.info("Fired Claude Code Routine for groom request", {
            projectId: event.params.projectId,
            itemCount: items.length,
            sessionId,
          });
        }
      } catch (err) {
        fireError = err instanceof Error ? err.message : String(err);
        logger.error("Failed to call Routine fire endpoint for groom request", {
          projectId: event.params.projectId,
          error: fireError,
        });
      }

      // Lets the board show a spinner (or a visible error) on its Groom
      // Backlog button instead of the click looking like a no-op — same
      // shape as notifyRoutine/deployRoutine above, read by
      // groomNotifyButtonHTML in public/js/app.js.
      await db.collection("projects").doc(event.params.projectId).set({
        groomRoutine: {
          status: fireError ? "error" : "in-progress",
          firedAt: new Date(),
          sessionId,
          sessionUrl,
          itemCount: items.length,
          errorMessage: fireError,
        },
      }, { merge: true });
    } else {
      logger.warn(
        "CLAUDE_ROUTINE_FIRE_URL/CLAUDE_ROUTINE_TOKEN not set — skipping Routine fire for groom request",
        { projectId: event.params.projectId }
      );
    }

    const webhookUrl = NOTIFY_WEBHOOK_URL.value();
    if (webhookUrl) {
      const trackLine = sessionUrl
        ? `Click here to track their progress: ${sessionUrl}`
        : (fireUrl && token ? "(session link unavailable)" : "(Routine fire not configured — no Claude session started)");
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `Claude was asked to groom ${items.length} item${items.length === 1 ? "" : "s"} in the Backlog for "${projectName}" — classifying and summarizing only, no fixes. ${trackLine}`,
            projectId: event.params.projectId,
            projectName,
            itemCount: items.length,
            sessionUrl,
          }),
        });
        if (!res.ok) {
          logger.error("Groom notify webhook responded with a non-2xx status", {
            projectId: event.params.projectId,
            status: res.status,
            body: await res.text().catch(() => "<unreadable>"),
          });
        } else {
          logger.info("Notified webhook of Groom Backlog click", {
            projectId: event.params.projectId,
            itemCount: items.length,
          });
        }
      } catch (err) {
        logger.error("Failed to call notify webhook for groom request", {
          projectId: event.params.projectId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } else {
      logger.warn("NOTIFY_WEBHOOK_URL is not set — skipping Slack notification for Groom Backlog click", {
        projectId: event.params.projectId,
      });
    }
  }
);

// The board's "Approved for Deployment" project action (see deployToFeature() in
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
        "NOTIFY_WEBHOOK_URL is not set — skipping Slack notification for Approved for Deployment",
        { projectId: event.params.projectId }
      );
      return;
    }

    const projectName = after.name || "A project";
    const titles = Array.isArray(after.deployToFeatureItemTitles) ? after.deployToFeatureItemTitles : [];
    const text = `${projectName}: ${titles.length} item${titles.length === 1 ? "" : "s"} approved for deployment` +
      (titles.length ? `:\n${titles.map((t) => `• ${t}`).join("\n")}` : ".") +
      ` No new GitHub push happened — each item's code was already on its own feature branch from the Backlog stage.`;

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, projectId: event.params.projectId, projectName, itemTitles: titles }),
      });
      if (!res.ok) {
        logger.error("Approved for Deployment notify webhook responded with a non-2xx status", {
          projectId: event.params.projectId,
          status: res.status,
          body: await res.text().catch(() => "<unreadable>"),
        });
        return;
      }
      logger.info("Notified webhook of Approved for Deployment click", {
        projectId: event.params.projectId,
        itemCount: titles.length,
      });
    } catch (err) {
      logger.error("Failed to call notify webhook for Approved for Deployment", {
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

    const db = getFirestore();
    const itemId = event.params.itemId;

    // 1. Proposed FAQ revisions this ticket is a source of (written by the
    //    Deploy-flow Routine — ROUTINE_INSTRUCTIONS.md "FAQ impact review").
    //    Each goes live only once a person has approved it AND every source
    //    ticket is live; this ticket going live may be the last thing it was
    //    waiting on.
    const pendingSnap = await db.collection("faqArticles")
      .where("pendingRevision.sourceItemIds", "array-contains", itemId)
      .get();
    const handled = new Set();
    for (const articleDoc of pendingSnap.docs) {
      handled.add(articleDoc.id);
      await promoteFaqRevisionIfReady(db, articleDoc.ref, `ticket ${itemId} reached published-live`);
    }

    // 2. The older, coarser per-project safety net: opt-in via the Docs
    //    page's "FAQ review automation" toggle, flags every article linked
    //    to the project for a human look. Skips articles that already carry
    //    a specific proposal from step 1 — those have something concrete to
    //    review; a bare flag on top would be noise.
    if (!after.projectId) {
      return;
    }
    const projectSnap = await db.collection("projects").doc(after.projectId).get();
    if (!projectSnap.exists || !projectSnap.data().faqAutoFlagOnLive) {
      return;
    }

    const articlesSnap = await db.collection("faqArticles")
      .where("projectId", "==", after.projectId)
      .get();
    const toFlag = articlesSnap.docs.filter((d) => !handled.has(d.id) && !d.data().pendingRevision);
    if (!toFlag.length) {
      logger.info("FAQ auto-flag enabled but nothing left to flag for this project", {
        itemId,
        projectId: after.projectId,
      });
      return;
    }

    const batch = db.batch();
    toFlag.forEach((articleDoc) => {
      batch.set(articleDoc.ref, {
        needsReview: true,
        updatedAt: new Date(),
      }, { merge: true });
    });
    await batch.commit();

    logger.info("Flagged linked FAQ articles for review after merge to main", {
      itemId,
      projectId: after.projectId,
      articleCount: toFlag.length,
    });
  }
);

// ── Proposed FAQ revisions: approve + merge ⇒ go live ─────────────────────
// The Deploy-flow Routine parks a corrected article as faqArticles/{id}.
// pendingRevision {title, summary, bodyMd, keywords?, docType?, reason,
// sourceItemIds, reviewStatus: "awaiting-review", isNew?} and sets
// needsReview. A reviewer approves it in FAQ Management (reviewStatus ->
// "approved"). Two events can be the last one to happen — the approval, or
// the final source ticket reaching published-live — so both call this.
// Promotion copies the proposal into the live fields, keeps what it replaced
// under previousRevision (one-click revert in the console), clears the
// proposal and the flag, and publishes a proposal-created draft. The
// hourly FAQ export (faq-content.yml) then carries it to the static site.
const LIVE_OR_LATER = new Set(["published-live", "archived"]);

async function promoteFaqRevisionIfReady(db, articleRef, why) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(articleRef);
    if (!snap.exists) return;
    const a = snap.data();
    const rev = a.pendingRevision;
    if (!rev || rev.reviewStatus !== "approved") return;

    const ids = Array.isArray(rev.sourceItemIds) ? rev.sourceItemIds.filter((s) => typeof s === "string" && s) : [];
    // Every source ticket must be live (or archived, which only happens
    // after live). A ticket that no longer exists can't hold it up forever.
    for (const id of ids) {
      const itemSnap = await tx.get(db.collection("backlogItems").doc(id));
      if (itemSnap.exists && !LIVE_OR_LATER.has(itemSnap.data().status)) {
        logger.info("Approved FAQ revision still waiting on a source ticket", { articleId: articleRef.id, waitingOn: id, why });
        return;
      }
    }

    const now = new Date();
    const update = {
      title: typeof rev.title === "string" && rev.title.trim() ? rev.title : a.title,
      summary: typeof rev.summary === "string" ? rev.summary : (a.summary || ""),
      bodyMd: typeof rev.bodyMd === "string" ? rev.bodyMd : (a.bodyMd || ""),
      ...(Array.isArray(rev.keywords) ? { keywords: rev.keywords } : {}),
      ...(typeof rev.docType === "string" ? { docType: rev.docType } : {}),
      previousRevision: {
        title: a.title || "",
        summary: a.summary || "",
        bodyMd: a.bodyMd || "",
        replacedAt: now,
        sourceItemIds: ids,
        wasNew: !!rev.isNew,
      },
      pendingRevision: null,
      needsReview: false,
      lastPromotedAt: now,
      updatedAt: now,
      ...(rev.isNew || a.status !== "published" ? { status: "published", publishedAt: a.publishedAt || now } : {}),
    };
    // Firestore's admin SDK deletes a field only via FieldValue.delete();
    // a null pendingRevision is also what the console/rules treat as
    // "none", so keep null (simpler to query against) and let the client
    // read either.
    tx.set(articleRef, update, { merge: true });
    logger.info("Promoted approved FAQ revision to live", { articleId: articleRef.id, sourceItemIds: ids, why });
  });
}

exports.onFaqArticleRevisionApproved = onDocumentUpdated(
  "faqArticles/{articleId}",
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;
    const wasApproved = before.pendingRevision && before.pendingRevision.reviewStatus === "approved";
    const isApproved = after.pendingRevision && after.pendingRevision.reviewStatus === "approved";
    if (!isApproved || wasApproved) return;
    await promoteFaqRevisionIfReady(getFirestore(), event.data.after.ref, "revision approved in FAQ Management");
  }
);

// ── Wake backlog-automation.yml immediately ──────────────────────────────
// backlog-automation.yml is what turns a Routine's finished work into a
// commit on its project's integration branch (backlogItems.patchReady),
// takes a rejected ticket's commits back off it
// (backlogItems.revertRequested), and merges the whole train to main
// (projects.trainReady). It polls every 2 minutes —
// except GitHub throttles scheduled workflows well past their nominal
// interval under load: the gaps measured on 12 September 2026 were 07:36,
// 07:42, 07:49, 07:55, 08:06, 08:25. One patch-ready item waited about 10
// minutes for its PR and one merge-ready item about 12 for its merge, which
// was most of the wall-clock time in the entire workflow — the Claude
// session that did the actual work was never the slow part.
//
// So: the instant any of those flags turns true, dispatch the workflow
// directly (see dispatchBacklogAutomation below, shared with the
// project-level trigger).
// The schedule stays exactly as it is, as the safety net for whenever this
// token is missing or the dispatch call fails — this only ever makes the
// job run sooner, never instead.
//
// onDocumentWritten rather than onDocumentUpdated because an item can be
// created with patchReady already set (a Routine writing a finished patch
// straight onto a new card), and an update trigger never sees that.
exports.onBacklogItemReadyForAutomation = onDocumentWritten(
  { document: "backlogItems/{itemId}", secrets: [GH_DISPATCH_TOKEN] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) {
      return;
    }
    // Only a false/absent -> true transition. Every other write to the item
    // lands here too, including the automation's own write clearing the flag
    // again once it has acted — which is also what stops this from looping:
    // that write takes the flag true -> false, which is not a transition
    // this reacts to.
    const turnedOn = (field) => after[field] === true && before?.[field] !== true;
    // revertRequested is the train's own "take this rejected ticket's
    // commits back off the integration branch" signal (app.js's
    // failTesting -> processRevertFromTrain). It waits on the same 2-minute
    // schedule as everything else without this, and a rejected ticket
    // sitting on the branch is exactly the state worth shortening.
    const reasons = ["patchReady", "mergeReady", "revertRequested"].filter(turnedOn);
    if (reasons.length === 0) {
      return;
    }

    await dispatchBacklogAutomation({ itemId: event.params.itemId, reasons, title: typeof after.title === "string" ? after.title : null });
  }
);

// Fixes "Ready for Dev CTA stays hidden after all train tickets are
// deleted (stuck trainLocked)". projects/{id}.trainLocked only ever
// LATCHES true from app.js's deployToFeature() — firestore.rules lets the
// board write it in that one direction only — so clearing it again is
// entirely this backend's job. Before this trigger existed, the only path
// that ever cleared it was a successful merge
// (run-backlog-automation.js's finishTrain()/reconcileMergedTrains()).
// Deleting every ticket that had been approved for deployment, or
// rejecting them all via "Failed testing" (which reverts their commits off
// the branch — see processRevertFromTrain), empties the train without
// ever going through a merge, so the lock got stuck forever with nothing
// left in Ready for Testing or Approved for Deployment for Deploy to Main
// to act on either.
//
// train-lock.js holds the actual "is this project's train empty" decision
// (shared with run-backlog-automation.js's own reconcileLockedTrains(),
// which is the safety net for this same trigger and additionally
// archives/resets an orphaned integration branch — something only that
// script, with real git credentials, can do). This trigger only decides
// WHEN it's worth paying for a project + sibling-items read: a write that
// didn't change whether this one item occupies the train (the vast
// majority — a title edit, a note, a comment) is skipped outright, and an
// item newly joining the train can only make it fuller, never trigger an
// unlock.
exports.onBacklogItemTrainLockRecompute = onDocumentWritten(
  { document: "backlogItems/{itemId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const projectId = (after || before || {}).projectId;
    if (!projectId) return;

    const wasRelevant = isTrainRelevantItem(before);
    const isRelevantNow = isTrainRelevantItem(after);
    if (!wasRelevant || isRelevantNow) return; // relevance didn't just drop

    const db = getFirestore();
    const projectRef = db.collection("projects").doc(projectId);
    const projectSnap = await projectRef.get();
    if (!projectSnap.exists) return;
    const project = projectSnap.data();
    if (!project.trainLocked) return; // nothing to clear

    const itemsSnap = await db.collection("backlogItems").where("projectId", "==", projectId).get();
    const items = itemsSnap.docs.map((d) => d.data());
    if (!trainLockShouldClear(project, items)) return;

    logger.info("Train emptied by a backlogItems write — clearing trainLocked", {
      projectId, itemId: event.params.itemId,
    });
    await projectRef.set({
      trainLocked: false,
      trainStatus: "idle",
      // Whatever trainNote/trainStatus said before (including a stale
      // "conflict" left over from before the tickets were removed) stops
      // applying — there is nothing left on the train for it to describe.
      trainNote: null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
);

// The train's other trigger, on the PROJECT rather than an item: the Deploy
// CTA's Routine sets projects/{id}.trainReady once it has verified every
// ticket in the DEPLOY REQUEST really is on the integration branch and
// nothing on that branch is still in testing. Same "don't wait out the
// 2-minute schedule" reasoning as onBacklogItemReadyForAutomation above —
// this is the click a person is actually watching, so it is the worst one
// to leave sitting.
exports.onProjectReadyForAutomation = onDocumentWritten(
  { document: "projects/{projectId}", secrets: [GH_DISPATCH_TOKEN] },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) {
      return;
    }
    if (after.trainReady !== true || before?.trainReady === true) {
      return;
    }
    await dispatchBacklogAutomation({ projectId: event.params.projectId, reasons: ["trainReady"], title: typeof after.name === "string" ? after.name : null });
  }
);

// Backfills the skill change-history audit trail (eKFIGtskqbnUTqUTBFBl) for
// a skill edited directly on the console. update_skill/delete_skill in
// functions/mcp-server.js already write to docRevisions themselves, inline,
// before the skills/{id} write commits — but the console's own Add/Edit
// skill modal (public/js/app.js) writes straight to Firestore with the
// client SDK, which firestore.rules forbids from ever writing docRevisions
// (`allow write: if false` — server-only, on purpose, so an agent can't
// tamper with its own history). Without this trigger, only MCP-originated
// changes would ever show up in the Skills page's "Change history" view,
// which is most of the point ("full visibility of every change") for a
// team that mostly edits skills from the console, not over MCP.
//
// Console writes tag themselves `lastWriteVia: "console"`; an MCP write
// tags itself "mcp" and this trigger skips those outright — it already has
// its revision, recorded synchronously by the tool itself (which is also
// the only way an MCP tool can hand its caller a revisionId in the same
// response). For an update, this makes the decision from before/after data
// alone: no query needed, so no risk of a race with the write that triggered
// it. For a delete there is no "after" doc to carry that tag, so this falls
// back to asking whether delete_skill already recorded one — a skill's
// Firestore doc id is never reused once deleted, so "does a skill.deleted
// revision already exist for this id" can never give a false answer either
// way.
exports.onSkillWritten = onDocumentWritten(
  { document: "skills/{skillId}" },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    const db = getFirestore();

    if (!before) return; // creation — nothing to have replaced yet

    if (after) {
      // Update. Only a files change is ever worth a revision (matches
      // update_skill's own "only record when files change" behavior) —
      // renaming a skill or editing its summary/version/owningTeam isn't
      // something the "what did this replace" history needs to carry.
      const beforeFiles = JSON.stringify(Array.isArray(before.files) ? before.files : []);
      const afterFiles = JSON.stringify(Array.isArray(after.files) ? after.files : []);
      if (beforeFiles === afterFiles) return;
      if (after.lastWriteVia === "mcp") return; // update_skill already recorded this

      await db.collection("docRevisions").add({
        target: "skill",
        skillId: event.params.skillId,
        slug: after.slug || before.slug || null,
        name: before.name || after.name || "",
        contentMd: beforeFiles,
        chars: beforeFiles.length,
        replacedAt: FieldValue.serverTimestamp(),
        replacedByEmail: after.updatedByEmail || before.updatedByEmail || null,
        via: "console",
      });
      return;
    }

    // Delete. Skip if delete_skill (mcp-server.js) already recorded this
    // exact deletion — see the comment above for why this check is safe.
    const already = await db.collection("docRevisions")
      .where("skillId", "==", event.params.skillId)
      .where("target", "==", "skill.deleted")
      .limit(1)
      .get();
    if (!already.empty) return;

    const contentMd = JSON.stringify({
      name: before.name || "", slug: before.slug || "", summary: before.summary || "",
      version: before.version || "", owningTeam: before.owningTeam || null,
      files: Array.isArray(before.files) ? before.files : [],
    });
    await db.collection("docRevisions").add({
      target: "skill.deleted",
      skillId: event.params.skillId,
      slug: before.slug || null,
      name: before.name || "",
      contentMd,
      chars: contentMd.length,
      replacedAt: FieldValue.serverTimestamp(),
      replacedByEmail: before.updatedByEmail || before.createdByEmail || null,
      via: "console",
    });
  }
);

// Fires backlog-automation.yml immediately via repository_dispatch. Shared
// by both triggers above; the workflow's own 2-minute schedule stays as the
// safety net for whenever the token is missing or this call fails, so a
// failure here is logged and swallowed rather than thrown (a thrown error
// would have Cloud Functions retry the write, and a retried dispatch is
// pure noise when the schedule already covers it).
async function dispatchBacklogAutomation({ itemId = null, projectId = null, reasons, title }) {
  const logCtx = { itemId, projectId, reasons };
  // "unset" is the placeholder the deploy workflow writes when no repo
  // secret supplies a real token, so that the secret these functions
  // declare always exists in Secret Manager — see that workflow's
  // "Sync GH_DISPATCH_TOKEN" step for why a missing secret would
  // otherwise fail the whole deploy, hosting and Firestore rules
  // included. Treated as not configured.
  const token = (GH_DISPATCH_TOKEN.value() || "").trim();
  if (!token || token === "unset") {
    logger.warn(
      "GH_DISPATCH_TOKEN is not set — not dispatching backlog-automation.yml; " +
      "the workflow's own schedule will pick this up within a few minutes",
      logCtx
    );
    return;
  }

  try {
    const res = await fetch(`https://api.github.com/repos/${AUTOMATION_REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        // GitHub's API rejects a request with no User-Agent outright.
        "User-Agent": "backlog-tracker-functions",
      },
      // client_payload is diagnostic only — the workflow re-reads every
      // flagged item and project from Firestore itself rather than trusting
      // what arrives here, so a dispatch can never aim the trusted job at
      // something that is not actually ready.
      body: JSON.stringify({
        event_type: AUTOMATION_DISPATCH_EVENT,
        client_payload: { itemId, projectId, reasons, title },
      }),
    });
    // A successful repository_dispatch is 204 No Content.
    if (res.status !== 204) {
      logger.error("GitHub repository_dispatch returned an unexpected status", {
        ...logCtx,
        status: res.status,
        body: await res.text().catch(() => "<unreadable>"),
      });
      return;
    }
    logger.info("Dispatched backlog-automation.yml", logCtx);
  } catch (err) {
    logger.error("Failed to dispatch backlog-automation.yml", {
      ...logCtx,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── boardApi: authenticated Firestore REST proxy for automation ───────────
// The board's Firestore rules require a signed-in editor for every board
// collection, so the Claude Code sessions the Notify Claude Routines fire
// (which used to call Firestore's REST API anonymously — see
// ROUTINE_INSTRUCTIONS.md) can no longer talk to Firestore directly. This
// endpoint is their replacement: a transparent proxy onto the same REST API,
// authenticated with a shared key instead of a Google sign-in.
//
//   https://<region>-backlog-tracker-e4ed2.cloudfunctions.net/boardApi/v1/projects/backlog-tracker-e4ed2/databases/(default)/documents/...
//   header: X-Board-Key: <BOARD_API_KEY>
//
// Same paths, verbs, query strings and JSON bodies as
// https://firestore.googleapis.com/v1/... — only the host changes and the
// header is added — restricted to the board's own collections. The function
// runs as the project's service account, which bypasses rules. The key
// lives in Secret Manager (BOARD_API_KEY, synced from the GitHub repo secret
// of the same name by the deploy workflow); an unset placeholder disables
// the endpoint entirely.
const { onRequest } = require("firebase-functions/v2/https");
const { GoogleAuth } = require("google-auth-library");
// "skills" and "settings" (settings/phaseSkillBindings) added alongside the
// phase-bound-skills mechanism (l5mjAANU0dfveGhxmDjm) — a fired Routine
// session following a BUILD/DEPLOY skills block needs to read the skills
// library, and this is the fallback board-access path it's told to use if
// identitytoolkit.googleapis.com is unreachable (see ROUTINE_INSTRUCTIONS.md
// "Board access"). Both collections are already isBoardReader()-readable
// straight from Firestore; this just lets the same read work through the
// proxy too.
const BOARD_API_COLLECTIONS = ["projects", "programs", "backlogItems", "interfaces", "projectDocs", "faqCategories", "faqArticles", "skills", "settings"];
const FIRESTORE_HOST = "https://firestore.googleapis.com";
const FIRESTORE_DOCS = `/v1/projects/${process.env.GCLOUD_PROJECT || "backlog-tracker-e4ed2"}/databases/(default)/documents`;

function timingSafeEqual(a, b) {
  const crypto = require("crypto");
  const ab = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
function boardApiPathAllowed(pathname, body) {
  if (!pathname.startsWith(FIRESTORE_DOCS)) return false;
  const rest = pathname.slice(FIRESTORE_DOCS.length);
  if (rest === ":runQuery" || rest === ":batchGet" || rest === ":commit") {
    // Body must only reference allowed collections.
    const text = JSON.stringify(body || {});
    const ids = [...text.matchAll(/"collectionId"\s*:\s*"([^"]+)"/g)].map((m) => m[1]);
    const names = [...text.matchAll(/documents\/([A-Za-z]+)\//g)].map((m) => m[1]);
    return [...ids, ...names].every((c) => BOARD_API_COLLECTIONS.includes(c));
  }
  const first = rest.replace(/^\//, "").split("/")[0].split(":")[0];
  return BOARD_API_COLLECTIONS.includes(first);
}

exports.boardApi = onRequest({ secrets: [BOARD_API_KEY], cors: false, timeoutSeconds: 60 }, async (req, res) => {
  const configured = BOARD_API_KEY.value();
  const presented = req.get("x-board-key") || "";
  if (!configured || configured === "unset") { res.status(503).json({ error: "boardApi is not configured (BOARD_API_KEY unset)" }); return; }
  if (!presented || !timingSafeEqual(presented, configured)) { res.status(401).json({ error: "missing or invalid X-Board-Key" }); return; }
  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method)) { res.status(405).json({ error: "method not allowed" }); return; }
  // Depending on which URL form invoked us the function name may or may not
  // still be on the path; normalise so both work.
  const url = new URL((req.originalUrl || req.url).replace(/^\/boardApi(?=\/|$)/, ""), FIRESTORE_HOST);
  if (!boardApiPathAllowed(url.pathname, req.body)) { res.status(403).json({ error: "path or collection not allowed" }); return; }
  try {
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/datastore"] });
    const client = await auth.getClient();
    const { token } = await client.getAccessToken();
    const upstream = await fetch(FIRESTORE_HOST + url.pathname + url.search, {
      method: req.method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: ["POST", "PATCH"].includes(req.method) ? JSON.stringify(req.body || {}) : undefined,
    });
    const text = await upstream.text();
    res.status(upstream.status).set("Content-Type", "application/json").send(text);
  } catch (err) {
    logger.error("boardApi proxy failed", { error: err instanceof Error ? err.message : String(err) });
    res.status(502).json({ error: "upstream request failed" });
  }
});

// ── PH Agent Console MCP server ───────────────────────────────────────────
// Lets a team member's own AI agent use this board as a tool, signing in
// with the same Personalisation Hub / offline2online account they use for
// the console itself — an OAuth 2.1 flow over Firebase Auth, not a shared
// key. Deliberately separate from boardApi above: boardApi is ONE shared
// secret for the Routine's own automation, this is per-person, per-token,
// revocable access with the writer's email attached to everything it does.
// Required after initializeApp() has run, since it uses the admin SDK.
// See ../MCP.md for the full flow and the tool list.
const mcp = require("./mcp-server");
exports.mcpServer = mcp.mcpServer;
exports.syncConsoleUserClaims = mcp.syncConsoleUserClaims;
