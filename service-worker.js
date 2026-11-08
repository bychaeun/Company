const CACHE_NAME = "chae-appsscript-v33";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./specs.js",
  "./specs.css",
  "./editor-guard.js",
  "./spec-registry.js",
  "./spec-registry.css",
  "./board.js",
  "./board.css",
  "./korea-map.json",
  "./auth.js",
  "./checklist.js",
  "./api.js",
  "./config.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./privacy.html",
  "./assets/pudding-mascot.png?v=7",
  "./assets/pudding-mascot-wave.png?v=7"
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
  // Stale-while-revalidate: the app opens from cache instantly and refreshes the copy in the background.
  // Versioned files (?v=) only match their exact URL, so a new page never mixes with old scripts.
  event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then((response) => {
      if (response.ok && response.type === "basic") cache.put(event.request, response.clone());
      return response;
    });
    if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
    return network.catch(() => cache.match(event.request, { ignoreSearch: true }).then((fallback) => fallback || Response.error()));
  }));
});
