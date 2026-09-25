// The source of truth for "what's actually live", alongside the footer it's
// rendered into. No build step exists here to derive it from git.
//
// Bumped automatically now, ONCE PER DEPLOYMENT, by
// scripts/run-backlog-automation.js's processDeployTrain: it reads this
// value off `main`, increments the third number, and commits the result on
// the project's integration branch just before opening that train's PR.
// Individual tickets no longer touch this file — every PR bumping the same
// line was what made any two open PRs conflict on this file alone, which is
// half of why the deployment train exists.
//
// Edit it by hand only for a change that ships outside that pipeline.
export const APP_VERSION = "1.5.82";
