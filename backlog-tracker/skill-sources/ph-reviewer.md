---
name: ph-reviewer
description: >
  Post-build code-review gate for Personalisation Hub builds, fired by the Review Batch button on
  the board. Reviews a project's built-but-unreviewed tickets as one batch for human-reviewability,
  checks that docs match the code, acceptance-tests each ticket against its own Outcome and Test
  steps, auto-remediates only safe behaviour-preserving structural issues, kicks the rest back with
  findings, and writes a review-status flag with a one-line hover reason onto each ticket. Trigger
  on: "review batch", "Review Batch", "code review", "review the built tickets", "post-build
  review", "reviewability check".
---

# Personalisation Hub Code Reviewer

The post-build review gate. Builds are written by agents as a folder inside `rob_ph_demos`, then
handed to the engineering team to integrate into the primary repo. The review exists to make that
hand-off cheap: code a human engineer can hold in their head, understand, and plug in without
archaeology.

It is the counterpart of `ph-designer`. That skill says build only what is specified. This one says
the mirror: **remediate only safe, behaviour-preserving structural issues; never change behaviour
to make code look reviewable.**

Owned by Engineering. The step-by-step mechanics (which fields to write, how a kick-back re-enters
the pipeline) live in `backlog-tracker/ROUTINE_INSTRUCTIONS.md`, "Review Batch flow". This skill
holds the judgement; where the two disagree on a field name, the Routine instructions win.

## How to use this skill

1. **It fires on the Review Batch button.** Sweep every ticket in that project that is built but
   not yet reviewed. That set, taken together, is the batch. The button press defines the batch
   boundary; do not infer it any other way.
2. **State the model first** (section 5).
3. **Review the batch as a set, not ticket by ticket.** Seams that cross module boundaries, logic
   duplicated across tickets and naming that drifts between tickets only show when the batch is
   read together.
4. **Apply the checks** in section 1 to each ticket.
5. **Run the project's full regression suite**, then **acceptance-test each ticket** against its
   own Outcome and Test steps (section 2).
6. **Split every finding** into safe-to-fix or kick-back (section 3).
7. **Write the review flag and its one-line reason** on every reviewed ticket, and the full review
   log in its notes (section 4).

## 1. What a ticket must pass

**Human-reviewable**

- **Clear module boundaries.** Each piece is small enough to hold in a reviewer's head, with one
  reason to exist. A reviewer can read one module without opening five others.
- **Domain-language naming.** Types, functions and variables are named in the language of the
  domain (auction, reservation, enforcement, hand-off, billing), not in incidental or
  implementation terms.
- **Single-responsibility functions.** A function that auctions, books and bills is three functions
  wearing one name.
- **Comments explain why, not what.** Comments are for the reasoning a reader cannot recover from
  the code: why a seam is kept, why a rate is locked, why an edge case exists.
- **Plugs in cleanly.** The build reaches into PH Core only through the agreed seams (one interface
  per dependency, wired in a single place). Nothing reaches across a boundary directly. This is the
  check that most directly protects the engineering hand-off.

**Docs match the code**

- The project's spec and documents (REQUIREMENTS, README, additional project documents, interface
  contracts) describe what the ticket now does, and the ticket carries a `[docs-impact]` note
  (`Updated: ...` or `No doc impact: <reason>`).
- A `No doc impact` note passes only if the diff really changes no documented behaviour.
- A mismatch or a missing note fails the ticket. Name the document and the lines that disagree. The
  review never rewrites the docs itself.

UI and admin tickets are also covered by `ph-designer`. This skill earns its keep on backend and
integration tickets, where structure, not appearance, is what a human reviewer has to trust.

## 2. Tests: regression, then each ticket's own steps

- **Regression.** Run the full suite the project has against the branch head. A red run blocks:
  the change does not advance and does not join the deployment train. Raise one Backlog bug per
  distinct failing case, each fixed as its own ticket. Red is a stop signal, not a
  patch-and-bundle signal.
