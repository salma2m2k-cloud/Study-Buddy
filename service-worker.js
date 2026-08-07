/* =========================================================
   STUDY BUDDY — SERVICE WORKER
   ---------------------------------------------------------
   Handles:
   1. Offline caching of the app shell (HTML/CSS/JS/icons) so
      Study Buddy still opens without a network connection.
      IndexedDB data itself is NOT touched here — it already
      persists in the browser regardless of the network.
   2. Displaying notifications via registration.showNotification,
      which notifications.js calls into so reminders can appear
      even if the tab isn't focused (subject to the browser/OS
      limitations described in js/notifications.js).

   LIMITATION: a service worker can only run while the browser
   itself is running (even backgrounded). It cannot wake a fully
   closed browser or a killed mobile app — no web technology can
   guarantee that without a native push service + server.
   ========================================================= */

const CACHE_NAME = "study-buddy-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./js/db.js",
  "./js/ai.js",
  "./js/notifications.js",
  "./js/sounds.js",
  "./js/app.js",
  "./manifest.json",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clientsArr) => {
      const existing = clientsArr.find((c) => "focus" in c);
      if (existing) return existing.focus();
      return self.clients.openWindow("./index.html");
    })
  );
});
