// Service worker: makes the app work offline and installable.
// Strategy: network first (always the newest version online), cache as offline fallback.
// Bump VERSION when files change so old caches are cleaned up.
const VERSION = "mnm-v2.8.0"; // must match APP_VERSION in js/app.js and ?v= in index.html
const FILES = [
  "./", "index.html", "styles.css", "manifest.webmanifest",
  "js/movies.js", "js/logic.js", "js/app.js",
  "fonts/bungee-latin-400-normal.woff2", "fonts/figtree-latin-400-normal.woff2",
  "fonts/figtree-latin-500-normal.woff2", "fonts/figtree-latin-700-normal.woff2",
  "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png"
];

self.addEventListener("install", event => {
  // cache: "reload" skips the browser's own HTTP cache (GitHub Pages lets browsers keep files for
  // 10 minutes), so a new version never gets mixed with an old app.js.
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
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
  // Network first: online you always get the newest files (and the cache is refreshed);
  // offline, the cached copy is used. "no-cache" asks the server whether a file changed.
  event.respondWith(
    fetch(req.url, { cache: "no-cache", credentials: "same-origin" })
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(cache => cache.put(req, copy)); }
        return res;
      })
      .catch(() => caches.open(VERSION).then(cache => cache.match(req, { ignoreSearch: true })))
  );
});
