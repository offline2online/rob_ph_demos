---
name: aws-ace-sandbox-credit-request
description: Drafts the AWS sandbox credit request for a Personalisation Hub opportunity, as an APN Innovation Sandbox innovation plan, using the Avolta Hudson plan as the default example. Calls aws-pricing-calculator for every cost. Trigger on: "sandbox credit", "sandbox funding", "AWS credits", "innovation sandbox", "innovation plan", "APN sandbox".
---

# Sandbox credit request

Bound to the Internal operations map step "Sandbox credit draft", which follows the POC funding draft. The draft is created for the account owner, who reviews and submits it. This skill never submits anything.

## What the program expects

From the APN Innovation Sandbox template and the requests made so far. Confirm anything that matters with the AWS partner manager; program terms change.

- AWS Promotional Credits for a sandbox or development environment used to build a specific Design Win. Not production hosting.
- Credits apply only to a **dedicated sandbox AWS account id**, separate from business-as-usual and production accounts. Get that 12-digit id from the account owner.
- Funding is capped at **three months** of AWS services.
- An **AWS Pricing Calculator link is required**, estimating monthly usage during the project.
- The innovation plan must do three things: (1) describe the overall goal and how it ties to customers' needs; (2) give project details: timeline, resources and budget; (3) list the solution in development by application and by industry.

## Steps

1. **Confirm the basics** from the lead card (`get_lead`) and the account owner: the opportunity, the sandbox purpose (build, integration test, customer evaluation, in-region deployment after a POC), the focus areas, the start and end dates, the Region, and the sandbox account id. Ask for dates; do not invent a window. If the owner cannot give them yet, mark a placeholder and list it as open.
2. **Use the owner's focus areas as the spine.** If they name three areas, the summary, the success criteria and the development plan each carry those three, in that order.
3. **Use exact AWS product names**, the ones the owner used. If a name is ambiguous, ask. A past draft used Amazon Connect where Amazon Quick Suite was meant, and another read "Amazon Quick" as QuickSight.
4. **Fill the template** in `references/innovation-plan-template.md`, section by section, in its order. Do not drop or rename a template field.
5. **Cost it** by calling the `aws-pricing-calculator` skill with context `sandbox`. Put its share link in the "AWS Pricing Calculator Link" field and its monthly figure beside it. The credit ask is the estimate total for the funded months, or a clean figure just under it. Do not compute costs here.
6. **Cross-reference the POC funding request.** State how the sandbox relates to the POC, and make sure AWS infrastructure is counted in exactly one of the two documents.
7. **Check before handing over:**
   - The applicant is "Personalisation Hub" everywhere, including the title line and any "prepared by" line. Search the draft for "Offline2Online".
   - Dates span no more than three months and agree across project details and the plan table.
   - The credit ask equals or sits below the calculator total, and the months match.
   - The plan says the credits apply to a dedicated sandbox account, not production.
   - All three program points are answered and easy to find.
   - Every service in the estimate appears in the architecture section.
8. **Output.** A Word document that keeps the template's layout (plus a PDF render you have looked at). List the open items for the owner: dates, calculator link if still pending, sandbox account id, architecture diagram.
9. **Short description for the form.** When asked, give about 100 words: what is being built, on which AWS services, and the outcome. Keep it generic: no prices, no dates, and no platform or company name unless the owner asks for them. Offer a 200-word version only if asked.
10. **Record it** on the lead (`add_lead_note`): draft ready, credit ask per month and in total, dates, calculator link, open items. Never submit it yourself.

## Refining

Report misses (a field AWS queried, a rejection reason, a wrong product name, a total mismatch) with `report_skill_miss` against slug `aws-ace-sandbox-credit-request`. When a request is approved, add what the approved version changed to the reference file.
