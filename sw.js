/* Bench Block service worker — network-first with cache fallback.
   Online: always the newest app + program (updates land on next open).
   Offline: last cached copy of everything, so gym dead-zones don't matter. */

const CACHE = "bench-block-v1";
const SHELL = ["./", "index.html", "style.css", "app.js", "program.json", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
	e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
	e.waitUntil(
		caches.keys()
			.then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener("fetch", e => {
	if (e.request.method !== "GET") return;
	e.respondWith(
		fetch(e.request)
			.then(resp => {
				const copy = resp.clone();
				caches.open(CACHE).then(c => c.put(e.request, copy));
				return resp;
			})
			.catch(() => caches.match(e.request, { ignoreSearch: true }))
	);
});
