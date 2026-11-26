#!/usr/bin/env node
// One-command install and teardown of the Pharmacy Screen Promo Template in
// the retailer's own AWS account (miPharmacy's environment), from a clean
// checkout. The AWS counterpart of ../../scripts/deploy.mjs (our Firebase test
// environment).
//
//   cd pharmacy-screen-promo-template
//   npm run deploy:aws  -- --region ap-southeast-2 [options]
//   npm run destroy:aws -- --region ap-southeast-2 [--stack-name …]
//
// deploy runs, in order:
//   1. install    npm ci in aws/ (CDK, the AWS SDK)
//   2. stage      .deploy-aws/site   the screen and admin files, by the same allow-list as the
//                                    Firebase deploy (PUBLIC_ENTRIES), with the service worker stamped
//                 .deploy-aws/lambda the two back ends' src/, the AWS adapters and Lambda entries,
//                                    with their production dependencies
//   3. discover   with --oidc-issuer: read the provider's endpoints from its discovery document
//   4. bootstrap  cdk bootstrap (once per account and region; does nothing if already done)
//   5. deploy     cdk deploy of the one stack (infra/stack.js); outputs saved to
//                 .deploy-aws/<stack>.outputs.json
//   6. admin      with --admin-email (Cognito only): create that user (Cognito emails a temporary
//                 password) and put it in the admin group
//   7. print      the URLs and what to do next
//
// destroy deletes the stack (everything in it, unless it was deployed with
// --retain-data) and the Lambda log groups CloudFormation leaves behind.
//
// Credentials: the standard AWS chain (AWS_PROFILE / --profile, SSO, env vars,
// an instance role), for an identity that may create the stack's resources
// (AdministratorAccess on a fresh account, or the CDK bootstrap roles).
// Nothing here reads, writes or prints the PH API token: an admin enters it in
// Admin → Settings after the first deploy.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { PUBLIC_SOURCE, PUBLIC_ENTRIES, STAGE_SKIP, stampServiceWorker } from "../../scripts/deploy.mjs";

const require = createRequire(import.meta.url);
const { PARAMS, normaliseParams } = require("../infra/params.js");

export const AWS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = join(AWS_DIR, "..");
export const STAGE_DIR = join(ROOT, ".deploy-aws");

// Function code, by allow-list, at the same relative paths as in the repo, so
// the Lambda entries' require("../../pharmacy-screen/…") resolve unchanged.
export const LAMBDA_ENTRIES = [
  "pharmacy-screen/config-api/src",
  "pharmacy-screen/ph-proxy/src",
  "aws/adapters",
  "aws/lambda",
];

// Download MP4's worker (aws/lambda/video-worker.js), staged on its own: its Chromium and ffmpeg are Linux x86_64
// binaries (the other functions are arm64 and need neither), installed for that platform whatever this machine is.
export const VIDEO_LAMBDA_ENTRIES = [
  "pharmacy-screen/config-api/src",
  "aws/adapters",
  "aws/lambda",
];
export const VIDEO_LAMBDA_DEPENDENCIES = {
  "@aws-sdk/client-dynamodb": "3.1161.0",
  "@aws-sdk/client-s3": "3.1161.0",
  "@aws-sdk/s3-request-presigner": "3.1161.0",
  "@sparticuz/chromium": "153.0.0",
  "ffmpeg-static": "5.3.0",
  "playwright-core": "1.64.1",
};
export const VIDEO_LAMBDA_INSTALL_ENV = { npm_config_platform: "linux", npm_config_arch: "x64", npm_config_os: "linux", npm_config_cpu: "x64" };

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const OPTION_KEYS = new Map(PARAMS.filter(([k]) => k !== "siteAsset" && k !== "lambdaAsset" && k !== "videoLambdaAsset").map(([k]) => [kebab(k), k]));
const FLAGS = new Set(["vpcEndpoints", "retainData"]);

