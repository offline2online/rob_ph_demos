---
name: aws-ace-sandbox-credit-request
description: Generates the AWS sandbox credit request for a Personalisation Hub opportunity, using the Avolta Hudson sandbox funding request as the default example. Calls aws-pricing-calculator for all costing. Trigger on: "sandbox credit", "sandbox funding", "AWS credits".
---

# Sandbox credit request

Bound to the map step "Sandbox credit draft". Auto-created after the POC funding draft; the account owner reviews and submits.

## Steps
1. Confirm the opportunity and the sandbox purpose (build, integration test, customer evaluation) and the term.
2. Start from the Avolta Hudson sandbox funding request (`references/avolta-hudson-example.md`, attach the real document there) as the default template. Keep its structure: customer and opportunity, sandbox purpose, what will run, term, credit ask, link to the POC.
3. Call the `aws-pricing-calculator` skill with context `sandbox` and use its URL and total as the credit ask. Do not compute costs here.
4. Cross-reference the POC funding request so the two asks are consistent and do not double count.
5. Output the draft for the account owner. Never submit it yourself.

## Refining
Report misses with `report_skill_miss` against slug `aws-ace-sandbox-credit-request`.
