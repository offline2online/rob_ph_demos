// `npm test`: the whole Staff Kanban end-to-end suite across the viewport matrix (lib/profiles.mjs),
// several profiles at a time. `npm run test:serial` runs the same cases in one process.
import { wantedProfiles } from "./lib/profiles.mjs";
import { runMatrix } from "./lib/matrix-run.mjs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const profiles = wantedProfiles();
if (!profiles.length) { console.error("No profile matches KB_PROFILES / KB_ENGINES."); process.exit(2); }
const { ok } = await runMatrix({ name: "Staff Kanban prototype — end to end", command: process.execPath, args: ["--test", "--test-concurrency=1", "e2e.test.mjs"], cwd: here, profiles });
process.exit(ok ? 0 : 1);
