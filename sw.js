// Offline support: the game, Three.js and the fonts are cached when the app
// is installed, and served from the cache (then refreshed in the background)
// so it starts with no connection. Music is cached the first time each
// track plays. Bump VERSION when the file list changes.
const VERSION = 'sideways-v3';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/audio.js',
  './src/camera.js',
  './src/car.js',
  './src/carModel.js',
  './src/country.js',
  './src/career.js',
  './src/drone.js',
  './src/gates.js',
  './src/ghost.js',
  './src/hazards.js',
  './src/input.js',
  './src/leaderboard.js',
  './src/loftcar.js',
  './src/main.js',
  './src/menus.js',
  './src/minimap.js',
  './src/paceicons.js',
  './src/pacenotes.js',
  './src/particles.js',
  './src/podium.js',
  './src/retro.js',
  './src/rng.js',
  './src/scenery.js',
  './src/school.js',
  './src/stagegen.js',
  './src/stats.js',
  './src/street.js',
  './src/surfaces.js',
  './src/terrain.js',
  './src/themes.js',
  './src/track.js',
  './src/trackside.js',
  './src/tyremarks.js',
  './src/weather.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
  'https://fonts.googleapis.com/css2?family=Bungee&family=Chakra+Petch:wght@400;600;700&display=swap',
];
const CDN = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // One missing file shouldn't stop the rest being cached.
    await Promise.all(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Audio asks for byte ranges: answer them from the whole cached file.
async function rangeFrom(res, range) {
  const buf = await res.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range || '');
  const start = m && m[1] ? +m[1] : 0, end = m && m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206, statusText: 'Partial Content',
    headers: { 'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg', 'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes' },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !CDN.test(req.url)) return;

  // Music: cache-first, fetched whole in the background the first time.
  if (same && url.pathname.includes('/music/')) {
    e.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const hit = await cache.match(url.href);
      if (hit) return req.headers.has('range') ? rangeFrom(hit, req.headers.get('range')) : hit;
      e.waitUntil(cache.add(url.href).catch(() => {}));
      return fetch(req);
    })());
    return;
  }

  // Everything else: the cached copy straight away (refreshed for next
  // time), or the network the first time.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: same });
    const fresh = fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);
    if (hit) { e.waitUntil(fresh); return hit; }
    const res = await fresh;
    if (res) return res;
    // Offline and not cached: for a page load, fall back to the game itself.
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
