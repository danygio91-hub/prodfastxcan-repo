// This is a basic Service Worker with a Stale-While-Revalidate strategy.

const CACHE_NAME = 'pfxcan-cache-v1';
const urlsToCache = [
  '/',
  '/manifest.json',
  '/icon-192x192.png',
  '/icon-512x512.png'
];

// Install event: precache the main application shell.
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event: clean up old caches and take control.
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  // Take control of the page immediately.
  return self.clients.claim();
});

// Listen for messages from the client to skip the waiting phase.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});


// Fetch event: apply the Stale-While-Revalidate strategy.
self.addEventListener('fetch', event => {
  // We only apply this strategy to navigation requests (i.e., for HTML pages).
  // Other requests (like Firestore's WebSockets, images, API calls) will pass through to the network directly.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        // 1. Return the cached version immediately if available (Stale).
        return cache.match(event.request).then(cachedResponse => {
          
          // 2. In the background, fetch a fresh version from the network (Revalidate).
          const fetchPromise = fetch(event.request).then(networkResponse => {
            // If the fetch is successful, update the cache with the new version.
            if (networkResponse.ok) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          });

          // Return the cached response if it exists, otherwise wait for the network response.
          // This ensures the app works offline if there's something in the cache.
          return cachedResponse || fetchPromise;
        });
      })
    );
  }
  // For non-navigation requests, just let the browser handle it (network-first).
  // This is crucial for Firestore's real-time connection.
  return;
});
