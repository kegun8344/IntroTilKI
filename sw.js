// Service worker: makes the app work offline and installable.
// Strategy: serve from cache right away, refresh the cache in the background.
// Bump VERSION when files change so old caches are cleaned up.
const VERSION = "mnm-v2.4.0";
const FILES = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/movies.js", "js/logic.js", "js/app.js",
  "fonts/bungee-latin-400-normal.woff2", "fonts/figtree-latin-400-normal.woff2",
  "fonts/figtree-latin-500-normal.woff2", "fonts/figtree-latin-700-normal.woff2",
  "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if ((req.headers.get("accept") || "").includes("text/event-stream")) return; // live streams are never cached
  event.respondWith(
    caches.open(VERSION).then(cache =>
      cache.match(req, { ignoreSearch: true }).then(cached => {
        const fresh = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
