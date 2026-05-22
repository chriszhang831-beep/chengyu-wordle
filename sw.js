/* Service Worker
 * 缓存策略：
 *   - 核心资源 (HTML/CSS/JS/数据/icon) 安装时预缓存
 *   - 同源 GET 请求走 stale-while-revalidate：先返回缓存，后台拉新
 *   - 跨域请求不动（不缓存）
 * 升级：版本号 CACHE 变化时，旧缓存会被自动清理
 */

const CACHE = "miyi-v3-2026-05-22-1";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./data.js",
  "./manifest.json",
  "./icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // 跨域资源（比如以后用了 CDN 字体）不缓存
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req).then(cached => {
      const fetchPromise = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached || caches.match("./index.html"));
      // 有缓存先返回缓存，后台静默更新
      return cached || fetchPromise;
    })
  );
});
