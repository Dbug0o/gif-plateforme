// Neo GIF service worker: network-first for the app shell, never caches Supabase.
const CACHE = 'neogif-v16';
const SHELL = ['./', './index.html', './style.css?v=16', './app.js?v=16', './core.js?v=16', './i18n.js?v=16', './effects.js?v=16', './gifenc.js?v=16',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Only the app shell: never Supabase/CDNs, blob:/data:, videos, GIFs, range requests or non-GET
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('range')) return;
  if (!(req.mode === 'navigate' || /\.(?:js|css|html|webmanifest|png)$/.test(url.pathname) || url.pathname.endsWith('/'))) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  }).catch(async () => (await caches.match(req)) || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())));
});
