// Deliberately cache-free: the app needs the live Trilium server anyway, and a
// caching worker would serve stale bundles. Its presence (with a fetch handler)
// is what makes the app installable, which in turn enables the share target.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