export function parseArgs(argv) {
  const opts = { command: "deploy", params: {}, adminEmail: "", profile: "", dryRun: false, help: false };
  const args = argv.slice();
  if (args[0] && !args[0].startsWith("-")) opts.command = args.shift();
  if (!["deploy", "destroy", "synth"].includes(opts.command)) throw new Error(`Unknown command ${opts.command} (deploy, destroy or synth)`);
  for (let i = 0; i < args.length; i++) {
    let a = args[i];
    let value;
    const eq = a.indexOf("=");
    if (a.startsWith("--") && eq > 0) {
      value = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    const name = a.replace(/^--/, "");
    const next = () => {
      if (value !== undefined) return value;
      const v = args[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--profile") opts.profile = next();
    else if (a === "--admin-email") opts.adminEmail = next();
    else if (OPTION_KEYS.has(name)) {
      const key = OPTION_KEYS.get(name);
      opts.params[key] = FLAGS.has(key) ? (value === undefined ? "true" : value) : next();
    } else throw new Error(`Unknown option ${a}`);
  }
  if (!opts.params.region && process.env.AWS_REGION) opts.params.region = process.env.AWS_REGION;
  return opts;
}

export function usage() {
  const rows = PARAMS.filter(([k]) => OPTION_KEYS.has(kebab(k))).map(([k, d]) => `  --${kebab(k)}${FLAGS.has(k) ? "" : " <value>"}\n      ${d}`);
  return [
    "Usage: npm run deploy:aws -- --region <region> [options]",
    "       npm run destroy:aws -- --region <region> [--stack-name <name>]",
    "",
    "Options:",
    ...rows,
    "  --admin-email <address>\n      Cognito only: create this admin user (a temporary password is emailed) and add it to the admin group",
    "  --profile <name>\n      AWS named profile",
    "  --dry-run\n      print every step without running anything",
  ].join("\n");
}

// -c key=value pairs for cdk, in a fixed order.
export function contextArgs(params) {
  const out = [];
  for (const [k] of PARAMS) {
    const v = params[k];
    if (v === undefined || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
    out.push("-c", `${k}=${Array.isArray(v) ? v.join(",") : v}`);
  }
  return out;
}

export function stageSite(out = join(STAGE_DIR, "site")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of PUBLIC_ENTRIES) {
    const from = join(ROOT, PUBLIC_SOURCE, entry);
    cpSync(from, join(out, entry), { recursive: true, filter: (src) => src === from || !STAGE_SKIP.test(src.slice(from.length)) });
  }
  // The screen's service worker gets the same build id as on Firebase (a hash of the page, js/ and css/), so a
  // player downloads the shell again only when it changed.
  stampServiceWorker(out);
  return out;
}

const LAMBDA_SKIP = /(^|[\\/])(\.[^\\/]*|node_modules|test|README\.md)$/;

export function stageVideoLambda(out = join(STAGE_DIR, "video-lambda")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of VIDEO_LAMBDA_ENTRIES) {
    const from = join(ROOT, entry);
    cpSync(from, join(out, entry), { recursive: true, filter: (src) => src === from || !LAMBDA_SKIP.test(src.slice(from.length)) });
  }
  writeFileSync(join(out, "package.json"), JSON.stringify({ name: "pharmacy-screen-aws-video-worker", private: true, dependencies: VIDEO_LAMBDA_DEPENDENCIES }, null, 2) + "\n");
  return out;
}

export function stageLambda(out = join(STAGE_DIR, "lambda")) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of LAMBDA_ENTRIES) {
    const from = join(ROOT, entry);
    cpSync(from, join(out, entry), { recursive: true, filter: (src) => src === from || !LAMBDA_SKIP.test(src.slice(from.length)) });
  }
  const pkg = JSON.parse(readFileSync(join(AWS_DIR, "package.json"), "utf8"));
  writeFileSync(join(out, "package.json"), JSON.stringify({ name: "pharmacy-screen-aws-functions", private: true, dependencies: pkg.dependencies }, null, 2) + "\n");
  return out;
}

const CDK = ["npx", "--no-install", "cdk"];
const APP = ["--app", "node infra/app.js"];

