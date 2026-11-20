// The one-command AWS deploy and teardown (scripts/deploy.mjs), offline: the
// options it takes, the exact commands it would run (the same plan --dry-run
// prints), and what it stages for the site and the functions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { parseArgs, buildPlan, contextArgs, stageSite, stageLambda, usage, makeTasks } from "../scripts/deploy.mjs";

const require = createRequire(import.meta.url);

test("deploy: one command, in order — install, stage, bootstrap, deploy, first admin", () => {
  const { steps, params, outputs } = buildPlan(parseArgs(["deploy", "--region", "ap-southeast-2", "--admin-email", "ops@example.com"]));
  assert.deepEqual(steps.map((s) => s.phase), ["install", "stage", "stage", "stage", "bootstrap", "deploy", "admin"]);
  const deploy = steps.find((s) => s.phase === "deploy").cmd;
  assert.deepEqual(deploy.slice(0, 7), ["npx", "--no-install", "cdk", "deploy", "PharmacyScreen", "--require-approval", "never"]);
  assert.ok(deploy.includes("--outputs-file") && deploy.includes(outputs));
  assert.ok(deploy.includes("region=ap-southeast-2"));
  assert.equal(params.stackName, "PharmacyScreen");
  assert.equal(steps.find((s) => s.phase === "admin").args.email, "ops@example.com");
});

test("deploy: parameterised for the retailer's account, region, VPC and domain", () => {
  const opts = parseArgs([
    "--region=ap-southeast-2", "--stack-name", "MiPharmacyScreens",
    "--vpc-id", "vpc-1", "--subnet-ids", "subnet-a,subnet-b", "--vpc-endpoints",
    "--domain-name", "screens.example.com", "--certificate-arn", "arn:aws:acm:us-east-1:111122223333:certificate/x",
    "--retain-data", "--profile", "mipharmacy",
  ]);
  assert.equal(opts.profile, "mipharmacy");
  const { params, steps } = buildPlan(opts);
  assert.equal(params.vpcEndpoints, true);
  assert.equal(params.retainData, true);
  const ctx = steps.find((s) => s.phase === "deploy").cmd.join(" ");
  for (const kv of ["stackName=MiPharmacyScreens", "vpcId=vpc-1", "subnetIds=subnet-a,subnet-b", "vpcEndpoints=true", "domainName=screens.example.com", "retainData=true"]) {
    assert.ok(ctx.includes(kv), kv);
  }
});

test("deploy: an external identity provider's endpoints are discovered first", () => {
  const { steps } = buildPlan(parseArgs(["--region", "eu-west-2", "--oidc-issuer", "https://login.example.com", "--oidc-client-id", "c1"]));
  assert.deepEqual(steps.map((s) => s.phase).slice(0, 5), ["install", "stage", "stage", "stage", "discover"]);
  assert.throws(() => buildPlan(parseArgs(["--region", "eu-west-2", "--oidc-issuer", "https://login.example.com", "--oidc-client-id", "c1", "--admin-email", "a@b.c"])), /identity provider/);
});

test("deploy: bad options stop it before anything runs", () => {
  assert.throws(() => buildPlan(parseArgs([])), /--region is required/);
  assert.throws(() => buildPlan(parseArgs(["--region", "ap-southeast-2", "--domain-name", "x.example.com"])), /certificateArn/);
  assert.throws(() => parseArgs(["--nope"]), /Unknown option/);
  assert.throws(() => parseArgs(["launch"]), /Unknown command/);
  assert.throws(() => parseArgs(["--region"]), /needs a value/);
  assert.match(usage(), /--vpc-id <value>/);
});

test("destroy: one command — deletes the stack, then the log groups it leaves", () => {
  const { steps } = buildPlan(parseArgs(["destroy", "--region", "ap-southeast-2", "--stack-name", "Test1"]));
  assert.deepEqual(steps.map((s) => s.task || s.cmd.slice(0, 4).join(" ")), ["npm ci --no-audit --no-fund", "stageEmpty", "readStack", "npx --no-install cdk destroy", "deleteLeftoverLogs"]);
  const destroy = steps.find((s) => s.cmd && s.cmd[3] === "destroy").cmd;
  assert.deepEqual(destroy.slice(0, 6), ["npx", "--no-install", "cdk", "destroy", "Test1", "--force"]);
  assert.equal(steps.at(-1).args.stackName, "Test1");
});

