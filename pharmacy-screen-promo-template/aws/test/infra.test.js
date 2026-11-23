"use strict";

// The CloudFormation the stack produces (infra/stack.js), synthesized offline
// with CDK's assertions: what is created, who may use the KMS key, what the
// CDN routes where, what is deleted with the stack and what --retain-data
// keeps, the VPC and external-IdP variants, and the admin editor's config.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cdk = require("aws-cdk-lib");
const { Template, Match } = require("aws-cdk-lib/assertions");
const { PharmacyScreenStack, PH_ROUTES, CONFIG_ROUTES } = require("../infra/stack");
const { CSP_HEADER, screenCsp, editorCsp } = require("../infra/csp");
const { normaliseParams } = require("../infra/params");

const assets = fs.mkdtempSync(path.join(os.tmpdir(), "ps-aws-assets-"));
for (const d of ["site/admin", "site/assets/js", "lambda"]) fs.mkdirSync(path.join(assets, d), { recursive: true });
fs.writeFileSync(path.join(assets, "site/admin/index.html"), "<!doctype html>");
fs.writeFileSync(path.join(assets, "site/assets/js/player.0123456789.js"), "");
fs.writeFileSync(path.join(assets, "lambda/index.js"), "");

function synth(extra = {}) {
  const { params, errors } = normaliseParams({ region: "ap-southeast-2", siteAsset: path.join(assets, "site"), lambdaAsset: path.join(assets, "lambda"), ...extra });
  assert.deepEqual(errors, []);
  const app = new cdk.App();
  const stack = new PharmacyScreenStack(app, params.stackName, { env: { account: "111122223333", region: "ap-southeast-2" }, params });
  return { template: Template.fromStack(stack), json: app.synth().getStackByName(params.stackName).template };
}

const ofType = (json, type) => Object.entries(json.Resources).filter(([, r]) => r.Type === type);

test("infra: default stack (empty account) — what is created", () => {
  const { template, json } = synth();
  template.resourceCountIs("AWS::DynamoDB::Table", 1);
  template.resourceCountIs("AWS::KMS::Key", 1);
  template.resourceCountIs("AWS::S3::Bucket", 2);
  template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
  template.resourceCountIs("AWS::Cognito::UserPool", 1);
  template.resourceCountIs("AWS::EC2::SecurityGroup", 0);
  template.hasResourceProperties("AWS::DynamoDB::Table", {
    KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }, { AttributeName: "sk", KeyType: "RANGE" }],
    BillingMode: "PAY_PER_REQUEST",
    PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
  });
  template.hasResourceProperties("AWS::KMS::Key", { EnableKeyRotation: true, RotationPeriodInDays: 90, PendingWindowInDays: 7 });
  for (const [, b] of ofType(json, "AWS::S3::Bucket")) {
    assert.deepEqual(b.Properties.PublicAccessBlockConfiguration, { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true });
  }
  const fns = ofType(json, "AWS::Lambda::Function").filter(([, f]) => /aws\/lambda\//.test(f.Properties.Handler || ""));
  assert.deepEqual(fns.map(([, f]) => f.Properties.Handler).sort(), ["aws/lambda/config-api.handler", "aws/lambda/ph-proxy.handler"]);
  for (const [, f] of fns) {
    assert.equal(f.Properties.Runtime, "nodejs24.x");
    assert.deepEqual(f.Properties.Architectures, ["arm64"]);
    assert.equal(f.Properties.VpcConfig, undefined, "no VPC unless asked");
  }
  const routes = ofType(json, "AWS::ApiGatewayV2::Route").map(([, r]) => r.Properties.RouteKey).sort();
  assert.deepEqual(routes, [...PH_ROUTES, ...CONFIG_ROUTES].map((p) => `ANY ${p}`).sort());
});