// The whole run as data, so --dry-run and the tests see exactly what runs.
export function buildPlan(opts) {
  const p = { ...opts.params, siteAsset: join(STAGE_DIR, "site"), lambdaAsset: join(STAGE_DIR, "lambda"), videoLambdaAsset: join(STAGE_DIR, "video-lambda") };
  const { params, errors } = normaliseParams(p, { endpointsLater: true });
  if (!params.region) errors.unshift("--region is required (or set AWS_REGION)");
  if (opts.adminEmail && params.oidcIssuer) errors.push("--admin-email creates a Cognito user; with --oidc-issuer, give the admin role in your identity provider instead");
  if (errors.length) throw new Error(`Invalid options:\n  ${errors.join("\n  ")}`);
  const ctx = contextArgs(params);
  const outputs = join(STAGE_DIR, `${params.stackName}.outputs.json`);
  const steps = [];
  if (opts.command === "destroy") {
    steps.push({ phase: "install", kind: "run", label: "Install the CDK in aws/", cmd: ["npm", "ci", "--no-audit", "--no-fund"] });
    steps.push({ phase: "stage", kind: "task", task: "stageEmpty", label: "Stage placeholders for the stack's assets (nothing is uploaded)", args: {} });
    steps.push({ phase: "destroy", kind: "task", task: "readStack", label: `Read stack ${params.stackName}`, args: { stackName: params.stackName, region: params.region } });
    steps.push({ phase: "destroy", kind: "run", label: `Delete stack ${params.stackName} and everything in it`, cmd: [...CDK, "destroy", params.stackName, "--force", ...APP, ...contextArgs({ stackName: params.stackName, region: params.region, siteAsset: p.siteAsset, lambdaAsset: p.lambdaAsset, videoLambdaAsset: p.videoLambdaAsset })] });
    steps.push({ phase: "destroy", kind: "task", task: "deleteLeftoverLogs", label: `Delete the log groups /aws/lambda/${params.stackName}-* left behind`, args: { stackName: params.stackName, region: params.region } });
    return { params, steps, outputs };
  }
  steps.push({ phase: "install", kind: "run", label: "Install the CDK and AWS SDK in aws/", cmd: ["npm", "ci", "--no-audit", "--no-fund"] });
  steps.push({ phase: "stage", kind: "task", task: "stageSite", label: "Stage the screen and admin files in .deploy-aws/site", args: {} });
  steps.push({ phase: "stage", kind: "task", task: "stageLambda", label: "Stage the function code in .deploy-aws/lambda", args: {} });
  steps.push({ phase: "stage", kind: "run", label: "Install the functions' production dependencies", cmd: ["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", "--prefix", join(STAGE_DIR, "lambda")] });
  steps.push({ phase: "stage", kind: "task", task: "stageVideoLambda", label: "Stage the Download MP4 worker in .deploy-aws/video-lambda", args: {} });
  steps.push({ phase: "stage", kind: "run", label: "Install the Download MP4 worker's dependencies (Chromium and ffmpeg for Linux x86_64)", env: VIDEO_LAMBDA_INSTALL_ENV, cmd: ["npm", "install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock", "--prefix", join(STAGE_DIR, "video-lambda")] });
  if (params.oidcIssuer && !(params.oidcAuthorizeUrl && params.oidcTokenUrl)) {
    steps.push({ phase: "discover", kind: "task", task: "discoverOidc", label: `Read ${params.oidcIssuer}/.well-known/openid-configuration`, args: {} });
  }
  steps.push({ phase: "bootstrap", kind: "run", label: "CDK bootstrap (once per account and region)", cmd: [...CDK, "bootstrap", ...APP, ...ctx] });
  if (opts.command === "synth") {
    steps.push({ phase: "deploy", kind: "run", label: "Synthesize the CloudFormation template (cdk.out/)", cmd: [...CDK, "synth", params.stackName, ...APP, ...ctx] });
    return { params, steps: steps.filter((s) => s.phase !== "bootstrap"), outputs };
  }
  steps.push({ phase: "deploy", kind: "run", label: `Deploy stack ${params.stackName}`, cmd: [...CDK, "deploy", params.stackName, "--require-approval", "never", "--outputs-file", outputs, ...APP, ...ctx] });
  if (opts.adminEmail) {
    steps.push({ phase: "admin", kind: "task", task: "firstAdmin", label: `Admin user ${opts.adminEmail}`, args: { email: opts.adminEmail, group: params.adminValue } });
  }
  return { params, steps, outputs };
}

// ── execution ──────────────────────────────────────────────────────────────

function run(cmd, env) {
  const r = spawnSync(cmd[0], cmd.slice(1), { cwd: AWS_DIR, stdio: "inherit", env });
  return r.status === 0;
}

