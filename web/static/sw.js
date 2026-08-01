/* herdr-web service worker: app-shell cache + Web Push + notification actions. */
// Vite emits hashed asset names, so only the stable entries are precached;
// everything else lands in the cache on first fetch (network-first below).
const CACHE = 'hw-v2';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  // per-item, not addAll: addAll is atomic, and one 404'd icon would fail the
  // whole install — leaving push and offline silently dead
  e.waitUntil(caches.open(CACHE).then((c) =>
    Promise.allSettled(SHELL.map((u) => c.add(u)))));
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
      // never cache the worker script itself — the offline path could then
      // resurrect a stale worker
      if (res.ok && url.pathname !== '/sw.js') {
        (await caches.open(CACHE)).put(e.request, res.clone());
      }
      // token auth rejected us: boot the cached app anyway so it can show
      // its unlock screen instead of raw 401 JSON (API calls stay gated)
      if (res.status === 401) {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
      }
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
    // Chrome caps notification actions at 2 — store the SAME sliced list we
    // display, so click indices can never resolve to a hidden action
    const actions = (msg.actions ?? []).slice(0, 2);
    await self.registration.showNotification(msg.title ?? 'herdr', {
      body: msg.body ?? '',
      tag: msg.tag ?? 'herd',
      renotify: msg.renotify !== false,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { paneId: msg.paneId, actions },
      actions: actions.map((a, i) => ({ action: `a${i}`, title: a.title })),
    });
  })());
});

// The push service can rotate the endpoint under us (routine on Android).
// Re-subscribe with the same VAPID key and hand the fresh subscription to the
// daemon — otherwise pushes silently die while the UI still shows 🔔 on.
self.addEventListener('pushsubscriptionchange', (e) => {
  e.waitUntil((async () => {
    try {
      const old = e.oldSubscription ?? (await self.registration.pushManager.getSubscription());
      const key = old?.options?.applicationServerKey
        ?? await (async () => {
          const { key: k } = await (await fetch('/api/push/pubkey')).json();
          const raw = atob(k.replace(/-/g, '+').replace(/_/g, '/'));
          return Uint8Array.from(raw, (c) => c.charCodeAt(0)).buffer;
        })();
      const sub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (old && old.endpoint !== sub.endpoint) {
        await fetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: old.endpoint }),
        }).catch(() => null);
      }
    } catch {}
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
    // prefer the window the user was last looking at; focus() can reject
    // (platform restrictions) and must not kill the fallback
    ws.sort((a, b) => Number(b.focused) - Number(a.focused)
      || Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible'));
    const pathHash = (u) => { const p = new URL(u); return `${p.pathname}${p.hash}`; };
    for (const c of ws) {
      // compare on path+hash, not full href — a tab still carrying ?token=
      // from enrollment is the same app and must not be re-navigated (that
      // would drop its query string mid-session)
      if (pathHash(c.url) !== pathHash(url)) {
        const nav = await c.navigate(url).then(() => true, () => false);
        if (!nav) continue; // uncontrolled client refused — try the next one
      }
      await c.focus().catch(() => null);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
