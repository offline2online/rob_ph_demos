// A train waiting on CI starts its own next automation run instead of
// waiting for the */2 schedule, which GitHub throttled to one run every
// 75-90 minutes on 4 Oct 2026 (PRs #308 and #311 sat green, unmerged).
// Run with:  node test/train-follow-up.test.js
"use strict";
const assert = require("assert");
const { followUpDue, FOLLOW_UP_MAX_WAIT_MS } = require("../scripts/run-backlog-automation.js");
const now = Date.parse("2026-10-04T06:30:00Z");
assert.strictEqual(followUpDue(null, now), true, "first wait: dispatch the follow-up");
assert.strictEqual(followUpDue(now - 10 * 60 * 1000, now), true, "10 minutes in: keep going");
assert.strictEqual(followUpDue(now - FOLLOW_UP_MAX_WAIT_MS - 1000, now), false, "past the cap: leave it to the schedule (no endless loop)");
assert.strictEqual(FOLLOW_UP_MAX_WAIT_MS, 45 * 60 * 1000);
console.log("train-follow-up.test.js: all passed");
