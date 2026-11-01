// Tablet menu regression: the slide-over (641-1023px) and the persistent
// sidebar (>=1024px) must hand over cleanly when a tablet rotates, and the
// hamburger / close / collapse controls must keep working afterwards.
// Run with:  cd backlog-tracker/test && node ui/nav-rotation.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const seed = { user: { email: "editor@personalisationhub.com", role: "editor" }, docs: { projects: { p1: { name: "Demo", createdAt: { $ts: 1_760_000_000_000 } } }, backlogItems: {} } };
const h = await startHarness();
try {
  const { page } = await h.open({ seed, width: 820, height: 1180 });
  await until(() => page.locator(".project-options-btn").count(), "board");
  const st = () => page.evaluate(() => ({
    open: document.getElementById("nav-drawer").classList.contains("open"),
    visible: getComputedStyle(document.getElementById("nav-drawer")).visibility === "visible",
    collapsed: document.documentElement.hasAttribute("data-nav-collapsed"),
    backdrop: document.getElementById("nav-drawer-backdrop").classList.contains("open"),
  }));
  const settle = () => page.waitForTimeout(350);

  await page.click("#nav-open-btn"); await settle();
  assert.deepEqual(await st(), { open: true, visible: true, collapsed: false, backdrop: true }, "portrait: hamburger opens the slide-over");
  await page.click("#nav-close-btn"); await settle();
  assert.equal((await st()).open, false, "portrait: close button closes it");

  await page.click("#nav-open-btn"); await settle();
  await page.setViewportSize({ width: 1180, height: 820 }); await settle();
  assert.deepEqual(await st(), { open: false, visible: true, collapsed: false, backdrop: false }, "rotate to landscape: no stranded slide-over or backdrop");
  await page.click("#nav-collapse-btn"); await settle();
  assert.equal((await st()).visible, false, "landscape: collapse hides the sidebar");
  await page.click("#nav-open-btn"); await settle();
  assert.deepEqual(await st(), { open: false, visible: true, collapsed: false, backdrop: false }, "landscape: hamburger re-expands without the slide-over state");
  await page.click("#nav-collapse-btn"); await settle();
  await page.setViewportSize({ width: 820, height: 1180 }); await settle();
  assert.equal((await st()).open, false, "back to portrait: nothing stranded open");
  await page.click("#nav-open-btn"); await settle();
  assert.equal((await st()).visible, true, "portrait again: hamburger still opens the menu");
  // Dictation mic stays a circle at tablet and phone widths (apple.css's blanket button min-height used to make it an oval).
  for (const [w, hgt] of [[820, 1180], [1180, 820], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt }); await settle();
    const box = await page.evaluate(() => { const b = document.getElementById("qc-mic-btn"); b.hidden = false; const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), radius: getComputedStyle(b).borderRadius }; });
    assert.equal(box.w, box.h, `mic is square at ${w}px (${box.w}x${box.h})`);
    assert.equal(box.radius, "50%", `mic is round at ${w}px`);
  }
  console.log("nav-rotation: ok");
} finally { await h.close(); }
