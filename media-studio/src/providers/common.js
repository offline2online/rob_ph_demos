'use strict';

class ProviderError extends Error {
  constructor(message, { status, provider, details } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.provider = provider;
    this.details = details;
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error('Cancelled'));
  const t = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
});

// Pull the most useful message out of a provider's error body. Google returns
// {error:{message,status}}, LTX returns {error:{message}} or {message}/{detail}.
async function errorFromResponse(resp, provider) {
  let text = '';
  try { text = await resp.text(); } catch { /* ignore */ }
  let message = text.slice(0, 500);
  try {
    const j = JSON.parse(text);
    message = j?.error?.message || (typeof j?.error === 'string' ? j.error : '') || j?.message
      || (typeof j?.detail === 'string' ? j.detail : JSON.stringify(j?.detail || j)).slice(0, 500);
  } catch { /* not JSON */ }
  return new ProviderError(`${provider} returned HTTP ${resp.status}: ${message || resp.statusText}`, {
    status: resp.status, provider, details: text.slice(0, 2000),
  });
}

async function download(fetchImpl, url, headers, provider) {
  const resp = await fetchImpl(url, { headers, redirect: 'follow' });
  if (!resp.ok) throw await errorFromResponse(resp, `${provider} download`);
  const buffer = Buffer.from(await resp.arrayBuffer());
  const mimeType = (resp.headers.get('content-type') || 'video/mp4').split(';')[0];
  return { buffer, mimeType };
}

module.exports = { ProviderError, sleep, errorFromResponse, download };
