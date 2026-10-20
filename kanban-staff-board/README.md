# Kanban — Staff Task Board (Jira replacement)

Clickable prototype for the PH Agent Console concept **"Kanban — Staff Task
Board (Jira replacement)"** (Concept Incubator, `conceptId
vmhUoPiogxiJq1YmtJph`). This is a concept, not yet a board project, so there
is no `REQUIREMENTS.md` here. The concept's README and Requirements on the
board are the spec.

Live: <https://offline2online.github.io/rob_ph_demos/kanban-staff-board/prototype/>

When you change any CSS or JS file, bump the `?v=` on its link in `index.html`. GitHub Pages lets browsers
cache those files for 10 minutes.

It is front-end only, with mock data and no backend. Changes are kept in the
viewer's own `localStorage`, and **Kanban settings (cog) → Reset demo data** puts the mock data back.

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
  Progress or Ready for Dev returns it to the developer. Search sits in the page header, beside the task count. The filter row
  stays on one line from 1240px wide with the sidebar open; below that it wraps. The filters cover My
  tasks, assignee avatars (first names), release, type, priority, sprint,
  label and search. Selecting people in the assignee filter splits the board into one
  swimlane per person. Each lane has a full-width header with the person's name, and can be
  collapsed on its own or with Expand all / Collapse all. On this page the console topbar
  scrolls away. Only the column headers stick to the top, and the header of the lane you're
  scrolling through is pinned beneath them. Dragging a card into another
  person's lane reassigns it to them.
- **New task: voice first**. One **Record task** button uses the browser's speech
  recognition. When you stop, an "agent" writes the title and description, and it fills in priority,
  type, assignee, release, estimate, due date, sprint and labels when they're mentioned. Those
  fields are marked "Agent" for checking. Typed text gets the same treatment from **Fill in
  the ticket from this description**. The agent is a local stand-in (`agentDraft()` in
  `kanban.js`); the real console would send the transcript to Claude. A new task has no
  Status field, because it always starts in Backlog, and no Comments field.
  The side panel runs priority, type, assignee, reporter, release, estimate, then time logged.
  When you edit a task, the description has a mic for dictation, and Status sits at the end of
  the side panel.
- **Flags**. Each card has a flag button (shown on hover, always shown once a card is flagged).
  Flagged cards turn amber. There's a **Flagged** filter with a count, a Flag toggle in the
  modal header, and flags also show in the release report.
- **Types: Task, Bug, Epic**. Story has been removed. An epic is an ordinary ticket. Once
  saved, it can be picked as the **Parent epic** of any task or bug. The child shows the epic
  name under its title. The epic's card shows "n/m done" with a progress bar, and its modal
  lists the child tickets. Epics are left out of the release report's effort figures.
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
