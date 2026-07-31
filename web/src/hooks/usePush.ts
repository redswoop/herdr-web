import { useCallback, useEffect, useState } from 'react';
import { post } from '../api';

function b64uToBytes(s: string): Uint8Array {
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function usePush() {
  const [reg, setReg] = useState<ServiceWorkerRegistration | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker
      .register('/sw.js')
      .then(async (r) => {
        setReg(r);
        setSubscribed(!!(await r.pushManager?.getSubscription()));
      })
      .catch(() => {}); // http origin or private mode — feature stays off
  }, []);

  const toggle = useCallback(async () => {
    if (!reg?.pushManager) return;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await post('/api/push/unsubscribe', { endpoint: existing.endpoint });
      await existing.unsubscribe();
      setSubscribed(false);
      return;
    }
    if (Notification.permission === 'denied') {
      alert('Notifications are blocked for this site — enable them in browser settings.');
      return;
    }
    try {
      const { key } = await (await fetch('/api/push/pubkey')).json();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToBytes(key).buffer as ArrayBuffer,
      });
      await post('/api/push/subscribe', { subscription: sub.toJSON() });
      setSubscribed(true);
    } catch (e) {
      alert(`push setup failed: ${(e as Error).message ?? e}`);
    }
  }, [reg]);

  return { supported: !!reg?.pushManager, subscribed, toggle };
}
