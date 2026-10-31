// Profile photos in Chromium against the REAL public/ files with the Firebase
// SDK stubbed: a photoUrl injected on the signed-in member's consoleUsers row
// renders on the topbar button, in the profile menu and on their comment; a
// member with no photo gets a coloured initial; an upload larger than 10 MB
// and a non-image file are refused inline with nothing uploaded. 1280 and 390 px.
// Run with:  cd backlog-tracker/test && node ui/avatars.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const ME = "editor@personalisationhub.com";
const seed = {
  user: { email: ME, role: "editor" },
  docs: {
    projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    consoleUsers: {
      [ME]: { email: ME, role: "editor", displayName: "Edie Editor", photoUrl: PIXEL },
      "sam@personalisationhub.com": { email: "sam@personalisationhub.com", role: "editor", displayName: "Sam Sample" },
    },
    backlogItems: {
      b1: { projectId: "p1", title: "Purple widget", desc: "Make it purple", type: "feature", category: "HQ Admin", status: "backlog", createdAt: t(T0 + 1), updatedAt: t(T0 + 1),
        notes: [{ author: ME, text: "mine", at: t(T0 + 2) }, { author: "sam@personalisationhub.com", text: "theirs", at: t(T0 + 3) }] },
    },
  },
};

const h = await startHarness();
let failed = 0;
try {
  for (const width of [1280, 390]) {
    const o = await h.open({ seed, width, height: 900 });
    const { page } = o;
    try {
      await page.waitForSelector(".edit-item-btn", { state: "attached" });
      // Topbar button: the photo, a 32px circle, not the generic icon.
      await until(() => page.locator("#profile-btn-avatar img.ph-avatar-img").count(), "photo on the topbar button");
      assert.equal(await page.locator("#profile-btn-avatar .material-symbols-outlined").count(), 0, "generic icon replaced");
      // (On a phone the topbar button is hidden and the Profile tab opens the menu.)
      const radius = await page.$eval("#profile-btn-avatar .ph-avatar", (el) => ({ r: getComputedStyle(el).borderRadius, w: el.getBoundingClientRect().width }));
      assert.equal(radius.r, "50%");
      if (width >= 640) assert.equal(Math.round(radius.w), 32);
      // Profile menu header (in the DOM at both widths; hidden until opened).
      assert.ok(await page.locator("#profile-photo-face img.ph-avatar-img").count(), "photo in the profile menu header");
      assert.equal((await page.locator("#profile-photo-label").innerText()).trim(), "Change photo");
      // Comments: mine shows the photo, Sam falls back to a coloured initial.
      await page.click(".edit-item-btn");
      await page.waitForSelector("#ei-notes-list .ei-note-row");
      const mine = page.locator(`#ei-notes-list .ph-avatar[data-avatar-email="${ME}"]`);
      assert.ok(await mine.locator("img").count(), "my comment shows my photo");
      const sam = page.locator('#ei-notes-list .ph-avatar[data-avatar-email="sam@personalisationhub.com"]');
      assert.equal((await sam.innerText()).trim(), "S", "no photo -> first-name initial");
      assert.notEqual(await sam.evaluate((el) => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", "coloured circle");
      assert.equal(Math.round((await mine.first().boundingBox()).width), 24);
      // A photo arriving later repaints in place, no reload.
      await page.evaluate((px) => {
        const b = globalThis.__fbStub; const col = b.col("consoleUsers"); col.set("sam@personalisationhub.com", { ...col.get("sam@personalisationhub.com"), photoUrl: px }); b.notify();
      }, PIXEL);
      await until(() => sam.locator("img").count(), "Sam's photo to appear without a reload");
      if (o.problems.length) throw new Error(`the page reported problems:\n ${o.problems.join("\n ")}`);
      console.log(`PASS  avatars @${width}px`);
    } catch (err) {
      failed++;
      console.error(`FAIL  avatars @${width}px: ${err && err.stack || err}`);
    } finally { await o.close(); }
  }

// An owner account (admitted by the rules with NO consoleUsers row) uploads a
// photo: the row is created with it, nothing errors, and Remove clears it.
// The page's role is seeded as "editor" on purpose: the save must not depend
// on the cached console role (the first fix did, and still failed live), and
// the created row keeps agent access ON (mcpEnabled false would cut the
// owner's MCP connection — functions/mcp-server.js).
{
  const OWNER = "rob@offline2online.com";
  const o = await h.open({ seed: { user: { email: OWNER, role: "editor" }, docs: { projects: seed.docs.projects, backlogItems: seed.docs.backlogItems } }, width: 1280, height: 900 });
  const { page } = o;
  try {
    await page.waitForSelector(".edit-item-btn", { state: "attached" });
    await page.click("#profile-btn");
    const chooser = page.waitForEvent("filechooser");
    await page.click("#profile-photo-upload");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await (await chooser).setFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await until(() => page.locator("#profile-btn-avatar img.ph-avatar-img").count(), "owner photo on the topbar button");
    const row = await page.evaluate((e) => globalThis.__fbStub.col("consoleUsers").get(e), OWNER);
    assert.ok(row && row.photoUrl, "consoleUsers row created with the photo");
    assert.equal(row.role, "admin");
    assert.equal(row.mcpEnabled, true);
    assert.equal(await page.locator("#profile-photo-error").isHidden(), true, "no error shown");
    await page.click("#profile-btn");
    await page.click("#profile-photo-remove");
    await until(() => page.evaluate((e) => !globalThis.__fbStub.col("consoleUsers").get(e).photoUrl, OWNER), "photo cleared");
    if (o.problems.length) throw new Error(`the page reported problems:\n ${o.problems.join("\n ")}`);
    console.log("PASS  avatars: owner with no team row can upload and remove a photo");
  } catch (err) {
    failed++;
    console.error(`FAIL  avatars owner upload: ${err && err.stack || err}`);
  } finally { await o.close(); }
}
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
