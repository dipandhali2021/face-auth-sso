// Simplified Model Cache Service Worker for Face API
// This service worker provides basic caching for face-api models

const CACHE_NAME = 'face-api-model-cache-v2';
const MODEL_URLS = [
  // Face detection models (tiny detector for faster loading)
  '/models/tiny_face_detector_model-weights_manifest.json',
  '/models/tiny_face_detector_model-shard1',
  
  // Face landmark models (tiny version is smaller and faster)
  '/models/face_landmark_68_tiny_model-weights_manifest.json',
  '/models/face_landmark_68_tiny_model-shard1',
  
  // Face recognition model
  '/models/face_recognition_model-weights_manifest.json',
  '/models/face_recognition_model-shard1',
  '/models/face_recognition_model-shard2',
  
  // Main face-api.js library
  '/js/face-api.min.js'
];

// Simple installation that caches models
self.addEventListener('install', event => {
  console.log('[SW] Installing Face API Model Cache...');
  
  // Skip waiting to become active immediately
  self.skipWaiting();
  
  // Cache models in the background
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching face-api models...');
        return cache.addAll(MODEL_URLS);
      })
      .catch(err => {
        console.error('[SW] Model caching error:', err);
      })
  );
});

// Clean up old caches when activated
self.addEventListener('activate', event => {
  console.log('[SW] Activating Face API Model Cache...');
  
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
    }).then(() => self.clients.claim())
  );
});

// Simplified fetch handler - only intercept model requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Only handle model requests
  if (url.pathname.includes('/models/') || 
      url.pathname.includes('/face-api.min.js')) {
      
    event.respondWith(
      caches.match(event.request)
        .then(response => {
          // Return from cache if available
          if (response) {
            return response;
          }
          
          // Otherwise fetch from network
          return fetch(event.request).then(response => {
            // Don't cache if response is invalid
            if (!response || response.status !== 200) {
              return response;
            }
            
            // Cache the valid response
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            
            return response;
          });
        })
        .catch(() => {
          // If both cache and network fail, return a fallback or error
          return new Response('Model loading error', {
            status: 408,
            headers: {'Content-Type': 'text/plain'}
          });
        })
    );
  }
});

// Basic message handling
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});