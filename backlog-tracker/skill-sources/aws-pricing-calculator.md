---
name: aws-pricing-calculator
description: Shared AWS costing skill. Sizes a Personalisation Hub POC or sandbox footprint, builds the estimate in the online AWS Pricing Calculator (calculator.aws), and returns the shareable estimate link, a per-service cost table, the total and every assumption. Called by aws-ace-poc-funding-request and aws-ace-sandbox-credit-request; aws-ace-poc-claim compares actual spend against its output. Never duplicate its costing logic in them. Trigger on: "pricing calculator", "AWS estimate", "POC cost estimate", "sandbox cost", "how much AWS credit", "cost calculator for the funding request".
---

# AWS Pricing Calculator (shared)

Single owner of costing for every AWS funding document. The funding skills call this skill and paste its output. They carry no prices or sizing rules of their own.

Bound to the Internal operations map steps "Funding prompted & eligibility check", "POC funding draft" and "Sandbox credit draft".

## Inputs: ask for what is missing, never invent it

| Input | Notes |
|---|---|
| Customer and opportunity | From the lead card (`get_lead`). |
| Context | `poc` (the POC workload) or `sandbox` (a dedicated non-production account). |
| AWS Region | The Region the workload will actually run in. State it by name and code, e.g. Asia Pacific (Sydney), ap-southeast-2. Do not default silently. |
| Duration | Start date, end date, months. A sandbox is capped at three months of AWS services. |
| Scale | Stores, displays or positions, expected requests per second, data volume. |
| Named extras | Anything the account owner asked to include: analytics seats, a GenAI inference budget, a device fleet. Use the exact AWS product name they give. If a name is ambiguous (for example "Amazon Quick" could be read as Amazon Quick Suite or Amazon QuickSight), ask which one before costing it. |
| Target | Any figure the owner is aiming for (for example "at least US$3k a month"). It shapes the footprint you propose, never the prices. |

If an input is missing and nobody can be asked in this run, stop and list what is needed. A placeholder may stand in for a date or an id in a draft; it may never stand in for a price or a quantity.

## Steps

1. **Size the footprint** from the inputs with `references/sizing.md`. One line per AWS service, each with its configuration (instance type, count, storage, hours).
2. **Build the estimate at https://calculator.aws/** in the stated Region, one service line per component, named the same as your table. Save and share it, and record the share link (`https://calculator.aws/#/estimate?id=...`).
   - If this session cannot drive a browser, do not stop and do not improvise prices. Produce the input sheet (service, Region, configuration, quantity, hours per month) so the account owner can key it in within minutes, and return the table with the cost columns marked "pending calculator".
3. **Return** all of:
   - the estimate share link, or "pending: account owner to build from the input sheet";
   - a table: service, configuration, monthly cost (USD), months, total;
   - monthly total and grand total in USD;
   - the Region, the pricing model (On-Demand unless told otherwise) and the date the estimate was built;
   - every assumption, as a list.
4. **Reconcile with the calling document.** Every figure in the document must equal the estimate: per line, per month and in total. If they differ, fix the document, not the estimate.

## Rules

- **Prices come from the calculator only.** Not from memory, not from a third-party pricing site, not from an older estimate, not from `references/sizing.md`.
- **Never fabricate or guess a calculator link.** A link is either one you saved or one the account owner gave you.
- **The ask never exceeds the estimate.** Credits are requested at the estimate total or rounded down to a clean figure. Asking slightly under the modelled cost (the June 2026 sandbox request asked for about 92 percent) shows the credits will be fully used. Never round up.
- **Only cost what will be consumed.** Every service in the estimate must appear in the architecture section of the calling document, and the claim later lists only services actually used. Leave out anything speculative.
- **Infrastructure only.** People, design and engineering days are not AWS costs. They belong in the POC funding request's use-of-funds table, not here.
- **No double counting.** When a POC funding request and a sandbox credit request exist for the same opportunity, the AWS infrastructure is costed once and each document says which request carries it.
- **A spreadsheet is a supplement, not the estimate.** If the owner wants an editable workbook, build it from the calculator figures and keep the calculator link as the source.
- **Estimates age.** Rebuild one that is more than 30 days old, or when the Region, dates or scale change, before it goes into a submission.

## Record it

Add a note to the lead (`add_lead_note`): estimate link, monthly and total figures, Region, date built, and which document uses it. The claim skill reads this later.

## Refining

Log every miss (a service omitted, a total AWS queried, a Region mismatch, a wrong product name, a stale link) with `report_skill_miss` against slug `aws-pricing-calculator`. Fix `references/sizing.md` when a miss repeats.
