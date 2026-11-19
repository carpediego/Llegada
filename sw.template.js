const APP_VERSION = __APP_VERSION__;
const APP_BUILD = __APP_BUILD__;
const PRECACHE = __PRECACHE__;

const CACHE_PREFIX = "llegada-";
const SHELL_CACHE = `llegada-shell-${APP_VERSION}`;
const TILE_CACHE = "llegada-tiles-v1";
const SCOPE = self.registration.scope;
const OFFLINE_FALLBACK = new URL("index.html", SCOPE).href;
const TILE_HOSTS = new Set([
  "tile.openstreetmap.org",
  "a.tile.openstreetmap.org",
  "b.tile.openstreetmap.org",
  "c.tile.openstreetmap.org"
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const urls = Array.from(new Set([SCOPE, ...PRECACHE.map((path) => new URL(path, SCOPE).href)]));
      await Promise.all(
        urls.map(async (url) => {
          const response = await fetch(new Request(url, { cache: "reload" }));
          if (!response.ok) throw new Error(`No se pudo precachear ${url}`);
          await cache.put(new Request(url), response);
        })
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== SHELL_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (data.type === "GET_VERSION" && event.ports?.[0]) {
    event.ports[0].postMessage({ version: APP_VERSION, build: APP_BUILD });
    return;
  }
  if (data.type === "CLEAR_CACHES") {
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX)).map((key) => caches.delete(key)));
        if (event.ports?.[0]) event.ports[0].postMessage({ ok: true });
      })()
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (TILE_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirstTile(request));
    return;
  }

  if (url.origin !== self.location.origin) {
    if (url.hostname === "nominatim.openstreetmap.org") return;
    return;
  }

  if (url.pathname.endsWith("/version.json") || url.pathname.endsWith("/update.json")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, { navigation: true }));
    return;
  }

  event.respondWith(networkFirst(request));
});

async function networkFirst(request, options = {}) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetchWithTimeout(request, 4500);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (options.navigation) {
      const fallback = await caches.match(OFFLINE_FALLBACK, { ignoreSearch: true });
      if (fallback) return fallback;
      const root = await caches.match(SCOPE, { ignoreSearch: true });
      if (root) return root;
    }
    return new Response(
      options.navigation
        ? "<!doctype html><meta charset=utf-8><title>Sin conexión</title><style>body{font-family:system-ui;background:#f3efe5;color:#17251f;display:grid;place-items:center;height:100vh;margin:0;text-align:center}main{max-width:340px;padding:24px}h1{font-size:24px}p{color:#5d6b63;font-size:14px}</style><main><h1>Llegada está sin conexión</h1><p>Vuelve a conectarte para cargar la app. Tus recordatorios siguen guardados en este dispositivo.</p></main>"
        : "Offline",
      {
        status: 503,
        headers: { "Content-Type": options.navigation ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" }
      }
    );
  }
}

async function cacheFirstTile(request) {
  const cache = await caches.open(TILE_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      await cache.put(request, response.clone());
      trimCache(TILE_CACHE, 260);
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Tile offline" });
  }
}

async function fetchWithTimeout(request, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const reminderId = data.reminderId || "";
  const targetUrl = new URL("./", SCOPE);
  if (reminderId) targetUrl.searchParams.set("alarm", reminderId);

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windowClients) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        client.postMessage({ type: "NOTIFICATION_CLICK", reminderId });
        return;
      }
      await self.clients.openWindow(targetUrl.href);
    })()
  );
});
