// Mobile theme + CTA regression (ticket KK9rwjU1zKJ5Cfd61fcs): at 360 and 390 px, with the OS in light AND dark mode
// (the console stays light either way; dark is opt-in via <html data-theme="dark">),
// the tab bar, the Build sheet and the profile menu follow the same theme as the page (no light bar under a
// dark page), their icons keep >= 3:1 contrast against the surface behind them, and CTAs are >= 44px tall,
// unclipped and clear of the sticky header and tab bar. Screenshots go to $SHOT_DIR when set.
// Run with:  cd backlog-tracker/test && node ui/mobile-theme.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const T0 = 1_760_000_000_000;
const t = (ms) => ({ $ts: ms });
const seed = {
  user: { email: "editor@personalisationhub.com", role: "editor" },
  docs: {
    projects: { p1: { name: "Demo Project", createdAt: t(T0), deployBranch: "deploy/demo", repoFolder: "demo" } },
    backlogItems: { i1: { projectId: "p1", title: "Ticket", desc: "A ticket", type: "bug", category: "HQ Admin", status: "backlog", createdAt: t(T0), updatedAt: t(T0) } },
  },
};

// Runs in the page: effective (alpha-composited) background behind an element, and WCAG contrast.
const probe = () => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const chain = []; for (let e = el; e; e = e.parentElement) chain.push(e);
    let acc = { r: 255, g: 255, b: 255, a: 1 };
    for (const e of chain.reverse()) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) acc = over(c, acc); }
    return acc;
  };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const contrast = (el) => { const bg = bgOf(el); const fg = over(parse(getComputedStyle(el).color), bg); return ratio(fg, bg); };
  const isDark = (el) => lum(bgOf(el)) < 0.4;
  return { bgOf, contrast, isDark };
};

const h = await startHarness();
let failed = 0;
try {
  for (const scheme of ["light", "dark"]) for (const width of [360, 390]) {
    const label = `${scheme} @${width}px`;
    const o = await h.open({ seed, width, height: 780, colorScheme: scheme });
    const { page } = o;
    try {
      await until(() => page.locator("#total-summary").count(), "board header");
      const shot = async (name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: `${process.env.SHOT_DIR}/${name}-${scheme}-${width}.png` }); };
      const check = async (what, sel) => page.evaluate(([sel, what, probeSrc]) => {
        const { contrast, isDark } = new Function(`return (${probeSrc})()`)();
        const page = isDark(document.body);
        const out = [];
        for (const e of document.querySelectorAll(sel)) {
          if (!e.getClientRects().length) continue;
          if (isDark(e) !== page) out.push(`${what}: surface is ${page ? "light" : "dark"} under a ${page ? "dark" : "light"} page`);
          const ic = e.matches(".material-symbols-outlined") ? e : e.querySelector(".material-symbols-outlined") || e;
          const c = contrast(ic);
          if (c < 3) out.push(`${what}: icon/label contrast ${c.toFixed(2)} < 3 (${e.id || e.className})`);
        }
        return out;
      }, [sel, what, probe.toString()]);
      let problems = [];
      await shot("board");
      // Light by default, whatever the phone's own appearance setting (Rob, 20 Oct 2026).
      const pageDark = await page.evaluate((probeSrc) => new Function(`return (${probeSrc})()`)().isDark(document.body), probe.toString());
      if (pageDark) problems.push(`page renders dark with the OS in ${scheme} mode — light is the default`);
      problems.push(...await check("tab bar", ".tab"), ...await check("header", ".topbar"));
      await page.click('.tab[data-tab="build"]'); await page.waitForTimeout(350);
      await shot("build-sheet");
      problems.push(...await check("build sheet", ".nav-drawer.open .nav-drawer-item"));
      await page.click('.tab[data-tab="build"]'); await page.waitForTimeout(250);
      await page.click('.tab[data-tab="profile"]'); await page.waitForTimeout(350);
      await shot("profile-menu");
      problems.push(...await check("profile menu", ".profile-menu .profile-menu-item"));
      assert.deepStrictEqual([...new Set(problems)], [], "theme problems");
      // CTAs: tall enough, label not clipped, not under the sticky header or tab bar.
      const bad = await page.evaluate(() => {
        const tb = document.querySelector("#tabbar").getBoundingClientRect(), vw = innerWidth, out = [];
        for (const e of document.querySelectorAll(".btn-primary, .btn-ghost, .btn-outline, .notify-claude-btn")) {
          if (!e.getClientRects().length) continue;
          const r = e.getBoundingClientRect(), n = e.textContent.trim().slice(0, 24);
          if (r.height < 43.5) out.push(`"${n}" is ${r.height}px tall`);
          if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).fontSize !== "0px") out.push(`"${n}" label clipped`);
          if (r.right > vw + 1 || r.left < -1) out.push(`"${n}" overflows the screen`);
          if (e.closest(".page-header, .mobile-action-bar, .project-header") && r.height && r.top < tb.bottom && r.bottom > tb.top && r.top >= 0 && r.bottom <= innerHeight) out.push(`"${n}" overlaps the tab bar`);
        }
        return out;
      });
      assert.deepStrictEqual(bad, [], "CTA problems");
      console.log(`PASS mobile-theme ${label}`);
    } catch (e) { failed++; console.log(`FAIL mobile-theme ${label}: ${e.message}\n${e.actual ? JSON.stringify(e.actual) : ""}`); }
    await o.close();
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
