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
| `js/editor.js` | Rich-text editor for descriptions and comments: the FAQ article editor's Quill 1.3.7 toolbar (headings, formatting, alignment, lists, quote, code, callouts, link, image, video, tables) plus @mentions, screenshots (upload, paste or drop), screen recording and URLs that link themselves |
| `js/vendor/` | Quill 1.3.7 and DOMPurify (the console's own vendored build), bundled so the page doesn't depend on a CDN |
| `js/kanban.js` | Routing (`#kanban`, `#agent-board`, `#report`, `#settings`), drag and drop, modal, report, settings |
| `img/` | Console logo and favicon |

## Screens

- **Staff Kanban** (`#kanban`). Columns: Backlog → Ready for Dev → In Progress →
  Ready for Testing → Approved for Deployment → Completed / Withdrawn. The last column has two drop zones, **Completed** and
  **Withdrawn**, each with its own count; the column header shows both, the Status menu lists them separately,
  withdrawn cards are greyed and struck through, and epics' progress leaves withdrawn children out. The release
  report splits them too (filter, KPI and breakdown columns). While a card is being dragged, that column's cards hide and two large drop targets
  fill the screen height over it: Completed (three quarters) and Withdrawn (one quarter). On a phone they sit at the
  bottom of the screen. You can drag cards
  with a mouse, or press and hold them on touch. Moving a card to Ready for
  Testing reassigns it to the tester (Rob by default). Moving it back to In
  Progress or Ready for Dev returns it to the developer. Search sits in the page header, beside the task count. The primary filters, staff avatars,
  **My tasks** and **Release**, sit in a bar pinned to the top while you scroll, with the column headers under it. Flagged,
  type, priority, sprint and label are in the **Filters** menu, whose button shows how many are on. The bar stays on
  one line from 1024px wide. Changing a filter keeps your place on the page. **On a phone** the columns are a
  sideways carousel: swipe left or right, or tap a column tab in the pinned strip. With swimlanes, every
  person's lane shows the column you're on, and swiping changes it for all of them. Selecting people in the assignee filter splits the board into one
  swimlane per person. Each lane has a full-width header with the person's name, and can be
  collapsed on its own or with Expand all / Collapse all. The board scrolls as one page: columns have no
  inner scrollbars. On this page the console topbar scrolls away. Only the column headers stick to the top,
  with or without swimlanes, and the header of the lane you're
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
  When you edit a task, the description and the comment box each have a round mic for dictation
  (it turns into a red stop button while listening), and Status sits at the end of
  the side panel.
- **Flags**. Each card has a flag button (shown on hover, always shown once a card is flagged).
  Flagged cards turn amber. There's a **Flagged** filter with a count, a Flag toggle in the
  modal header, and flags also show in the release report.
- **Types: Task, Bug, Epic**. Story has been removed. An epic is an ordinary ticket. Once
  saved, it can be picked as the **Parent epic** of any task or bug. The child shows the epic
  name under its title. The epic's card shows "n/m done" with a progress bar, and its modal
  lists the child tickets, with **Add task** / **Add bug** buttons and an "Add an existing ticket…" picker.
  Adding a child saves the epic first, creating it if it's new. The child opens with the epic,
  release, sprint and labels already filled in, and the epic reopens when the child is created
  or cancelled. The × on a child row removes it from the epic. Epics are left out of the release report's effort figures.
- **Rich descriptions and comments**. The description uses the same editor as Help Centre articles. The
  comment box uses a compact version. Type `@` to mention someone, and they're notified when you save or comment. Paste,
  drop or upload screenshots; they're downscaled and stored with the ticket. The record button captures your screen as a
  playable video (prototype only: a recording lasts for the browser session, and the real console would upload it to Storage).
- **Task modal layout**. The panel button in the window header (or the "Details" tab) folds the details column away to
  the right, so the description gets the full width. The choice is remembered, and it reopens by itself if a
  required field in it is empty.
- **Finding tickets**. "Add an existing ticket" on an epic and "Linked tickets" use a search box, not a dropdown. Type a
  number (`36`, `PH-36`) or any words from the title or description. Description matches show a highlighted snippet.
  Only the best 50 results are listed, so it stays quick however many tickets there are. Use the arrow keys and Enter, or click.
- **Tooltips**. (i) tips open in one floating bubble that's always kept inside the window, so they're never cut off
  by the modal or the screen edge. Tap to open them on touch screens.
- **Profile photos**. Profile menu → Profile photo → Upload photo. The photo is cropped to a square and stored with
  the prototype's data. It replaces the initial everywhere that person appears: the profile button, filter avatars, cards,
  swimlane headers, comments, @mention suggestions and the release report. An admin can set anyone's photo from
  Kanban settings → Team. The console itself is ticket cQZRViGdvsqJrnNk00GF on the Backlog Tracker & FAQs board.
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
