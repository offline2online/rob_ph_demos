"use strict";

// Deployment parameters for the AWS stack, read from CDK context
// (`cdk deploy -c key=value`, which scripts/deploy.mjs builds from its
// command-line options). Kept free of aws-cdk-lib so the deploy script and the
// tests can use it without loading CDK. Every value is non-secret.

const DEFAULTS = {
  stackName: "PharmacyScreen",
  phApiBaseUrl: "https://ph.mipharmacy.net",
  adminValue: "admin",
  oidcScopes: "openid email profile",
};

// [context key, description]. The deploy script's --help prints these.
const PARAMS = [
  ["stackName", "CloudFormation stack name; also prefixes resource names (default PharmacyScreen)"],
  ["region", "AWS region to deploy into, e.g. ap-southeast-2"],
  ["domainName", "custom domain for the screen and admin, e.g. screens.example.com (default: the CloudFront domain)"],
  ["certificateArn", "ACM certificate for domainName, in us-east-1 (required with domainName)"],
  ["hostedZoneId", "Route 53 hosted zone to add the domain's alias records to (optional)"],
  ["hostedZoneName", "that zone's name, e.g. example.com (required with hostedZoneId)"],
  ["vpcId", "run both API functions inside this VPC (default: no VPC)"],
  ["subnetIds", "comma-separated private subnets for the functions (default: the VPC's private subnets with egress)"],
  ["securityGroupIds", "comma-separated security groups for the functions (default: a new one, all outbound)"],
  ["vpcEndpoints", "true: add S3 and DynamoDB gateway endpoints and a KMS interface endpoint to the VPC"],
  ["oidcIssuer", "your identity provider's OIDC issuer URL (default: a new Cognito user pool)"],
  ["oidcClientId", "the admin editor's client id at that provider (public client, authorization code + PKCE)"],
  ["oidcAuthorizeUrl", "authorization endpoint (the deploy script reads it from the issuer's discovery document)"],
  ["oidcTokenUrl", "token endpoint (likewise)"],
  ["oidcLogoutUrl", "end-session endpoint, if the provider has one (likewise)"],
  ["oidcJwksUri", "JWKS URL (likewise)"],
  ["oidcScopes", "scopes the editor asks for (default \"openid email profile\")"],
  ["adminClaim", "ID token claim that carries the admin role (default cognito:groups, or groups with oidcIssuer)"],
  ["adminValue", "value of that claim that means admin (default admin)"],
  ["cognitoDomainPrefix", "Cognito hosted sign-in domain prefix (default <stack name>-<account id>, lower case)"],
  ["phApiBaseUrl", "default Personalisation Hub API base URL until an admin saves one (default https://ph.mipharmacy.net)"],
  ["retainData", "true: keep the table, media bucket, KMS key and user pool when the stack is deleted"],
  ["siteAsset", "staged static files (written by the deploy script)"],
  ["lambdaAsset", "staged function code (written by the deploy script)"],
];

const bool = (v) => v === true || v === "true" || v === "1" || v === "yes";
const list = (v) => (Array.isArray(v) ? v : String(v || "").split(",")).map((s) => String(s).trim()).filter(Boolean);
const str = (v) => (v === undefined || v === null ? "" : String(v).trim());

// endpointsLater: the deploy script reads an external provider's endpoints from its discovery document
// before CDK runs, so they may still be missing when it first checks the options.
function normaliseParams(raw = {}, { endpointsLater = false } = {}) {
  const get = (k) => str(raw[k]);
  const p = {
    stackName: get("stackName") || DEFAULTS.stackName,
    region: get("region"),
    domainName: get("domainName").toLowerCase(),
    certificateArn: get("certificateArn"),
    hostedZoneId: get("hostedZoneId"),
    hostedZoneName: get("hostedZoneName").replace(/\.$/, ""),
    vpcId: get("vpcId"),
    subnetIds: list(raw.subnetIds),
    securityGroupIds: list(raw.securityGroupIds),
    vpcEndpoints: bool(raw.vpcEndpoints),
    oidcIssuer: get("oidcIssuer").replace(/\/+$/, ""),
    oidcClientId: get("oidcClientId"),
    oidcAuthorizeUrl: get("oidcAuthorizeUrl"),
    oidcTokenUrl: get("oidcTokenUrl"),
    oidcLogoutUrl: get("oidcLogoutUrl"),
    oidcJwksUri: get("oidcJwksUri"),
    oidcScopes: get("oidcScopes") || DEFAULTS.oidcScopes,
    adminClaim: get("adminClaim"),
    adminValue: get("adminValue") || DEFAULTS.adminValue,
    cognitoDomainPrefix: get("cognitoDomainPrefix").toLowerCase(),
    phApiBaseUrl: get("phApiBaseUrl") || DEFAULTS.phApiBaseUrl,
    retainData: bool(raw.retainData),
    siteAsset: get("siteAsset"),
    lambdaAsset: get("lambdaAsset"),
  };
  if (!p.adminClaim) p.adminClaim = p.oidcIssuer ? "groups" : "cognito:groups";

  const errors = [];
  if (!/^[A-Za-z][A-Za-z0-9-]{0,99}$/.test(p.stackName)) errors.push("stackName: letters, digits and hyphens, starting with a letter");
  if (p.region && !/^[a-z]{2}(-[a-z]+)+-\d$/.test(p.region)) errors.push(`region: "${p.region}" is not an AWS region`);
  if (p.domainName && !p.certificateArn) errors.push("domainName needs certificateArn (an ACM certificate in us-east-1 covering it)");
  if (p.certificateArn && !/^arn:aws[a-z-]*:acm:us-east-1:\d{12}:certificate\//.test(p.certificateArn)) errors.push("certificateArn must be an ACM certificate in us-east-1 (CloudFront only uses certificates from there)");
  if (p.certificateArn && !p.domainName) errors.push("certificateArn needs domainName");
  if (p.hostedZoneId && (!p.domainName || !p.hostedZoneName)) errors.push("hostedZoneId needs domainName and hostedZoneName");
  if ((p.subnetIds.length || p.securityGroupIds.length || p.vpcEndpoints) && !p.vpcId) errors.push("subnetIds, securityGroupIds and vpcEndpoints need vpcId");
  if (p.oidcIssuer) {
    if (!/^https:\/\//.test(p.oidcIssuer)) errors.push("oidcIssuer must be an https URL");
    for (const k of endpointsLater ? ["oidcClientId"] : ["oidcClientId", "oidcAuthorizeUrl", "oidcTokenUrl"]) if (!p[k]) errors.push(`oidcIssuer needs ${k}`);
  } else if (p.oidcClientId) {
    errors.push("oidcClientId needs oidcIssuer");
  }
  for (const k of ["oidcAuthorizeUrl", "oidcTokenUrl", "oidcLogoutUrl", "oidcJwksUri", "phApiBaseUrl"]) {
    if (p[k] && !/^https:\/\/[^\s]+$/.test(p[k])) errors.push(`${k} must be an https URL`);
  }
  if (p.cognitoDomainPrefix && (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p.cognitoDomainPrefix) || /aws|amazon|cognito/.test(p.cognitoDomainPrefix))) {
    errors.push("cognitoDomainPrefix: lower-case letters, digits and hyphens, without aws, amazon or cognito");
  }
  return { params: p, errors };
}

module.exports = { PARAMS, DEFAULTS, normaliseParams };
