"use strict";

// Adapts the framework-neutral API (src/api.js) to a Node HTTP request /
// response pair: plain `http.createServer` (scripts/dev-server.js) and Cloud
// Functions' onRequest (index.js), which hands over an Express-style request
// whose body is already read into req.rawBody.

const MAX_BODY = 6 * 1024 * 1024;

function readBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return Promise.resolve(req.rawBody);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("body too large"), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toNodeHandler(api) {
  return async (req, res) => {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      res.statusCode = err.tooLarge ? 413 : 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: { code: err.tooLarge ? "too-large" : "bad-request", message: err.message } }));
      return;
    }
    const url = new URL(req.originalUrl || req.url || "/", "http://localhost");
    const query = Object.fromEntries(url.searchParams);
    const out = await api.handle({ method: req.method, path: url.pathname, headers: req.headers, query, body });
    res.statusCode = out.status;
    for (const [k, v] of Object.entries(out.headers || {})) res.setHeader(k, v);
    res.end(out.body === null || out.body === undefined ? "" : JSON.stringify(out.body));
  };
}

module.exports = { toNodeHandler };
