---
name: status
description: A short status report from the PH Agent Console - what is waiting on a person, what is blocked, and where each project's release stands. Optionally for one project.
argument-hint: "[project name]"
---

# Console status

Give the person a short, spoken-style status of the PH Agent Console.
If they named a project in `$ARGUMENTS`, report on that project only.

1. If the server offers `get_insight`, call it: `pipeline_status` for the
   whole board, or `project_status` with the project's name. Otherwise call
   `list_projects` (to find the project's id, if one was named) and then
   `get_pipeline_health`.
2. Report, in this order and in plain sentences:
   - what is waiting on a person, oldest first, and who it is waiting on
   - what is blocked, and why
   - how many tickets are in each stage
   - where each release train stands, in one line each
3. Keep it to what a person could take in at a glance: at most five items
   per group, and say how many more there are.

Do not change anything. This is a read-only report.
