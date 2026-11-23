"use strict";
// Per-ticket model requirement (ticket t1CU2q6LlxGd5pFB9vwG, 13 Nov 2026).
//
// A ticket's `model` says which Claude model its build and its code review
// must run on: "standard" (the default, and what an unset field means) or
// "advanced" (the most capable model, Claude Opus). It replaces the free-text
// "MODEL REQUIREMENT: Opus" line two tickets carried in their description,
// which nothing enforced.
//
// The fire endpoint takes only `text`, and the Routine's own model is set at
// claude.ai/code/routines, so the requirement travels in the fire text
// (modelRequirementBlock) and the session honours it as
// ROUTINE_INSTRUCTIONS.md → "Per-ticket model requirement" says: run on Opus,
// or hand the whole build to an Opus subagent, or do not build and flag the
// ticket `blocked: {reason: "model-unavailable"}`. Whichever model did the
// work is recorded on the card (builtByModel / reviewedByModel), and
// run-backlog-automation.js refuses to land an Advanced ticket's patch whose
// builtByModel is not an Opus (modelGuardRefusal) — the backstop for a session
// that ignored the block.
//
// The guard judges a patch against the requirement its build was fired with
// (18 Nov 2026, ticket 6Nia0yWu8yAL3STGh96R). Each fire records the ticket's
// model on the card as lastFire.model; when the model on the card is the
// classifier's (modelAuto) rather than a person's choice, the guard uses the
// fired one for the attempt that handed back. Two finished Standard builds were
// refused on 18 Nov 2026 because the classifier re-marked the ticket Advanced
// from the build session's own hand-over wording. A person's explicit choice
// (or an escalation) still counts as it stands.
//
// When an Advanced (Opus) Routine is configured (modelRoutineBindings/advanced,
// set by an admin with the MCP tool set_advanced_routine_binding), an Advanced
// ticket that would otherwise fire on the shared Routine fires on that one
// instead, so it runs on Opus from the start; without one it fires on the
// shared Routine with the block below, as before.
//
// The advisor model (ticket MoCADJ47kT9a77tg4cfW, 23 Nov 2026). When a ticket
// raises a question or needs analysis or support before it can be built (a
// choice it leaves open, a blocker, something to clarify or investigate), the
// build session consults Fable (claude-fable-5-2) as the advisor instead of
// stopping on the question: the Agent tool with model "fable". Fable's advice
// is posted on the card as a note starting ADVISOR_NOTE_PREFIX and the build
// carries on with it. Fable only advises. The build and the review still run
// on the ticket's model, and an Advanced ticket is never built on Fable:
// isAdvancedModelId does not match it, so modelGuardRefusal refuses such a
// patch (the earlier bug where Advanced builds came back from claude-fable-5-2
// and were flagged model-unavailable). Every build fire carries advisorBlock()
// through modelRequirementBlock, Standard and Advanced alike.
//
// Shared by functions/index.js, functions/mcp-server.js and
// scripts/run-backlog-automation.js. public/js/app.js keeps its own copy of
// the two values and labels (a browser module can't require this file).

const MODEL_REQUIREMENTS = ["standard", "advanced"];
const DEFAULT_MODEL_REQUIREMENT = "standard";
const MODEL_UNAVAILABLE_REASON = "model-unavailable";
const MODEL_LABELS = { standard: "Standard", advanced: "Advanced (Opus)" };
// The Agent tool's model alias for the most capable model.
const ADVANCED_AGENT_MODEL = "opus";
// The advisor: its exact model id, the Agent tool's alias for it, and how its
// advice starts on the card.
const ADVISOR_MODEL = "claude-fable-5-2";
const ADVISOR_AGENT_MODEL = "fable";
const ADVISOR_NOTE_PREFIX = `[advisor · ${ADVISOR_MODEL}]`;

function normaliseModelRequirement(value) {
  return value === "advanced" ? "advanced" : DEFAULT_MODEL_REQUIREMENT;
}

function requiresAdvancedModel(item) {
  return !!item && normaliseModelRequirement(item.model) === "advanced";
}

