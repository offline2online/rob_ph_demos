#!/usr/bin/env node
"use strict";

// Load the launch data (five pharmacies, the default promotions, the service
// library) into an AWS deployment, through the same seedConfig() as the
// Firebase seed (../../pharmacy-screen/seed/seed.js), so it gets the same
// validation, published screen config and audit log as an edit in the admin
// editor. Idempotent; --reset puts seeded records back to the fixtures.
//
//   npm run seed:aws -- --region <region> [--stack-name <name>] [--reset]
//
// The table, media bucket and site URL are read from the stack's outputs.
// Credentials: the standard AWS chain, with read/write on that table and bucket.

const { seedConfig, summarise } = require("../../pharmacy-screen/seed/seed");
const { createDynamoStore } = require("../adapters/dynamodb-store");
const { createS3Blobs } = require("../adapters/s3-blobs");
const { STORE_ROOT } = require("../infra/constants");

function parseArgs(argv) {
  const opts = { reset: false, stackName: "PharmacyScreen", region: process.env.AWS_REGION || "", profile: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v || v.startsWith("--")) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--reset") opts.reset = true;
    else if (a === "--region") opts.region = next();
    else if (a === "--stack-name") opts.stackName = next();
    else if (a === "--profile") opts.profile = next();
    else if (a === "--help" || a === "-h") opts.help = true;
    else throw new Error(`Unknown option ${a}`);
  }
  return opts;
}

async function stackOutputs(stackName, region) {
  const { CloudFormationClient, DescribeStacksCommand } = require("@aws-sdk/client-cloudformation");
  const out = await new CloudFormationClient({ region }).send(new DescribeStacksCommand({ StackName: stackName }));
  return Object.fromEntries((out.Stacks[0].Outputs || []).map((o) => [o.OutputKey, o.OutputValue]));
}

async function main(argv) {
  const opts = parseArgs(argv);
  if (opts.help) {
    console.log("Usage: npm run seed:aws -- --region <region> [--stack-name <name>] [--reset] [--profile <name>]");
    return;
  }
  if (!opts.region) throw new Error("--region is required (or set AWS_REGION)");
  if (opts.profile) process.env.AWS_PROFILE = opts.profile;
  const o = await stackOutputs(opts.stackName, opts.region);
  const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
  const { S3Client } = require("@aws-sdk/client-s3");
  const store = createDynamoStore({ client: new DynamoDBClient({ region: opts.region }), table: o.TableName, root: STORE_ROOT });
  const blobs = createS3Blobs({ client: new S3Client({ region: opts.region }), bucket: o.MediaBucket, publicBaseUrl: o.SiteUrl });
  console.log(`Seeding stack ${opts.stackName} in ${opts.region} (table ${o.TableName}, bucket ${o.MediaBucket})`);
  const report = await seedConfig({ store, blobs, reset: opts.reset, log: (level, msg) => console.error(`[${level}] ${msg}`) });
  console.log(summarise(report));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Seed failed: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, main };
