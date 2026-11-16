"use strict";
// Skills per project and per kind of work (ticket CCPnRjXOH4YMsfy3C49r,
// "Flow 8/9", 14 Nov 2026 board flow review).
//
// settings/phaseSkillBindings used to be one global { build: slug[],
// deploy: slug[] }, so a docs ticket and a UI ticket were sent the same
// skills. It now also takes two optional maps, each ADDED to the global list:
//
//   byProject: { [projectId]: { build?: slug[], deploy?: slug[] } }
//   byArea:    { [category]:  { build?: slug[], deploy?: slug[] } }
//
// A plain array in either map is read as that key's build list. The old
// shape (no maps) reads exactly as before. A ticket whose description or
// category says it changes rendered output always gets ph-designer in its
// build list (root CLAUDE.md: "Every UI change goes through the ph-designer
// skill"), whether or not anything binds it.
//
// The fire text lists the union with each skill's reason, and the card
// records the slugs on lastFire.skills. Shared by functions/index.js and
// functions/mcp-server.js; pure.

const { rendersUI } = require("./model-suggest");

const PHASES = ["build", "deploy"];
const UI_SKILL = "ph-designer";
const MAX_PER_LIST = 20;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function listFor(value, phase) {
  if (Array.isArray(value)) return phase === "build" ? value : [];
  if (value && typeof value === "object" && Array.isArray(value[phase])) return value[phase];
  return [];
}
const cleanSlugs = (list) => list.map((s) => String(s || "").trim()).filter((s) => SLUG_RE.test(s));

// → [{slug, reason}] in order: global, project, area, then ph-designer for UI.
function skillsFor(bindings, phase, { projectId = null, projectName = null, item = null } = {}) {
  const b = bindings && typeof bindings === "object" ? bindings : {};
  const out = [];
  const add = (slug, reason) => { if (!out.some((x) => x.slug === slug)) out.push({ slug, reason }); };
  for (const slug of cleanSlugs(Array.isArray(b[phase]) ? b[phase] : [])) add(slug, `bound to every ${phase}`);
  if (projectId && b.byProject && typeof b.byProject === "object") {
    for (const slug of cleanSlugs(listFor(b.byProject[projectId], phase))) add(slug, `bound to ${projectName ? `"${projectName}"` : "this project"}`);
  }
  const area = item && item.category;
  if (area && b.byArea && typeof b.byArea === "object") {
    for (const slug of cleanSlugs(listFor(b.byArea[area], phase))) add(slug, `bound to ${area} tickets`);
  }
  if (phase === "build" && item && rendersUI(item)) {
    const i = out.findIndex((x) => x.slug === UI_SKILL);
    const reason = "this ticket changes rendered UI";
    if (i >= 0) out[i] = { slug: UI_SKILL, reason: `${out[i].reason}; ${reason}` };
    else out.push({ slug: UI_SKILL, reason });
  }
  return out;
}

// The fire-text block (empty string when there is nothing to list).
function skillsBlock(list, phaseLabel) {
  if (!Array.isArray(list) || !list.length) return "";
  return `=== SKILLS BOUND TO THE ${phaseLabel} PHASE ===\n` +
    `Before finishing this phase's work, fetch each of these from the shared, organisation-wide skills library (skills/{skillId} — query where slug == the name below, via your existing board access) and follow it. Each line is "slug: why it is listed". See ROUTINE_INSTRUCTIONS.md for exactly when in this phase to apply each one; a slug here that doesn't resolve to a skill yet is not an error, just note it and move on.\n` +
    `${list.map((s) => `- ${s.slug}: ${s.reason}`).join("\n")}\n` +
    `=== END SKILLS BOUND TO THE ${phaseLabel} PHASE ===\n\n`;
}

// set_phase_skill_bindings: the next value of one list. target is
// {phase} (global), {phase, projectId} or {phase, area}. Returns
// {path: [field, key?, phase?], next} for the caller to write with merge.
function nextBindingList(current, { phase, projectId = null, area = null }, add = [], remove = []) {
  const b = current && typeof current === "object" ? current : {};
  let cur;
  if (projectId) cur = listFor((b.byProject || {})[projectId], phase);
  else if (area) cur = listFor((b.byArea || {})[area], phase);
  else cur = Array.isArray(b[phase]) ? b[phase] : [];
  const drop = new Set(remove.map(String));
  const next = cur.map(String).filter((x) => !drop.has(x));
  for (const slug of add) if (!next.includes(slug)) next.push(slug);
  return next;
}

// The write that sets one list with merge:true, keeping a plain-array entry's
// build list when a deploy list is added next to it.
function bindingWrite(current, { phase, projectId = null, area = null }, next) {
  if (!projectId && !area) return { [phase]: next };
  const mapName = projectId ? "byProject" : "byArea";
  const key = projectId || area;
  const existing = ((current || {})[mapName] || {})[key];
  const entry = Array.isArray(existing) ? { build: existing } : { ...(existing && typeof existing === "object" ? existing : {}) };
  entry[phase] = next;
  return { [mapName]: { [key]: entry } };
}

module.exports = { PHASES, UI_SKILL, MAX_PER_LIST, SLUG_RE, listFor, skillsFor, skillsBlock, nextBindingList, bindingWrite };
