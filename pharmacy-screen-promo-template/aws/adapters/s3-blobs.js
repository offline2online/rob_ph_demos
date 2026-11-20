"use strict";

// S3 media store for the AWS deployment: logos and template backgrounds.
// Same contract as config-api/src/adapters/blobs.js:
//
//   blobs.put(path, buffer, contentType) -> { path, url }
//   blobs.delete(path)                   -> undefined (missing is fine)
//
// The bucket is private (no public access, no ACLs). CloudFront serves
// pharmacyScreen/media/* from it through Origin Access Control, on the same
// domain as the screen and the admin editor, so `url` is
// <publicBaseUrl>/<path>. Objects are named by content hash (service.js), so
// they are cached as immutable.

function createS3Blobs({ client, commands, bucket, publicBaseUrl } = {}) {
  if (!client || !bucket || !publicBaseUrl) throw new Error("s3-blobs: client, bucket and publicBaseUrl are required");
  const C = commands || require("@aws-sdk/client-s3");
  const base = String(publicBaseUrl).replace(/\/+$/, "");
  const urlOf = (path) => `${base}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
  return {
    kind: "s3",
    put: async (path, buffer, contentType) => {
      await client.send(new C.PutObjectCommand({
        Bucket: bucket,
        Key: path,
        Body: Buffer.from(buffer),
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }));
      return { path, url: urlOf(path) };
    },
    delete: async (path) => {
      // S3 DeleteObject succeeds for a missing key.
      await client.send(new C.DeleteObjectCommand({ Bucket: bucket, Key: path }));
    },
  };
}

module.exports = { createS3Blobs };
