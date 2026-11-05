/* Business model calculator, for browsers and agents. Printed only on an industry page that has a calculator.
 * window.PH_CALCULATOR comes from calculators.php (the one list): { industry, name, title, summary, outcome, fields[], download, gated }.
 * 1. Deep link: ?stores=58&arpu=49 ... fills the calculator on load (known field ids only, clamped to each field's range).
 * 2. WebMCP: registers run_business_model_calculator (navigator.modelContext.registerTool) so a browser agent can fill the
 *    figures, read the estimate and, when the person has supplied their own details and agreed, submit the gate form that
 *    starts the download. It drives the page's own inputs and form, so it can never do more than the person could.
 * Does nothing without the calculator on the page. No arguments or contact details are sent to analytics. */
(function () {
  var cfg = window.PH_CALCULATOR;
  if (!cfg || !cfg.fields || window.__phCalcMcp) return;
  window.__phCalcMcp = 1;
  var byId = {};
  cfg.fields.forEach(function (f) { byId[f.id] = f; });

  function input(id) { return document.getElementById("ph-ind-in-" + id); }
  function ready() { return !!input(cfg.fields[0].id); }
  function whenReady(fn) {
    if (ready()) return fn();
    var n = 0, t = setInterval(function () { if (ready() || ++n > 100) { clearInterval(t); if (ready()) fn(); } }, 100);
  }
  function clamp(f, v) { v = +v; if (!isFinite(v)) return null; return Math.max(f.min, Math.min(f.max, v)); }
  function fire(node, type) { node.dispatchEvent(new Event(type, { bubbles: true })); }

  /* Set the figures that were given; returns what is now in the calculator. */
  function fill(values) {
    var used = {};
    Object.keys(values || {}).forEach(function (id) {
      var f = byId[id], node = f && input(id); if (!node) return;
      var v = clamp(f, values[id]); if (v === null) return;
      node.value = v; fire(node, "input"); used[id] = v;
    });
    return used;
  }
  function current() {
    var out = {};
    cfg.fields.forEach(function (f) { var n = input(f.id); if (n) out[f.id] = +n.value; });
    return out;
  }
  function total() {
    var ps = document.querySelectorAll(".ph-ind-cout p"), i, t = "";
    for (i = 0; i < ps.length; i++) { if (/ph-ind-ctot-/.test(ps[i].className) && !/ph-ind-ctot-l/.test(ps[i].className)) t = ps[i].textContent; }
    return t;
  }
  function seen() {
    try { (window.dataLayer = window.dataLayer || []).push({ event: "ph_agent_tool", tool: "run_business_model_calculator", source: "webmcp", page_path: location.pathname, referrer: (document.referrer.split("/")[2] || "none").toLowerCase(), at: new Date().toISOString() }); } catch (e) {}
  }
  function text(t, extra) { var r = { content: [{ type: "text", text: t }] }; if (extra) r.structuredContent = extra; return r; }
  function fail(t) { return { isError: true, content: [{ type: "text", text: t }] }; }

  /* 1. deep link */
  try {
    var q = new URLSearchParams(location.search), pre = {}, any = false;
    cfg.fields.forEach(function (f) { if (q.has(f.id)) { pre[f.id] = q.get(f.id); any = true; } });
    if (any) whenReady(function () { fill(pre); var c = document.querySelector(".ph-ind-calc"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "start" }); });
  } catch (e) {}

  /* 2. WebMCP */
  var mc = navigator.modelContext;
  if (!mc || !mc.registerTool) return;
  var props = {};
  cfg.fields.forEach(function (f) { props[f.id] = { type: "number", minimum: f.min, maximum: f.max, description: f.label + " (default " + f.default + ")" }; });
  props.name = { type: "string", maxLength: 120, description: "Full name of the person, only if they gave it to you for the download" };
  props.company = { type: "string", maxLength: 120, description: "Their company, only if they gave it to you for the download" };
  props.email = { type: "string", maxLength: 120, description: "Their work email, only if they gave it to you for the download" };
  props.consent = { type: "boolean", description: "true only if the person has said they agree to be contacted (see the privacy policy). Never assume it." };
  var desc = "Fill in the " + cfg.title + " on this page and read the estimate. " + cfg.summary + " Give any of the figures you know; the rest keep their defaults. " +
    (cfg.download ? "To also download the business model" + (cfg.gated ? ", the person must give you their own full name, company and work email and agree to be contacted: pass name, company, email and consent=true only when they have, and the download starts in their browser. Without them, the figures are filled in and the person can complete the download form on the page." : ", pass nothing more; the download starts in the browser.") : "");
  try {
    mc.registerTool({
      name: "run_business_model_calculator",
      description: desc,
      inputSchema: { type: "object", properties: props, additionalProperties: false },
      annotations: { readOnlyHint: false },
      execute: function (args) {
        seen();
        args = args || {};
        if (!ready()) return Promise.resolve(fail("The calculator has not loaded yet. Try again in a moment."));
        var vals = {};
        cfg.fields.forEach(function (f) { if (args[f.id] !== undefined) vals[f.id] = args[f.id]; });
        fill(vals);
        var now = current(), est = total();
        var base = "Calculator filled in. " + cfg.outcome.split(",")[0] + ": " + est + ".";
        var data = { industry: cfg.industry, inputs: now, estimate: est };
        var wantsDownload = args.name || args.company || args.email || args.consent;
        var form = document.querySelector(".ph-ind-gate-f");
        if (!cfg.download || !form) return Promise.resolve(text(base, data));
        if (!wantsDownload) {
          return Promise.resolve(text(base + (cfg.gated ? " To get the downloadable model, ask the person for their full name, company, work email and whether they agree to be contacted, then call again with name, company, email and consent. Or they can complete the form under the calculator." : " The download form is under the calculator."), data));
        }
        if (args.consent !== true) return Promise.resolve(text(base + " The download needs the person's agreement to be contacted (consent=true). Ask them first.", data));
        ["name", "company", "email"].forEach(function (k) { var n = form.elements[k]; if (n && typeof args[k] === "string") { n.value = args[k]; fire(n, "input"); } });
        if (form.elements.consent) { form.elements.consent.checked = true; fire(form.elements.consent, "change"); }
        var btn = form.querySelector("button[type=submit]");
        if (!btn || btn.disabled) return Promise.resolve(text(base + " The details were not accepted (check the name, company and a valid work email), so no download was started.", data));
        btn.click();
        return new Promise(function (resolve) {
          var n = 0, t = setInterval(function () {
            var a = form.querySelector(".ph-ind-gate-m a"), m = form.querySelector(".ph-ind-gate-m"), err = m && /ph-ind-gate-err/.test(m.className);
            if (a || err || ++n > 80) {
              clearInterval(t);
              if (a) data.download = a.href;
              resolve(a ? text(base + " The download has started in the browser. If it does not, this link works for 24 hours: " + a.href, data) : fail(err ? m.textContent : "The download did not start. The person can use the form under the calculator."));
            }
          }, 100);
        });
      }
    });
  } catch (e) {}
})();
