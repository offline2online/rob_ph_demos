---
name: aws-ace-poc-funding-request
description: Drafts the AWS ACE Proof of Concept funding request document for a Personalisation Hub opportunity, using the CP Group request as the worked example. Calls aws-pricing-calculator for every AWS cost. Trigger on: "POC funding", "funding draft", "ACE funding request", "AWS funding request", "supporting document for AWS", "proof of concept funding".
---

# POC funding request

Bound to the Internal operations map step "POC funding draft" (prompted at ACE Technical Validation or Business Validation). The draft is created for the account owner, who reviews and submits it. This skill never submits anything.

## 1. Settle these before writing a word

Past drafts were rewritten because one of these was assumed. Read the lead card (`get_lead`), the discovery and demo notes, and ask the account owner for anything still open.

1. **The applicant is always Personalisation Hub.** Not Offline2Online, not a channel partner, not the customer. This applies to the title block, the byline, the contact line and every sentence.
2. **The party structure.** Who is the customer, who are the delivery or channel partners, who is the brand or advertiser, and who funds which part. Write it as a table if more than two parties are involved. A partner that neither seeks nor provides funding is said to be so.
3. **What AWS is being asked to fund.** One of:
   - **Cash for delivery resource** (design, engineering, project management, test), with AWS infrastructure carried by a separate sandbox credit request. This is the CP Group pattern and the default.
   - **Infrastructure and delivery resource in one request**, shown as two subtotals that add up to the ask.
   Say which in the header table and again in Use of Funds, so the two requests never double count.
4. **Dates.** POC start and end, and the submission date. Ask; do not invent a window. If the owner cannot give them yet, use a clearly marked placeholder and list it under open items.
5. **Eligibility.** ACE stage is Technical Validation or Business Validation (or later), the workload is AWS-hosted, the customer is named, and the ACE opportunity id exists. If one fails, stop and say which.

## 2. Write it

Follow the section order and depth in `references/cp-group-example.md`. In short:

Header table, 1 Executive summary, 2 What exists today and what this POC adds, 3 Scope (components, then out of scope), 4 Solution architecture on AWS, 5 Project plan with phase demonstrations to AWS, 6 Success criteria, 7 Use of funds, 8 Post-POC opportunity for AWS, 9 Risks and mitigations, 10 Summary of request.

What makes a request land with the AWS reviewer:

- **Lead with the commercial logic.** What the customer already does, what they cannot do today, and what the POC proves. "Extends an existing revenue stream on an existing platform" is stronger than "builds something new".
- **Scope only what Personalisation Hub controls.** Every phase must be demonstrable to AWS by Personalisation Hub alone, with no dependency on customer scheduling, store access or a third party's onboarding. Where a third-party system is needed (a DSP, a POS feed), build against its documented interface and demonstrate with a mock on the same contract. Say so in scope, success criteria and risks.
- **Success criteria are a table**: measure, definition, target. Each one is checkable at a demonstration. The claim sign-off form later copies these word for word, so write them as you want the customer to sign them.
- **A dated plan.** Phases with dates, a demonstration to AWS at the end of each phase, milestones, dependencies and critical path, governance (weekly status to the AWS partner managers), team and roles.
- **Use of funds reconciles.** A table by resource with amounts that sum to the ask; if the plan allocates funding by phase, that table sums to the same total.
- **Out of scope is explicit**, including AWS infrastructure when it sits in a separate request, production rollout, hardware, and customer system changes.
- **Post-POC opportunity is written for AWS**: workload growth, estate expansion, repeatability in the Region, data gravity, how rollout is funded.
- **Distinguish POC from proof of value.** The POC proves the integration works end to end. The customer's business case is proven in the POV that follows. Do not promise revenue outcomes inside the POC.

## 3. AWS costs

Call the `aws-pricing-calculator` skill with context `poc`. Use its link, table and totals wherever AWS infrastructure appears. Do not compute or estimate a cost here. When infrastructure is carried by the sandbox request, this document names the services and points to that request rather than repeating figures.

## 4. Check before handing over

1. Applicant reads "Personalisation Hub" everywhere. Search the draft for "Offline2Online".
2. Every total reconciles: header ask, executive summary, use of funds, phase allocation, summary of request.
3. Every "see Section N" points at the section that actually has that number. Renumbering has broken these before.
4. Dates agree across the header, plan, milestones and summary.
5. AWS product names are exact and are the ones the owner used.
6. Nothing in scope depends on a party outside Personalisation Hub's control without a stated mock or fallback.
7. Open items are listed for the owner: AWS partner manager names, opportunity id, 12-digit account id, submission date, any placeholder.

## 5. Output and hand-over

- Deliver a Word document (plus a PDF render you have looked at) unless the owner asks for another format. File name: `AWS POC Funding Request - <Customer>.docx`.
- If the submission form needs a short description, provide about 100 words: what is being built and proven, on which AWS services, and the outcome. Keep it generic: no prices, no dates, no platform or company name unless the owner asks for them.
- Add a note to the lead (`add_lead_note`): draft ready, amount and type of ask, POC dates, calculator link, open items. Put the 12-digit AWS account id on the lead (`update_lead`) when you learn it.
- The account owner submits in Partner Central. Never submit it yourself.

## Refining

Report misses (a section AWS asked for, a rejection reason, a total mismatch, a wrong party) with `report_skill_miss` against slug `aws-ace-poc-funding-request`. When a request is approved, update `references/cp-group-example.md` with what the approved version changed.
