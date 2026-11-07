---
name: aws-pricing-calculator
description: Shared AWS ACE costing skill. Builds the online AWS Pricing Calculator estimate for a Personalisation Hub POC or sandbox, and returns the shareable estimate link plus a cost table. Called by aws-ace-poc-funding-request and aws-ace-sandbox-credit-request; never duplicate its costing logic in them. Trigger on: "pricing calculator", "AWS estimate", "POC cost estimate".
---

# AWS Pricing Calculator (shared)

Single owner of costing for every AWS ACE funding document. The funding skills call this skill and paste its output; they do not carry their own prices or sizing rules.

## Inputs
- Customer, region(s), duration in months (POC window or sandbox term).
- Scale: number of displays/positions, expected requests per second, data volume. Ask the account owner for any missing figure; never invent one.
- Context: `poc` or `sandbox` (the sandbox estimate is a smaller, non-production footprint).

## Steps
1. Size the footprint from the inputs using the PH reference architecture (EKS in the customer's VPC, Postgres, object storage, load balancer, observability). Keep the sizing table in `references/sizing.md` of this skill; update it there only.
2. Build the estimate at https://calculator.aws/ in the correct region, one service line per component, then save and share it. Record the shareable URL.
3. Return: the estimate URL, a table (service, configuration, monthly cost, months, total), the grand total in USD, and every assumption made.
4. Check the total against the ask in the calling document; they must match to the dollar. If not, fix the document, not the estimate.

## Rules
- Prices come from the calculator, never from memory.
- State the date the estimate was built; AWS prices change.
- Credits are requested at the estimate total, not rounded up.

## Refining
Log every miss (a service omitted, a total AWS queried, a region mismatch) with `report_skill_miss` against slug `aws-pricing-calculator`. Fix `references/sizing.md` when a miss repeats.
