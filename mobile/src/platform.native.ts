import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState, type AppStateStatus, Alert } from 'react-native';
import EventSource from 'react-native-sse';
import type { Platform, SseClient } from '@herdr/shared/platform';
import { setPlatform } from '@herdr/shared/platform';
import { configureServers, type ServerConf } from '@herdr/shared/api';

/** In-memory kv hydrated from AsyncStorage before root UI mounts. */
const mem = new Map<string, string>();

export async function hydrateKv(): Promise<void> {
  try {
    const pairs = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    for (const [k, v] of pairs) {
      if (k.startsWith('herdr.') && v != null) mem.set(k, v);
    }
  } catch {
    // empty map is fine — drafts just won't restore
  }
}

function openSse(url: string): SseClient {
  // disable library retry — hooks own reconnection
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const es = new EventSource(url, { pollingInterval: 0 } as any);
  let closed = false;
  const listeners = new Map<string, Set<(e: MessageEvent) => void>>();

  const client: SseClient = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
        // react-native-sse types event names narrowly; named events are strings
        (es as any).addEventListener(type, (e: MessageEvent) => {
          for (const fn of listeners.get(type) ?? []) fn(e);
        });
      }
      listeners.get(type)!.add(listener);
    },
    onopen: null,
    onerror: null,
    isClosed() {
      return closed;
    },
    close() {
      closed = true;
      es.close();
    },
  };

  (es as any).addEventListener('open', () => {
    closed = false;
    client.onopen?.();
  });
  (es as any).addEventListener('error', () => {
    // permanent close on error so hooks rebuild with a fresh offset
    closed = true;
    client.onerror?.();
  });

  return client;
}

const kv = {
  get(key: string): string | null {
    return mem.has(key) ? mem.get(key)! : null;
  },
  set(key: string, value: string): void {
    mem.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  },
  remove(key: string): void {
    mem.delete(key);
    AsyncStorage.removeItem(key).catch(() => {});
  },
};

let foreground = AppState.currentState === 'active';

// One NetInfo subscription for the app; subscribers hear TRANSITIONS only.
// NetInfo replays the current state to every new listener synchronously, and
// a hook that re-subscribes per reconnect would hear "up" → reload → "up" …
let linkUp: boolean | null = null;
const linkSubs = new Set<(up: boolean) => void>();
NetInfo.addEventListener((state) => {
  if (state.isConnected == null) return; // undecided yet
  const up = state.isConnected && state.isInternetReachable !== false;
  if (up === linkUp) return;
  const first = linkUp === null;
  linkUp = up;
  if (first) return; // the initial reading is not a transition
  for (const cb of linkSubs) cb(up);
});

export function initNativePlatform(opts: { servers: ServerConf[] }): void {
  configureServers(opts.servers);

  const platform: Platform = {
    openSse,
    kv,
    onWake(cb) {
      const onApp = (s: AppStateStatus) => {
        foreground = s === 'active';
        if (s === 'active') cb();
      };
      const sub = AppState.addEventListener('change', onApp);
      const unNet = NetInfo.addEventListener((state) => {
        if (state.isConnected) cb();
      });
      return () => {
        sub.remove();
        unNet();
      };
    },
    onLink(cb) {
      linkSubs.add(cb);
      return () => {
        linkSubs.delete(cb);
      };
    },
    isForeground() {
      return foreground && AppState.currentState === 'active';
    },
    notifyError(msg) {
      Alert.alert('Capra', msg);
    },
  };

  setPlatform(platform);
}
