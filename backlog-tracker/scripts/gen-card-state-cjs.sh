#!/bin/sh
# Regenerates functions/card-state.js (CommonJS) from public/js/card-state.js.
# test/card-state.test.mjs fails when the two drift.
cd "$(dirname "$0")/.." || exit 1
{
  echo '"use strict";'
  echo '// GENERATED from public/js/card-state.js by scripts/gen-card-state-cjs.sh — edit that file, then run this script.'
  sed 's/^export //' public/js/card-state.js
  echo
  echo 'module.exports = { WAITING_ON, AGE_THRESHOLDS, TRAIN_STUCK_THRESHOLDS, TRAIN_STUCK_LABELS, toMillis, ageLabel, statusEnteredMs, onTrain, cardState, deployGate, trainStuckReason, trainStuckPatch, trainState, needsAttention, waitingOnMe, statusEnteredPatch };'
} > functions/card-state.js
