(function () {
  var mc = navigator.modelContext;
  if (!mc || (!mc.registerTool && !mc.provideContext) || window.__phAe) return;
  window.__phAe = 1;
  var base = window.PH_AE_REST || "/wp-json/ph-agent/v1/";
  function seen(name) {
    try {
      var h = (document.referrer.split("/")[2] || "").toLowerCase();
      (window.dataLayer = window.dataLayer || []).push({ event: "ph_agent_tool", tool: name, source: "webmcp", page_path: location.pathname, referrer: h || "none", at: new Date().toISOString() });
    } catch (e) {}
  }
  function call(name, args) {
    seen(name);
    return fetch(base + "tools/" + name + "?args=" + encodeURIComponent(JSON.stringify(args || {})), { credentials: "omit" })
      .then(function (r) { return r.json(); })
      .catch(function () { return { isError: true, content: [{ type: "text", text: "Could not reach the Personalisation Hub tools. Try again later." }] }; });
  }
  fetch(base + "tools", { credentials: "omit" }).then(function (r) { return r.json(); }).then(function (d) {
    var tools = (d.tools || []).map(function (t) {
      return { name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, execute: function (a) { return call(t.name, a); } };
    });
    try {
      if (mc.registerTool) tools.forEach(function (t) { mc.registerTool(t); });
      else mc.provideContext({ tools: tools });
    } catch (e) {}
  }).catch(function () {});
})();
