// Catalyst's service worker (spec §11.2): shows the urgent and high alerts the server pushes, and
// opens the item when one is clicked. The payload is `{ title, body, url, priority }`. It caches
// nothing and handles no fetches.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Catalyst', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Catalyst', {
      body: data.body || '',
      data: { url: data.url || '/needs-you' },
      tag: data.url || undefined,
      requireInteraction: data.priority === 'urgent',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only open pages of this app; anything else goes to Needs you.
  let target = new URL('/needs-you', self.location.origin);
  try {
    const url = new URL(event.notification.data && event.notification.data.url, self.location.origin);
    if (url.origin === self.location.origin) target = url;
  } catch {
    // keep Needs you
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          return client.navigate(target.href).then((navigated) => (navigated || client).focus());
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