function readOutputs(file, stackName) {
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8"))[stackName] || {};
}

export function makeTasks(state) {
  return {
    async stageSite() {
      return `staged ${relative(ROOT, stageSite())}`;
    },
    async stageVideoLambda() {
      return `staged ${relative(ROOT, stageVideoLambda())}`;
    },
    async stageLambda() {
      return `staged ${relative(ROOT, stageLambda())}`;
    },
    async stageEmpty() {
      for (const d of ["site", "lambda", "video-lambda"]) mkdirSync(join(STAGE_DIR, d), { recursive: true });
      return "ok";
    },
    async discoverOidc() {
      const p = state.params;
      const res = await fetch(`${p.oidcIssuer}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`the issuer's discovery document returned ${res.status}`);
      const doc = await res.json();
      if (String(doc.issuer || "").replace(/\/+$/, "") !== p.oidcIssuer) throw new Error(`discovery says the issuer is ${doc.issuer}, not ${p.oidcIssuer}`);
      p.oidcAuthorizeUrl = p.oidcAuthorizeUrl || doc.authorization_endpoint;
      p.oidcTokenUrl = p.oidcTokenUrl || doc.token_endpoint;
      p.oidcLogoutUrl = p.oidcLogoutUrl || doc.end_session_endpoint || "";
      p.oidcJwksUri = p.oidcJwksUri || doc.jwks_uri || "";
      const { params, errors } = normaliseParams(p);
      if (errors.length) throw new Error(errors.join("; "));
      state.params = params;
      // Later steps take the endpoints as context too.
      for (const s of state.steps) if (s.kind === "run" && s.cmd.includes("--app")) s.cmd = [...s.cmd.slice(0, s.cmd.indexOf("--app") + 2), ...contextArgs(params)];
      return `authorize ${p.oidcAuthorizeUrl}, token ${p.oidcTokenUrl}${p.oidcLogoutUrl ? `, logout ${p.oidcLogoutUrl}` : ""}`;
    },
    async readStack({ stackName, region }) {
      const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
      try {
        const out = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }));
        const outputs = Object.fromEntries((out.Stacks[0].Outputs || []).map((o) => [o.OutputKey, o.OutputValue]));
        state.retainData = outputs.RetainData === "true";
        return state.retainData ? "deployed with --retain-data: the table, media bucket, KMS key and user pool are kept" : "everything in it will be deleted";
      } catch (e) {
        if (/does not exist/.test(e.message)) {
          state.retainData = false;
          return "not deployed (nothing to delete in CloudFormation)";
        }
        throw e;
      }
    },
    async deleteLeftoverLogs({ stackName, region }) {
      if (state.retainData) return "kept (the stack was deployed with --retain-data)";
      const { CloudWatchLogsClient, DescribeLogGroupsCommand, DeleteLogGroupCommand } = require("@aws-sdk/client-cloudwatch-logs");
      const logs = new CloudWatchLogsClient({ region });
      const names = [];
      let nextToken;
      do {
        const out = await logs.send(new DescribeLogGroupsCommand({ logGroupNamePrefix: `/aws/lambda/${stackName}-`, nextToken }));
        names.push(...(out.logGroups || []).map((g) => g.logGroupName));
        nextToken = out.nextToken;
      } while (nextToken);
      for (const logGroupName of names) await logs.send(new DeleteLogGroupCommand({ logGroupName }));
      return names.length ? `deleted ${names.length}` : "none left";
    },
    async firstAdmin({ email, group }) {
      const o = readOutputs(state.outputs, state.params.stackName);
      if (!o.UserPoolId) throw new Error("the stack has no Cognito user pool (deployed with --oidc-issuer?)");
      const C = require("@aws-sdk/client-cognito-identity-provider");
      const idp = new C.CognitoIdentityProviderClient({ region: state.params.region });
      let made = false;
      try {
        await idp.send(new C.AdminGetUserCommand({ UserPoolId: o.UserPoolId, Username: email }));
      } catch (e) {
        if (e.name !== "UserNotFoundException") throw e;
        await idp.send(new C.AdminCreateUserCommand({
          UserPoolId: o.UserPoolId,
          Username: email,
          UserAttributes: [{ Name: "email", Value: email }, { Name: "email_verified", Value: "true" }],
          DesiredDeliveryMediums: ["EMAIL"],
        }));
        made = true;
      }
      await idp.send(new C.AdminAddUserToGroupCommand({ UserPoolId: o.UserPoolId, Username: email, GroupName: group }));
      return `${made ? "created (temporary password emailed)" : "already exists"}; in group ${group}`;
    },
  };
}

