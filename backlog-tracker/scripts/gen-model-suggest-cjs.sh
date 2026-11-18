#!/bin/sh
# Regenerates functions/model-suggest.js (CommonJS) from public/js/model-suggest.js.
# test/model-suggest.test.js fails when the two drift.
cd "$(dirname "$0")/.." || exit 1
{
  echo '"use strict";'
  echo '// GENERATED from public/js/model-suggest.js by scripts/gen-model-suggest-cjs.sh — edit that file, then run this script.'
  sed 's/^export //' public/js/model-suggest.js
  echo
  echo 'module.exports = { MODEL_SUGGEST_VERSION, LONG_DESC_CHARS, MANY_BUILD_ITEMS, AUTO_REVIEW_REASONS, pathsIn, projectsTouched, numberedBuildItems, suggestModel, explicitModel, buildInFlight, autoModelFields, isOpusModelId, modelChipText, suggestionHint, reviewNeedsOpus, reviewedForCommit, needsAutoReview, rendersUI, buildsByModel };'
} > functions/model-suggest.js
