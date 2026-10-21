// The viewport matrix every Staff Kanban case runs in (E2E-TEST-PLAN.md →
// "Viewport matrix"). One profile is one Playwright "project": an engine, a
// viewport and an input type. Both suites (the prototype's and the console's)
// import this file, so the matrix cannot drift between them.
//
//   KB_PROFILES=phone-390-chromium,tablet-l-webkit   run only those
//   KB_PROFILES=quick                                 desktop 1440 + phone 390, Chromium
//   KB_ENGINES=chromium                               drop Firefox and WebKit
//
// An engine that isn't installed is reported and skipped, never silently
// treated as a pass: the run summary names every profile that did not run.

const P = (id, label, engine, width, height, touch, kind, extra = {}) => ({ id, label, engine, width, height, touch, kind, ...extra });

export const PROFILES = [
  P("desktop-1440-chromium", "Desktop 1440×900 · mouse · Chromium", "chromium", 1440, 900, false, "desktop"),
  P("desktop-1440-firefox", "Desktop 1440×900 · mouse · Firefox", "firefox", 1440, 900, false, "desktop"),
  P("desktop-1440-webkit", "Desktop 1440×900 · mouse · WebKit", "webkit", 1440, 900, false, "desktop"),
  P("desktop-1024-chromium", "Desktop 1024×768, sidebar open · mouse · Chromium", "chromium", 1024, 768, false, "desktop", { sidebarOpen: true }),
  P("tablet-l-chromium", "Tablet landscape 1024×768 · touch · Chromium", "chromium", 1024, 768, true, "tablet"),
  P("tablet-l-webkit", "Tablet landscape 1024×768 · touch · WebKit", "webkit", 1024, 768, true, "tablet"),
  P("tablet-p-chromium", "Tablet portrait 768×1024 · touch · Chromium", "chromium", 768, 1024, true, "tablet"),
  P("tablet-p-webkit", "Tablet portrait 768×1024 · touch · WebKit", "webkit", 768, 1024, true, "tablet"),
  P("phone-390-chromium", "Phone 390×844 · touch · Chromium", "chromium", 390, 844, true, "phone"),
  P("phone-390-webkit", "Phone 390×844 · touch · WebKit", "webkit", 390, 844, true, "phone"),
  P("phone-360-chromium", "Phone small 360×740 · touch · Chromium", "chromium", 360, 740, true, "phone"),
];

export const QUICK = ["desktop-1440-chromium", "phone-390-chromium"];

// Context options for a profile. `height` lets a case ask for a taller window
// (drags need the whole column in view) without changing width or input.
export function contextOptions(profile, over = {}) {
  const o = { viewport: { width: profile.width, height: over.height || profile.height } };
  if (profile.touch) { o.hasTouch = true; if (profile.engine !== "firefox") o.isMobile = true; }
  return o;
}

export function wantedProfiles(env = process.env) {
  let list = PROFILES;
  const sel = (env.KB_PROFILES || "").trim();
  if (sel === "quick") list = list.filter((p) => QUICK.includes(p.id));
  else if (sel) { const ids = sel.split(",").map((s) => s.trim()); list = list.filter((p) => ids.includes(p.id)); }
  const engines = (env.KB_ENGINES || "").trim();
  if (engines) { const e = engines.split(",").map((s) => s.trim()); list = list.filter((p) => e.includes(p.engine)); }
  return list;
}

// Launches each engine once; returns { launched: Map(engine → browser), missing: [{engine, reason}] }.
export async function launchEngines(pw, launchers, profiles) {
  const launched = new Map(), missing = [];
  for (const engine of [...new Set(profiles.map((p) => p.engine))]) {
    try { launched.set(engine, await launchers[engine]()); }
    catch (e) { missing.push({ engine, reason: String(e.message || e).split("\n")[0] }); }
  }
  return { launched, missing };
}
