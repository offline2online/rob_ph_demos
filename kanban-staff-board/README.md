# Kanban — Staff Task Board (Jira replacement)

Clickable prototype for the PH Agent Console concept **"Kanban — Staff Task
Board (Jira replacement)"** (Concept Incubator, `conceptId
vmhUoPiogxiJq1YmtJph`). This is a concept, not yet a board project, so there
is no `REQUIREMENTS.md` here. The concept's README and Requirements on the
board are the spec.

Live: <https://offline2online.github.io/rob_ph_demos/kanban-staff-board/prototype/>

It is front-end only, with mock data and no backend. Changes are kept in the
viewer's own `localStorage`, and **⋮ → Reset demo data** puts the mock data back.

## What's in `prototype/`

| File | What it does |
|---|---|
| `index.html` | Console shell (topbar, Build / Publish sidebar, profile menu, phone tab bar) and the task modal |
| `css/console.css`, `css/console-apple.css` | Verbatim copies of `backlog-tracker/public/css/styles.css` and `apple.css` (20 Oct 2026), so it looks like the console |
| `css/kanban.css` | Only what this prototype adds: six-column board, cards, task modal, settings, release report |
| `js/data.js` | Mock team (Rob plus five Vietnam-based engineers), releases PH 4.11–4.13, sprints, epics, 33 tasks |
| `js/kanban.js` | Routing (`#kanban`, `#agent-board`, `#report`, `#settings`), drag and drop, modal, report, settings |
| `img/` | Console logo and favicon |

## Screens

- **Kanban** (`#kanban`). Columns: Backlog → Ready for Dev → In Progress →
  Ready for Testing → Approved / Ready for Deployment → Done. You can drag cards
  with a mouse, or press and hold them on touch. Moving a card to Ready for
  Testing reassigns it to the tester (Rob by default). Moving it back to In
  Progress or Ready for Dev returns it to the developer. The filters cover My
  tasks, assignee avatars (first names), release, type, priority, sprint,
  label and search. Select two or more people and the board splits into one
  swimlane per person, each of which can be collapsed. Dragging a card into another
  person's lane reassigns it to them.
- **Task modal**. Core fields are always shown. Optional fields follow Kanban
  settings. On an existing ticket, hidden fields stay editable under
  "N more fields". Required fields are validated.
- **Release report** (`#report`). It defaults to the current release, and
  every filter is kept in the URL, so a view can be shared. It shows
  outstanding tasks, remaining effort (estimate minus logged), remaining
  effort per staff member against capacity (6 focused hours a working day),
  a breakdown by staff member with totals, and the task list grouped by
  person.
- **Kanban settings** (`#settings`). Show and required toggles for each field,
  the Ready for Testing reassignment target, the current release and the team list.
- **Agent Board** (`#agent-board`). A static copy of the existing board, so
  the two are visibly separate in the navigation.

Helper text is in (i) tooltips, never shown under charts or tables.
