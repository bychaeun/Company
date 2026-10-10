const CACHE_NAME = "chae-appsscript-v13";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./auth.js",
  "./checklist.js",
  "./api.js",
  "./config.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./privacy.html",
  "./assets/pudding-mascot.png",
  "./assets/pudding-mascot-wave.png?v=6"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const shellPaths = APP_SHELL.map(path => new URL(path, self.registration.scope).pathname);
  if (!shellPaths.includes(url.pathname)) return;
  // Private note data is never stored in the offline cache.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request, { ignoreSearch: true })));
});

