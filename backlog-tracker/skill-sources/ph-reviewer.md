---
name: ph-reviewer
description: >
  Post-build code-review gate for Personalisation Hub POC builds. Use this skill whenever a built
  batch of tickets needs review before it advances -- triggered by the Review Batch button on the
  board. It reviews backend and integration work for human-reviewability, auto-remediates safe
  behaviour-preserving structural issues, kicks the rest back with findings, and writes a visible
  review-status flag with a hover reason onto each ticket. Trigger on: "review batch",
  "code review", "review the built tickets", "post-build review", "reviewability check",
  "Review Batch".
---

# Personalisation Hub -- Code Reviewer Skill

This skill is the post-build code-review gate for Personalisation Hub POC builds. POC builds are
written in Claude Code as a folder inside `rob_ph_demos`, then handed to the engineering team to
integrate into the primary repo. The whole point of the review is to make that hand-off cheap:
code that a human engineer can hold in their head, understand, and plug in without archaeology.

It is the counterpart of `ph-designer`. Where that skill says *build only what is specified, add
nothing extra*, this one says the mirror: **remediate only safe, behaviour-preserving structural
issues; never change behaviour to make code look reviewable.** Both skills exist to keep the
agent's hands off things it should not touch.

This skill is owned by Engineering.

## How to use this skill

1. **It fires on the Review Batch button.** When a human presses Review Batch on a project, sweep
   every ticket in that project that is built but not yet reviewed. That set -- all of it, taken
   together -- is the batch. The board tracks tickets, not batches, so the button press is what
   defines the batch boundary; do not try to infer it any other way.
2. **Review the batch as a set, not one ticket at a time.** A cross-cutting review is the whole
   reason this runs per batch: seams that cross module boundaries, duplicated logic across
   tickets, and naming that drifts between tickets only show up when the batch is read together.
3. **Apply the reviewability criteria** in section 1 to each ticket.
4. **Split every finding** into safe-to-fix or must-kick-back per section 2.
5. **Auto-remediate the safe findings, then re-run the full regression suite.** Only advance a
   ticket on green. A red run blocks -- see section 2. Kick back the rest with findings.
6. **Write the review-status flag and its hover reason** onto every reviewed ticket per section 3.
   The full review log goes in the ticket comments.

---

## 1. What "human-reviewable" means

A ticket passes the reviewability bar when all of the following hold:

- **Clear module boundaries.** Each piece is small enough to hold in a reviewer's head, with one
  reason to exist. A reviewer should be able to read one module without opening five others.
- **Domain-language naming.** Types, functions and variables are named in the language of the
  domain (auction, reservation, enforcement, hand-off, billing) -- not in incidental or
  implementation terms.
- **Single-responsibility functions.** A function does one thing. A function that auctions,
  books, and bills is three functions wearing one name.
- **Comments explain why, not what.** The code says what it does; comments are reserved for the
  reasoning a reader cannot recover from the code -- why a seam is kept, why a rate is locked,
  why an edge case exists.
- **Plugs in cleanly.** The build reaches into PH Core only through the agreed seams (one
  interface per dependency, wired in a single place). Nothing reaches across a boundary directly.
  This is the check that most directly protects the engineering hand-off.

- **Docs match the code.** The project's spec and documents (REQUIREMENTS, README, additional
  project documents, interface contracts) describe what the ticket now does, and the ticket
  carries a `[docs-impact]` note (`Updated: ...` or `No doc impact: <reason>`). A mismatch, or a
  missing note, fails the ticket. Kick it back with the document and lines that disagree; the
  review never rewrites the docs itself.

UI and admin tickets are already covered by `ph-designer`; this skill earns its keep on the
backend and integration tickets, where structure -- not appearance -- is what a human reviewer
has to trust.

---

## 2. The remediation split -- fix-and-advance, never behaviour-change

The review is a fix-and-advance loop, not a pass/fail stamp. There is nothing more frustrating
than a ticket that sits in backlog with no sign of what happened to it, so wherever it is safe,
the review fixes the issue and advances the ticket rather than kicking it back.

**Auto-remediate (safe, behaviour-preserving only):**

- naming that is not in domain language,
- functions carrying more than one responsibility (split them),
- comments that explain what instead of why.

These are structural, cosmetic changes that do not alter behaviour. Fix them, re-run the full
regression suite, and advance on green.

**Kick back (never silently fixed):**

- a docs mismatch or a missing `[docs-impact]` note (reason starts `docs:`),
- anything that needs a behaviour change,
- anything that needs a judgement call,
- a seam that crosses into PH Core directly rather than through an interface.

These go back to the ticket with clear findings and a status that says why. **Never change
behaviour to make code look reviewable.** An automated fix that makes bad code merely *look*
clean can mask a real problem and march it toward testing -- which is worse than a ticket that
honestly sits and waits.

**Block on red.** A red run on either the E2E regression or the full API suite blocks: the
change does not advance and does not join the deployment train. One backlog bug is raised per
distinct failing case, each fixed as its own ticket, the full regression re-run, and the change
advances only once green on its own diff. Red is a stop signal, not a patch-and-bundle signal.

This step runs **after build and before the ready-for-deployment gate**, on purpose: remediation
and re-testing happen here, so the deployment gate stays a clean yes/no with nothing reopening
behind it.

---

## 3. The review-status flag

Every reviewed ticket carries a **visible review-status flag** on the item itself. Hovering the
flag shows a **one-line reason** -- for a kicked-back ticket, the single most important reason
(e.g. *rejected: a seam crosses into PH Core directly*), so the status can be read without
opening 16,000 lines of comments. The full review log lives in the ticket comments.

Pipeline status, approval and deployment fields are **not writable through the console tools**,
so the flag is a **board-rendered convention**, not a new status column. Write it where the tools
allow -- structured into the ticket's comment thread -- and let the board surface it.

---

## 4. Do / Don't

**Do**

- Review the whole batch together; look for issues that only appear across tickets.
- Remediate only safe, behaviour-preserving structural issues.
- Re-run the full regression suite after any remediation, and advance only on green.
- Kick back anything needing a behaviour change or a judgement call, with a clear one-line reason.
- Check every PH Core dependency goes through its agreed seam.
- Put a readable status flag on every ticket and the full log in its comments.

**Don't**

- Don't change behaviour to make code look reviewable.
- Don't silently fix a judgement call -- kick it back.
- Don't advance a ticket on a red regression run.
- Don't pull red-run fixes onto the same deployment train -- red stops the train.
- Don't fold this review into the ready-for-deployment gate -- it runs as its own step before it.
- Don't try to infer the batch boundary from anything but the Review Batch button press.
- Don't invent a new pipeline status column -- the flag is a board convention.

---

*Owned by Engineering. First used on the Display Types & DSP Integration project, September 2026.
Counterpart to ph-designer: that skill governs what gets built; this one governs how built code
is reviewed before hand-off to engineering.*

