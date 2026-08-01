import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const URL_KEY = 'herdr.serverUrl';
const TOKEN_KEY = 'herdr.token';

export interface ServerSettings {
  baseUrl: string;
  token: string;
}

/**
 * expo-secure-store has no web implementation — its native module resolves to
 * `{}` there, so every call throws. The react-native-web audition still needs
 * to reach a daemon, so fall back to localStorage on web. Not secure storage,
 * but the browser build is a dev/preview surface; iOS keeps the keychain.
 */
const store =
  Platform.OS === 'web'
    ? {
        get: async (k: string) => globalThis.localStorage?.getItem(k) ?? null,
        set: async (k: string, v: string) => globalThis.localStorage?.setItem(k, v),
        del: async (k: string) => globalThis.localStorage?.removeItem(k),
      }
    : {
        get: (k: string) => SecureStore.getItemAsync(k),
        set: (k: string, v: string) => SecureStore.setItemAsync(k, v),
        del: (k: string) => SecureStore.deleteItemAsync(k),
      };

export async function loadSettings(): Promise<ServerSettings> {
  const [baseUrl, token] = await Promise.all([store.get(URL_KEY), store.get(TOKEN_KEY)]);
  return {
    baseUrl: baseUrl ?? '',
    token: token ?? '',
  };
}

export async function saveSettings(s: ServerSettings): Promise<void> {
  await store.set(URL_KEY, s.baseUrl.trim().replace(/\/$/, ''));
  if (s.token.trim()) await store.set(TOKEN_KEY, s.token.trim());
  else await store.del(TOKEN_KEY);
}
