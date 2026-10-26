// Pure, dependency-free write logic for the Failed testing dialog's two
// outcomes. No Firebase, no DOM: testable with plain node
// (test/follow-up.test.mjs) and imported as-is by public/js/app.js, which
// wraps the results with arrayUnion / serverTimestamp / doc() / writeBatch.
//
// "Something's wrong — send it back" is the long-standing behaviour (the card
// goes to Backlog and its commits are reverted off the train). "It works, but
// I want something more" keeps the card and its commit where they are and
// files the extra request as a NEW Backlog ticket linked by followUpOf.
import { applyAnswers } from "./ticket-intake.js";

export const FAILED_TESTING_CHOICES = {
  SEND_BACK: "send-back",
  FOLLOW_UP: "follow-up",
};
export const DEFAULT_FAILED_TESTING_CHOICE = FAILED_TESTING_CHOICES.SEND_BACK;

// firestore.rules' isValidItemCommon caps.
export const DESC_MAX = 10000;
export const TITLE_MAX_CHARS = 200;

// The one category that means "take it off this release" rather than "fix it".
export const NO_REBUILD_CATEGORY = "Blocking a release, not a rebuild";

// The Failed testing write. `at` is the Date stamped on both
// lastFailureReason and the note.
export function sendBackFields({ category, text, at }) {
  return {
    status: "backlog",
    // Nothing leaves Ready for Testing rejected without coming off the
    // branch: run-backlog-automation.js's processRevertFromTrain picks this
    // flag up and reverts the card's commits. A card in Backlog must never
    // have live commits on a train.
    revertRequested: true,
    // ...and once it is off, it is rebuilt with this reason as its brief
    // (26 Oct 2026). Before, a failed ticket waited in Backlog for someone to
    // click Ready for Dev again, and often sat there: a test failure is a fix
    // to make, not a decision to take. Except when the tester only wants it
    // off the release.
    rebuildAfterRevert: category !== NO_REBUILD_CATEGORY,
    lastFailureReason: { category, text, action: "failed-testing", at },
    note: { author: "viewer", text: `Failed testing [${category}]: ${text}`, at },
  };
}

function clip(s, max) {
  return s.length <= max ? s : s.slice(0, max);
}

// The follow-up: one new Backlog ticket plus a note on the original. Returns
// {error} (and no writes) for empty text or an original with no project.
// Otherwise {newId, newItem, originalNote}; `newItem.notes` holds the one
// note on the new ticket. Nothing here touches the original's status or any
// pipeline field.
export function followUpWrites({ original, text, title, author, at, newId }) {
  const body = String(text || "").trim();
  if (!body) return { error: "Say what you'd like added." };
  if (!original || !original.projectId) return { error: "This ticket has no project, so a follow-up can't be filed against it." };

  const origTitle = String(original.title || "Untitled").replace(/\s+/g, " ").trim();
  const branch = original.deployBranch ? ` (on train branch ${original.deployBranch})` : "";
  const ref = `"${origTitle}" (${original.id})${branch}`;
  const answers = {
    deps: `Builds on ${ref}, which stays in Ready for Testing. No other ticket needed.`,
    spec: `Follow-up to ${ref} — see that ticket's description and Test steps.`,
  };

  let desc = applyAnswers("", { outcome: body, ...answers });
  if (desc.length > DESC_MAX) {
    const over = desc.length - DESC_MAX;
    desc = applyAnswers("", { outcome: clip(body, Math.max(1, body.length - over)), ...answers });
  }
  desc = clip(desc, DESC_MAX);

  const who = author || "viewer";
  return {
    newId,
    newItem: {
      projectId: original.projectId,
      title: clip(String(title || body).trim() || "Follow-up", TITLE_MAX_CHARS),
      desc,
      type: "feature",
      category: original.category || "Uncategorised",
      status: "backlog",
      followUpOf: original.id,
      notes: [{ author: who, text: `Follow-up of "${origTitle}" (${original.id}), requested from Ready for Testing`, at }],
    },
    originalNote: { author: who, text: `Follow-up requested: ${body} → new Backlog ticket ${newId}`, at },
  };
}
