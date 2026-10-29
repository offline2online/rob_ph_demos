// Staff Kanban seed for the console harness: the signed-off prototype's mock
// team, releases and 39 tickets (fixtures/kanban-seed.json, generated from
// kanban-staff-board/prototype/js/data.js) as the Firestore documents the
// console reads. kanbanSeed({ user }) returns a harness seed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cardOf, searchTokens } from "../../public/js/kanban/kanban-core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const KB = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "kanban-seed.json"), "utf8"));
export const ROB = "rob@offline2online.com";
export const emailOf = (first) => KB.users.find((u) => u.first === first).email;
// A small JPEG for Rob, as his uploaded profile photo.
const ROB_PHOTO = "data:image/jpeg;base64," + fs.readFileSync(path.join(here, "..", "..", "..", "kanban-staff-board", "prototype", "img", "rob.jpg")).toString("base64");

// The board's card for a ticket, as the page and the server write it (kanbanCards).
export const cardOfTask = (t) => ({ ...cardOf(t), ...(t.closedAt ? { closedAt: t.closedAt } : {}), updatedBy: t.updatedBy || "seed" });

export function kanbanSeed({ user = { email: ROB, role: "admin" }, extra = {}, photos = true } = {}) {
  const md = JSON.parse(JSON.stringify(KB.memberDirectory));
  if (photos) md[ROB].photoUrl = ROB_PHOTO;
  const docs = {
    memberDirectory: md,
    consoleUsers: Object.fromEntries(Object.keys(md).map((e) => [e, { email: e, role: e === ROB ? "admin" : "editor", displayName: md[e].displayName, ...(md[e].photoUrl ? { photoUrl: md[e].photoUrl } : {}) }])),
    releases: KB.releases,
    // (a stored ticket carries the search tokens the server's text search reads)
    kanbanTasks: Object.fromEntries(Object.entries(KB.kanbanTasks).map(([k, t]) => [k, { searchTokens: searchTokens({ key: k, title: t.title, labels: t.labels, descriptionText: t.descriptionText }), ...t }])),
    kanbanCards: Object.fromEntries(Object.entries(KB.kanbanTasks).map(([k, t]) => [k, cardOfTask(t)])),
    kanbanSprints: KB.sprints,
    kanbanSettings: { main: KB.settings },
    kanbanCounters: { main: { nextNumber: KB.nextNumber } },
    projects: {},
  };
  for (const [key, cs] of Object.entries(KB.comments)) docs[`kanbanTasks/${key}/comments`] = cs;
  for (const [k, v] of Object.entries(extra)) docs[k] = { ...(docs[k] || {}), ...v };
  // A copy: a case that edits its seed (TC-16b) must not change the next case's.
  return JSON.parse(JSON.stringify({ user, docs }));
}