test("infra: only the PH API function may use the KMS key; the config API cannot", () => {
  const { json } = synth();
  const fns = Object.fromEntries(ofType(json, "AWS::Lambda::Function").map(([id, f]) => [id, f]));
  const roleOf = (prefix) => fns[Object.keys(fns).find((id) => id.startsWith(prefix))].Properties.Role["Fn::GetAtt"][0];
  const policiesFor = (role) => ofType(json, "AWS::IAM::Policy").filter(([, p]) => p.Properties.Roles.some((r) => r.Ref === role)).flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
  const kmsActions = (role) => policiesFor(role).flatMap((s) => [].concat(s.Action)).filter((a) => a.startsWith("kms:"));
  assert.deepEqual(kmsActions(roleOf("PhApi")).sort(), ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey*", "kms:ReEncrypt*"].sort());
  assert.deepEqual(kmsActions(roleOf("ConfigApi")), []);
  const s3Actions = (role) => policiesFor(role).flatMap((s) => [].concat(s.Action)).filter((a) => a.startsWith("s3:"));
  assert.deepEqual(s3Actions(roleOf("PhApi")), [], "the proxy has no S3 access");
  assert.ok(s3Actions(roleOf("ConfigApi")).includes("s3:PutObject"));
});

test("infra: CloudFront routes /api, media and the site; API Gateway gets the origin header", () => {
  const { json } = synth();
  const [, dist] = ofType(json, "AWS::CloudFront::Distribution")[0];
  const cfg = dist.Properties.DistributionConfig;
  assert.deepEqual(cfg.CacheBehaviors.map((b) => b.PathPattern), ["pharmacyScreen/media/*", "api/screens/*", "api/*", "admin/*"]);
  const api = cfg.Origins.find((o) => o.OriginCustomHeaders);
  assert.equal(api.OriginCustomHeaders[0].HeaderName, "x-origin-verify");
  assert.match(JSON.stringify(api.OriginCustomHeaders[0].HeaderValue), /resolve:secretsmanager/);
  const apiBehaviour = cfg.CacheBehaviors.find((b) => b.PathPattern === "api/*");
  assert.equal(apiBehaviour.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad", "CachingDisabled");
  assert.deepEqual(apiBehaviour.AllowedMethods.sort(), ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]);
  assert.equal(cfg.DefaultCacheBehavior.ViewerProtocolPolicy, "redirect-to-https");
  assert.equal(cfg.DefaultCacheBehavior.FunctionAssociations[0].EventType, "viewer-request");
  const [, phFn] = ofType(json, "AWS::Lambda::Function").find(([id]) => id.startsWith("PhApi"));
  assert.equal(phFn.Properties.Environment.Variables.PH_API_DEFAULT_BASE_URL, "https://ph.mipharmacy.net");
});

test("infra: the origin secret reaches the functions by reference only, and each may read it", () => {
  const { json } = synth();
  const [secretId] = ofType(json, "AWS::SecretsManager::Secret")[0];
  const fns = ofType(json, "AWS::Lambda::Function").filter(([, f]) => /aws\/lambda\//.test(f.Properties.Handler || ""));
  assert.equal(fns.length, 2);
  for (const [id, f] of fns) {
    const vars = f.Properties.Environment.Variables;
    assert.ok(!("PS_ORIGIN_VERIFY" in vars), `${id}: no secret value in the environment`);
    assert.doesNotMatch(JSON.stringify(vars), /resolve:secretsmanager/, `${id}: no dynamic reference to the value either`);
    assert.deepEqual(vars.PS_ORIGIN_VERIFY_SECRET_ARN, { Ref: secretId }, `${id}: the secret's ARN`);
    const role = f.Properties.Role["Fn::GetAtt"][0];
    const statements = ofType(json, "AWS::IAM::Policy").filter(([, p]) => p.Properties.Roles.some((r) => r.Ref === role)).flatMap(([, p]) => p.Properties.PolicyDocument.Statement);
    const reads = statements.filter((st) => [].concat(st.Action).includes("secretsmanager:GetSecretValue"));
    assert.equal(reads.length, 1, `${id} may read the secret`);
    assert.deepEqual(reads[0].Resource, { Ref: secretId }, `${id}: that secret only`);
  }
  // The only place the value is resolved is CloudFront's origin header (a dynamic reference in the template).
  const text = JSON.stringify(json);
  assert.equal(text.match(/resolve:secretsmanager/g).length, 1);
});

test("infra: CSP (report-only) on the screen and the editor; the viewer address goes to the screen read", () => {
  const { json } = synth();
  const cfg = ofType(json, "AWS::CloudFront::Distribution")[0][1].Properties.DistributionConfig;
  const policies = Object.fromEntries(ofType(json, "AWS::CloudFront::ResponseHeadersPolicy"));
  const cspOf = (behaviour) => {
    const ref = behaviour.ResponseHeadersPolicyId.Ref;
    const custom = policies[ref].Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig;
    const h = custom && custom.Items.find((i) => i.Header === CSP_HEADER);
    return h ? h.Value : undefined;
  };
  assert.equal(cspOf(cfg.DefaultCacheBehavior), screenCsp(), "the screen page (default behaviour)");
  const admin = cfg.CacheBehaviors.find((b) => b.PathPattern === "admin/*");
  // Cognito: the editor may call the user pool's sign-in domain (resolved at deploy), and nothing else outside.
  const [sep, parts] = cspOf(admin)["Fn::Join"];
  assert.equal(sep, "");
  assert.equal(parts[0], editorCsp({ connect: ["https://"] }).split("https://;")[0] + "https://");
  assert.match(parts[1].Ref, /^AdminUsersSignInDomain/);
  assert.equal(parts[2], ".auth.ap-southeast-2.amazoncognito.com; report-uri /api/csp-report");
  assert.equal(admin.FunctionAssociations[0].EventType, "viewer-request", "/admin/ still serves index.html");
  for (const b of cfg.CacheBehaviors.filter((x) => x.PathPattern.startsWith("api/"))) assert.equal(cspOf(b), undefined, `${b.PathPattern}: JSON, no CSP`);
  const screens = cfg.CacheBehaviors.find((b) => b.PathPattern === "api/screens/*");
  const orp = Object.fromEntries(ofType(json, "AWS::CloudFront::OriginRequestPolicy"))[screens.OriginRequestPolicyId.Ref].Properties.OriginRequestPolicyConfig;
  assert.deepEqual(orp.HeadersConfig, { HeaderBehavior: "whitelist", Headers: ["CloudFront-Viewer-Address"] }, "never Host");
  assert.deepEqual(orp.QueryStringsConfig, { QueryStringBehavior: "whitelist", QueryStrings: ["promo"] });
  // With the retailer's own OIDC provider, the editor may call that provider's token endpoint.
  const ext = synth({ oidcIssuer: "https://login.example.com", oidcClientId: "c", oidcAuthorizeUrl: "https://login.example.com/authorize", oidcTokenUrl: "https://login.example.com/oauth/token" }).json;
  const extCfg = ofType(ext, "AWS::CloudFront::Distribution")[0][1].Properties.DistributionConfig;
  const extPolicies = Object.fromEntries(ofType(ext, "AWS::CloudFront::ResponseHeadersPolicy"));
  const extAdmin = extCfg.CacheBehaviors.find((b) => b.PathPattern === "admin/*");
  const extCsp = extPolicies[extAdmin.ResponseHeadersPolicyId.Ref].Properties.ResponseHeadersPolicyConfig.CustomHeadersConfig.Items.find((i) => i.Header === CSP_HEADER).Value;
  assert.equal(extCsp, editorCsp({ connect: ["https://login.example.com"] }));
});

test("infra: the site router sends / to the admin editor and serves directory indexes", () => {
  const { json } = synth();
  const [, fn] = ofType(json, "AWS::CloudFront::Function")[0];
  // eslint-disable-next-line no-new-func
  const handler = new Function(`${fn.Properties.FunctionCode}; return handler;`)();
  const go = (uri) => handler({ request: { uri } });
  assert.equal(go("/").headers.location.value, "/admin/");
  assert.equal(go("/admin").headers.location.value, "/admin/");
  assert.equal(go("/admin/").uri, "/admin/index.html");
  assert.equal(go("/pharmacy-screen.html").uri, "/pharmacy-screen.html");
});

test("infra: teardown deletes everything by default; --retain-data keeps the data", () => {
  const policy = (json, type) => ofType(json, type).map(([, r]) => r.DeletionPolicy);
  const plain = synth().json;
  for (const type of ["AWS::DynamoDB::Table", "AWS::KMS::Key", "AWS::S3::Bucket", "AWS::Cognito::UserPool", "AWS::Logs::LogGroup", "AWS::SecretsManager::Secret"]) {
    assert.ok(policy(plain, type).every((p) => p === "Delete"), `${type} deleted with the stack`);
  }
  assert.equal(ofType(plain, "Custom::S3AutoDeleteObjects").length, 2, "both buckets are emptied first");
  const kept = synth({ retainData: "true" }).json;
  for (const type of ["AWS::DynamoDB::Table", "AWS::KMS::Key", "AWS::Cognito::UserPool"]) {
    assert.ok(policy(kept, type).every((p) => p === "Retain"), `${type} kept`);
  }
  assert.deepEqual(ofType(kept, "AWS::S3::Bucket").map(([, r]) => r.DeletionPolicy).sort(), ["Delete", "Retain"], "media kept, site files not");
  assert.equal(ofType(kept, "AWS::DynamoDB::Table")[0][1].Properties.DeletionProtectionEnabled, true);
});

test("infra: inside the retailer's VPC, with endpoints", () => {
  const { template, json } = synth({ vpcId: "vpc-12345", subnetIds: "subnet-a,subnet-b", vpcEndpoints: "true" });
  const fns = ofType(json, "AWS::Lambda::Function").filter(([, f]) => /aws\/lambda\//.test(f.Properties.Handler || ""));
  for (const [, f] of fns) assert.deepEqual(f.Properties.VpcConfig.SubnetIds, ["subnet-a", "subnet-b"]);
  template.resourceCountIs("AWS::EC2::SecurityGroup", 1);
  template.resourceCountIs("AWS::EC2::VPCEndpoint", 4); // S3, DynamoDB, KMS, Secrets Manager
});

test("infra: the retailer's own OIDC provider instead of Cognito; custom domain with DNS", () => {
  const { template, json } = synth({
    oidcIssuer: "https://login.example.com",
    oidcClientId: "screens-admin",
    oidcAuthorizeUrl: "https://login.example.com/authorize",
    oidcTokenUrl: "https://login.example.com/token",
    domainName: "screens.example.com",
    certificateArn: "arn:aws:acm:us-east-1:111122223333:certificate/abc",
    hostedZoneId: "Z123",
    hostedZoneName: "example.com",
  });
  template.resourceCountIs("AWS::Cognito::UserPool", 0);
  template.resourceCountIs("AWS::Route53::RecordSet", 2);
  const [, cfn] = ofType(json, "AWS::Lambda::Function").find(([id]) => id.startsWith("ConfigApi"));
  const env = cfn.Properties.Environment.Variables;
  assert.equal(env.PS_OIDC_ISSUER, "https://login.example.com");
  assert.equal(env.PS_OIDC_AUDIENCE, "screens-admin");
  assert.equal(env.PS_ADMIN_CLAIM, "groups");
  assert.equal(env.PS_MEDIA_BASE_URL, "https://screens.example.com");
  const [, dist] = ofType(json, "AWS::CloudFront::Distribution")[0];
  assert.deepEqual(dist.Properties.DistributionConfig.Aliases, ["screens.example.com"]);
  assert.equal(dist.Properties.DistributionConfig.ViewerCertificate.MinimumProtocolVersion, "TLSv1.2_2021");
});

test("infra: the admin editor's config.js is written at deploy time with the sign-in endpoints", () => {
  const { json } = synth();
  const dep = ofType(json, "Custom::CDKBucketDeployment").map(([, r]) => r).find((r) => !r.Properties.DestinationBucketKeyPrefix);
  const markers = JSON.stringify(dep.Properties.SourceMarkers || []);
  assert.match(markers, /oauth2\/authorize/);
  assert.match(markers, /oauth2\/token/);
  assert.match(markers, /logout_uri/);
  assert.deepEqual(dep.Properties.SystemMetadata, { "cache-control": "no-cache" });
  const [, client] = ofType(json, "AWS::Cognito::UserPoolClient")[0];
  assert.deepEqual(client.Properties.AllowedOAuthFlows, ["code"]);
  assert.equal(client.Properties.GenerateSecret, false);
  assert.match(JSON.stringify(client.Properties.CallbackURLs), /\/admin\//);
  const [, group] = ofType(json, "AWS::Cognito::UserPoolGroup")[0];
  assert.equal(group.Properties.GroupName, "admin");
});

test("infra: parameters are checked before anything is deployed", () => {
  const errs = (raw) => normaliseParams(raw).errors.join("\n");
  assert.match(errs({ domainName: "x.example.com" }), /certificateArn/);
  assert.match(errs({ domainName: "x.example.com", certificateArn: "arn:aws:acm:ap-southeast-2:111122223333:certificate/a" }), /us-east-1/);
  assert.match(errs({ subnetIds: "subnet-a" }), /need vpcId/);
  assert.match(errs({ oidcIssuer: "https://x.example" }), /oidcClientId/);
  assert.match(errs({ oidcIssuer: "http://x.example", oidcClientId: "c", oidcAuthorizeUrl: "https://a", oidcTokenUrl: "https://t" }), /https/);
  assert.match(errs({ cognitoDomainPrefix: "my-cognito-login" }), /cognitoDomainPrefix/);
  assert.match(errs({ region: "sydney" }), /region/);
  assert.equal(errs({ region: "ap-southeast-2" }), "");
});

test("infra: the screen's fingerprinted assets/ are uploaded first, kept a year and never pruned; the rest is no-cache", () => {
  const { json } = synth();
  const deps = ofType(json, "Custom::CDKBucketDeployment");
  assert.equal(deps.length, 2);
  const [assetsId, assetsDep] = deps.find(([, r]) => r.Properties.DestinationBucketKeyPrefix === "assets/");
  assert.deepEqual(assetsDep.Properties.SystemMetadata, { "cache-control": "public, max-age=31536000, immutable" });
  assert.equal(assetsDep.Properties.Prune, false, "a player still on the previous page can finish loading it");
  const [, site] = deps.find(([, r]) => !r.Properties.DestinationBucketKeyPrefix);
  assert.deepEqual(site.Properties.SystemMetadata, { "cache-control": "no-cache" });
  assert.deepEqual(site.Properties.Exclude, ["assets/*"], "the page upload neither uploads nor prunes assets/");
  assert.ok((site.DependsOn || []).includes(assetsId), "the page is uploaded after the files it names");
  // A site staged empty (cdk destroy) synthesizes without assets/.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "ps-aws-empty-"));
  fs.mkdirSync(path.join(empty, "site"));
  const { params } = normaliseParams({ region: "ap-southeast-2", siteAsset: path.join(empty, "site"), lambdaAsset: path.join(assets, "lambda") });
  const app = new cdk.App();
  const stack = new PharmacyScreenStack(app, params.stackName, { env: { account: "111122223333", region: "ap-southeast-2" }, params });
  assert.equal(ofType(app.synth().getStackByName(stack.stackName).template, "Custom::CDKBucketDeployment").length, 1);
});
