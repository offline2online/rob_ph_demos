"use strict";

// Object storage for logos and template backgrounds. Contract:
//
//   blobs.put(path, buffer, contentType) -> { path, url }
//   blobs.delete(path)                   -> undefined (missing is fine)
//
// Every object lives under pharmacyScreen/media/, which the Storage rules
// (rules/storage.rules) make publicly readable and never client-writable.
// Only this back end writes there, with the Admin SDK. An AWS deployment
// adds an S3 adapter with the same two methods.

const MEDIA_PREFIX = "pharmacyScreen/media/";

function createMemoryBlobs({ baseUrl = "http://localhost/media/" } = {}) {
  const objects = new Map();
  return {
    kind: "memory",
    put: async (path, buffer, contentType) => {
      objects.set(path, { buffer: Buffer.from(buffer), contentType });
      return { path, url: baseUrl + path };
    },
    delete: async (path) => {
      objects.delete(path);
    },
    objects,
  };
}

// Cloud Storage via the Admin SDK. The url is the Firebase download URL,
// which is served under the bucket's Storage rules (public read of
// pharmacyScreen/media/**), so no object ACLs or signed URLs are needed.
function createGcsBlobs(bucket) {
  return {
    kind: "gcs",
    put: async (path, buffer, contentType) => {
      await bucket.file(path).save(buffer, {
        resumable: false,
        contentType,
        metadata: { cacheControl: "public, max-age=31536000, immutable" },
      });
      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(path)}?alt=media`;
      return { path, url };
    },
    delete: async (path) => {
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  };
}

module.exports = { MEDIA_PREFIX, createMemoryBlobs, createGcsBlobs };
