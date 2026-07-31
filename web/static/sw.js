/* herdr-web service worker: app-shell cache + Web Push + notification actions. */
// Vite emits hashed asset names, so only the stable entries are precached;
// everything else lands in the cache on first fetch (network-first below).
const CACHE = 'hw-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Network-first; cached shell only when the daemon is unreachable. The API is
// never cached — stale roster/transcript is worse than an error.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true }))
        ?? Response.error();
    }
  })());
});

// ---------- push ----------

async function anyVisibleClient() {
  const ws = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return ws.some((c) => c.visibilityState === 'visible');
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let msg = {};
    try { msg = e.data?.json() ?? {}; } catch { msg = { title: 'herdr', body: e.data?.text() }; }
    if (msg.type === 'clear') {
      // retraction: the herd resolved — close the slot, show nothing
      for (const n of await self.registration.getNotifications({ tag: msg.tag })) n.close();
      return;
    }
    // Suppress only real herd alerts when the PWA is already on screen.
    // Always show tests (and anything marked force) so we can prove the pipe.
    const force = msg.force || msg.tag === 'test' || msg.type === 'test';
    if (!force && await anyVisibleClient()) return;
    await self.registration.showNotification(msg.title ?? 'herdr', {
      body: msg.body ?? '',
      tag: msg.tag ?? 'herd',
      renotify: msg.renotify !== false,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { paneId: msg.paneId, actions: msg.actions ?? [] },
      actions: (msg.actions ?? []).slice(0, 2).map((a, i) => ({ action: `a${i}`, title: a.title })),
    });
  })());
});

// Tap: an action button answers the prompt straight from the lock screen
// (server re-verifies the screen via `expect` — a 409 means it moved on, so we
// open the app instead). A body tap deep-links to the agent.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const { paneId, actions = [] } = e.notification.data ?? {};
  e.waitUntil((async () => {
    if (e.action) {
      const a = actions[Number(e.action.slice(1))];
      if (a && paneId) {
        try {
          const r = await fetch(`/api/agent/${encodeURIComponent(paneId)}/answer`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ keys: a.keys, expect: a.expect }),
          });
          if (r.ok) return; // answered from the notification — nothing to open
        } catch {}
      }
      // fall through: couldn't answer — open the app on that agent
    }
    const url = new URL(paneId ? `/#/agent/${encodeURIComponent(paneId)}` : '/', self.location.origin).href;
    const ws = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of ws) {
      await c.focus();
      if (c.url !== url) await c.navigate(url).catch(() => null);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