// A model id or name such as "claude-opus-5-5" or "Claude Opus 5.5".
function isAdvancedModelId(modelId) {
  return typeof modelId === "string" && /\bopus\b|-opus-|opus-\d/i.test(modelId);
}

// A model id or name such as "claude-fable-5-2" or "Claude Fable 5.2": the
// advisor, never a build model for an Advanced ticket.
function isAdvisorModelId(modelId) {
  return typeof modelId === "string" && /\bfable\b|-fable-|fable-\d/i.test(modelId);
}

// The advisor rule every build fire carries. Pure.
function advisorBlock(item) {
  const advanced = requiresAdvancedModel(item);
  return `\n\n=== ADVISOR: Fable (${ADVISOR_MODEL}) ===\n` +
    "When this ticket raises a question, or needs analysis or support before it can be built (a choice it leaves open, a blocker, something to clarify or investigate), do not stop on it and do not ask a person: consult the advisor. Follow ROUTINE_INSTRUCTIONS.md → \"The advisor model (Fable)\":\n" +
    `- Use the Agent tool with model "${ADVISOR_AGENT_MODEL}" (${ADVISOR_MODEL}). Brief it with the ticket, its comments and notes, what you found in the code and the exact question or analysis needed; ask it to say first which model id it runs as, then to give one recommendation and its reasoning.\n` +
    `- Append its advice to this card as a note whose text starts "${ADVISOR_NOTE_PREFIX}" (Setup → "Append a note"), then carry on with the build on its recommendation and say under "Assumed:" what you took.\n` +
    `- The advisor only advises: it writes no code, tests or patchFiles and never does the build. ${advanced ? `This ticket is Advanced: it is built on Claude Opus, and builtByModel is never ${ADVISOR_MODEL}.` : "builtByModel names the model that did the build, never the advisor."}\n` +
    "- If you still have to flag the card waiting-on-input (only for something a person alone can supply), put the advisor's recommendation in blocked.recommendation.\n" +
    "- If the advisor is unavailable (no Agent tool, or it fails to start or reports another model), decide as the ticket's Outcome, the spec and the code best fit, and say in the note that the advisor was unavailable.\n" +
    "=== END ADVISOR ===";
}

// The requirement a handed-back patch is judged against. A person's choice (or
// an escalation) is binding as it stands now. A model the classifier set
// (modelAuto) is judged as it was when this build attempt was fired
// (lastFire.model, for the attempt named by patchAttemptId, or the card's
// current buildAttemptId when the patch carries none). Anything else: the
// card's model. Pure.
function requiredModelForBuild(item) {
  if (!item) return DEFAULT_MODEL_REQUIREMENT;
  const current = normaliseModelRequirement(item.model);
  if (item.modelAuto !== true) return current;
  const fire = item.lastFire;
  const attempt = item.patchAttemptId || item.buildAttemptId;
  if (fire && typeof fire.model === "string" && fire.buildAttemptId && attempt && fire.buildAttemptId === attempt) {
    return normaliseModelRequirement(fire.model);
  }
  return current;
}

// The block a build fire carries. An Advanced ticket gets the full rule; a
// Standard one only the line asking the session to record its model, so the
// card says which model built every ticket. Both end with the advisor rule.
function modelRequirementBlock(item) {
  return requirementOnlyBlock(item) + advisorBlock(item);
}
function requirementOnlyBlock(item) {
  if (!requiresAdvancedModel(item)) {
    return "\n\nModel requirement: Standard (the default build model). In the same PATCH as patchFiles/patchReady, set builtByModel to the exact model id this session runs as (e.g. claude-sonnet-5-5).";
  }
  return "\n\n=== MODEL REQUIREMENT: ADVANCED (Claude Opus) ===\n" +
    "This ticket is marked Advanced: it must be built on the most capable Claude model, Claude Opus, never on a lesser one. Follow ROUTINE_INSTRUCTIONS.md → \"Per-ticket model requirement\":\n" +
    "- If this session runs as an Opus model, build it here.\n" +
    `- Otherwise hand the whole build to a subagent on Opus (the Agent tool with model "${ADVANCED_AGENT_MODEL}"), passing it this full request, and have it report the exact model id it ran as.\n` +
    `- If no Opus is available (no Agent tool, the subagent reports a non-Opus model, or it fails to start), do NOT build it on a weaker model: PATCH the card with blocked {reason: "${MODEL_UNAVAILABLE_REASON}", note: "Not built: this ticket needs Claude Opus and none was available to this build session. Clear the flag to try again."}, append a note saying which model was available, and set buildSession.status "error".\n` +
    "- In the same PATCH as patchFiles/patchReady, set builtByModel to the exact model id that did the build (e.g. claude-opus-5-5). The automation refuses an Advanced ticket's patch whose builtByModel is not an Opus.\n" +
    "=== END MODEL REQUIREMENT ===";
}

