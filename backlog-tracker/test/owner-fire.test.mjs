// The console's half of owner-only firing for agent tickets
// (xFzQgynkoMdV33iWJFZq): which Ready for Dev / Deploy to Main / Groom
// Backlog controls a viewer may use. public/js/owner-fire.js is pure.
//
// Run with:  node test/owner-fire.test.mjs
import assert from "node:assert";
import { ROUTINE_SETUP_HASH, ticketOwner, ownerFireBlock, deployOwnerBlock, groomOwnerBlock } from "../public/js/owner-fire.js";
import { settingsPageFromHash } from "../public/js/settings-section.js";

const OWNER = "owner@example.com";
const mine = { id: "m", ownerEmail: "Owner@Example.com" };
const plain = { id: "p" };
const bound = { email: OWNER, hasBinding: true };
const unbound = { email: OWNER, hasBinding: false };
const other = { email: "other@example.com", hasBinding: true };

assert.strictEqual(ticketOwner(mine), OWNER);
assert.strictEqual(ticketOwner(plain), "");

// A ticket with no owner is never blocked.
assert.strictEqual(ownerFireBlock(plain, other), null);
// The owner with a binding may start it.
assert.strictEqual(ownerFireBlock(mine, bound), null);
// The owner without one: blocked, pointed at setup.
assert.strictEqual(ownerFireBlock(mine, unbound).reason, "no-binding");
assert.match(ownerFireBlock(mine, unbound).message, /My Claude Routine/);
// While the binding is still being checked the box stays disabled.
assert.strictEqual(ownerFireBlock(mine, { email: OWNER, hasBinding: null }).reason, "no-binding");
// Anyone else: blocked whatever their own binding.
assert.strictEqual(ownerFireBlock(mine, other).reason, "not-owner");
assert.match(ownerFireBlock(mine, other).message, /owner@example\.com/);

// Deploy to Main.
assert.strictEqual(deployOwnerBlock([plain], other), null);
assert.strictEqual(deployOwnerBlock([mine, plain], bound), null);
assert.strictEqual(deployOwnerBlock([mine], unbound).reason, "no-binding");
assert.strictEqual(deployOwnerBlock([mine], other).reason, "not-owner");
assert.strictEqual(deployOwnerBlock([mine, { ownerEmail: "other@example.com" }], bound).reason, "mixed-owners");

// Groom Backlog: disabled only when nothing is left this viewer may groom.
assert.strictEqual(groomOwnerBlock([mine, plain], other), null);
assert.strictEqual(groomOwnerBlock([mine], other).reason, "not-owner");
assert.strictEqual(groomOwnerBlock([mine], unbound).reason, "no-binding");
assert.strictEqual(groomOwnerBlock([mine], bound), null);

// The info links point at a real Settings page.
assert.strictEqual(ROUTINE_SETUP_HASH, "#settings/routine");
assert.strictEqual(settingsPageFromHash(ROUTINE_SETUP_HASH), "routine");

console.log("owner-fire: all checks passed");
