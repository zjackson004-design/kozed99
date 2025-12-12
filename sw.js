const CACHE_NAME = "z99-v1";
const urlsToCache = [
  "./",
  "./index.html",
  "./home.html",
  "./login.html",
  "./logo.png"
];

// Install SW
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

// Fetch Data (Network First Strategy for Fresh Odds)
self.addEventListener("fetch", (event) => {
  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});