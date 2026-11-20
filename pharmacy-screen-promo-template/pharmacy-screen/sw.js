// Keeps the pharmacy screen on the device, so a player that restarts, or starts with no network, still plays it, and
// re-downloads it only when a deploy has changed it.
//
// Registered by js/player.js with scope pharmacy-screen.html only, so the admin editor is never touched.
//
//   The shell (the page, its scripts and stylesheets, which carry the self-hosted fonts, icons and the Seasonal Christmas photo, about 1.5 MB) is
//   downloaded once into a cache named after BUILD and served from that cache from then on, with no request at all.
//   scripts/deploy.mjs stamps BUILD with a hash of the shell's files, so this file's bytes change exactly when the
//   shell changes. The browser compares sw.js on every page load and the player asks again every 30 minutes
//   (UPDATE_CHECK_MS in player.js): one small request, answered 304 while nothing has changed. When it has changed,
//   the new worker downloads the new shell, takes over, the old cache is deleted and the player reloads itself once.
//   Images are kept after their first download. Our own logos and backgrounds carry their content's hash in the
//   URL, so they are never asked for again. Any other image (a logo URL from PH, which can be replaced in place) is
//   shown from the device's copy at once and checked in the background, so a new one shows on the next play.
//   The data (/api/**) is never cached here: js/live-data.js polls it and keeps the last good copy in localStorage.
//   The seed fixtures (mockapi=1) are fetched from the network first, with the last copy as a fallback.
//
// Unstamped (BUILD still the placeholder: tools/serve.mjs, the tests), the shell is fetched from the network first,
// so a local edit shows on the next reload, and the cached copy is only the offline fallback.
const BUILD = '__PHARMACY_SCREEN_BUILD__';
const DEV = BUILD.startsWith('__');
const SHELL_CACHE = 'pharmacy-screen-shell-' + (DEV ? 'dev' : BUILD);
const MEDIA_CACHE = 'pharmacy-screen-media';
const FIXTURE_CACHE = 'pharmacy-screen-fixtures';
// A screen shows one logo and a background or two. Kept small because an image from a host that does not allow
// cross-origin reads is stored opaque, which browsers count as several megabytes of quota each.
const MEDIA_MAX = 40;
// Our media's URLs end in the content's SHA-256 (config-api/src/service.js): the same URL is always the same image.
const IMMUTABLE_URL = /[0-9a-f]{64}/i;

// Everything the page needs to start, relative to this file. test/offline-cache.test.mjs checks it lists every file
// in js/ and css/, so a new module can't be left out.
const SHELL = [
  'pharmacy-screen.html',
  'css/fonts.css',
  'css/material-symbols.css',
  'css/occasion-fonts.css',
  'css/occasion-media.css',
  'css/screen.css',
  'css/debug.css',
  'js/player.js',
  'js/render.js',
  'js/hours.js',
  'js/fit-text.js',
  'js/live-data.js',
  'js/tokens.js',
  'js/occasions.js',
  'js/debug-panel.js',
];
const shellUrls = new Set(SHELL.map((p) => new URL(p, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    if (!DEV) {
      const cache = await caches.open(SHELL_CACHE);
      // cache: 'reload' skips the HTTP cache, so the new build is never filled from a stale copy.
      await cache.addAll(SHELL.map((p) => new Request(p, { cache: 'reload' })));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('pharmacy-screen-shell-') && name !== SHELL_CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!/^https?:$/.test(url.protocol)) return;
  const sameOrigin = url.origin === self.location.origin;
  // The live data and the admin editor always go straight to the network.
  if (sameOrigin && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin/'))) return;

  const key = url.origin + url.pathname; // the campaign URL's query (device, promo) doesn't change the page
  if (sameOrigin && shellUrls.has(key)) {
    event.respondWith(DEV ? networkFirst(req, key, SHELL_CACHE) : cacheFirst(req, key, SHELL_CACHE));
  } else if (sameOrigin && url.pathname.includes('/fixtures/')) {
    event.respondWith(networkFirst(req, key, FIXTURE_CACHE));
  } else if (req.destination === 'image') {
    event.respondWith(image(event, req));
  }
});

async function cacheFirst(req, key, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(key, res.clone());
  return res;
}

// A readable (CORS) copy where the host allows it, so the cache holds a real response and a failed download is
// never kept; otherwise the browser's own request, kept only if it did not fail visibly.
async function fetchImage(req) {
  if (new URL(req.url).origin !== self.location.origin) {
    try {
      const res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) return res;
    } catch (err) { /* no cross-origin read allowed: fall through to the page's own request */ }
  }
  return fetch(req);
}

async function image(event, req) {
  const cache = await caches.open(MEDIA_CACHE);
  const hit = await cache.match(req.url);
  const refresh = async () => {
    const res = await fetchImage(req);
    if (res.ok || res.type === 'opaque') {
      await cache.put(req.url, res.clone());
      trim(cache, MEDIA_MAX);
    }
    return res;
  };
  if (!hit) return refresh();
  if (!IMMUTABLE_URL.test(req.url)) event.waitUntil(refresh().catch(() => {}));
  return hit;
}

async function networkFirst(req, key, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
