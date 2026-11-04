'use strict';
// Upload a finished asset straight into a WordPress media library
// (personalisationhub.com, offline2online.com…) over the core REST API:
//   POST {site}/wp-json/wp/v2/media   (raw bytes, Content-Disposition filename)
//   POST {site}/wp-json/wp/v2/media/{id}  { alt_text, caption, title }
// Auth is a WordPress Application Password (user profile → Application
// Passwords) sent as HTTP Basic. WP_AUTH may be "user:password" or its base64.

const { errorFromResponse } = require('./providers/common');

function basicAuth(auth) {
  const a = String(auth || '').trim();
  if (!a) return '';
  return a.includes(':') ? Buffer.from(a.replace(/\s+(?=[^:]*$)/g, '')).toString('base64') : a;
}

const isConfigured = (config) => Boolean(config.wordpress.siteUrl && config.wordpress.auth);

async function uploadToWordPress({ config, fetch: fetchImpl, buffer, filename, mimeType, title, altText, caption }) {
  if (!isConfigured(config)) {
    const err = new Error('WordPress is not configured: set WP_SITE_URL and WP_AUTH');
    err.status = 400;
    throw err;
  }
  const { siteUrl } = config.wordpress;
  const headers = { Authorization: `Basic ${basicAuth(config.wordpress.auth)}` };
  const up = await fetchImpl(`${siteUrl}/wp-json/wp/v2/media`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': mimeType, 'Content-Disposition': `attachment; filename="${filename.replace(/"/g, '')}"` },
    body: buffer,
  });
  if (!up.ok) throw await errorFromResponse(up, 'WordPress');
  let media = await up.json();
  const meta = {};
  if (altText) meta.alt_text = altText;
  if (caption) meta.caption = caption;
  if (title) meta.title = title;
  if (Object.keys(meta).length) {
    const upd = await fetchImpl(`${siteUrl}/wp-json/wp/v2/media/${media.id}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(meta),
    });
    if (upd.ok) media = await upd.json();
  }
  return { site: siteUrl, id: media.id, url: media.source_url, link: media.link, at: new Date().toISOString() };
}

module.exports = { uploadToWordPress, isConfigured, basicAuth };
