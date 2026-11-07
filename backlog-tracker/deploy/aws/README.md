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
