const CACHE_NAME = 'gamemap-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/styles.js',
  './js/routing.js',
  './js/ui.js',
  './js/map.js',
  './manifest.webmanifest',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // API-Aufrufe (Routing, Geocoding, Overpass) nicht hart cachen
  if (url.hostname.includes('valhalla') || url.hostname.includes('photon') || url.hostname.includes('overpass')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(networkRes => {
        if (networkRes && networkRes.status === 200 && event.request.method === 'GET') {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkRes;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
