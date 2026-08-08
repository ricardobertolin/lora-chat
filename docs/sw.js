// Cache-first app shell, so the page keeps working with no internet once it has
// been loaded once. Bump CACHE when you change any of the files below.
const CACHE = 'lora-chat-v7';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'protocol.js',
  'transport.js',
  'position.js',
  'crypto.js',
  'history.js',
  'survey.js',
  'audio.js',
  'backdrop.js',
  'vendor/three.module.min.js',
  'vendor/dotgothic16-latin.woff2',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request))
  );
});
