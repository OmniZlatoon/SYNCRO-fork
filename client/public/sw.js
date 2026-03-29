// SYNCRO PWA Service Worker
// Handles caching for offline support and push notifications for reminders

/* global self, clients */

const CACHE_NAME = 'syncro-v1';
const CACHED_ROUTES = ['/', '/dashboard', '/offline'];

const REMINDER_MESSAGE_TYPE = 'SYNCRO_REMINDER';

// Install event - cache essential routes
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHED_ROUTES))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve from cache when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
      .catch(() => caches.match('/offline'))
  );
});

// Push event - handle renewal reminders
self.addEventListener('push', (event) => {
  if (!event.data) {
    return;
  }

  let payload;
  try {
    payload = event.data.json();
  } catch (error) {
    console.error('[SYNCRO] Invalid push payload', error);
    return;
  }

  const notificationData = payload && payload.data ? payload.data : {};
  const {
    subscriptionId,
    renewalDate,
    reminderType,
    url,
  } = notificationData;

  // Only forward renewal reminders
  if (!subscriptionId || !renewalDate || reminderType !== 'renewal') {
    return;
  }

  const title = payload.title || 'Subscription Renewal Reminder';
  const options = {
    body: payload.body || 'You have an upcoming subscription renewal.',
    icon: payload.icon || '/icon.svg',
    badge: payload.badge || '/icon.svg',
    data: {
      url: url || '/dashboard',
    },
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(
    (async () => {
      // Show a standard browser notification
      await self.registration.showNotification(title, options);
    })()
  );
});

// Notification click event - open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});