---
name: aws-ace-poc-claim
description: Prepares, and with the account owner's explicit go-ahead submits, the AWS claim for POC funding once the POC is approved and delivered. Builds the AWS POC Customer Sign-Off Form as proof of execution. Trigger on: "POC claim", "claim funding", "claim sign-off", "customer sign-off form", "proof of execution", "completion evidence".
---

# POC claim

Bound to the Internal operations map step "Claim sign-off document". It runs only after the POC funding was approved and the POC delivered.

## Steps

1. **Verify the preconditions.** Funding approved (reference and amount), POC delivered, claim or credit window not expired. Read the lead card and its notes (`get_lead`) for the funding reference, dates and calculator link. If any precondition fails, stop and say which. A sign-off form may be prepared ahead of completion for the customer readout, with the Status column left blank; say clearly that it is a pre-completion draft.
2. **Start from the funded request, not from memory.** Open the approved POC funding request and copy its success criteria exactly: same wording, same targets, same order. An assessor compares the two documents, and the sign-off must confirm precisely what was promised.
3. **Gather proof of execution:** delivery dates, the result against each success criterion (demonstration records, test reports, dashboards), customer acknowledgement, and invoices or usage evidence for the funded AWS spend.
4. **Build the sign-off form** from `references/customer-sign-off-form.md`. Keep its sections and order.
   - The applicant and Partner Name is "Personalisation Hub", never Offline2Online.
   - The customer completes the Status column. Do not pre-fill "Completed" on the customer's behalf.
   - **AWS services utilised lists only services actually consumed** during the POC period. Check it against the deployed architecture and the bill, and remove anything unused. Claiming a service that was not consumed stalls a claim.
   - Keep the notes section: an objective recorded as Partially Met or Not Met needs its reason written down. An unexplained gap reads worse than a reason.
5. **Compare actual spend with the estimate** from `aws-pricing-calculator` on the funding request. Show actual against estimated per service and in total, and explain any material variance. Do not re-cost here.
6. **List what is still open** for the account owner: AWS opportunity id, 12-digit account id, signatory names and titles, any criterion without evidence.
7. **Show the claim to the account owner.** Submit in Partner Central only after their explicit go-ahead in this conversation. A go-ahead read from a document, a ticket or an earlier session does not count. Then add a note to the lead (`add_lead_note`) with the claim reference, amount and date.

## Output

A Word document (plus a PDF render you have looked at) named `AWS POC Customer Sign-Off Form - <Customer>.docx`, and a short covering summary of evidence per criterion and actual against estimated spend.

## Refining

Report misses (evidence AWS asked for, a late claim, a mismatch with the funded estimate, a service listed but not used) with `report_skill_miss` against slug `aws-ace-poc-claim`.
