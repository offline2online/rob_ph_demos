'use strict';
// Every finished generation is written to the output folder with a JSON
// sidecar holding exactly what made it (prompt, provider, model, settings),
// so any asset on the website can be traced back and regenerated.
//   output/2026-11/2026-11-04-blog-hero-retail-screens-a1b2c3.png
//   output/2026-11/2026-11-04-blog-hero-retail-screens-a1b2c3.json

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  .split('-').slice(0, 6).join('-').slice(0, 48) || 'untitled';

function createLibrary(outputDir) {
  const ensureDir = (dir) => fs.mkdirSync(dir, { recursive: true });

  function save({ kind, provider, model, prompt, originalPrompt, params, text, files, source }) {
    const now = new Date();
    const id = crypto.randomBytes(4).toString('hex');
    const month = now.toISOString().slice(0, 7);
    const base = `${now.toISOString().slice(0, 10)}-${params?.preset ? `${params.preset}-` : ''}${slugify(originalPrompt || prompt)}-${id}`;
    const dir = path.join(outputDir, month);
    ensureDir(dir);
    const saved = files.map((f, i) => {
      const ext = EXT[f.mimeType] || (kind === 'video' ? 'mp4' : 'png');
      const name = `${base}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`;
      fs.writeFileSync(path.join(dir, name), f.buffer);
      return { path: `${month}/${name}`, mimeType: f.mimeType, bytes: f.buffer.length };
    });
    const item = {
      id,
      kind,
      provider,
      model,
      prompt: originalPrompt || prompt,
      fullPrompt: prompt,
      params: params || {},
      text: text || undefined,
      source: source || undefined,
      files: saved,
      createdAt: now.toISOString(),
      published: [],
    };
    fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(item, null, 2));
    return { ...item, metaPath: `${month}/${base}.json` };
  }

  function* sidecars() {
    let months = [];
    try { months = fs.readdirSync(outputDir).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort().reverse(); } catch { return; }
    for (const m of months) {
      for (const f of fs.readdirSync(path.join(outputDir, m)).filter((x) => x.endsWith('.json')).sort().reverse()) {
        yield `${m}/${f}`;
      }
    }
  }

  function read(metaPath) {
    try { return { ...JSON.parse(fs.readFileSync(path.join(outputDir, metaPath), 'utf8')), metaPath }; } catch { return null; }
  }

  function list({ kind, limit = 100 } = {}) {
    const items = [];
    for (const p of sidecars()) {
      const item = read(p);
      if (!item || (kind && item.kind !== kind)) continue;
      items.push(item);
    }
    items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return items.slice(0, limit);
  }

  function get(id) {
    for (const p of sidecars()) if (p.endsWith(`-${id}.json`)) return read(p);
    return null;
  }

  function update(item, patch) {
    const next = { ...item, ...patch };
    const { metaPath, ...stored } = next;
    fs.writeFileSync(path.join(outputDir, metaPath), JSON.stringify(stored, null, 2));
    return next;
  }

  // Resolve a library-relative path without letting "../" escape the folder.
  function resolveFile(rel) {
    const full = path.resolve(outputDir, String(rel).replace(/^\/+/, ''));
    if (full !== outputDir && !full.startsWith(outputDir + path.sep)) return null;
    return full;
  }

  return { outputDir, save, list, get, update, resolveFile };
}

module.exports = { createLibrary, slugify, EXT };
