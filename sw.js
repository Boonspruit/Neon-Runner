const CACHE_VERSION = 'neon-runner-v2';
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_ASSETS = [
  './',
  'index.html',
  'styles.css',
  'game.js',
  'ai-worker.js',
  'assets/synthwave-loop.mp3',
  'assets/effects-atlas.svg',
];

const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r160/three.min.js',
  'https://unpkg.com/three@0.160.0/build/three.min.js',
];

async function cacheList(cache, resources) {
  await Promise.all(resources.map(async (resource) => {
    try {
      const request = new Request(resource, { cache: 'no-cache' });
      const response = await fetch(request);
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone());
      }
    } catch (_error) {
      // Ignore transient cache failures to avoid blocking startup.
    }
  }));
}

async function warmAllCaches() {
  const shellCache = await caches.open(APP_SHELL_CACHE);
  await cacheList(shellCache, APP_ASSETS);
  await cacheList(shellCache, EXTERNAL_ASSETS);
}

self.addEventListener('install', (event) => {
  event.waitUntil(warmAllCaches().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !name.startsWith(CACHE_VERSION)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'PRECACHE_GAME_ASSETS') return;

  event.waitUntil((async () => {
    await warmAllCaches();
    if (event.ports?.[0]) {
      event.ports[0].postMessage({ ok: true });
    }
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith((async () => {
    const cached = await caches.match(event.request, { ignoreVary: true });
    if (cached) return cached;

    try {
      const response = await fetch(event.request);
      if (response.ok || response.type === 'opaque') {
        const runtime = await caches.open(RUNTIME_CACHE);
        runtime.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      if (event.request.mode === 'navigate') {
        return caches.match('index.html');
      }
      throw error;
    }
  })());
});
