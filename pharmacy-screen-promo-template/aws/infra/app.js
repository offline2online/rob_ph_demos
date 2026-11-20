#!/usr/bin/env node
"use strict";

// CDK app: `cdk deploy -c region=… [-c key=value …]` (scripts/deploy.mjs runs it).
const cdk = require("aws-cdk-lib");
const { PharmacyScreenStack } = require("./stack");
const { normaliseParams, PARAMS } = require("./params");

const app = new cdk.App();
const raw = {};
for (const [key] of PARAMS) {
  const v = app.node.tryGetContext(key);
  if (v !== undefined) raw[key] = v;
}
const { params, errors } = normaliseParams(raw);
if (errors.length) throw new Error(`Invalid parameters:\n  ${errors.join("\n  ")}`);
if (!params.siteAsset || !params.lambdaAsset) throw new Error("siteAsset and lambdaAsset are not set: deploy with scripts/deploy.mjs, which stages them");

new PharmacyScreenStack(app, params.stackName, {
  stackName: params.stackName,
  description: "Pharmacy Screen Promo Template: screen page, admin editor, config API and PH API proxy",
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: params.region || process.env.CDK_DEFAULT_REGION },
  params,
});
