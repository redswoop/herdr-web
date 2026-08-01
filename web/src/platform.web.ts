import type { Platform, SseClient } from '@herdr/shared/platform';
import { setPlatform } from '@herdr/shared/platform';
import { configureApi } from '@herdr/shared/api';

function openSse(url: string): SseClient {
  const es = new EventSource(url);
  return {
    addEventListener(type, listener) {
      es.addEventListener(type, listener as EventListener);
    },
    removeEventListener(type, listener) {
      es.removeEventListener(type, listener as EventListener);
    },
    get onopen() {
      return es.onopen as ((ev?: Event) => void) | null;
    },
    set onopen(fn) {
      es.onopen = fn as (this: EventSource, ev: Event) => void;
    },
    get onerror() {
      return es.onerror as ((ev?: Event) => void) | null;
    },
    set onerror(fn) {
      es.onerror = fn as (this: EventSource, ev: Event) => void;
    },
    isClosed() {
      return es.readyState === EventSource.CLOSED;
    },
    close() {
      es.close();
    },
  };
}

const webPlatform: Platform = {
  openSse,
  kv: {
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, v);
      } catch {}
    },
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {}
    },
  },
  onWake(cb) {
    const wake = () => {
      if (document.visibilityState === 'visible') cb();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  },
  isForeground() {
    return document.visibilityState === 'visible';
  },
  notifyError(msg) {
    alert(msg);
  },
};

/** Register web platform + cookie-style API defaults. Call once at boot. */
export function initWebPlatform(): void {
  configureApi({ baseUrl: '', token: null });
  setPlatform(webPlatform);
}
