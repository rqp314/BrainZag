/**
 * Author: BrainZag
 * Repository: https://github.com/rqp314/BrainZag
 * License: See LICENSE file
 * Copyright (c) 2026 BrainZag
 *
 * Service worker setup for offline support
 *
*/

const CACHE_NAME = 'brainzag-cache';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/game.js',
    '/core.js',
    '/site.webmanifest',
    '/social-preview.png',
    '/GitHub_Invertocat_Black_Clearspace.png',
    '/favicon.ico',
    '/favicon-16x16.png',
    '/favicon-32x32.png',
    '/apple-touch-icon.png',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png'
];

// Install: cache all assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching app assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => {
                // Activate immediately without waiting
                return self.skipWaiting();
            })
    );
});

// Activate: take control immediately
self.addEventListener('activate', (event) => {
    event.waitUntil(
        self.clients.claim()
    );
});

// Fetch: stale-while-revalidate strategy
// Serves cached version instantly, fetches fresh version in background for next time
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                // Start fetching fresh version in background
                const fetchPromise = fetch(event.request)
                    .then((networkResponse) => {
                        // Update cache with fresh version
                        if (networkResponse && networkResponse.status === 200) {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    })
                    .catch(() => {
                        // Network failed, that's fine if we have cache
                        return null;
                    });

                // Return cached version immediately, or wait for network if no cache
                return cachedResponse || fetchPromise;
            });
        })
    );
});
