"use strict";

// Download MP4's worker on AWS: its own Lambda (x86_64, Chromium and ffmpeg from npm, staged on its own by
// scripts/deploy.mjs into .deploy-aws/video-lambda), invoked asynchronously by the config API with {jobId} and no
// retries. It runs runVideoJob() (pharmacy-screen/config-api/src/video/jobs.js): renders the job's screen page,
// puts the MP4 in the media bucket under exports/ (deleted after a day by the bucket's lifecycle rule, and never
// served by CloudFront, which serves pharmacyScreen/media/* only), and writes a one-hour presigned download link on
// the job.
//
// Environment: PS_TABLE, PS_ROOT, PS_MEDIA_BUCKET.

const { runVideoJob } = require("../../pharmacy-screen/config-api/src/video/jobs");
const { cloudRender, removeFile } = require("../../pharmacy-screen/config-api/src/video/worker");
const { createDynamoStore } = require("../adapters/dynamodb-store");

const LINK_SECONDS = 3600;

async function handler(event, deps = {}) {
  const env = deps.env || process.env;
  const fs = require("node:fs");
  const ddb = deps.dynamodb || new (require("@aws-sdk/client-dynamodb").DynamoDBClient)({});
  const s3sdk = deps.s3sdk || require("@aws-sdk/client-s3");
  const s3 = deps.s3 || new s3sdk.S3Client({});
  const presign = deps.presign || require("@aws-sdk/s3-request-presigner").getSignedUrl;
  const store = createDynamoStore({ client: ddb, table: env.PS_TABLE, root: env.PS_ROOT || "pharmacyScreen" });
  return runVideoJob(String((event && event.jobId) || ""), {
    store,
    render: deps.render || cloudRender(),
    upload: async (job, file, fileName, jobId) => {
      const Key = `exports/${jobId}/${fileName}`;
      await s3.send(new s3sdk.PutObjectCommand({ Bucket: env.PS_MEDIA_BUCKET, Key, Body: fs.readFileSync(file), ContentType: "video/mp4", ContentDisposition: `attachment; filename="${fileName}"` }));
      removeFile(file);
      const url = await presign(s3, new s3sdk.GetObjectCommand({ Bucket: env.PS_MEDIA_BUCKET, Key, ResponseContentDisposition: `attachment; filename="${fileName}"` }), { expiresIn: LINK_SECONDS });
      return { url };
    },
    log: (level, msg) => (level === "error" ? console.error(msg) : console.warn(msg)),
  });
}

module.exports = { handler, LINK_SECONDS };