// One line per ticket in a Review Batch fire.
function reviewModelTag(item) {
  return requiresAdvancedModel(item) ? " [Model: Advanced — review on Claude Opus only]" : " [Model: Standard]";
}

// Why the automation must not land this patch, or null. Pure.
function modelGuardRefusal(item) {
  if (requiredModelForBuild(item) !== "advanced") return null;
  if (isAdvancedModelId(item.builtByModel)) return null;
  const built = typeof item.builtByModel === "string" && item.builtByModel.trim() ? item.builtByModel.trim() : "an unrecorded model";
  return {
    why: `Not built: this ticket is marked Advanced and must be built on Claude Opus, but its patch was handed back by ${built}. ` +
      "The patch was not landed. Clear the flag to build it again (ROUTINE_INSTRUCTIONS.md → \"Per-ticket model requirement\").",
    blocked: {
      reason: MODEL_UNAVAILABLE_REASON,
      note: "Not built: this ticket needs Claude Opus and the build that came back was not on Opus. Clear the flag to try again.",
    },
  };
}

// Escalate after failed rounds (CCPnRjXOH4YMsfy3C49r, "Flow 8/9"). A Standard
// ticket that has been sent back twice (countedSendBacks: Failed testing, a
// train test ejection, a review kick-back — see functions/test-rounds.js), or
// whose patch was refused twice (autoRebuilds: a conflict, a migration clash,
// a placeholder left in the description), is raised to Advanced before its
// next rebuild fires. Once only: modelEscalatedAt marks it, and an escalated
// model is a choice (modelAuto false), so a later description edit's
// suggestion never lowers it again. Pure.
const ESCALATE_AFTER = 2;
const ESCALATION_NOTE = "Raised to Advanced after 2 failed rounds";
function modelEscalation(item, { countedSendBacks, autoRebuilds, now = new Date() } = {}) {
  if (!item || requiresAdvancedModel(item) || item.modelEscalatedAt) return null;
  const sent = Number(countedSendBacks ?? item.countedSendBacks) || 0;
  const refused = Number(autoRebuilds ?? item.autoRebuilds) || 0;
  if (sent < ESCALATE_AFTER && refused < ESCALATE_AFTER) return null;
  const why = sent >= ESCALATE_AFTER ? `sent back ${sent} times` : `its patch was refused ${refused} times`;
  return {
    fields: { model: "advanced", modelAuto: false, modelEscalatedAt: now },
    note: `${ESCALATION_NOTE} (${why}): its next build runs on Claude Opus. A person can set it back to Standard in Edit item.`,
  };
}

module.exports = {
  ESCALATE_AFTER, ESCALATION_NOTE, modelEscalation,
  MODEL_REQUIREMENTS, DEFAULT_MODEL_REQUIREMENT, MODEL_UNAVAILABLE_REASON, MODEL_LABELS, ADVANCED_AGENT_MODEL,
  ADVISOR_MODEL, ADVISOR_AGENT_MODEL, ADVISOR_NOTE_PREFIX,
  normaliseModelRequirement, requiresAdvancedModel, requiredModelForBuild, isAdvancedModelId, isAdvisorModelId,
  modelRequirementBlock, advisorBlock, reviewModelTag, modelGuardRefusal,
};
