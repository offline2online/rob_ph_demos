"use strict";
// A logger that can never print the PH API token.
//
// Every argument is serialised to text and every known secret (the current
// token, and any token seen since start-up, e.g. the one just replaced) is
// replaced with [REDACTED] before it reaches the underlying logger. Headers
// named x-api-key / authorization are dropped by name as a second guard.
// Code in this module logs ids, URLs and status codes only; this is the
// backstop for an error message or object that unexpectedly carries one.

const SECRET_HEADER = /^(x-api-key|authorization|cookie)$/i;

function createSafeLogger(base = console) {
  const secrets = new Set();
  const scrub = (text) => {
    let out = String(text);
    for (const s of secrets) {
      if (s && s.length >= 4) out = out.split(s).join("[REDACTED]");
    }
    return out;
  };
  const toText = (v) => {
    if (v instanceof Error) return `${v.name}: ${v.message}`;
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, (k, val) => (SECRET_HEADER.test(k) ? "[REDACTED]" : val));
    } catch {
      return String(v);
    }
  };
  const emit = (level) => (...args) => {
    const line = scrub(args.map(toText).join(" "));
    (base[level] || base.log).call(base, line);
  };
  return {
    addSecret(s) {
      if (typeof s === "string" && s.length >= 4) secrets.add(s);
    },
    scrub,
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
  };
}

module.exports = { createSafeLogger };