- **Acceptance.** Exercise every numbered Test step on the ticket and check its Outcome, as far as
  the environment allows. Record pass or fail per step in the review log. A ticket that is green on
  regression but fails one of its own steps is kicked back with that step as the finding.
- **A step you could not exercise is "not verified", never "passed".**

## 3. The remediation split: fix and advance, never change behaviour

The review is a fix-and-advance loop, not a pass/fail stamp. Nothing is more frustrating than a
ticket that sits with no sign of what happened to it, so wherever it is safe, the review fixes the
issue and advances the ticket.

**Auto-remediate (safe, behaviour-preserving only):**

- naming that is not in domain language,
- functions carrying more than one responsibility (split them),
- comments that explain what instead of why.

Fix them, re-run the full regression suite, and advance only on green. If you could not run the
suite green against the patched tree, list the fix as pending instead of packaging it.

**Kick back (never silently fixed):**

- a docs mismatch or a missing `[docs-impact]` note (reason starts `docs:`),
- a failed Test step or unmet Outcome,
- anything that needs a behaviour change,
- anything that needs a judgement call,
- a seam that crosses into PH Core directly rather than through an interface.

**Never change behaviour to make code look reviewable.** An automated fix that makes bad code
merely look clean can mask a real problem and march it toward testing, which is worse than a
ticket that honestly waits.

**Kick-backs are capped.** The first and second kick-back send the ticket back to be rebuilt with
your findings. A third failure is not re-queued: the ticket is blocked for a person to decide.
Write findings a rebuild can act on: the file, the lines, what is wrong and what right looks like.

This step runs after build and before the approval for deployment, on purpose: remediation and
re-testing happen here, so the deployment gate stays a clean yes or no with nothing reopening
behind it.

## 4. The review flag

Every reviewed ticket carries a visible review flag on the card: passed, remediating (safe fixes
packaged and waiting to land), kicked back, or blocked. Hovering it shows **one line**: the single
most important reason (for example "rejected: a seam crosses into PH Core directly"), so the
status can be read without opening the comments.

- The one-line reason is one line. The full review log goes in the ticket's notes, starting
  `[ph-reviewer]`.
- Never move a passed, remediating or blocked ticket yourself. It stays where it is and a person
  decides; the flag says why.
- Do not invent a new pipeline column, and do not write testing-round or send-back counters. The
  automation keeps those.

## 5. Model

This gate runs on the most capable model (latest Claude Opus).

- Begin the review log with `Model: <the model this session is running as>`.
- If it is not an Opus, add `WARNING: reviewed on a lesser model` to that line and to every
  one-line reason.
- A ticket marked as needing the advanced model is never reviewed on a lesser one: hand its review
  to an Opus subagent, or block it and say why.
- Record which model reviewed each ticket.

## 6. Do / Don't

**Do**

- Review the whole batch together; look for issues that only appear across tickets.
- Check docs against code, and each ticket against its own Outcome and Test steps.
- Remediate only safe, behaviour-preserving structural issues, and re-run the full suite after.
- Kick back anything needing a behaviour change or a judgement call, with a clear one-line reason.
- Check every PH Core dependency goes through its agreed seam.
- Report a genuine, specific gap in a governing skill with `report_skill_miss`.

**Don't**

- Don't change behaviour to make code look reviewable.
- Don't silently fix a judgement call. Kick it back.
- Don't rewrite documents in review.
- Don't advance a ticket on a red run, or call an unexercised step passed.
- Don't pull red-run fixes onto the same deployment train. Red stops the train.
- Don't fold this review into the deployment gate. It runs as its own step before it.
- Don't infer the batch boundary from anything but the Review Batch button press.

*Owned by Engineering. First used on the Display Types & DSP Integration project, September 2026.
Counterpart to ph-designer: that skill governs what gets built; this one governs how built code is
reviewed before hand-off to engineering.*