test("contextArgs: only set values, in a fixed order", () => {
  assert.deepEqual(contextArgs({ region: "ap-southeast-2", stackName: "S", vpcEndpoints: false, subnetIds: [] }), ["-c", "stackName=S", "-c", "region=ap-southeast-2"]);
});

test("stage: the site holds the screen and admin only; the functions hold their code only", () => {
  const out = mkdtempSync(join(tmpdir(), "ps-aws-stage-"));
  const site = stageSite(join(out, "site"));
  assert.ok(existsSync(join(site, "pharmacy-screen.html")));
  assert.ok(existsSync(join(site, "admin", "index.html")));
  assert.ok(existsSync(join(site, "admin", "js", "auth.js")));
  const sw = readFileSync(join(site, "sw.js"), "utf8");
  assert.ok(!sw.includes("__PHARMACY_SCREEN_BUILD__"), "the service worker is stamped with the build id, as on Firebase");
  for (const never of ["config-api", "ph-proxy", "seed/seed.js", "admin/test", "admin/tools", "admin/package.json"]) {
    assert.ok(!existsSync(join(site, never)), `${never} is not published`);
  }
  const fn = stageLambda(join(out, "lambda"));
  assert.deepEqual(readdirSync(fn).sort(), ["aws", "package.json", "pharmacy-screen"]);
  assert.ok(!existsSync(join(fn, "pharmacy-screen/config-api/test")));
  assert.ok(!existsSync(join(fn, "pharmacy-screen/ph-proxy/.env.rob-ph-demos")));
  assert.ok(!existsSync(join(fn, "aws/infra")) && !existsSync(join(fn, "aws/test")) && !existsSync(join(fn, "aws/node_modules")));
  const pkg = JSON.parse(readFileSync(join(fn, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ["@aws-sdk/client-dynamodb", "@aws-sdk/client-kms", "@aws-sdk/client-s3"]);
  // The staged entries load from their staged paths (the SDK is only required when a client is made).
  for (const entry of ["config-api", "ph-proxy"]) {
    const mod = require(join(fn, "aws", "lambda", `${entry}.js`));
    assert.equal(typeof mod.handler, "function", entry);
  }
});

test("deploy: discovery fills the provider's endpoints into every later CDK command, and checks the issuer", async () => {
  const plan = buildPlan(parseArgs(["--region", "eu-west-2", "--oidc-issuer", "https://login.example.com", "--oidc-client-id", "c1"]));
  const state = { params: plan.params, steps: plan.steps, outputs: plan.outputs };
  const realFetch = globalThis.fetch;
  let doc = { issuer: "https://login.example.com", authorization_endpoint: "https://login.example.com/oauth2/authorize", token_endpoint: "https://login.example.com/oauth2/token", end_session_endpoint: "https://login.example.com/logout", jwks_uri: "https://login.example.com/keys" };
  globalThis.fetch = async (url) => {
    assert.equal(url, "https://login.example.com/.well-known/openid-configuration");
    return { ok: true, status: 200, json: async () => doc };
  };
  try {
    await makeTasks(state).discoverOidc();
    const deploy = state.steps.find((s) => s.phase === "deploy").cmd.join(" ");
    for (const kv of ["oidcAuthorizeUrl=https://login.example.com/oauth2/authorize", "oidcTokenUrl=https://login.example.com/oauth2/token", "oidcLogoutUrl=https://login.example.com/logout", "oidcJwksUri=https://login.example.com/keys", "adminClaim=groups"]) {
      assert.ok(deploy.includes(kv), kv);
    }
    assert.ok(deploy.includes("--outputs-file"), "the rest of the command is kept");
    doc = { ...doc, issuer: "https://evil.example.com" };
    await assert.rejects(makeTasks({ ...state, params: plan.params }).discoverOidc(), /issuer is https:\/\/evil/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
