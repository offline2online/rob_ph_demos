// The type every Concept Incubator concept and every project carries
// (ticket ufOwuueuj1f5vmeN0xi2): exactly one of two values, never both.
//   Platform            the Personalisation Hub product itself
//   Internal operations how Personalisation Hub runs internally (support,
//                       RevOps, Staff Kanban, the backlog tracker ...)
// Kept in step with firestore.rules' entityTypeOk and
// functions/mcp-server.js' ENTITY_TYPES. Items saved before the field
// existed have no type (`typeOf` returns "") and show an "Unassigned" badge.
// Pure functions, no DOM and no Firestore, so the unit test can drive them.

export const TYPE_PLATFORM = "Platform";
export const TYPE_INTERNAL = "Internal operations";
export const ENTITY_TYPES = [TYPE_PLATFORM, TYPE_INTERNAL];

export function typeOf(entity) {
  const t = entity && entity.type;
  return ENTITY_TYPES.includes(t) ? t : "";
}

// Does `entity` belong on the map / list for `view`? An unset item belongs to
// both, so Rob can find and sort it.
export function inTypeView(entity, view) {
  const t = typeOf(entity);
  return !t || t === view;
}

// "all" (or empty) keeps everything; "unassigned" keeps only unset items.
export function matchesTypeFilter(entity, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "unassigned") return !typeOf(entity);
  return typeOf(entity) === filter;
}

export function typeBadgeHTML(entity, escapeHTML) {
  const t = typeOf(entity);
  const cls = t === TYPE_PLATFORM ? "platform" : t === TYPE_INTERNAL ? "internal" : "unassigned";
  return `<span class="type-badge type-${cls}">${escapeHTML(t || "Unassigned")}</span>`;
}

// <option>s for a Type select. `withEmpty` adds the "Choose a type" prompt
// used by the create forms; a filter passes `filter: true` for All/Unassigned.
export function typeOptionsHTML(selected, { withEmpty = false, filter = false } = {}) {
  const opts = [];
  if (filter) opts.push(`<option value="all"${!selected || selected === "all" ? " selected" : ""}>All types</option>`);
  else if (withEmpty) opts.push(`<option value=""${!selected ? " selected" : ""}>Choose a type…</option>`);
  ENTITY_TYPES.forEach((t) => opts.push(`<option value="${t}"${selected === t ? " selected" : ""}>${t}</option>`));
  if (filter) opts.push(`<option value="unassigned"${selected === "unassigned" ? " selected" : ""}>Unassigned</option>`);
  return opts.join("");
}
