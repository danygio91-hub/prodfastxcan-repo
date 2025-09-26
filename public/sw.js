// This is the service worker file for the PWA.

const CACHE_NAME = 'prodfastxcan-cache-v1';

// A list of all the essential files to be cached for the app to work offline.
const urlsToCache = [
  '/',
  '/dashboard',
  '/scan-job',
  '/operator',
  '/report-problem',
  '/material-loading',
  '/material-check',
  '/manifest.json',
  '/favicon.ico',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/logo.png'
  // Note: Next.js assets (_next/static/...) are usually handled by runtime caching
  // because their names are hashed and change with every build.
];

// Install event: opens the cache and adds the core files to it.
self.addEventListener('install', (event) => {
  console.log('Service Worker: Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Service Worker: Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(error => {
        console.error('Service Worker: Failed to cache app shell.', error);
      })
  );
});

// Activate event: cleans up old caches.
self.addEventListener('activate', (event) => {
  console.log('Service Worker: Activating...');
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Service Worker: Deleting old cache', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// Fetch event: serves assets from cache if available, otherwise fetches from network.
self.addEventListener('fetch', (event) => {
  // We only want to handle GET requests.
  if (event.request.method !== 'GET') {
    return;
  }
  
  // For navigation requests (to pages), use a network-first strategy.
  // This ensures users always get the latest HTML, but falls back to cache if offline.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          console.log('Service Worker: Network fetch failed, serving from cache for navigation.');
          return caches.match(event.request)
                .then(response => response || caches.match('/')); // Fallback to root if specific page not cached
        })
    );
    return;
  }

  // For other requests (CSS, JS, images), use a cache-first strategy.
  // This is fast and efficient for static assets.
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        if (response) {
          // Found in cache, return it.
          return response;
        }
        
        // Not in cache, fetch from network, then cache it for next time.
        return fetch(event.request).then(
          (networkResponse) => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // IMPORTANT: Clone the response. A response is a stream
            // and because we want the browser to consume the response
            // as well as the cache consuming the response, we need
            // to clone it so we have two streams.
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        );
      })
  );
});