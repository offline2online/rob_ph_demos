---
name: aws-ace-poc-claim
description: Prepares, and with the account owner's go-ahead submits, the AWS claim for POC funding once the POC is approved and delivered. Builds the claim sign-off document as proof of execution. Trigger on: "POC claim", "claim funding", "claim sign-off".
---

# POC claim

Bound to the map step "Claim sign-off document". Only runs after the POC funding was approved and the POC delivered.

## Steps
1. Verify preconditions: funding approved (reference and amount), POC delivered, credit window not expired. If any fails, stop and say which.
2. Gather proof of execution: delivery dates, success-criteria results against the funded plan, customer sign-off, invoices or usage evidence for the funded AWS spend.
3. Draft the claim sign-off document: what was funded, what was delivered, evidence per success criterion, actual spend against the estimate (from the `aws-pricing-calculator` estimate on the funding request), customer acknowledgement.
4. Show the claim to the account owner. Submit in Partner Central only after their explicit go-ahead, then record the claim reference and date on the lead card.

## Refining
Report misses (evidence AWS asked for, a late claim, a mismatch with the funded estimate) with `report_skill_miss` against slug `aws-ace-poc-claim`.
