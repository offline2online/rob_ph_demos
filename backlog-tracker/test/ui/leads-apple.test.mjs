// Promote › Leads, Apple-style (ticket iAY4X9RF5K16vLEGYswi): the board, the
// lead form and the lead detail view at 390, 820, 1180 and 1440 px, light and
// dark, with real seeded data. Checks: no sideways scroll (page or board), one
// primary action on the page, no helper paragraph outside an (i), 44px touch
// targets, the detail view's order (logo header, contacts with the inbound
// count, AWS team, research, news, financials) as inset grouped cards, the form
// as grouped rows with Save off until something changes.
// Run with:  cd backlog-tracker/test && node ui/leads-apple.test.mjs
import assert from "node:assert";
import { startHarness, until } from "./harness.mjs";

const WIDTHS = [390, 820, 1180, 1440];
const T0 = 1_762_000_000_000, t = (ms) => ({ $ts: ms });
const enrichment = { at: t(T0), by: "agent", summary: "A UK grocery retailer.", hq: "London, UK", employees: "12,400",
  news: [{ title: "Acme opens 20 stores", url: "https://news.example/a", date: "2026-10-02", source: "Retail Week" }],
  financials: { summary: "Revenue up 6%.", period: "FY25", sources: [{ title: "Annual report", url: "https://ir.example/ar", date: "2026-06-30" }] },
  sources: [{ source: "web", status: "ok", message: "Company website read" }] };
const lead = (name, stage, extra = {}) => ({ company: { name, website: "https://x.example", industry: extra.industry || "Grocery", countries: ["United Kingdom"], storeCount: 120 },
  contacts: [{ id: "k1", name: "Jo Bloggs", jobTitle: "Head of Digital", buyingRole: "decision-maker", email: "jo@x.example", linkedin: "https://linkedin.com/in/jo" }],
  stage, source: "Website form", assignee: "", customerAccount: null, inboundCount: extra.inbound || 0, enrichment: extra.enrichment || null, createdAt: t(T0), updatedAt: t(T0) });
const seed = { user: { email: "editor@personalisationhub.com", role: "editor" }, docs: {
  projects: { p1: { name: "Demo Project", createdAt: t(T0) } },
  leads: { acme: lead("Acme Retail", "demo", { enrichment, inbound: 3 }), beta: lead("Beta Pharmacy", "lead", { industry: "Pharmacy" }), gamma: lead("Gamma Telecom", "hot-lead", { industry: "Telco" }),
    delta: lead("Delta Fashion", "post-demo", { industry: "Fashion" }), eps: lead("Epsilon Electronics", "closed-won"), zeta: lead("Zeta Lost Co", "closed-lost") },
  prospectCompanies: { acmeretail: { name: "Acme Retail", awsTeam: [{ id: "a1", name: "Pat Lee", role: "account-manager", email: "pat@amazon.com" }] } },
} };

const audit = (page, scopeSel) => page.evaluate((scopeSel) => {
  const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest("[hidden]");
  const scope = document.querySelector(scopeSel);
  const q = (sel) => [...scope.querySelectorAll(sel)].filter(vis);
  const small = q("button:not(.info-tip), a.ap-icon-btn, select, input").filter((b) => !b.closest(".ag-root-wrapper"))
    .map((b) => ({ id: b.id || String(b.className).slice(0, 40) || b.tagName, h: Math.round(b.closest(".ap-row") ? b.closest(".ap-row").getBoundingClientRect().height : b.getBoundingClientRect().height) })).filter((x) => x.h < 44);
  const links = q(".ap-row a:not(.ap-icon-btn)").map((a) => Math.round(a.closest(".ap-row").getBoundingClientRect().height)).filter((h) => h < 44);
  const helpers = q(".field-hint").filter((e) => !e.classList.contains("tip-source") && e.textContent.trim()).map((e) => e.textContent.trim().slice(0, 60));
  const boardWrap = document.querySelector(".leads-board-wrap");
  return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, board: boardWrap.scrollWidth - boardWrap.clientWidth,
    small, links, helpers, font: getComputedStyle(scope).fontFamily };
}, scopeSel);

