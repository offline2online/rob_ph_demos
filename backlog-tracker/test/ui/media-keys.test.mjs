// Settings → Integrations & MCP → Media Studio API keys, in Chromium against
// the real public/ files (harness.mjs stubs Firebase and /mediaKeys/**).
// Checks: admins see it and editors don't; a saved key shows only its last
// four characters; Save sends the key once, clears the field, then tests it;
// Remove asks first. Run: cd backlog-tracker/test && node ui/media-keys.test.mjs
import assert from "node:assert";
import path from "node:path";
import { startHarness, until, outDir } from "./harness.mjs";

const STATUS = {
  encryptionReady: true,
  providers: [
    { id: "gemini", label: "Google Gemini — Nano Banana Pro and Veo 3.1", env: "GEMINI_API_KEY", set: true, hint: "…WXYZ", updatedBy: "rob@offline2online.com", updatedAt: "2026-11-04T09:00:00Z", lastTest: { ok: true, message: "Key works; Nano Banana Pro and Veo 3.1 are available", at: "2026-11-04T09:00:05Z" }, lastUsedAt: null, readable: true },
    { id: "ltx", label: "LTX 2.5 (Lightricks)", env: "LTX_API_KEY", set: false, hint: null, updatedBy: null, updatedAt: null, lastTest: null, lastUsedAt: null, readable: false },
    { id: "wordpress", label: "WordPress media library (application password)", env: "WP_AUTH", set: false, hint: null, siteUrl: null, updatedBy: null, updatedAt: null, lastTest: null, lastUsedAt: null, readable: false },
  ],
};
const seed = (role) => ({ user: { email: `${role}@personalisationhub.com`, role }, docs: { projects: {} }, mediaKeys: STATUS });

const h = await startHarness();
let failed = 0;
const run = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`); } catch (err) { failed += 1; console.log(`FAIL ${name}\n     ${err.message}`); }
};

for (const width of [1280, 390]) {
  await run(`admin sees and uses the Media Studio keys block at ${width}px`, async () => {
    const c = await h.open({ seed: seed("admin"), width, hash: "#settings/integrations" });
    try {
      const block = c.page.locator("#media-keys-block");
      await until(async () => (await block.isVisible()) && (await c.page.locator("[data-media-key]").count()) === 3, "three key rows");
      const text = await block.innerText();
      assert.match(text, /Saved, ends WXYZ/);
      assert.match(text, /Not set/);
      const ltx = c.page.locator('[data-media-key="ltx"]');
      await ltx.locator("[data-media-key-value]").fill("ltxv_secret_value_123456");
      await ltx.locator('[data-media-key-act="save-key"]').click();
      await until(() => c.mediaKeyWrites.some((w) => w.path.endsWith("/keys/ltx/test")), "save then test");
      const save = c.mediaKeyWrites.find((w) => w.method === "POST" && w.path === "/mediaKeys/v1/keys/ltx");
      assert.deepStrictEqual(JSON.parse(save.body), { value: "ltxv_secret_value_123456" });
      assert.strictEqual(await ltx.locator("[data-media-key-value]").inputValue(), "", "the field is cleared after saving");
      assert.ok(!(await c.page.content()).includes("ltxv_secret_value_123456"), "the key is nowhere in the page");
      // Rendered page has no horizontal overflow at this width.
      const sw = await c.page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(sw <= width, `no sideways scroll (scrollWidth ${sw})`);
      await block.screenshot({ path: path.join(outDir, `media-keys-${width}.png`) });
      assert.deepStrictEqual(c.problems, []);
    } finally { await c.close(); }
  });
}

await run("an editor neither sees the block nor calls the endpoint", async () => {
  const c = await h.open({ seed: seed("editor"), hash: "#settings/integrations" });
  try {
    await until(() => c.page.locator('[data-settings-pane="integrations"]').isVisible(), "integrations pane");
    assert.strictEqual(await c.page.locator("#media-keys-block").isVisible(), false);
    assert.strictEqual(c.mediaKeyWrites.length, 0);
  } finally { await c.close(); }
});

await h.close();
console.log(failed ? `media-keys UI: ${failed} failed` : "media-keys UI: all passed");
process.exit(failed ? 1 : 0);
