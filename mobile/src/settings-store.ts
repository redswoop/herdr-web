import { Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';
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

/**
 * Native only: adopt `capra://settings?server=…&token=…` — the QR /
 * "open in Capra" onboarding, and the prod↔canary switch. Either param may
 * appear alone (server-only links re-point an already-enrolled phone).
 * Returns true when anything changed so the caller can remount against the
 * new API config. Web has its own ?server= flow in adoptUrlSettings.
 */
export async function adoptDeepLink(url: string): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  let params: Record<string, unknown>;
  try {
    params = ExpoLinking.parse(url).queryParams ?? {};
  } catch {
    return false;
  }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const server = str(params.server);
  const token = str(params.token);
  if (!server && !token) return false;

  const cur = await loadSettings();
  const next = { baseUrl: server ?? cur.baseUrl, token: token ?? cur.token };
  if (next.baseUrl === cur.baseUrl && next.token === cur.token) return false;
  await saveSettings(next);
  return true;
}

/**
 * Web only: seed settings from `?server=…&token=…` so the RNW audition is a
 * single clickable link instead of a hand-typed settings screen. Consumed
 * once — the params are stripped from the URL so a reload/share doesn't carry
 * the token around.
 */
export async function adoptUrlSettings(): Promise<void> {
  if (Platform.OS !== 'web') return;
  const loc = globalThis.location;
  if (!loc?.search) return;
  const q = new URLSearchParams(loc.search);
  const token = q.get('token');
  const server = q.get('server');
  if (!token && !server) return;

  const cur = await loadSettings();
  await saveSettings({
    baseUrl: server ?? cur.baseUrl,
    token: token ?? cur.token,
  });
  q.delete('token');
  q.delete('server');
  const rest = q.toString();
  globalThis.history?.replaceState(null, '', `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`);
}

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
