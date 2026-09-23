const CACHE_NAME = "chae-auth-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./auth.js",
  "./config.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./assets/pudding-mascot.png"
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
  const shellUrls = APP_SHELL.map(path => new URL(path, self.registration.scope).href);
  if (!shellUrls.includes(url.href)) return;
  // Private note data is never stored in the offline cache.
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

