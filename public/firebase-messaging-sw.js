// Shows the Sunday digest notification and opens the app on a tap. Nothing else: no caching, no fetch handling, so
// the app itself always comes fresh from the network. Firebase Cloud Messaging delivers a data message
// (functions/src/weeklyDigest.js); the name is the one the Firebase SDK looks for.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const data = payload.data || {};
  const notification = payload.notification || {};
  const title = data.title || notification.title || 'Your week';
  const body = data.body || notification.body || 'Your week is ready to look back on.';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/brand/apple-touch-icon-180.png',
    badge: '/brand/apple-touch-icon-180.png',
    tag: data.tag || 'weekly-digest',
    data: { url: data.url || '/#digest' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/#digest', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).origin === target.origin);
    if (open) {
      await open.focus();
      return open.navigate(target.href);
    }
    return self.clients.openWindow(target.href);
  })());
});
