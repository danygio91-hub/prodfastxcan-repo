
// This is a basic service worker file.
// Its presence is required to make the web app installable (PWA).

self.addEventListener('install', (event) => {
  // console.log('Service Worker: Installing...');
  // You can pre-cache assets here if needed.
});

self.addEventListener('activate', (event) => {
  // console.log('Service Worker: Activating...');
});

self.addEventListener('fetch', (event) => {
  // This simple service worker doesn't intercept fetch requests.
  // It's here just to satisfy the PWA installability criteria.
  return;
});
