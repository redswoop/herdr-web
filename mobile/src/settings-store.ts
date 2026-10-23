import { Platform } from 'react-native';
import * as ExpoLinking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import type { ServerConf } from '@herdr/shared';

/** The server registry (PLAN-MULTIHOST.md): one JSON blob, tokens inside,
 *  so it lives in the keychain like the single token used to. */
const SERVERS_KEY = 'herdr.servers';
// pre-multi-host keys — migrated into the list on first load, then removed
const LEGACY_URL_KEY = 'herdr.serverUrl';
const LEGACY_TOKEN_KEY = 'herdr.token';

export type ServerSettings = ServerConf;

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

const normUrl = (u: string) => u.trim().replace(/\/$/, '');

/** `blackstar.tail93d23c.ts.net` → `blackstar`; anything odd → a safe slug. */
export function slugFor(name: string | null | undefined, baseUrl: string): string {
  let s = (name ?? '').trim().toLowerCase();
  if (!s) {
    try {
      s = new URL(baseUrl).hostname.split('.')[0] ?? '';
    } catch {
      s = '';
    }
  }
  s = s.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'host';
}

const uniqueId = (want: string, taken: ServerConf[], except?: ServerConf): string => {
  let id = want;
  for (let n = 2; taken.some((s) => s !== except && s.id === id); n++) id = `${want}-${n}`;
  return id;
};

export async function loadServers(): Promise<ServerConf[]> {
  const raw = await store.get(SERVERS_KEY);
  if (raw) {
    try {
      const j = JSON.parse(raw) as unknown;
      if (Array.isArray(j)) {
        return j
          .filter((s): s is ServerConf => !!s && typeof s === 'object' && typeof (s as ServerConf).baseUrl === 'string')
          .map((s) => ({ id: String(s.id || slugFor(s.name, s.baseUrl)), name: String(s.name || s.id || ''), baseUrl: normUrl(s.baseUrl), token: s.token || null }));
      }
    } catch {
      /* fall through to legacy */
    }
  }
  // first run after the multi-host update: the single server becomes the primary
  const [url, token] = await Promise.all([store.get(LEGACY_URL_KEY), store.get(LEGACY_TOKEN_KEY)]);
  if (url) {
    const one: ServerConf = { id: slugFor(null, url), name: slugFor(null, url), baseUrl: normUrl(url), token: token || null };
    await saveServers([one]);
    await Promise.all([store.del(LEGACY_URL_KEY), store.del(LEGACY_TOKEN_KEY)]);
    return [one];
  }
  return [];
}

export async function saveServers(list: ServerConf[]): Promise<void> {
  await store.set(SERVERS_KEY, JSON.stringify(list.map((s) => ({ ...s, baseUrl: normUrl(s.baseUrl), token: s.token || null }))));
}

/** The primary (first) server, for the parts of the app that still think in one. */
export async function loadSettings(): Promise<{ baseUrl: string; token: string }> {
  const [p] = await loadServers();
  return { baseUrl: p?.baseUrl ?? '', token: p?.token ?? '' };
}

/**
 * Add a server, or refresh one we already know (matched by baseUrl): a
 * re-scanned QR after a token rotation lands on the same entry. Returns the
 * entry and whether anything changed.
 */
export async function upsertServer(input: {
  baseUrl: string;
  token?: string | null;
  name?: string | null;
}): Promise<{ server: ServerConf; changed: boolean }> {
  const list = await loadServers();
  const baseUrl = normUrl(input.baseUrl);
  const cur = list.find((s) => s.baseUrl === baseUrl);
  if (cur) {
    const next: ServerConf = {
      ...cur,
      token: input.token !== undefined && input.token !== null ? input.token : cur.token,
      name: input.name?.trim() ? input.name.trim() : cur.name,
    };
    const changed = next.token !== cur.token || next.name !== cur.name;
    if (changed) await saveServers(list.map((s) => (s === cur ? next : s)));
    return { server: next, changed };
  }
  const name = input.name?.trim() || slugFor(null, baseUrl);
  const server: ServerConf = { id: uniqueId(slugFor(name, baseUrl), list), name, baseUrl, token: input.token || null };
  await saveServers([...list, server]);
  return { server, changed: true };
}

export async function removeServer(id: string): Promise<void> {
  const list = await loadServers();
  await saveServers(list.filter((s) => s.id !== id));
}

/** Move a server to the front: its ids go bare, everyone else's carry `@host`. */
export async function makePrimary(id: string): Promise<void> {
  const list = await loadServers();
  const s = list.find((x) => x.id === id);
  if (!s) return;
  await saveServers([s, ...list.filter((x) => x !== s)]);
}

export async function renameServer(id: string, name: string): Promise<void> {
  const list = await loadServers();
  const clean = name.trim();
  if (!clean) return;
  await saveServers(list.map((s) => (s.id === id ? { ...s, name: clean } : s)));
}

/**
 * Native only: adopt `capra://settings?server=…&token=…&name=…` — the QR /
 * "open in Capra" onboarding. ADDITIVE: a known server (same URL) gets its
 * token/name refreshed, a new one joins the list. A token alone re-keys the
 * primary (the old prod↔canary links). Returns true when anything changed so
 * the caller can remount against the new registry. Web has its own
 * ?server= flow in adoptUrlSettings.
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
  const name = str(params.name);
  if (!server && !token) return false;
  if (!server) {
    const [p] = await loadServers();
    if (!p || p.token === token) return false;
    return (await upsertServer({ baseUrl: p.baseUrl, token })).changed;
  }
  return (await upsertServer({ baseUrl: server, token, name })).changed;
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
  const [p] = await loadServers();
  const baseUrl = server ?? p?.baseUrl ?? '';
  await upsertServer({ baseUrl, token: token ?? p?.token ?? null, name: q.get('name') });
  q.delete('token');
  q.delete('server');
  q.delete('name');
  const rest = q.toString();
  globalThis.history?.replaceState(null, '', `${loc.pathname}${rest ? `?${rest}` : ''}${loc.hash}`);
}
