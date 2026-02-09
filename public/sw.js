const CACHE_NAME = "ai-stock-v2";
const PRECACHE_URLS = ["/", "/manifest.json"];

// インストール: 静的アセットをキャッシュ
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// フェッチ: Network First (API), Cache First (静的アセット)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ナビゲーションリクエスト (ページ遷移) はSWを通さない
  // → 307リダイレクト (/login等) がWebViewで正しく処理される
  if (event.request.mode === "navigate") {
    return;
  }

  // APIリクエスト: ネットワーク優先、失敗時キャッシュ
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // 成功レスポンスをキャッシュ
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 静的アセット: キャッシュ優先、なければネットワーク
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && event.request.method === "GET") {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    })
  );
});
