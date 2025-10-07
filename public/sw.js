// ProdFastXcan Service Worker

const CACHE_NAME = 'prodfastxcan-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
    // Next.js static files are usually prefixed with /_next/static/
    // We'll cache them dynamically as they are requested.
];
const NETWORK_FIRST_PATHS = [
    '/',
    '/scan-job',
    '/dashboard',
    '/admin/dashboard',
    '/admin/production-console',
    '/admin/data-management',
];

// On install, pre-cache the static shell
self.addEventListener('install', event => {
    console.log('[SW] Install');
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching app shell');
            return cache.addAll(STATIC_ASSETS);
        })
    );
});

// On activate, clean up old caches
self.addEventListener('activate', event => {
    console.log('[SW] Activate');
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('[SW] Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});


self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // --- Network First Strategy for HTML pages and key data paths ---
    // This ensures we always get the latest page structure and critical data.
    if (request.mode === 'navigate' || NETWORK_FIRST_PATHS.includes(url.pathname)) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // If we get a valid response, cache it and return it
                    if (response && response.status === 200) {
                        const responseToCache = response.clone();
                        caches.open(CACHE_NAME).then(cache => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return response;
                })
                .catch(() => {
                    // If the network fails, serve from cache
                    return caches.match(request).then(response => {
                        return response || caches.match('/'); // Fallback to home page
                    });
                })
        );
        return;
    }
    
    // --- Cache First Strategy for Static Assets (_next/static) ---
    // These files are versioned by Next.js, so they are safe to cache aggressively.
    if (url.pathname.startsWith('/_next/static/')) {
         event.respondWith(
            caches.match(request).then(cachedResponse => {
                if (cachedResponse) {
                    return cachedResponse;
                }
                return fetch(request).then(response => {
                     const responseToCache = response.clone();
                     caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseToCache);
                     });
                     return response;
                });
            })
        );
        return;
    }

    // Default: try network, fallback to cache for other requests
     event.respondWith(
        fetch(request).catch(() => caches.match(request))
    );
});
