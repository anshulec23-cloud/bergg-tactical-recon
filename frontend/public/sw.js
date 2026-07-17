const CACHE_NAME = 'ares-recon-v10'; // Forced version bump
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install Event - Pre-cache critical application assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[PWA Service Worker] Pre-caching static app shell');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting()) // Force immediate install takeover
  );
});

// Activate Event - Evict old caches and FORCE refresh all clients
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          console.log('[PWA Service Worker] Clearing cache:', key);
          return caches.delete(key);
        })
      );
    }).then(() => self.clients.claim())
      .then(() => {
        // Force navigate all active tabs to reload the fresh build
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          for (let client of clients) {
            client.navigate(client.url);
          }
        });
      })
  );
});

// Fetch Event - Handle offline access with targeted caching strategies
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);

  // 1. Skip caching for non-GET requests (e.g. Overpass APIs, route calculations)
  if (event.request.method !== 'GET') {
    return;
  }

  // 2. Cache-First Strategy for local frontend assets (scripts, styles, html)
  if (requestUrl.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cachedResponse => {
        if (cachedResponse) {
          // Serve from cache, but fetch fresh in background to update it
          fetch(event.request).then(freshResponse => {
            if (freshResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => cache.put(event.request, freshResponse));
            }
          }).catch(() => {}); // Ignore background errors if completely offline
          return cachedResponse;
        }

        return fetch(event.request).then(response => {
          if (response.status === 200) {
            const contentType = response.headers.get('content-type');
            // Guard: Do not cache HTML fallbacks if the request was for JS or CSS
            if (contentType && contentType.includes('text/html') && 
                (requestUrl.pathname.endsWith('.js') || requestUrl.pathname.endsWith('.css') || requestUrl.pathname.includes('/assets/'))) {
              return response;
            }
            const responseCopy = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseCopy));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Stale-While-Revalidate for external fonts and styles
  if (requestUrl.hostname.includes('googleapis.com') || requestUrl.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          const fetchPromise = fetch(event.request).then(networkResponse => {
            cache.put(event.request, networkResponse.clone());
            return networkResponse;
          });
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }

  // 4. Cache-First for Map Tiles (e.g., OpenStreetMap tiles or Mapbox/MapLibre assets)
  // This allows previously viewed regions to load completely offline
  if (requestUrl.pathname.includes('/tile/') || requestUrl.hostname.includes('tile.openstreetmap') || requestUrl.hostname.includes('basemaps.cartocdn')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then(networkResponse => {
            if (networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });
        });
      })
    );
    return;
  }
});
