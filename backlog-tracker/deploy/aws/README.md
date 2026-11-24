# AWS Partner Central connection (keyless)

The console backend (`functions/partner-central.js`, served at `/partnerCentral/**`) calls the
Partner Central **Selling API** (ACE opportunities) and **Benefits API** (funding drafts) with no
stored AWS key.

```
Cloud Function --Google OIDC ID token--> STS AssumeRoleWithWebIdentity --15 min creds--> Partner Central
```

## Set-up (one-off, by Rob)

1. Deploy `partner-central-role.yaml` in AWS account `817173160653` (CloudFormation), passing the
   unique id of the Cloud Functions runtime service account in `backlog-tracker-e4ed2`. Role:
   `arn:aws:iam::817173160653:role/PH-Console-PartnerCentral`.
2. In Partner Central, link the Partner Central account to that AWS account and map the role to the
   matching Partner Central user role (Partner Central -> Settings -> Cloud Platform /
   Role mapping). Until this is done the console shows **Not linked yet**.
3. Console -> Settings -> Integrations & MCP -> **AWS Partner Central** -> Test connection.

## Partner Central data export → Conversion Funnel (one-off, by Rob)

The Conversion Funnel's Revenue stage reads Partner Central's single-step S3 data export
(`functions/pc-export.js`, run by the funnel ingest every 6 hours). It needs:

1. A PH-owned S3 bucket in account `817173160653` (private, no public access), e.g.
   `ph-partner-central-export`.
2. Partner Central -> Analytics -> data export, pointed at that bucket (and a folder, if you want
   one). Partner Central's own instructions add a bucket policy that lets it write there.
3. Redeploy `partner-central-role.yaml` with `ExportBucketName` set to the bucket. That adds
   `s3:ListBucket` and `s3:GetObject` on that bucket only.
4. Set `pcExportBucket` (and `pcExportPrefix` for the folder, `pcExportRegion` if it is not
   `us-east-1`) on `consoleConfig/funnelIngest` in Firestore.
5. Run the import once: POST `funnelIngest` with `X-Board-Key` and `{"mode": "daily"}`. Then
   check `consoleConfig/funnelIngest.sources.pc-export`: `recordsRead`, `joined` (the rows matched
   to an ACE opportunity, a prospect or a lead) and `unknownHeaders` (columns the import did not
   recognise; add them to `HEADER_ALIASES` if they carry a figure the funnel needs).

Until step 4 the funnel's Revenue row reads **Not set up yet**. It does not show as a failure.

## License Manager (AWS Marketplace agreements)

The same role also reads PH's AWS Marketplace agreements and their buyer contacts for Promote ›
License Manager (`functions/marketplace-agreements.js`): `SearchAgreements` and
`GetAgreementContacts` on `agreement-marketplace.us-east-1.amazonaws.com` (signing name
`aws-marketplace`, target `AWSMPCommerceService_v20200301`), read-only, under the
`MarketplaceAgreementsRead` policy in `partner-central-role.yaml`. Re-deploy the stack to add it.
Untested live: confirm on the first **Sync from AWS Marketplace** that the call succeeds and that
the stored `contactsRaw` carries the buyer's name, email, company and country.

## Safety

* Catalogue is **Sandbox** until an admin switches to **AWS** (live) in Settings and types `LIVE`.
* Benefits: the role denies `SubmitBenefitApplication` and the module has no submit wrapper;
  drafts only.
* Every call is written to `partnerCentralAudit` (server-only) and shown in Settings; CloudTrail
  records the AWS side.

## To verify on the first real Sandbox call

Endpoints are the documented `partnercentral-selling.us-east-1.api.aws` and
`partnercentral-benefits.us-east-1.api.aws` (the `*.amazonaws.com` names do not resolve, which was
the "fetch failed" of 7 Nov 2026). Target prefixes (`AWSPartnerCentralSelling`,
`PartnerCentralBenefitsService`) were probed against the live endpoints without credentials: a known
target answers `MissingAuthenticationToken`, an unknown one `UnknownOperation`. A signed Sandbox
`ListOpportunities` still needs the role and Partner Central link; press Test connection. An AWS
authorisation error shows as "Not linked yet" with AWS's message; a network failure shows the cause
(for example `Couldn't reach host (ENOTFOUND)`) in the audit row and Last error, and the details in
Cloud Logging. Constants are in `SERVICES`.

## Partner Central agent (MCP server)

The console's **Ask the Partner Central agent** panel (Settings -> Integrations & MCP -> AWS Partner
Central) calls AWS's hosted agents MCP server at
`https://partnercentral-agents-mcp.us-east-1.api.aws/mcp` (SigV4 signing name
`partnercentral-agents-mcp`, `tools/call` of `sendMessage` / `getSession` only) with the same role.
The role needs `partnercentral:UseSession` (the `PartnerCentralAgentMcp` policy in
`partner-central-role.yaml`; redeploy the stack to add it). Every write the agent proposes waits for an
admin's Approve or Reject in the panel. Test in the **Sandbox** catalogue first: list opportunities,
ask for a customer profile, ask it to draft a test opportunity (not submitted) and check the approval
card appears before anything is written. An authentication error answers `-32001` and shows in the audit
list as `agent:sendMessage`.
