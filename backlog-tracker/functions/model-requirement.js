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
// Shared by functions/index.js, functions/mcp-server.js and
// scripts/run-backlog-automation.js. public/js/app.js keeps its own copy of
// the two values and labels (a browser module can't require this file).

const MODEL_REQUIREMENTS = ["standard", "advanced"];
const DEFAULT_MODEL_REQUIREMENT = "standard";
const MODEL_UNAVAILABLE_REASON = "model-unavailable";
const MODEL_LABELS = { standard: "Standard", advanced: "Advanced (Opus)" };
// The Agent tool's model alias for the most capable model.
const ADVANCED_AGENT_MODEL = "opus";

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

// The block a build fire carries. An Advanced ticket gets the full rule; a
// Standard one only the line asking the session to record its model, so the
// card says which model built every ticket.
function modelRequirementBlock(item) {
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
  if (!requiresAdvancedModel(item)) return null;
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

module.exports = {
  MODEL_REQUIREMENTS, DEFAULT_MODEL_REQUIREMENT, MODEL_UNAVAILABLE_REASON, MODEL_LABELS, ADVANCED_AGENT_MODEL,
  normaliseModelRequirement, requiresAdvancedModel, isAdvancedModelId,
  modelRequirementBlock, reviewModelTag, modelGuardRefusal,
};
