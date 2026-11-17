---
name: ph-ticket-intake
description: Definition of ready for PH Agent Console backlog tickets. Load whenever a ticket is created, groomed or about to be sent to build, whether filed via MCP (create_backlog_item) or by hand on the board. Triggers: "add to backlog", "file a ticket", "create a ticket", "groom the backlog", "mark ready for dev", "is this ticket ready".
---

# Personalisation Hub Ticket Intake: Definition of Ready

Why this exists (Rob, Oct 2026): tickets were pushed into the build train under-specified, so only some crossed to Ready for Testing while the rest silently fell back to Backlog. A ticket must carry enough to be built end to end. This skill defines that bar and is applied at point of entry, not at the train.

## Is it a backlog ticket at all?

- **The backlog is for agent work**: agent-built product, docs, prototype and tooling changes.
- **A task a person does** (a call, a decision, a contract, a manual check) belongs on the Staff Kanban: `kanban_create_task`, which can assign it.
- An early idea that is not yet buildable belongs in the Concept Incubator (`create_concept`), not the backlog.

## The four sections

Every ticket description is structured into these, in this order:

1. **## Outcome**: what "done" looks like, stated so it is testable. Not "make it green": a concrete, checkable result. Name the file, screen, endpoint or document it changes when you know it.
2. **## Test steps**: numbered steps QA can follow: the screens, endpoints or commands to exercise and what to expect at each. The review runs these one by one, so each step must be checkable on its own.
3. **## Dependencies**: other tickets, migrations or specs that must exist first. Name tickets by id or exact title so the board links them (`dependsOnItemIds`). Write "None" if genuinely none.
4. **## Spec reference**: the REQUIREMENTS.md section, boundary document or project document this builds against. Write "None" if genuinely none.

One ticket, one outcome. If the Outcome needs "and" to join two unrelated results, file two tickets and link them. Keep the description under 10,000 characters; put long material in a project document and reference it.

## Automation rules: nothing manual

Take whatever the creator (person or MCP caller) supplies and structure it into the four sections. Do not present a form or ask the creator to pick fields.

- **Title**: derived from the Outcome when not supplied.
- **Type** (feature or bug): defect-fix language means bug; new behaviour means feature.
- **Area** (category): inferred from the description. One of Pricing & Offers, Product Assets, HQ Admin, Retail Admin, PH Website, Backend / Infrastructure. Never left Uncategorised when the text makes the area clear. A ticket that changes rendered UI must have a UI area or say so in its Outcome, because that is what pulls `ph-designer` into the build.
- **Model**: leave on `auto` so the board suggests standard or advanced and records why. Set `advanced` only when the work clearly needs it (cross-cutting design, security, a subtle data migration); a model a person sets is never overridden.
- **Owner**: leave unowned unless the creator asks for an agent ticket of their own (`ownedByMe`), which then only fires under their own Routine.

## The gate

- **Outcome present and substantive**: the ticket is ready. Missing Test steps, Dependencies or Spec reference are left as placeholders, and the build session fills them in from the code and the spec before it builds. Fill them at intake whenever the source material lets you; a ticket with real Test steps passes review far more often.
- **Outcome missing or too thin to build from**: do not send it to build. Flag it BLOCKED with `set_blocked` (`needs-decision` if a scope or outcome call is missing, `waiting-on-input` if a file or dependency is missing) and a one-line note naming the gap. It stays in Backlog, visibly held, never silently pushed.
- **Never invent an Outcome** the source material does not contain. A missing buildable outcome is the one case a person is pulled in.
- Tickets always start in Backlog. Sending them to build (Ready for Dev) is a person's click, or an admin's `send_to_build` for named tickets.

## Grooming an existing ticket

- Restructure into the four sections without changing what was asked. Keep the creator's wording inside the Outcome.
- Correct type and area to what the ticket is really about.
- Do not change another member's agent ticket; comment on it instead.
- Check for a duplicate before filing: search open tickets for the same outcome and link or comment rather than filing twice.

## Pairs with

- **ph-build-agent** consumes ready tickets. The DECIDED, PARKED and BLOCKED signals are shared between the two.
- **ph-reviewer** acceptance-tests each built ticket against the Outcome and Test steps written here.
