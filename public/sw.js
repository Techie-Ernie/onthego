/* onthego service worker — hand-written, no build step.
 *
 * Caches:
 *   otg-shell-v<N>    app shell: route HTML + /_next/static assets (stale-while-revalidate)
 *   otg-bank-index    /bank/<subject>/index.json (network-first, fallback cache)
 *   otg-topic-<shard> per-topic shard JSON + its /q-assets images (filled on "Download for offline")
 *   otg-quiz          assets of the quiz in progress + next questions (auto, small, pruned)
 *
 * Messages from the page:
 *   {type:"warm-shell"}                         precache app routes and the static assets they reference
 *   {type:"cache-topic", shard, urls:[...]}     download a topic; posts {type:"topic-progress", shard, done, total}
 *   {type:"drop-topic", shard}
 *   {type:"cache-quiz", urls:[...]}             replace the quiz cache with these urls
 */
const VERSION = 1;
const SHELL = `otg-shell-v${VERSION}`;
const INDEX = "otg-bank-index";
const QUIZ = "otg-quiz";
const ROUTES = ["/", "/build", "/quiz", "/results", "/mistakes", "/insights", "/trends", "/search", "/settings", "/offline"];

self.addEventListener("install", (e) => {
  e.waitUntil(warmShell().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("otg-shell-") && k !== SHELL).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

async function warmShell() {
  const cache = await caches.open(SHELL);
  const assets = new Set();
  for (const r of ROUTES) {
    try {
      const res = await fetch(r, { credentials: "same-origin" });
      if (!res.ok) continue;
      const html = await res.clone().text();
      await cache.put(r, res);
      for (const m of html.matchAll(/["'(](\/_next\/static\/[^"')\s]+)["')]/g)) assets.add(m[1].replace(/\\u0026/g, "&"));
    } catch {}
  }
  await Promise.all(
    [...assets].map(async (u) => {
      if (await cache.match(u)) return;
      try {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch {}
    }),
  );
}

async function findCached(req) {
  const keys = await caches.keys();
  for (const k of keys) {
    const hit = await (await caches.open(k)).match(req, { ignoreSearch: req.mode === "navigate" });
    if (hit) return hit;
  }
  return undefined;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/api/")) return;

  // Page navigations: network first (fresh), fall back to cached route, then to the cached home shell.
  if (req.mode === "navigate") {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(SHELL)).put(url.pathname, res.clone());
          return res;
        } catch {
          return (
            (await caches.match(url.pathname, { cacheName: SHELL })) ||
            (await caches.match("/offline", { cacheName: SHELL })) ||
            (await caches.match("/", { cacheName: SHELL })) ||
            new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } })
          );
        }
      })(),
    );
    return;
  }

  // Hashed static assets: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    e.respondWith(
      (async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      })(),
    );
    return;
  }

  // Bank index: network first so new questions arrive, cache fallback offline.
  if (/^\/bank\/[^/]+\/index\.json$/.test(url.pathname)) {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          if (res.ok) (await caches.open(INDEX)).put(url.pathname, res.clone());
          return res;
        } catch {
          return (await caches.match(url.pathname)) || Response.error();
        }
      })(),
    );
    return;
  }

  // Topic shards and question images: any cache first (topic or quiz cache), else network.
  // Not stored automatically — only "Download for offline" and the quiz cache persist them.
  if (url.pathname.startsWith("/bank/") || url.pathname.startsWith("/q-assets/")) {
    e.respondWith(
      (async () => {
        const hit = await findCached(url.pathname);
        if (hit) return hit;
        return fetch(req);
      })(),
    );
  }
});

self.addEventListener("message", (e) => {
  const msg = e.data || {};
  const reply = (data) => e.source && e.source.postMessage(data);
  if (msg.type === "warm-shell") e.waitUntil(warmShell());
  if (msg.type === "cache-topic") e.waitUntil(cacheTopic(msg.shard, msg.urls || [], reply));
  if (msg.type === "drop-topic") e.waitUntil(caches.delete(`otg-topic-${msg.shard}`).then(() => reply({ type: "topic-dropped", shard: msg.shard })));
  if (msg.type === "cache-quiz") e.waitUntil(cacheQuiz(msg.urls || []));
});

async function cacheTopic(shard, urls, reply) {
  const cache = await caches.open(`otg-topic-${shard}`);
  let done = 0;
  let failed = 0;
  const queue = [...urls];
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift();
      try {
        if (!(await cache.match(u))) {
          const res = await fetch(u);
          if (!res.ok) throw new Error(String(res.status));
          await cache.put(u, res);
        }
      } catch {
        failed++;
      }
      done++;
      if (done % 4 === 0 || done === urls.length) reply({ type: "topic-progress", shard, done, total: urls.length, failed });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  reply({ type: "topic-done", shard, failed });
}

async function cacheQuiz(urls) {
  const cache = await caches.open(QUIZ);
  const want = new Set(urls.map((u) => new URL(u, self.location.origin).pathname));
  for (const req of await cache.keys()) {
    if (!want.has(new URL(req.url).pathname)) await cache.delete(req);
  }
  await Promise.all(
    [...want].map(async (u) => {
      if (await findCached(u)) return;
      try {
        const res = await fetch(u);
        if (res.ok) await cache.put(u, res);
      } catch {}
    }),
  );
}
