// iPad repro in WebKit (Safari's engine): tap Staff Kanban in the sidebar
// from the Agent Board and from other pages, and report what happened plus
// every page error and console message. HARNESS_BROWSER=webkit.
import fs from "node:fs";
import { devices } from "playwright-core";
import { startHarness, until, outDir } from "./harness.mjs";
import { kanbanSeed } from "./kanban-seed.mjs";
fs.mkdirSync(outDir, { recursive: true });
const h = await startHarness();
const ipads = ["iPad Pro 11", "iPad Pro 11 landscape", "iPad (gen 7)", "iPad Mini landscape"];
let failed = 0;
for (const name of ipads) {
  const d = devices[name];
  for (const start of ["", "#concept-incubator", "#releases"]) {
    const { viewport, ...ctx } = d;
    const o = await h.open({ seed: kanbanSeed(), hash: start, width: viewport.width, height: viewport.height, contextOptions: ctx });
    const p = o.page; const logs = []; let r;
    p.on("console", (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
    p.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}\n${(e.stack || "").split("\n").slice(0, 4).join("\n")}`));
    try {
      await until(() => p.locator("#projects-root").count(), "boot", 20000); await p.waitForTimeout(1500);
      const bound = await p.evaluate(() => typeof document.getElementById("staff-kanban-btn").onclick);
      if (await p.locator("#nav-open-btn").isVisible()) { await p.tap("#nav-open-btn"); await p.waitForTimeout(500); }
      const box = await p.locator("#staff-kanban-btn").boundingBox();
      const hit = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? (e.id ? "#" + e.id : e.tagName + "." + [...e.classList].join(".")) : null; }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await p.tap("#staff-kanban-btn", { timeout: 5000 }); await p.waitForTimeout(2500);
      r = await p.evaluate(() => ({ hash: location.hash, kbHidden: document.getElementById("staff-kanban-page").hidden, cards: document.querySelectorAll(".kb-card").length }));
      r.hit = hit; r.onclick = bound;
      if (r.kbHidden || !r.cards) failed++;
    } catch (e) { r = "ERR " + e.message.split("\n")[0]; failed++; }
    await p.screenshot({ path: `${outDir}/ipad-${name.replace(/\W+/g, "_")}-${start.replace(/\W+/g, "") || "board"}.png` }).catch(() => {});
    console.log(`\n=== ${name} from ${start || "#(board)"} → ${JSON.stringify(r)}\nproblems: ${JSON.stringify(o.problems, null, 1)}\n${logs.join("\n")}`);
    await o.close();
  }
}
await h.close();
console.log(failed ? `\n${failed} iPad case(s) FAILED` : "\nall iPad cases passed");
process.exit(failed ? 1 : 0);