function show(cmd) {
  return cmd.map((a) => (/[\s"'$]/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(usage());
    return;
  }
  const plan = buildPlan(opts);
  const state = { params: plan.params, steps: plan.steps, outputs: plan.outputs, retainData: false };
  const tasks = makeTasks(state);
  const env = { ...process.env, AWS_REGION: plan.params.region, CDK_DEFAULT_REGION: plan.params.region };
  if (opts.profile) env.AWS_PROFILE = opts.profile;
  if (opts.profile) process.env.AWS_PROFILE = opts.profile;
  mkdirSync(STAGE_DIR, { recursive: true });
  console.log(`Pharmacy Screen → AWS ${plan.params.region}, stack ${plan.params.stackName} (${opts.command})${opts.dryRun ? " — dry run" : ""}`);

  for (const step of plan.steps) {
    console.log(`\n▸ [${step.phase}] ${step.label}`);
    if (opts.dryRun) {
      console.log(step.kind === "task" ? `   task:   ${step.task} ${JSON.stringify(step.args)}` : `   ${show(step.cmd)}`);
      continue;
    }
    if (step.kind === "task") console.log(`   ${await tasks[step.task](step.args)}`);
    else if (!run(step.cmd, step.env ? { ...env, ...step.env } : env)) throw new Error(`Failed: ${step.label}`);
  }

  if (opts.command === "destroy") {
    console.log(`\nStack ${plan.params.stackName} ${opts.dryRun ? "would be" : "is"} deleted.${state.retainData ? " Data resources were kept (--retain-data)." : ""}
The KMS key is scheduled for deletion after 7 days (KMS's minimum). The CDK bootstrap stack (CDKToolkit) is shared by every CDK app in the account and region and is left in place.`);
    return;
  }
  if (opts.command === "synth" || opts.dryRun) {
    console.log(`\n${opts.dryRun ? "Dry run: nothing was changed." : "Template written to aws/cdk.out/."}`);
    return;
  }
  const o = readOutputs(plan.outputs, plan.params.stackName);
  const cognitoNote = o.UserPoolId
    ? `1. Admin sign-in is the Cognito user pool ${o.UserPoolId}. ${opts.adminEmail ? `Sign in as ${opts.adminEmail} with the emailed temporary password.` : `Create an admin: rerun with --admin-email <address>, or add a user to the group "${plan.params.adminValue}" in the Cognito console.`}`
    : `1. Admin sign-in is ${o.OidcIssuer}: give admins the claim ${o.AdminClaim} there, and add ${o.AdminUrl} as a redirect URI of client ${o.AdminClientId}.`;
  console.log(`
Pharmacy Screen is deployed to AWS ${plan.params.region} (stack ${plan.params.stackName}):
  Admin      ${o.AdminUrl}
  Screen     ${o.ScreenUrl}
  Campaign   ${o.CampaignUrlTemplate}
  API        ${o.ApiUrl}   (health: ${o.HealthUrl})
  CloudFront ${o.DistributionId} (${o.DistributionDomain})${plan.params.domainName && !plan.params.hostedZoneId ? `\n  DNS        point ${plan.params.domainName} at ${o.DistributionDomain} (CNAME or alias)` : ""}
  Data       DynamoDB ${o.TableName}, S3 ${o.MediaBucket}, KMS ${o.TokenKeyArn}
  Outputs    ${relative(ROOT, plan.outputs)}
Next:
${cognitoNote}
2. Admin → Settings: enter the PH API token (write-only; KMS envelope-encrypted).
3. Load the launch data once: npm run seed:aws -- --region ${plan.params.region}${plan.params.stackName !== "PharmacyScreen" ? ` --stack-name ${plan.params.stackName}` : ""}
Tear down: npm run destroy:aws -- --region ${plan.params.region}${plan.params.stackName !== "PharmacyScreen" ? ` --stack-name ${plan.params.stackName}` : ""}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(`\n✖ ${err.message}`);
    process.exit(1);
  });
}
