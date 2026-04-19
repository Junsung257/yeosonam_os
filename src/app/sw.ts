import { defaultCache } from '@serwist/next/worker';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';
import { Serwist } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

self.addEventListener('push', (event: PushEvent) => {
  let payload: {
    title?: string;
    body?: string;
    deepLink?: string;
    tag?: string;
    icon?: string;
  } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: '여소남 OS', body: event.data?.text() ?? '' };
  }

  const title = payload.title || '여소남 OS';
  const options: NotificationOptions = {
    body: payload.body || '',
    icon: payload.icon || '/logo.png',
    badge: '/logo.png',
    data: { deepLink: payload.deepLink || '/m/admin' },
    tag: payload.tag,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();
  const deepLink =
    (event.notification.data && event.notification.data.deepLink) || '/m/admin';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const client of allClients) {
        const url = new URL(client.url);
        if (url.pathname === deepLink && 'focus' in client) {
          return client.focus();
        }
      }
      return self.clients.openWindow(deepLink);
    })(),
  );
});
