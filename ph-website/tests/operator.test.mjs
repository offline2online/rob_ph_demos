// node ph-website/tests/operator.test.mjs : the hidden Run Your Own RMN page (/run-your-own-rmn/) in Chromium: an Elementor-shaped page
// (operator-render.php: Elementor containers and widgets for the brief's sections, an Elementor kit stylesheet that restyles headings,
// buttons and inputs, and the three empty mount containers ph-rmn-calculator, ph-rmn-faq, ph-rmn-tour, filled server-side by
// operator_mount() as on the live page) with operator.php's real head, operator.css, operator.js and site.js, and the real tour.html
// served at /run-your-own-rmn/tour/ (the golf club walkthrough). The H1, the blocks inside their mount containers,
// copy and section order, the "Running your own RMN" FAQ accordion (keyboard and tap), the SEO head (one H1, title, description, canonical,
// OG, the head JSON-LD and the FAQ block's FAQPage JSON-LD equal to its questions), the calculator defaults and live updates, its "I am" toggle (Operator or team / Retailer: click, tap and keyboard, aria-pressed, $60.0M and the retailer labels), tooltips (hover, focus, tap), no commercial terms, the gate (disabled until valid, with its required "I am" select,
// the body it posts, ph_operator and ph_lead, an existing ph_lead never overwritten), the tour framed in place and unlocked with no form,
// Start the tour plays a step, returning visitors, the header's Arrange A Demo, the estimate_rmn_earnings WebMCP tool (the page's own
// figures for the defaults in both modes; the gate only with the person's details and consent; never a share), no horizontal scroll at
// 360/390/768/1440, and enhance.js's known-visitor rule (name, company and email).
// Neither the retired offer name (checked with the pattern fr[a]nch) nor the page's previous name (a bracketed pattern) appears, so this
// file never contains them: not in the visible text, any attribute, the title, meta or URL, the rendered HTML, the loaded CSS/JS file
// names and contents, localStorage keys or values, dataLayer events or request URLs. The three copy replacements are exact; the header
// item is "Run Your Own RMN"; the dataLayer and ph_lead source say "Network operator inquiry"; the gate posts to ph-site/v1/operator-lead.
// Touch: every "i" info button has a hit area of at least 44x44, and so does every FAQ question. Tablets: iPad Mini, iPad (gen 7),
// iPad Pro 11 and Galaxy Tab S4, portrait and landscape, touch on (iPad user agents on the iPads): no horizontal scroll, calculator,
// tooltips and the FAQ by tap, the 44x44 hit areas, the gate unlocking the tour, the tour playing and its full-screen fallback.
// Skips (exit 0) when Playwright, Chromium or php is not available.
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import assert from "assert";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
const require = createRequire(import.meta.url);
let chromium, devices;
try { ({ chromium, devices } = require("playwright")); } catch { console.log("operator: playwright not installed here; skipping"); process.exit(0); }
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(here, "..", "snippets", "ph-industry-enhancements");
const r = spawnSync("php", [path.join(here, "operator-render.php")], { encoding: "utf8" });
if (r.error) { console.log("operator: php not installed here; skipping"); process.exit(0); }
assert.strictEqual(r.status, 0, "operator-render.php: " + r.stderr);
const body = r.stdout;
const hr = spawnSync("php", [path.join(here, "operator-render.php"), "head"], { encoding: "utf8" });
assert.strictEqual(hr.status, 0, "operator-render.php head: " + hr.stderr);
const head = JSON.parse(hr.stdout);
assert.strictEqual(head.title, "Run Your Own Retail Media Network (RMN) - Personalisation Hub", "document title");
assert.strictEqual(head.menu.title, "Run Your Own RMN", "menu item title");
assert.strictEqual(head.menu.url, "http://x.test/run-your-own-rmn/", "menu item URL");
const OLD = /fr[a]nch/i;
const PREV = /own[ -]bo[s]s|be-your[-]own|ph[-]bo[s]s/i; // the page's previous name, slug and menu class
const NAMES = (s) => OLD.test(s) || PREV.test(s);
const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const css = fs.readFileSync(path.join(dir, "operator.css"), "utf8");
const js = fs.readFileSync(path.join(dir, "operator.js"), "utf8");
const site = fs.readFileSync(path.join(dir, "site.js"), "utf8");
const tourHtml = fs.readFileSync(path.join(dir, "tour", "tour.html"), "utf8");
const F = require(path.join(dir, "operator.js"));

// Model parity with the design (and operator_calc in PHP).
const DEF = { ven: 90, dis: 3, vis: 800, cpm: 25, atv: 25, view: 60, up: 15 };
const d = F.view(F.calc(DEF));
assert.deepStrictEqual(d, { yours: "$591K", venues: "90", displays: "270", visitors: "2,190,000", views: "3,942,000", extraSales: "$59.1M" }, "defaults");
assert.deepStrictEqual(F.view(F.calc(DEF, "operator")), d, "operator is the default mode");
const dr = F.view(F.calc(DEF, "retailer"));
assert.deepStrictEqual(dr, { ...d, yours: "$60.0M" }, "retailer mode at the defaults: its share of ad revenue plus the extra sales, $60.0M");
assert.strictEqual(Math.round(F.calc(DEF, "retailer").income), 59957820, "retailer income at the defaults");
const OP_LABELS = { venues: "Venues in your network", extraSales: "Extra sales for your venues a year" }, RT_LABELS = { venues: "Stores in your network", extraSales: "Extra sales in your stores a year" };