const h = await startHarness();
let failed = 0;
try {
  for (const theme of ["light", "dark"]) for (const width of WIDTHS) {
    const o = await h.open({ seed, width, height: 900, hash: "#promote/leads" });
    const { page } = o;
    const label = `${theme} @${width}px`;
    try {
      if (theme === "dark") await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
      await until(() => page.locator('#leads-page .lead-card[data-lead-id="acme"]').count(), "the lead tiles", 15000);
      await until(() => page.locator('#leads-page .lead-card[data-lead-id="acme"] .lead-card-aws').count(), "the account's AWS team on its tile", 8000);
      // Board
      let a = await audit(page, "#leads-page");
      assert.ok(a.overflow <= 0 && a.board <= 1, `no sideways scroll (page ${a.overflow}px, board ${a.board}px)`);
      assert.deepStrictEqual(a.small, [], "touch targets under 44px on the board");
      assert.deepStrictEqual(a.helpers, [], "helper copy outside tooltips on the board");
      assert.ok(/apple-system|system-ui/.test(a.font), "system font stack");
      const primaries = await page.evaluate(() => [...document.querySelectorAll("#leads-page .btn-primary")].filter((b) => b.getClientRects().length).map((b) => b.id));
      assert.deepStrictEqual(primaries, ["leads-add-btn"], "one primary action on the page");
      const geo = await page.evaluate(() => { const b = document.getElementById("leads-add-btn").getBoundingClientRect(), t = document.querySelector("#leads-page h2").getBoundingClientRect(); return { right: innerWidth - b.right, top: b.top - t.top, bottom: innerHeight - b.bottom }; });
      if (width > 640) assert.ok(geo.right < 80 && Math.abs(geo.top) < 40, `New lead is top right (${JSON.stringify(geo)})`);
      else assert.ok(geo.bottom > 0 && geo.bottom < 140, `New lead sits at the bottom on a phone (${JSON.stringify(geo)})`);
      const lanes = await page.evaluate(() => [...document.querySelectorAll(".lead-lane")].map((l) => getComputedStyle(l).borderTopWidth));
      assert.ok(lanes.every((w) => w === "0px"), "no coloured lane borders");
      const colours = await page.evaluate(() => new Set([...document.querySelectorAll("#leads-page .lead-chip")].map((c) => getComputedStyle(c).backgroundColor)).size);
      assert.strictEqual(colours, 1, "industry chips are neutral (the dot carries the colour)");
      // Detail
      await page.click('.lead-card[data-lead-id="acme"]');
      await until(() => page.locator("#lead-summary-backdrop:not([hidden]) #lead-sum-body .ap-group").count(), "the detail view");
      a = await audit(page, "#lead-summary-panel");
      assert.deepStrictEqual(a.small, [], "touch targets under 44px in the detail view");
      assert.deepStrictEqual(a.links, [], "link rows under 44px in the detail view");
      assert.deepStrictEqual(a.helpers, [], "helper copy outside tooltips in the detail view");
      const order = await page.evaluate(() => [...document.querySelectorAll("#lead-sum-body .ap-group-title")].map((x) => x.firstChild.textContent.trim()));
      assert.deepStrictEqual(order.slice(0, 5), ["Contacts", "AWS team", "Company research", "Recent news", "Recent financials · FY25"], "detail sections in order");
      assert.ok(await page.locator("#lead-sum-logo .enrich-logo").count(), "logo in the header");
      assert.strictEqual((await page.textContent("#lead-sum-contacts .lead-inbound")).trim(), "3 inbound", "inbound count beside Contacts");
      assert.ok((await page.textContent("#lead-sum-aws")).includes("Pat Lee"), "AWS team shown");
      await page.keyboard.press("Escape");
      await until(async () => page.locator("#lead-summary-backdrop").isHidden(), "the detail to close");
      // Form
      await page.click("#leads-add-btn");
      await until(() => page.locator("#lead-backdrop:not([hidden]) #lead-form").count(), "the form");
      await page.waitForTimeout(300);
      a = await audit(page, ".lead-panel");
      assert.deepStrictEqual(a.small, [], "touch targets under 44px in the form");
      assert.deepStrictEqual(a.helpers, [], "helper copy outside tooltips in the form");
      assert.ok(await page.locator("#lead-save").isDisabled(), "Save is off until something changes");
      const rows = await page.evaluate(() => ["lead-name", "lead-stage", "lead-assignee"].every((id) => document.getElementById(id).closest(".ap-group .ap-row")));
      assert.ok(rows, "fields are grouped rows");
      assert.ok(await page.evaluate(() => document.querySelector(".lead-contact .ap-group .lc-name") !== null), "a contact is its own grouped card");
      await page.fill("#lead-name", "Acme");
      assert.ok(await page.locator("#lead-save").isEnabled(), "typing turns Save on");
      a = await audit(page, ".lead-panel");
      assert.ok(a.overflow <= 0, "no sideways scroll with the form open");
      assert.deepStrictEqual(o.problems.filter((p) => !/unrouted host/.test(p)), [], "page/console problems");
      console.log(`PASS leads-apple ${label}`);
    } catch (e) { failed++; console.log(`FAIL leads-apple ${label}: ${e.message}`); }
    await o.close();
  }
} finally { await h.close(); }
process.exit(failed ? 1 : 0);
