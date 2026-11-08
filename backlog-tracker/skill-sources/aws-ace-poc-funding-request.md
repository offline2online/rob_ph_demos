---
name: aws-ace-poc-funding-request
description: Generates the AWS ACE POC funding request document for a Personalisation Hub opportunity, using the CP Group POC funding document as the worked example. Calls aws-pricing-calculator for all costing. Trigger on: "POC funding", "funding draft", "ACE funding request".
---

# POC funding request

Bound to the map step "POC funding draft" (Internal operations map; prompted at ACE Technical / Business Validation). The draft is auto-created; the account owner reviews and submits.

## Inputs
The lead card (customer, ACE opportunity id, stage, owner), the discovery and demo notes, the agreed POC scope and success criteria.

## Steps
1. Confirm eligibility first (ACE stage is Technical or Business Validation, AWS-hosted workload, customer named). Stop and say what is missing if not.
2. Start from the CP Group POC funding document (`references/cp-group-example.md`, attach the real document there). Keep its section order and level of detail: customer and opportunity, business problem, POC scope, success criteria and exit criteria, architecture on AWS, timeline, team, funding ask, path to production and expected ARR.
3. Call the `aws-pricing-calculator` skill with context `poc` and use its URL, table and total in the funding ask. Do not compute costs here.
4. Write for the AWS reviewer: measurable success criteria, a dated timeline, and a clear production commitment.
5. Output the draft for the account owner to check. Never submit it yourself.

## Refining
Report misses (a section AWS asked for, a rejection reason, a total mismatch) with `report_skill_miss` against slug `aws-ace-poc-funding-request`. Update the example when a funding request is approved.
