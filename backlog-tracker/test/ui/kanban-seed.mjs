// Staff Kanban seed for the console harness: the signed-off prototype's mock
// team, releases and 39 tickets (fixtures/kanban-seed.json, generated from
// kanban-staff-board/prototype/js/data.js) as the Firestore documents the
// console reads. kanbanSeed({ user }) returns a harness seed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const KB = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "kanban-seed.json"), "utf8"));
export const ROB = "rob@offline2online.com";
export const emailOf = (first) => KB.users.find((u) => u.first === first).email;
// A small JPEG for Rob, as his uploaded profile photo.
const ROB_PHOTO = "data:image/jpeg;base64," + fs.readFileSync(path.join(here, "..", "..", "..", "kanban-staff-board", "prototype", "img", "rob.jpg")).toString("base64");

export function kanbanSeed({ user = { email: ROB, role: "admin" }, extra = {}, photos = true } = {}) {
  const md = JSON.parse(JSON.stringify(KB.memberDirectory));
  if (photos) md[ROB].photoUrl = ROB_PHOTO;
  const docs = {
    memberDirectory: md,
    consoleUsers: Object.fromEntries(Object.keys(md).map((e) => [e, { email: e, role: e === ROB ? "admin" : "editor", displayName: md[e].displayName, ...(md[e].photoUrl ? { photoUrl: md[e].photoUrl } : {}) }])),
    releases: KB.releases,
    kanbanTasks: KB.kanbanTasks,
    kanbanSprints: KB.sprints,
    kanbanSettings: { main: KB.settings },
    kanbanCounters: { main: { nextNumber: KB.nextNumber } },
    projects: {},
  };
  for (const [key, cs] of Object.entries(KB.comments)) docs[`kanbanTasks/${key}/comments`] = cs;
  for (const [k, v] of Object.entries(extra)) docs[k] = { ...(docs[k] || {}), ...v };
  return { user, docs };
}
