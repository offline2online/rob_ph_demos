// Shared files between trains, owned paths and the deploy queue, as the board
// shows them (wPoSOXfp8Em06Vzp3Cz7). The automation writes the data
// (scripts/run-backlog-automation.js → trainOverlapFor, deployQueueGate;
// functions/deploy-queue.js holds the rules); this module only renders it, so
// test/train-overlap-view.test.mjs can check every string without a browser.
//
//   backlogItems.sharedWith  [{projectId, projectName, paths, conflictPaths, conflict}]
//   backlogItems.foreignPaths [{projectId, projectName, paths}]
//   projects.trainHold "queued" + trainNote "Queued behind <project>'s deploy; …"

function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SHOWN_IN = new Set(["ready-for-testing", "ready-to-publish"]);

function list(v) { return Array.isArray(v) ? v.filter((e) => e && typeof e === "object") : []; }
function pathsOf(v) { return Array.isArray(v) ? v.filter((p) => typeof p === "string" && p) : []; }

// "Also changed on <project>'s train" (call_split; hover lists the files), or
// in the warning colour "Conflicts with <project>'s train: <files>" when the
// two train tips do not merge cleanly. Ready for Testing and Approved only.
export function sharedWithChipsHTML(item) {
  if (!item || !SHOWN_IN.has(item.status)) return "";
  return list(item.sharedWith).map((e) => {
    const name = e.projectName || e.projectId || "another project";
    const paths = pathsOf(e.paths);
    const conflictPaths = pathsOf(e.conflictPaths);
    if (!paths.length) return "";
    if (e.conflict && conflictPaths.length) {
      const title = `${name}'s train changes the same files and the two branches do not merge cleanly. Fix it before either train is approved.\n\n${conflictPaths.join("\n")}`;
      return `<span class="train-overlap-chip train-overlap-chip-warn" title="${escapeHTML(title)}"><span class="material-symbols-outlined" aria-hidden="true">call_split</span>Conflicts with ${escapeHTML(name)}'s train: ${escapeHTML(conflictPaths.join(", "))}</span>`;
    }
    const title = `Also changed on ${name}'s train — whichever train merges second takes the other's change when it merges main:\n\n${paths.join("\n")}`;
    return `<span class="train-overlap-chip" title="${escapeHTML(title)}"><span class="material-symbols-outlined" aria-hidden="true">call_split</span>Also changed on ${escapeHTML(name)}'s train</span>`;
  }).join("");
}

// "Changes <project>'s files: <paths>" — a warning, never a refusal.
export function foreignPathsChipsHTML(item) {
  if (!item || !SHOWN_IN.has(item.status)) return "";
  return list(item.foreignPaths).map((e) => {
    const name = e.projectName || e.projectId || "another project";
    const paths = pathsOf(e.paths);
    if (!paths.length) return "";
    const shown = paths.length > 2 ? `${paths.slice(0, 2).join(", ")} +${paths.length - 2}` : paths.join(", ");
    const title = `This ticket changes files ${name} owns, so ${name}'s train will need main merged in after it ships:\n\n${paths.join("\n")}`;
    return `<span class="train-overlap-chip train-overlap-chip-owned" title="${escapeHTML(title)}"><span class="material-symbols-outlined" aria-hidden="true">folder_shared</span>Changes ${escapeHTML(name)}'s files: ${escapeHTML(shown)}</span>`;
  }).join("");
}

// The project header line, shown while any of its train's cards shares files
// with another project's train: "Shares files with <project>'s train".
export function sharedFilesHeaderHTML(projectItems) {
  const byProject = new Map();
  let conflict = false;
  for (const item of projectItems || []) {
    if (!item || !SHOWN_IN.has(item.status)) continue;
    for (const e of list(item.sharedWith)) {
      if (!pathsOf(e.paths).length) continue;
      const name = e.projectName || e.projectId;
      if (!byProject.has(name)) byProject.set(name, new Set());
      pathsOf(e.paths).forEach((p) => byProject.get(name).add(p));
      if (e.conflict && pathsOf(e.conflictPaths).length) conflict = true;
    }
  }
  if (!byProject.size) return "";
  const names = [...byProject.keys()];
  const label = `Shares files with ${names.map((n) => `${n}'s train`).join(" and ")}`;
  const title = names.map((n) => `${n}: ${[...byProject.get(n)].sort().join(", ")}`).join("\n");
  return `<div class="train-shared-hint${conflict ? " train-shared-hint-warn" : ""}" title="${escapeHTML(title)}"><span class="material-symbols-outlined train-locked-icon" aria-hidden="true">call_split</span><span>${escapeHTML(label)}</span></div>`;
}

// A deploy held in the queue: the line under the project header, carrying
// the automation's own note ("Queued behind <project>'s deploy; starts by
// itself when that merges").
export function deployQueuedHintHTML(project) {
  if (!project || project.trainHold !== "queued") return "";
  const note = (typeof project.trainNote === "string" && project.trainNote.trim()) || "Queued behind another project's deploy; starts by itself when that merges.";
  return `<div class="train-queued-hint"><span class="material-symbols-outlined train-locked-icon" aria-hidden="true">schedule</span><span>${escapeHTML(note)}</span></div>`;
}

// Owned paths, as typed on the Docs page: one repo-relative prefix per line.
// Returns { paths } or { error }. An empty box means "use the default".
export function parseOwnedPaths(text) {
  const paths = [];
  for (const raw of String(text || "").split(/[\n,]/)) {
    const p = raw.trim();
    if (!p) continue;
    if (p.startsWith("/") || p.split("/").includes("..") || /\s/.test(p) || p.length > 200) {
      return { error: `"${p}" is not a repo-relative path (no leading "/", no "..", no spaces).` };
    }
    if (!paths.includes(p)) paths.push(p);
  }
  if (paths.length > 30) return { error: "At most 30 owned paths." };
  return { paths };
}