// The site's header (Industry, Support, Arrange A Demo as an Elementor popup link) and footer around the shortcode output.
// Elementor's container basics and a kit that restyles headings, buttons, inputs and links the way the site's kit can: the blocks must keep the design.
const elementorCss = `.elementor *,.elementor :after,.elementor :before{box-sizing:border-box}.e-con{display:flex;flex-direction:column;width:100%;padding:0}.e-con-inner{width:100%;max-width:1280px;margin:0 auto;padding:40px 16px}.elementor-widget{width:100%}
.elementor-kit-5 h2{font-size:36px;color:#f00;font-family:serif;overflow-wrap:anywhere}.elementor-kit-5 button{background:#f00;color:#ff0;padding:30px;border:4px solid #000}.elementor-kit-5 input,.elementor-kit-5 select{border:4px solid #f00;padding:20px}.elementor-kit-5 a{color:#0f0}`;
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(head.title)}</title>${head.seo}<style>body{margin:0;font-family:Arial}</style><style>${elementorCss}</style><style>${css}</style></head><body class="page-template-elementor_header_footer elementor-kit-5 elementor-page elementor-page-10900">
<header class="elementor-location-header" style="position:sticky;top:0;z-index:5;background:#fff;height:72px"><nav><ul><li class="menu-item"><a href="/industries/">Industry</a></li><li class="${esc(head.menu.classes)}"><a href="${esc(head.menu.url)}" aria-current="${esc(head.menu.atts["aria-current"])}">${esc(head.menu.title)}</a></li><li class="menu-item"><a href="/support-centre/">Support</a></li></ul></nav>
<a class="elementor-button" id="hdr-demo" href="#elementor-action%3Aaction%3Dpopup%3Aopen%26settings%3DeyJpZCI6IjI2NTgi"><span>Arrange A Demo</span></a></header>
<main>${body}</main><footer class="elementor-location-footer"><a href="/privacy-policy/">Privacy</a></footer>
<script>window.__tools=[]; try { Object.defineProperty(navigator, "modelContext", { configurable: true, value: { registerTool: function (t) { window.__tools.push(t); } } }); } catch (e) {}</script>
<script>window.__cal=0; window.Calendly={initPopupWidget:function(){window.__cal++;}}; window.PH_OPERATOR={"endpoint":"/wp-json/ph-site/v1/operator-lead","tour":"/run-your-own-rmn/tour/"};</script>
<script>${site}</script><script>${js}</script></body></html>`;

// Every "i" info button: its visible circle and whether the 44x44 square around its centre all hits it (elementFromPoint).
const hitBoxes = (t) => t.evaluate(() => {
  const out = { coarse: matchMedia("(pointer: coarse)").matches, n: 0, bad: [] };
  for (const b of document.querySelectorAll(".phf .phf-tip-b, .phf .phf-how-b")) {
    b.scrollIntoView({ block: "center", behavior: "instant" });
    const r = (b.querySelector(".phf-how-i") || b).getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2; // the "i" circle
    out.n++;
    const miss = [];
    for (const dx of [-21.5, 0, 21.5]) for (const dy of [-21.5, 0, 21.5]) { const e = document.elementFromPoint(cx + dx, cy + dy); if (!e || !(e === b || b.contains(e))) miss.push([dx, dy, e && (e.id || e.className || e.tagName)]); }
    if (Math.round(r.width) !== 16 || Math.round(r.height) !== 16 || miss.length) out.bad.push({ id: b.getAttribute("aria-describedby"), w: r.width, h: r.height, miss });
  }
  return out;
});
// Every FAQ question (summary): its box is at least 44x44 and the point at its centre hits it.
const faqBoxes = (t) => t.evaluate(() => [...document.querySelectorAll("#faq summary")].map((s) => { s.scrollIntoView({ block: "center", behavior: "instant" }); const r = s.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), h: Math.round(r.height), hit: !!e && (e === s || s.contains(e)) }; }).filter((b) => b.w < 44 || b.h < 44 || !b.hit));
// The two "I am" toggle buttons: each at least 44x44 and hit at its centre.
const audBoxes = (t) => t.evaluate(() => [...document.querySelectorAll(".phf .phf-aud button")].map((b) => { b.scrollIntoView({ block: "center", behavior: "instant" }); const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { w: Math.round(r.width), h: Math.round(r.height), hit: !!e && (e === b || b.contains(e)) }; }).filter((b) => b.w < 44 || b.h < 44 || !b.hit));
// Where the Average CPM tooltip opens, relative to its button.
const tipPlace = async (t) => { await t.locator("[aria-describedby=c-cpm-tip]").focus(); return t.evaluate(() => { const b = document.querySelector("[aria-describedby=c-cpm-tip]").getBoundingClientRect(), x = document.getElementById("c-cpm-tip").getBoundingClientRect(); return { dx: Math.round(x.left - b.left), dy: Math.round(x.bottom - b.top), w: Math.round(x.width) }; }); };

const browser = await chromium.launch();
let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
try {
  const probe = await browser.newPage(); const tinyJpg = await probe.screenshot({ type: "jpeg", clip: { x: 0, y: 0, width: 8, height: 8 } }); await probe.close();
  const open = async ({ search = "", lead = null, operator = null, posts = null, status = 200, reply = { ok: true }, width = 1440, height = 1000, device = null, init = null } = {}) => {
    let ctx = null;
    if (device) { const { defaultBrowserType, ...desc } = devices[device]; ctx = await browser.newContext({ ...desc, reducedMotion: "reduce" }); }
    const p = ctx ? await ctx.newPage() : await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    p.__ctx = ctx;
    if (init) await p.addInitScript(init);
    p.__errs = []; p.on("pageerror", (e) => p.__errs.push(e.message));
    await p.addInitScript(([l, f]) => { if (sessionStorage.getItem("__init")) return; sessionStorage.setItem("__init", "1"); if (l) localStorage.setItem("ph_lead", JSON.stringify(l)); if (f) localStorage.setItem("ph_operator", JSON.stringify(f)); }, [lead, operator]);
    p.__reqs = [];
    await p.route("**/*", (rt) => {
      const u = rt.request().url(); p.__reqs.push(u);
      if (/\/wp-json\/ph-site\/v1\/operator-lead$/.test(u)) { if (posts) posts.push(JSON.parse(rt.request().postData())); return rt.fulfill({ status, contentType: "application/json", body: JSON.stringify(reply) }); }
      if (/\/assets\/v1\/img\//.test(u)) { const g = u.match(/\/run-your-own-rmn\/tour\/assets\/v1\/img\/([\w.-]+)$/), f = g && path.join(here, "..", "tour-assets", "rmn-golf", "img", g[1] + ".b64"); return rt.fulfill({ contentType: "image/jpeg", body: f && fs.existsSync(f) ? Buffer.from(fs.readFileSync(f, "ascii"), "base64") : tinyJpg }); }
      if (/\/assets\/v1\//.test(u)) return rt.fulfill({ status: 404, body: "" });
      if (/\/run-your-own-rmn\/tour\//.test(u)) return rt.fulfill({ contentType: "text/html", body: tourHtml });
      if (/\/wp-json\//.test(u)) return rt.fulfill({ contentType: "application/json", body: '{"found":false}' });
      if (u.startsWith("http://x.test/run-your-own-rmn/")) return rt.fulfill({ contentType: "text/html", body: page });
      return rt.abort();
    });
    await p.goto("http://x.test/run-your-own-rmn/" + search);
    return p;
  };
  const text = (p, sel) => p.evaluate((s) => document.querySelector(s).textContent.trim(), sel);
  const fill = async (p, o) => {
    for (const k of ["name", "email", "linkedin", "region"]) if (o[k] !== undefined) await p.fill(`#phf-form [name=${k}]`, o[k]);
    if (o.audience) await p.selectOption("#phf-form [name=audience]", o.audience);
    if (o.background) await p.selectOption("#phf-form [name=background]", o.background);
    if (o.consent) await p.check("#phf-form [name=consent]");
  };

  // 1. Copy and section order.
  let p = await open();
  const heads = await p.evaluate(() => [...document.querySelectorAll("main h1, main h2")].map((h) => h.textContent.trim()));
  assert.deepStrictEqual(heads, ["Run your own retail media network", "Your head start in a changing industry", "Three ways to run your own network", "How it works", "Any business with a physical presence", "Built to fix retail media's fragmentation", "What could it be worth to you?", "Give independents a fighting chance", "Running your own RMN", "See a retail media network run end to end"], "section order");
  const all = await p.evaluate(() => document.querySelector("main").textContent);
  ok((await text(p, "main h1")) === "Run your own retail media network", "H1 (an Elementor Heading widget)");
  const blocks = await p.evaluate(() => [...document.querySelectorAll(".phf")].map((b) => [b.dataset.phf, b.parentElement.id, b.parentElement.children.length, !!b.closest("[data-elementor-type=wp-page]")]));
  assert.deepStrictEqual(blocks, [["calculator", "ph-rmn-calculator", 1, true], ["faq", "ph-rmn-faq", 1, true], ["tour", "ph-rmn-tour", 1, true]], "the three blocks, each once, the only thing inside its mount container on the Elementor page, in the brief's order");
  ok(["ph-rmn-calculator", "ph-rmn-faq", "ph-rmn-tour"].every((id) => body.split('id="' + id + '"').length === 2) && ["calculator", "faq", "tour"].every((k) => body.split('data-phf="' + k + '"').length === 2) && body.split('"@type":"FAQPage"').length === 2, "the blocks and the FAQPage JSON-LD are in the server's HTML (the first response), once each, before any script runs");
  ok((await p.evaluate(() => [...document.querySelectorAll(".elementor-element[id]")].map((e) => e.id).join())) === "top,why,who,how,venues,standards,ph-rmn-calculator,independents,ph-rmn-faq,ph-rmn-tour" && (await p.evaluate(() => ["calculator", "faq", "tour"].every((id) => document.getElementById(id).closest(".phf")))), "anchors: the Elementor sections' and mount containers' CSS IDs, and the blocks' own #calculator, #faq and #tour");
  ok((await p.evaluate(() => document.querySelectorAll("h1").length)) === 1, "exactly one H1 on the page");
  for (const s of ["Benefits calculator", "Your network", "Your figures", "Assumptions", "Your potential income a year", "How it's calculated", "Running your own RMN", "What is a retail media network?", "How do I get started?", "Interactive product tour", "Unlock the product tour", "Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on the opportunity.", "Operator or team", "Retailer", "For retailers, those extra sales in your stores are added to your income."]) ok(all.includes(s), "block copy: " + s);
  ok(!/network operator|world-leading/i.test(all), "none of the replaced copy on the page");
  // The blocks' copy replacements, exact (the head-start paragraph is Elementor copy now: the brief carries it, tests/operator.test.php).
  ok((await text(p, ".phf-cin-h")) === "Your network", "copy: calculator panel heading");
  ok((await text(p, ".phf-gate-p")) === "Tell us a little about yourself to watch the full walkthrough. Our team will also follow up with more on the opportunity.", "copy: tour gate intro");
  ok(await p.evaluate(() => !document.querySelector(".phf h1, .phf .phf-hero, .phf #top, .phf #why, .phf #who, .phf #how, .phf #venues, .phf #standards, .phf #independents")), "the blocks render none of the Elementor sections (no H1, hero or static section)");
  // The retired offer name nowhere a visitor can see it: visible text, tooltips, every attribute (aria-label, title, alt, placeholder, href...),
  // the document title, meta and the URL. Script and style bodies are code, not page content.
  const seen = await p.evaluate(() => {
    const out = [document.body.innerText, document.title, location.href, [...document.querySelectorAll(".phf-tipbox, option")].map((t) => t.textContent).join(" ")];
    for (const el of document.querySelectorAll("*")) { if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue; for (const a of el.attributes) out.push(a.name + "=" + a.value); }
    return out.join("\n");
  });
  ok(!NAMES(seen), "no retired offer name or previous page name in visible text, attributes, title, meta or URL: " + (seen.match(/.{0,60}(fr[a]nch|own[ -]bo[s]s|be-your[-]own).{0,60}/i) || [""])[0]);
  // ...nor in the rendered HTML, the page's own CSS/JS (file names and contents) or the inline config.
  ok(!NAMES(body) && !NAMES(page), "no retired offer name or previous page name in the rendered HTML or the page source");
  for (const f of ["operator.css", "operator.js", "operator.php", "operator-content.php", "site.js", "enhance.js"]) ok(!NAMES(f) && !NAMES(fs.readFileSync(path.join(dir, f), "utf8")), `${f}: neither name in its file name or contents`);
  ok(!fs.readdirSync(dir).some((f) => NAMES(f)), "no snippet file named after either");
  ok((await p.title()) === "Run Your Own Retail Media Network (RMN) - Personalisation Hub", "document title");
  ok((await p.evaluate(() => { const a = document.querySelector("header a[aria-current=page]"); return a.textContent + "|" + a.getAttribute("href"); })) === "Run Your Own RMN|http://x.test/run-your-own-rmn/", "header item Run Your Own RMN, current, links /run-your-own-rmn/");
  const seo = await p.evaluate(() => ({ d: document.querySelector('meta[name="description"]').content, c: [...document.querySelectorAll('link[rel="canonical"]')].map((l) => l.href), og: document.querySelector('meta[property="og:title"]').content, img: document.querySelector('meta[property="og:image"]').content, tw: document.querySelector('meta[name="twitter:card"]').content, ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent)) }));
  ok(seo.d.startsWith("Run your own retail media network (RMN)") && seo.c.join() === "https://personalisationhub.com/run-your-own-rmn/" && seo.og === "Run Your Own Retail Media Network (RMN)" && /^https:\/\//.test(seo.img) && seo.tw === "summary_large_image", "head: description, one canonical, og:title, og:image, twitter card: " + JSON.stringify(seo).slice(0, 300));
  ok(seo.ld.length === 2 && ["WebPage", "Service", "BreadcrumbList"].every((t) => seo.ld[0]["@graph"].some((n) => n["@type"] === t)) && !seo.ld[0]["@graph"].some((n) => n["@type"] === "FAQPage") && seo.ld[1]["@type"] === "FAQPage", "JSON-LD: the head graph (WebPage, Service, BreadcrumbList) and the FAQ block's FAQPage, once each");
  ok(await p.evaluate(() => !!document.querySelector('.phf[data-phf=faq] script[type="application/ld+json"]')), "the FAQPage JSON-LD is printed by the FAQ block itself");
  const faqDom = await p.evaluate(() => [...document.querySelectorAll("#faq details")].map((d) => [d.querySelector("summary").textContent.trim(), d.querySelector(".phf-faq-a").textContent.trim()]));
  ok(JSON.stringify(faqDom) === JSON.stringify(seo.ld[1].mainEntity.map((q) => [q.name, q.acceptedAnswer.text])) && faqDom.length >= 5 && faqDom.length <= 6 && seo.ld[1].isPartOf["@id"] === seo.ld[0]["@graph"].find((n) => n["@type"] === "WebPage")["@id"], "the FAQPage JSON-LD equals the visible FAQ and is part of the WebPage");
  ok((await p.evaluate(() => getComputedStyle(document.querySelector(".phf h2")).fontFamily)).includes("Kantumruy Pro"), "Kantumruy Pro in the blocks, over the kit's heading font");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector("#calc")).color === "rgb(28, 37, 64)" && getComputedStyle(document.querySelector(".phf-cout")).backgroundColor === "rgb(15, 20, 36)" && getComputedStyle(document.querySelector(".phf-cout-v")).color === "rgb(239, 96, 167)" && getComputedStyle(document.querySelector(".phf-tip-b")).backgroundColor === "rgba(0, 0, 0, 0)" && getComputedStyle(document.querySelector("#t-fn")).borderTopWidth === "1px"), "design colours and controls kept against the Elementor kit's heading, button and input styles");
  // No commercial terms anywhere on the page (text, tooltips, attributes).
  const html = await p.content();
  const bodyText = (await p.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll(".phf-tipbox")].map((t) => t.textContent).join(" "))).toLowerCase();
  for (const re of [/setup fee/, /minimum/, /\bsplit\b/, /50\s*%/, /\b0\.5\b/, /70\s*%/, /\b0\.7\b/, /\bhalf\b/, /ph's share/]) ok(!re.test(bodyText), "no commercial term: " + re);
  ok(!/0\.5/.test(body) && !/0\.7/.test(body), "neither share is in the server HTML");
  ok(!/personaliz|organiz/i.test(bodyText), "UK spelling");

  // 2. Calculator: defaults, then live updates.
  const outs = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".phf [data-out]")].map((e) => [e.dataset.out, e.textContent])));
  assert.deepStrictEqual(await outs(), d, "calculator defaults on the page");
  ok(await p.evaluate(() => !document.querySelector("#calculator .phf-cout ~ p, #calculator .phf-calc + p")), "no explanatory copy under the calculator");
  await p.fill("#c-ven", "100");
  let o = await outs();
  ok(o.yours === "$657K" && o.venues === "100" && o.displays === "300" && o.visitors === "2,433,333" && o.views === "4,380,000" && o.extraSales === "$65.7M", "venues 100 updates live: " + JSON.stringify(o));
  await p.fill("#c-ven", "-5"); await p.locator("#c-ven").dispatchEvent("change");
  ok((await p.inputValue("#c-ven")) === "0" && (await outs()).yours === "$0", "a negative input clamps at 0");
  await p.fill("#c-ven", "90");
  await p.locator("#c-view").fill("100");
  o = await outs(); ok(o.yours === "$986K" && (await text(p, "#c-view-v")) === "100%", "slider updates live: " + JSON.stringify(o));
  await p.locator("#c-up").fill("0"); o = await outs();
  ok(o.extraSales === "$0" && (await text(p, "#c-up-v")) === "0%", "uplift 0");
  await p.locator("#c-view").fill("60"); await p.locator("#c-up").fill("15");

  // 2b. The "I am" toggle: Operator or team (default) / Retailer, by click and by keyboard; aria-pressed, the two renamed rows, $60.0M.
  const tog = () => p.evaluate(() => ({ group: (() => { const g = document.querySelector(".phf-aud"); return [g.getAttribute("role"), g.getAttribute("aria-label"), g.previousElementSibling.className, g.nextElementSibling.textContent]; })(), b: [...document.querySelectorAll(".phf-aud button")].map((b) => [b.textContent, b.type, b.getAttribute("aria-pressed")]), labels: Object.fromEntries([...document.querySelectorAll(".phf [data-lab]")].map((e) => [e.dataset.lab, e.textContent])), yours: document.querySelector('.phf [data-out="yours"]').textContent }));
  const lab = (t) => ({ venues: t.labels.venues, extraSales: t.labels.extraSales });
  let tg = await tog();
  assert.deepStrictEqual(tg.group, ["group", "I am", "phf-cin-h", "Your figures"], 'toggle: role="group", aria-label "I am", under "Your network" and above the inputs');
  assert.deepStrictEqual(tg.b, [["Operator or team", "button", "true"], ["Retailer", "button", "false"]], 'toggle: two <button type="button"> with aria-pressed, "Operator or team" pressed by default');
  assert.deepStrictEqual([lab(tg), tg.yours], [OP_LABELS, "$591K"], "toggle: operator labels and $591K at the defaults");
  await p.click(".phf-aud button[data-aud=retailer]");
  tg = await tog();
  assert.deepStrictEqual([tg.b.map((b) => b[2]), lab(tg), tg.yours], [["false", "true"], RT_LABELS, "$60.0M"], "toggle: a click on Retailer presses it, renames the two rows and shows $60.0M");
  assert.deepStrictEqual(await outs(), dr, "toggle: Retailer at the defaults shows the retailer figures");
  await p.fill("#c-ven", "100");
  ok((await outs()).yours === "$66.6M", "toggle: inputs keep updating in Retailer mode (venues 100 -> $66.6M): " + (await outs()).yours);
  await p.fill("#c-ven", "90");
  await p.locator(".phf-aud button[data-aud=operator]").focus();
  await p.keyboard.press("Enter");
  tg = await tog();
  assert.deepStrictEqual([tg.b.map((b) => b[2]), lab(tg), tg.yours], [["true", "false"], OP_LABELS, "$591K"], "toggle: Enter on the focused Operator or team button switches back");
  await p.keyboard.press("Tab");
  ok(await p.evaluate(() => document.activeElement.dataset.aud === "retailer"), "toggle: Tab moves to Retailer");
  await p.keyboard.press("Space");
  tg = await tog();
  assert.deepStrictEqual([tg.b.map((b) => b[2]), lab(tg), tg.yours], [["false", "true"], RT_LABELS, "$60.0M"], "toggle: Space on the focused Retailer button presses it");
  const tcss = await p.evaluate(() => { const g = getComputedStyle(document.querySelector(".phf-aud")), [a, b] = [...document.querySelectorAll(".phf-aud button")].map((x) => { const c = getComputedStyle(x), r = x.getBoundingClientRect(); return { bg: c.backgroundColor, col: c.color, bw: c.borderTopWidth, rad: c.borderTopLeftRadius, fs: c.fontSize, fw: c.fontWeight, h: r.height, w: r.width }; }); return { g: [g.display, g.columnGap, g.backgroundColor, g.borderTopColor, g.borderTopLeftRadius, g.paddingTop, g.marginBottom], hm: getComputedStyle(document.querySelector(".phf-cin-h")).marginBottom, a, b }; });
  assert.deepStrictEqual(tcss.g, ["flex", "6px", "rgb(255, 255, 255)", "rgb(220, 225, 235)", "999px", "4px", "18px"], "toggle container: flex, gap 6px, white, #DCE1EB border, radius 999px, padding 4px, margin bottom 18px");
  ok(tcss.hm === "14px", '"Your network" has a 14px margin below it');
  ok(tcss.a.bg === "rgba(0, 0, 0, 0)" && tcss.a.col === "rgb(28, 37, 64)" && tcss.b.bg === "rgb(28, 37, 64)" && tcss.b.col === "rgb(255, 255, 255)", "toggle: pressed #1C2540 with white text, unpressed transparent with #1C2540 text (against the kit's button colours): " + JSON.stringify(tcss));
  ok([tcss.a, tcss.b].every((x) => x.bw === "0px" && x.rad === "999px" && x.fs === "15px" && x.fw === "600" && x.h >= 44 && x.w >= 44) && Math.abs(tcss.a.w - tcss.b.w) < 1, "toggle buttons: no border, radius 999px, 15px weight 600, at least 44px tall, equal widths (flex 1): " + JSON.stringify(tcss));
  ok((await text(p, "#c-how-tip")).endsWith("For retailers, those extra sales in your stores are added to your income."), '"How it\'s calculated" ends with the retailer sentence');

  // 3. Tooltips on hover, keyboard focus and tap.
  const tipOn = (id) => p.evaluate((i) => getComputedStyle(document.getElementById(i)).display !== "none", id);
  ok(!(await tipOn("c-ven-tip")), "tooltip hidden at rest");
  await p.hover("#c-ven + * button, .phf-crow:first-of-type .phf-tip-b").catch(() => {});
  await p.locator("[aria-describedby=c-ven-tip]").hover();
  ok(await tipOn("c-ven-tip"), "tooltip on hover");
  await p.mouse.move(5, 5);
  await p.locator("[aria-describedby=c-cpm-tip]").focus();
  ok(await tipOn("c-cpm-tip"), "tooltip on keyboard focus");
  ok((await text(p, "#c-how-tip")).startsWith("Venues × visitors per day"), "How it's calculated tooltip text");
  const ids = await p.evaluate(() => [...document.querySelectorAll("#calculator [aria-describedby]")].map((b) => b.getAttribute("aria-describedby")));
  assert.deepStrictEqual(ids, ["c-ven-tip", "c-dis-tip", "c-vis-tip", "c-cpm-tip", "c-atv-tip", "c-view-tip", "c-up-tip", "c-how-tip"], "a tooltip on every input and on How it's calculated");
  await p.close();
  { const t = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await t.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t.goto("http://x.test/run-your-own-rmn/");
    await t.locator("[aria-describedby=c-atv-tip]").tap();
    const g = await t.evaluate(() => { const b = document.getElementById("c-atv-tip").getBoundingClientRect(); return { on: getComputedStyle(document.getElementById("c-atv-tip")).display !== "none", l: b.left, r: b.right, w: innerWidth, exp: document.querySelector("[aria-describedby=c-atv-tip]").getAttribute("aria-expanded") }; });
    ok(g.on && g.exp === "true" && g.l >= 0 && g.r <= g.w, "tooltip on tap, inside the viewport: " + JSON.stringify(g));
    await t.locator("#calc").tap();
    ok(!(await t.evaluate(() => getComputedStyle(document.getElementById("c-atv-tip")).display !== "none")), "a tap elsewhere closes it");
    const hb = await hitBoxes(t);
    ok(hb.coarse && hb.n === 8 && hb.bad.length === 0, "touch: every info button has a hit box of at least 44x44 (16px circle kept): " + JSON.stringify(hb));
    await t.locator(".phf-aud button[data-aud=retailer]").tap();
    ok(await t.evaluate(() => document.querySelector(".phf-aud button[data-aud=retailer]").getAttribute("aria-pressed") === "true" && document.querySelector(".phf-aud button[data-aud=operator]").getAttribute("aria-pressed") === "false" && document.querySelector('.phf [data-out="yours"]').textContent === "$60.0M" && document.querySelector('.phf [data-lab="venues"]').textContent === "Stores in your network"), "touch (390): a tap on Retailer switches the mode");
    const ab = await audBoxes(t);
    ok(ab.length === 0, "touch (390): each toggle button is at least 44x44 and hit at its centre: " + JSON.stringify(ab));
    await t.close(); }
  { const t = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await t.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t.goto("http://x.test/run-your-own-rmn/");
    const pos = await tipPlace(t);
    const t2 = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    await t2.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t2.goto("http://x.test/run-your-own-rmn/");
    const pos2 = await tipPlace(t2);
    ok(JSON.stringify(pos) === JSON.stringify(pos2), "touch: the tooltip opens in the same place as with a mouse: " + JSON.stringify([pos, pos2]));
    await t.close(); await t2.close(); }

  // 3b. The FAQ accordion: closed at rest; Enter and Space on the focused question open and close it; a tap opens it.
  p = await open();
  const faqOpen = (i) => p.evaluate((n) => document.querySelectorAll("#faq details")[n].open, i);
  ok((await p.evaluate(() => [...document.querySelectorAll("#faq details")].every((d) => !d.open))) && (await p.evaluate(() => getComputedStyle(document.querySelector("#faq .phf-faq-a")).display === "none" || !document.querySelector("#faq details").open)), "FAQ: every answer closed at rest");
  await p.locator("#faq summary").first().focus();
  await p.keyboard.press("Enter");
  ok(await faqOpen(0), "FAQ: Enter on the focused question opens it");
  ok(await p.evaluate(() => { const a = document.querySelector("#faq details .phf-faq-a"); return a.getBoundingClientRect().height > 0 && /retail media network sells advertising/.test(a.textContent); }), "FAQ: the answer shows");
  await p.keyboard.press("Space");
  ok(!(await faqOpen(0)), "FAQ: Space closes it again");
  await p.keyboard.press("Tab");
  ok(await p.evaluate(() => document.activeElement === document.querySelectorAll("#faq summary")[1]), "FAQ: Tab moves to the next question");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector("#faq summary")).fontFamily.includes("Kantumruy Pro") && getComputedStyle(document.querySelector("#faq summary")).listStyleType === "none"), "FAQ: styled like the page (Kantumruy Pro, no browser marker)");
  await p.close();
  { const t = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await t.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/") ? rt.fulfill({ contentType: "text/html", body: page }) : rt.abort());
    await t.goto("http://x.test/run-your-own-rmn/");
    await t.locator("#faq summary").nth(2).tap();
    ok(await t.evaluate(() => document.querySelectorAll("#faq details")[2].open), "FAQ: a tap opens a question");
    await t.locator("#faq summary").nth(2).tap();
    ok(await t.evaluate(() => !document.querySelectorAll("#faq details")[2].open), "FAQ: a second tap closes it");
    const fb = await faqBoxes(t);
    ok(fb.length === 0, "touch: every FAQ question is at least 44x44 and hit at its centre: " + JSON.stringify(fb));
    await t.close(); }

  // 4. CTAs and the header's Arrange A Demo go to their anchors; #tour focuses the first empty field.
  p = await open();
  ok((await p.getAttribute("#top .elementor-button >> nth=0", "href")) === "#calculator" && (await p.getAttribute("#top .elementor-button >> nth=1", "href")) === "#tour", "hero CTAs (Elementor buttons, the brief's anchors)");
  ok((await p.getAttribute(".phf-cctas a:first-child", "href")) === "#tour" && (await p.getAttribute(".phf-cctas a:last-child", "href")) === "#how", "calculator CTAs");
  await p.click(".phf-cctas a:first-child");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "t-fn");
  ok(true, "Request further information focuses Full name");
  await p.fill("#t-fn", "Ada Lovelace");
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.click("#hdr-demo");
  await p.waitForFunction(() => document.activeElement && document.activeElement.id === "t-em");
  ok((await p.evaluate(() => window.__cal)) === 0 && (await p.getAttribute("#hdr-demo", "href")) === "#tour", "header Arrange A Demo goes to #tour (no demo pop-up) and focuses the first empty field");
  ok(await p.evaluate(() => { const t = document.getElementById("tour").getBoundingClientRect().top; return t >= 0 && t < 200; }), "scrolled to the tour band");
  await p.close();

  // 5. The gate: disabled until valid, posts the body, stores ph_operator and ph_lead, frames the tour unlocked, Start plays a step.
  const posts = [];
  p = await open({ search: "?ph_test=1", posts });
  const dis = () => p.locator("#phf-unlock").isDisabled();
  ok(await dis(), "Unlock disabled when empty");
  await fill(p, { name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", background: "Retail media" });
  await p.check("#t-cs");
  ok(await dis(), 'still disabled without "I am" (it is required)');
  await p.uncheck("#t-cs");
  await fill(p, { audience: "A small to medium retailer" });
  ok(await dis(), "still disabled without consent");
  await p.check("#t-cs"); ok(!(await dis()), "enabled once valid (personal email accepted)");
  ok(await p.evaluate(() => { const s = document.getElementById("t-ia"), f = [...document.querySelectorAll("#phf-form .phf-f label")].map((l) => l.textContent); return s.required && s.name === "audience" && [...s.options].map((o) => o.text).join("|") === "Select one|An individual operator|Part of an operator team|A small to medium retailer" && f.join("|") === "Full name|Email|LinkedIn profile (optional)|Where you plan to operate|I am|Your background"; }), 'the gate has a required select "I am" (three options) after "Where you plan to operate"');
  await p.fill("#t-li", "example.com/ada"); ok(await dis(), "disabled with a non-LinkedIn address");
  await p.fill("#t-li", "linkedin.com/in/ada"); ok(!(await dis()), "a LinkedIn address without https:// is fine");
  ok(await p.evaluate(() => { const s = document.getElementById("t-bg"); return s.options.length === 8 && [...s.options].slice(1).map((o) => o.text).join("|") === "Agency media or account management|Ad-tech sales or partnerships|Retail media|Creative agency|Retail business owner or manager|Marketing|Something else"; }), "the 7 backgrounds, in the design's order");
  await p.click("#phf-unlock");
  await p.waitForSelector("#phf-mount iframe");
  assert.strictEqual(posts.length, 1, "one post");
  assert.deepStrictEqual(posts[0], { name: "Ada Lovelace", email: "ada@gmail.com", linkedin: "linkedin.com/in/ada", region: "Leeds", audience: "A small to medium retailer", background: "Retail media", consent: true, page: "/run-your-own-rmn/", test: true, website: "" }, "post body (\"I am\" travels as audience, the label)");
  const st = await p.evaluate(() => ({ f: JSON.parse(localStorage.getItem("ph_operator")), l: JSON.parse(localStorage.getItem("ph_lead")), dl: (window.dataLayer || []).filter((e) => e.event === "ph_lead_captured") }));
  ok(st.f.name === "Ada Lovelace" && st.f.email === "ada@gmail.com" && st.f.ts > 0, "ph_operator stored");
  ok(st.l.name === "Ada Lovelace" && st.l.email === "ada@gmail.com" && st.l.company === "" && st.l.source === "Network operator inquiry", "ph_lead stored for the tour, source \"Network operator inquiry\"");
  ok(st.dl.length === 1 && st.dl[0].source === "Network operator inquiry" && !JSON.stringify(st.dl).includes("ada@"), "dataLayer ph_lead_captured, no contact details");
  ok((await text(p, "#phf-in-h")) === "You’re in, Ada", "You're in, <first name>");
  ok((await p.getAttribute("#phf-mount iframe", "src")) === "/run-your-own-rmn/tour/?embed=1&ph_test=1", "iframe src with embed=1 and ph_test=1");
  ok(await p.evaluate(() => getComputedStyle(document.querySelector(".phf-ph")).display === "none" && getComputedStyle(document.getElementById("phf-gate")).display === "none" && window.PH_TOUR && window.PH_TOUR.endpoint === "/wp-json/ph-site/v1/tour-lead"), "placeholder and gate replaced; window.PH_TOUR set");
  const fr = p.frames().find((f) => /\/run-your-own-rmn\/tour\//.test(f.url()));
  await fr.waitForSelector("#start", { state: "visible" });
  ok(await fr.evaluate(() => document.getElementById("gate").hidden && !document.querySelector("#gform")), "the tour opens unlocked, with no form");
  ok(await fr.evaluate(() => /Watch full screen/.test(document.getElementById("card").textContent)), "its own Start the tour / Watch full screen card");
  await p.waitForFunction(() => parseInt(document.querySelector("#phf-mount iframe").style.height, 10) > 300);
  ok(true, "the frame height follows the tour's height message");
  await fr.click("#start");
  await fr.waitForFunction(() => !!document.querySelector('#dots [aria-current="true"]'), null, { timeout: 15000 });
  ok(true, "Start the tour plays a step");
  ok(p.__errs.length === 0, "no page errors: " + p.__errs.join("; "));
  ok(!NAMES(await p.evaluate(() => document.body.innerText)), "after unlocking: still neither name in the visible text");
  const keys = await p.evaluate(() => Object.keys(localStorage));
  ok(keys.includes("ph_operator") && !keys.some((k) => NAMES(k)) && !NAMES(await p.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))))), "localStorage: key ph_operator, neither name in any key or value: " + keys.join(","));
  ok(!NAMES(await p.evaluate(() => JSON.stringify(window.dataLayer || []))), "dataLayer: neither name in any event");
  ok(p.__reqs.some((u) => /\/wp-json\/ph-site\/v1\/operator-lead$/.test(u)) && !p.__reqs.some((u) => NAMES(u)), "the gate posts to ph-site/v1/operator-lead; no request names either");
  await p.close();

  // 6. Errors: a 400 names the field.
  p = await open({ status: 400, reply: { error: "Please tell us where you plan to operate.", field: "region" } });
  await fill(p, { name: "Ada", email: "ada@x.test", region: "x", audience: "An individual operator", background: "Creative agency", consent: true });
  await p.click("#phf-unlock");
  await p.waitForFunction(() => /where you plan/.test(document.getElementById("phf-msg").textContent));
  ok(await p.evaluate(() => document.activeElement.id === "t-rg" && document.getElementById("t-rg").getAttribute("aria-invalid") === "true" && !localStorage.getItem("ph_operator") && !document.querySelector("#phf-mount iframe")), "400: message, field focused, nothing stored, no tour");
  await p.close();

  // 7. An existing industry ph_lead: name and email prefilled, never overwritten.
  const industry = { name: "Grace Hopper", company: "Orbit Pharmacy", email: "grace@orbit.example", source: "Pharmacy business model download", ts: 1 };
  p = await open({ lead: industry, posts: [] });
  ok((await p.inputValue("#t-fn")) === "Grace Hopper" && (await p.inputValue("#t-em")) === "grace@orbit.example" && (await p.inputValue("#t-rg")) === "", "industry lead: name and email prefilled, the rest asked");
  ok(await p.locator("#phf-unlock").isDisabled(), "still asks for the remaining fields");
  await fill(p, { region: "Bristol", audience: "Part of an operator team", background: "Retail business owner or manager", consent: true });
  await p.click("#phf-unlock"); await p.waitForSelector("#phf-mount iframe");
  ok(JSON.stringify(await p.evaluate(() => JSON.parse(localStorage.getItem("ph_lead")))) === JSON.stringify(industry), "the industry ph_lead is not overwritten");
  await p.close();

  // 8. Returning visitor (ph_operator stored): no gate, the tour straight away; the restored ph_lead carries the new label.
  p = await open({ operator: { name: "Ada Lovelace", email: "ada@gmail.com", ts: 1 } });
  await p.waitForSelector("#phf-mount iframe");
  ok(await p.evaluate(() => { const l = JSON.parse(localStorage.getItem("ph_lead")); return getComputedStyle(document.getElementById("phf-gate")).display === "none" && l.email === "ada@gmail.com" && l.source === "Network operator inquiry"; }), "returning visitor skips the gate (ph_lead restored for the tour, source Network operator inquiry)");
  ok((await p.getAttribute("#phf-mount iframe", "src")) === "/run-your-own-rmn/tour/?embed=1", "no ph_test outside test mode");
  await p.close();

  // 8b. WebMCP: estimate_rmn_earnings drives the page's own calculator and returns the page's own figures; the gate only with consent.
  const wposts = [];
  p = await open({ search: "?ph_test=1", posts: wposts });
  const tools = await p.evaluate(() => window.__tools.map((t) => ({ name: t.name, d: t.description, s: t.inputSchema })));
  ok(tools.length === 1 && tools[0].name === "estimate_rmn_earnings", "WebMCP: one tool, estimate_rmn_earnings, registered on the page");
  ok(/running your own retail media network \(RMN\)/i.test(tools[0].d) && /consent=true/.test(tools[0].d) && tools[0].s.properties.consent.type === "boolean" && tools[0].s.properties.view.maximum === 100 && JSON.stringify(tools[0].s.properties.background.enum) === JSON.stringify(F.BACKGROUNDS), "WebMCP: described as running your own retail media network; schema from the page");
  ok(JSON.stringify(tools[0].s.properties.audience.enum) === '["operator","retailer"]' && /default/.test(tools[0].s.properties.audience.description) && JSON.stringify(tools[0].s.properties.i_am.enum) === JSON.stringify(F.AUDIENCES) && !(tools[0].s.required || []).length, 'WebMCP: an optional audience ("operator" | "retailer", default operator) and i_am (the gate\'s three options)');
  const est = (a) => p.evaluate((args) => window.__tools[0].execute(args), a);
  let w = await est({});
  assert.deepStrictEqual(w.structuredContent.figures, d, "WebMCP: the defaults return the page's own figures ($591K, 90, 270, 2,190,000, 3,942,000, $59.1M)");
  ok(w.structuredContent.inputs.ven === 90 && /Your potential income a year: \$591K/.test(w.content[0].text) && /consent/.test(w.content[0].text) && wposts.length === 0, "WebMCP: figures in the text, asks for the person's details, nothing posted");
  ok(w.structuredContent.audience === "operator" && /Venues in your network: 90/.test(w.content[0].text) && /Extra sales for your venues a year: \$59\.1M/.test(w.content[0].text), "WebMCP: no audience means operator, with the operator labels");
  ok(!/0\.5|50\s*%|0\.7|70\s*%|\bhalf\b|SHARE/i.test(JSON.stringify([w, tools])), "WebMCP: neither share constant is ever in the tool or its result");
  w = await est({ audience: "retailer" });
  assert.deepStrictEqual(w.structuredContent.figures, dr, "WebMCP: audience retailer returns the page's retailer figures ($60.0M)");
  ok(w.structuredContent.audience === "retailer" && /Your potential income a year: \$60\.0M/.test(w.content[0].text) && /Stores in your network: 90/.test(w.content[0].text) && /Extra sales in your stores a year: \$59\.1M/.test(w.content[0].text) && !/Venues in your network/.test(w.content[0].text), "WebMCP: retailer figures with the retailer labels in the text");
  ok(await p.evaluate(() => document.querySelector(".phf-aud button[data-aud=retailer]").getAttribute("aria-pressed") === "true" && document.querySelector('.phf [data-out="yours"]').textContent === "$60.0M" && document.querySelector('.phf [data-lab="extraSales"]').textContent === "Extra sales in your stores a year"), "WebMCP: the page's own toggle and figures show the same");
  ok(!/0\.5|50\s*%|0\.7|70\s*%|\bhalf\b|SHARE/i.test(JSON.stringify(w)), "WebMCP: no share constant in the retailer result");
  w = await est({ audience: "operator" });
  assert.deepStrictEqual([w.structuredContent.audience, w.structuredContent.figures], ["operator", d], "WebMCP: audience operator returns the operator figures ($591K)");
  w = await est({ audience: "retailer", ven: 100 });
  ok(w.structuredContent.figures.yours === "$66.6M" && w.structuredContent.inputs.ven === 100, "WebMCP: retailer with venues 100 ($66.6M)");
  w = await est({ ven: 90 });
  ok(w.structuredContent.audience === "operator" && w.structuredContent.figures.yours === "$591K" && (await p.evaluate(() => document.querySelector(".phf-aud button[data-aud=operator]").getAttribute("aria-pressed"))) === "true", "WebMCP: a call without audience is an operator estimate again");
  w = await est({ ven: 100 });
  ok(w.structuredContent.figures.yours === "$657K" && (await p.inputValue("#c-ven")) === "100" && (await text(p, "[data-out=yours]")) === "$657K", "WebMCP: venues 100 fills the page's input and returns what the page shows ($657K)");
  w = await est({ ven: -5, view: 500 });
  ok(w.structuredContent.inputs.ven === 0 && w.structuredContent.inputs.view === 100, "WebMCP: figures clamped to the inputs' ranges");
  await est({ ven: 90, view: 60 });
  w = await est({ name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", i_am: "An individual operator", background: "Retail media" });
  ok(/agreement to be contacted/.test(w.content[0].text) && wposts.length === 0 && !(await p.$("#phf-mount iframe")), "WebMCP: details without consent submit nothing");
  w = await est({ name: "Ada Lovelace", email: "nope", region: "Leeds", background: "Retail media", consent: true });
  ok(/not accepted/.test(w.content[0].text) && wposts.length === 0, "WebMCP: invalid details are not submitted");
  w = await est({ name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", background: "Retail media", consent: true });
  ok(/not accepted/.test(w.content[0].text) && wposts.length === 0, 'WebMCP: without "I am" the details are not submitted');
  w = await est({ name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", i_am: "A large retailer", background: "Retail media", consent: true });
  ok(/not accepted/.test(w.content[0].text) && wposts.length === 0, 'WebMCP: an "I am" that is not one of the three is not submitted');
  w = await est({ audience: "retailer", name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", i_am: "A small to medium retailer", background: "Retail business owner or manager", consent: true });
  ok(!w.isError && w.structuredContent.tourUnlocked === true && wposts.length === 1 && wposts[0].email === "ada@gmail.com" && wposts[0].audience === "A small to medium retailer" && wposts[0].background === "Retail business owner or manager" && wposts[0].consent === true && wposts[0].test === true && wposts[0].page === "/run-your-own-rmn/", "WebMCP: with the person's details and consent the page's own gate posts once and the tour unlocks");
  ok((await p.evaluate(() => (window.dataLayer || []).filter((e) => e.event === "ph_agent_tool" && e.tool === "estimate_rmn_earnings").length)) >= 1 && !(await p.evaluate(() => JSON.stringify(window.dataLayer))).includes("ada@"), "WebMCP: a ph_agent_tool event, no contact details in the dataLayer");
  ok(p.__errs.length === 0 && !NAMES(JSON.stringify(tools)), "WebMCP: no page errors, neither name in the tool");
  await p.close();

  // 9. No horizontal scroll at 360, 390, 768 and 1440 (locked and unlocked).
  for (const w of [360, 390, 768, 1440]) {
    for (const fr2 of [null, { name: "A", email: "a@b.test", ts: 1 }]) {
      p = await open({ width: w, height: 800, operator: fr2 });
      const sw = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, wide: [...document.querySelectorAll(".phf *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".phf-tipbox, .phf-hp, .phf-ph")).map((e) => e.className || e.tagName).slice(0, 5) }));
      ok(sw.sw <= sw.w && sw.wide.length === 0, `no horizontal scroll at ${w} (${fr2 ? "unlocked" : "locked"}): ` + JSON.stringify(sw));
      await p.close();
    }
  }
  p = await open({ width: 1440 });
  ok(await p.evaluate(() => { const a = document.querySelector(".phf-cin-card").getBoundingClientRect(), b = document.querySelector(".phf-cout").getBoundingClientRect(); return b.left > a.right && Math.abs(a.top - b.top) < 2; }), "1440: calculator inputs and result side by side");
  await p.close();
  p = await open({ width: 360 });
  ok(await p.evaluate(() => document.querySelector(".phf-cout").getBoundingClientRect().top > document.querySelector(".phf-cin-card").getBoundingClientRect().bottom), "360: the calculator stacks");
  await p.close();

  // 10. Tablets (Rob's iPad and tablet pass): each device in portrait and landscape, touch on, the device's own user agent (an iPad UA
  // on the iPads). Galaxy Tab: the browser's full-screen API is switched off, so the tour's in-page fallback is what is exercised there too.
  for (const dev of ["iPad Mini", "iPad (gen 7)", "iPad Pro 11", "Galaxy Tab S4"]) {
    for (const name of [dev, dev + " landscape"]) {
      assert.ok(devices[name], "Playwright device " + name);
      const ipad = /iPad/.test(devices[name].userAgent);
      p = await open({ device: name, search: "?ph_test=1", posts: [], init: ipad ? null : () => { Object.defineProperty(Document.prototype, "fullscreenEnabled", { get: () => false }); Element.prototype.requestFullscreen = undefined; } });
      const env = await p.evaluate(() => ({ w: innerWidth, sw: document.documentElement.scrollWidth, touch: navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches, ua: navigator.userAgent }));
      ok(env.touch && (ipad ? /iPad/.test(env.ua) : /Android/.test(env.ua)), `${name}: touch on, ${ipad ? "iPad" : "Android"} user agent`);
      ok(env.sw <= env.w, `${name}: no horizontal scroll (${env.sw} <= ${env.w})`);
      await p.locator("#c-ven").tap(); await p.fill("#c-ven", "100");
      ok((await outs()).yours === "$657K", `${name}: calculator usable (venues 100 -> $657K)`);
      await p.fill("#c-ven", "90");
      await p.locator(".phf-aud button[data-aud=retailer]").tap();
      ok(await p.evaluate(() => document.querySelector(".phf-aud button[data-aud=retailer]").getAttribute("aria-pressed") === "true" && document.querySelector('.phf [data-out="yours"]').textContent === "$60.0M" && document.querySelector('.phf [data-lab="venues"]').textContent === "Stores in your network" && document.querySelector('.phf [data-lab="extraSales"]').textContent === "Extra sales in your stores a year"), `${name}: a tap on Retailer shows $60.0M with the retailer labels`);
      await p.locator(".phf-aud button[data-aud=operator]").tap();
      ok(await p.evaluate(() => document.querySelector(".phf-aud button[data-aud=operator]").getAttribute("aria-pressed") === "true" && document.querySelector('.phf [data-out="yours"]').textContent === "$591K" && document.querySelector('.phf [data-lab="venues"]').textContent === "Venues in your network"), `${name}: a tap on Operator or team switches back`);
      const ab = await audBoxes(p);
      ok(ab.length === 0, `${name}: each toggle button's hit area is at least 44x44: ` + JSON.stringify(ab));
      await p.locator("[aria-describedby=c-atv-tip]").tap();
      ok(await p.evaluate(() => { const t = document.getElementById("c-atv-tip"), r = t.getBoundingClientRect(); return getComputedStyle(t).display !== "none" && r.left >= 0 && r.right <= innerWidth; }), `${name}: an info tooltip opens by tap, inside the viewport`);
      await p.locator("#calc").tap();
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("c-atv-tip")).display === "none"), `${name}: a tap elsewhere closes it`);
      const hb = await hitBoxes(p);
      ok(hb.coarse && hb.n === 8 && hb.bad.length === 0, `${name}: every info button's hit box is at least 44x44: ` + JSON.stringify(hb));
      const fq = await faqBoxes(p);
      ok(fq.length === 0, `${name}: every FAQ question is at least 44x44: ` + JSON.stringify(fq));
      await p.evaluate(() => document.querySelector("#faq summary").scrollIntoView({ block: "center", behavior: "instant" })); // clear of the sticky header
      await p.locator("#faq summary").first().tap();
      const fo = await p.evaluate(() => ({ open: document.querySelector("#faq details").open, sw: document.documentElement.scrollWidth, w: innerWidth }));
      ok(fo.open && fo.sw <= fo.w, `${name}: the FAQ opens by tap, no horizontal scroll: ` + JSON.stringify(fo));
      await fill(p, { name: "Ada Lovelace", email: "ada@gmail.com", region: "Leeds", audience: "An individual operator", background: "Retail media" });
      await p.locator("#t-cs").tap();
      ok(!(await p.locator("#phf-unlock").isDisabled()), `${name}: the gate is usable (Unlock enabled once valid, with "I am" chosen)`);
      await p.locator("#phf-unlock").tap();
      await p.waitForSelector("#phf-mount iframe");
      ok(await p.evaluate(() => getComputedStyle(document.getElementById("phf-gate")).display === "none" && getComputedStyle(document.querySelector(".phf-ph")).display === "none"), `${name}: the gate submit unlocks the tour`);
      const tf = p.frames().find((f) => /\/run-your-own-rmn\/tour\//.test(f.url()));
      await tf.waitForSelector("#start", { state: "visible" });
      await tf.locator("#start").tap();
      await tf.waitForFunction(() => !!document.querySelector('#dots [aria-current="true"]'), null, { timeout: 15000 });
      ok(true, `${name}: the tour plays`);
      const gt = await tf.evaluate(() => ({ title: document.title, cap: document.getElementById("capT").textContent, img: [...document.querySelectorAll("#stage .rm-shot img")].map((i) => i.complete && i.naturalWidth >= 1600 && /\/run-your-own-rmn\/tour\/assets\/v1\/img\//.test(i.src)) }));
      ok(/Run Your Own RMN/.test(gt.title) && /six screen types/.test(gt.cap) && gt.img.length > 0 && gt.img.every(Boolean), `${name}: it is the golf club tour, on its real screenshots: ` + JSON.stringify(gt));
      await tf.waitForSelector("#fs", { state: "visible" });
      await tf.locator("#fs").tap();
      await tf.waitForFunction(() => document.documentElement.classList.contains("fs"));
      await p.waitForFunction(() => document.querySelector("#phf-mount iframe").style.position === "fixed");
      const fsOn = await p.evaluate(() => { const r = document.querySelector("#phf-mount iframe").getBoundingClientRect(); return { native: !!document.fullscreenElement, cover: Math.round(r.width) === innerWidth && Math.round(r.height) === innerHeight }; });
      ok(!fsOn.native && fsOn.cover && !(await tf.evaluate(() => !!document.fullscreenElement)), `${name}: the full-screen fallback opens over the whole viewport: ` + JSON.stringify(fsOn));
      await tf.locator("#fsclose").tap();
      await tf.waitForFunction(() => !document.documentElement.classList.contains("fs"));
      await p.waitForFunction(() => document.querySelector("#phf-mount iframe").style.position !== "fixed");
      ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.body.style.overflow !== "hidden"), `${name}: the full-screen fallback closes and the page is restored`);
      ok(p.__errs.length === 0, `${name}: no page errors: ` + p.__errs.join("; "));
      await p.__ctx.close();
    }
  }

  // 11. enhance.js: a stored lead without a company is not "known" on the industry download gates; tours still unlock from it.
  const enhance = fs.readFileSync(path.join(dir, "enhance.js"), "utf8");
  const ecss = fs.readFileSync(path.join(dir, "enhance.css"), "utf8");
  const { CALC } = require(path.join(dir, "enhance.js"));
  const row = '<div class="ph-ind-cf"><span class="ph-ind-cf-l">L</span><span class="ph-ind-cf-v">V</span></div>';
  const ind = "pharmacy", n = CALC[ind].inputs.length + CALC[ind].assumptions.length;
  const ihtml = `<!doctype html><html><head><style>${ecss}</style></head><body><main><section class="ph-ind-sec"><div class="ph-ind-calc"><div class="ph-ind-cin"><p class="ph-ind-label-gap">a</p><p class="ph-ind-label-gap">b</p>${row.repeat(n)}</div><div class="ph-ind-cout"><p class="ph-ind-ctot-l">Total</p><p class="ph-ind-ctot-v">0</p><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div><div class="ph-ind-crow">r</div></div></div></section></main><script>window.PH_IND_PAGE="${ind}";</script><script>${enhance}</script></body></html>`;
  for (const [lead, known] of [[{ name: "Ada Lovelace", email: "ada@gmail.com", company: "", source: "Network operator inquiry" }, false], [{ name: "Ada Lovelace", email: "ada@orbit.example", company: "Orbit", source: "Interactive product tour" }, true], [{ name: "", email: "ada@orbit.example", company: "Orbit" }, false]]) {
    const q = await browser.newPage();
    await q.addInitScript((l) => localStorage.setItem("ph_lead", JSON.stringify(l)), lead);
    await q.route("**/*", (rt) => rt.request().url().startsWith("http://x.test/industries/pharmacy/") && !/tour/.test(rt.request().url()) ? rt.fulfill({ contentType: "text/html", body: ihtml }) : rt.fulfill({ contentType: "text/html", body: "<p>t</p>" }));
    await q.goto("http://x.test/industries/pharmacy/");
    await q.locator("form.ph-ind-gate-f").waitFor();
    const k = await q.evaluate(() => document.querySelector("form.ph-ind-gate-f").classList.contains("ph-ind-gate-known"));
    ok(k === known, `enhance.js known visitor needs name, company and email (${JSON.stringify(lead)}): known=${k}`);
    await q.close();
  }
} finally {
  await browser.close();
}
console.log(`operator.test.mjs: ${checks} checks passed`);
