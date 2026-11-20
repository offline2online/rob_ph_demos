"use strict";

// API Gateway HTTP API (payload format 2.0) <-> the framework-neutral
// handlers both back ends already export:
//   config-api  api.handle({ method, path, headers, query, body: Buffer }) -> { status, headers, body }
//   ph-proxy    handle({ method, path, headers, body: parsed JSON, ip })   -> { status, headers, body }
//
// Requests reach API Gateway through CloudFront, which adds two headers the
// stack configures: `x-origin-verify` (a value only CloudFront and these
// functions know, from Secrets Manager) and `cloudfront-viewer-address` (the
// viewer's address, written by CloudFront itself). The client address used for
// the proxy's per-client rate limit is the viewer address only when the
// request proves it came through CloudFront; a request sent straight to the
// API Gateway URL is keyed by API Gateway's own sourceIp, so a forged header
// can't spread one caller over many rate-limit buckets.

const crypto = require("node:crypto");

function lowerHeaders(h) {
  const out = {};
  for (const [k, v] of Object.entries(h || {})) out[k.toLowerCase()] = v;
  return out;
}

function rawBody(event) {
  if (event.body === undefined || event.body === null || event.body === "") return undefined;
  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

// "203.0.113.7:51234" -> "203.0.113.7"; "2001:db8::1:51234" -> "2001:db8::1"; "[2001:db8::1]:443" -> "2001:db8::1"
function addressOnly(viewer) {
  const s = String(viewer || "").trim();
  if (!s) return "";
  const br = /^\[([^\]]+)\](?::\d+)?$/.exec(s);
  if (br) return br[1];
  const i = s.lastIndexOf(":");
  if (i < 0) return s;
  return s.includes(".") || s.indexOf(":") !== i ? s.slice(0, i) : s;
}

function viaCloudFront(headers, originSecret) {
  return !!originSecret && safeEqual(headers["x-origin-verify"], originSecret);
}

// The address the rate limit counts against (see the header comment).
function clientIp(event, headers, originSecret) {
  const source = (event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp) || "unknown";
  if (!viaCloudFront(headers, originSecret)) return source;
  return addressOnly(headers["cloudfront-viewer-address"]) || source;
}

function fromEvent(event) {
  const http = (event.requestContext && event.requestContext.http) || {};
  const headers = lowerHeaders(event.headers);
  // Never hand the shared secret to the API layer, or let it reach a log line.
  const clean = { ...headers };
  delete clean["x-origin-verify"];
  return {
    method: http.method || "GET",
    path: event.rawPath || http.path || "/",
    headers: clean,
    allHeaders: headers,
    query: { ...(event.queryStringParameters || {}) },
    body: rawBody(event),
  };
}

function toResult(out) {
  const headers = {};
  for (const [k, v] of Object.entries((out && out.headers) || {})) headers[k] = String(v);
  const body = out && out.body !== null && out.body !== undefined ? JSON.stringify(out.body) : "";
  if (body && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) headers["Content-Type"] = "application/json; charset=utf-8";
  return { statusCode: (out && out.status) || 500, headers, body, isBase64Encoded: false };
}

module.exports = { fromEvent, toResult, clientIp, addressOnly, viaCloudFront, lowerHeaders };
