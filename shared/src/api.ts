/** Configurable API client. Web uses relative URLs + cookies; RN passes baseUrl + token.
 *
 *  Multi-host (PLAN-MULTIHOST.md): the client talks to N independent servers.
 *  `configureServers()` installs the registry; the first entry is the PRIMARY
 *  and its ids stay bare. Every other server's roster ids carry an `@<id>`
 *  suffix (`w19:p1@blackstar`), and `agentPath()` / `apiUrl(path, host)`
 *  route by that suffix. Call sites that already go through `agentPath` need
 *  nothing else. */

export interface ServerConf {
  /** short slug, the id in `@<id>` suffixes and on chips; '' = primary on web */
  id: string;
  /** label on chips (defaults to id) */
  name: string;
  /** '' on web = relative to the page origin */
  baseUrl: string;
  token: string | null;
  /** the host's colour on chips/stripes; absent = palette by position */
  color?: string | null;
}

/**
 * Host colours: deliberately off the status colours (blocked/working/done)
 * so a stripe never reads as a state. Picked to carry on both skins.
 */
export const HOST_PALETTE: { key: string; hex: string }[] = [
  { key: 'violet', hex: '#bb9af7' },
  { key: 'orange', hex: '#ff9e64' },
  { key: 'teal', hex: '#2ac3de' },
  { key: 'magenta', hex: '#ff79c6' },
  { key: 'lime', hex: '#b9f27c' },
  { key: 'sky', hex: '#7dcfff' },
  { key: 'coral', hex: '#ff7a59' },
  { key: 'mint', hex: '#73daca' },
];

const normBase = (u: string) => u.trim().replace(/\/$/, '');

let servers: ServerConf[] = [{ id: '', name: '', baseUrl: '', token: null }];

/** Single-server setup (web, tests): becomes the primary. */
export function configureApi(opts: { baseUrl?: string; token?: string | null }): void {
  const cur = servers[0] ?? { id: '', name: '', baseUrl: '', token: null };
  servers = [
    {
      ...cur,
      baseUrl: opts.baseUrl !== undefined ? normBase(opts.baseUrl) : cur.baseUrl,
      token: opts.token !== undefined ? opts.token : cur.token,
    },
    ...servers.slice(1),
  ];
}

/** Install the whole registry; first = primary. An empty list means "nowhere to talk to". */
export function configureServers(list: ServerConf[]): void {
  servers = list.map((s) => ({ ...s, baseUrl: normBase(s.baseUrl), name: s.name || s.id }));
}

export function getServers(): ServerConf[] {
  return servers;
}

export const primaryServer = (): ServerConf | undefined => servers[0];

export function getApiConfig(): { baseUrl: string; token: string | null } {
  const p = servers[0];
  return { baseUrl: p?.baseUrl ?? '', token: p?.token ?? null };
}

/* ---------------- host-qualified ids ---------------- */

export const HOST_SEP = '@';

/** `w19:p1@blackstar` → `{local: 'w19:p1', host: 'blackstar'}`; bare → host null (primary). */
export function splitHost(id: string): { local: string; host: string | null } {
  const i = id.lastIndexOf(HOST_SEP);
  if (i === -1) return { local: id, host: null };
  return { local: id.slice(0, i), host: id.slice(i + 1) || null };
}

/** Qualify a local id with its host. The primary's ids stay bare whatever
 *  its id is ('' on web, a slug on native) so they match what the roster
 *  reports — a spawn seeded with `servers[0].id` must not come back `@stormer`. */
export const joinHost = (local: string, host: string | null | undefined): string =>
  host && host !== servers[0]?.id ? `${local}${HOST_SEP}${host}` : local;

/** The server id a roster id belongs to (null = primary). */
export const hostOf = (id: string | null | undefined): string | null => (id ? splitHost(id).host : null);

/** Registry entry for a host id; null/'' → the primary. An unknown id (a
 *  removed server) → undefined: routes then go nowhere rather than to the
 *  primary's pane of the same local id. */
export function serverFor(host: string | null | undefined): ServerConf | undefined {
  if (!host) return servers[0];
  return servers.find((s) => s.id === host);
}

/** Chip label for a host id ('' for the primary when it's the only server). */
export function hostName(host: string | null | undefined): string {
  const s = serverFor(host);
  return s?.name || s?.id || '';
}

/** The colour for a host id: its stored pick, else the palette by position. */
export function hostColor(host: string | null | undefined): string {
  const s = serverFor(host);
  if (s?.color) return s.color;
  const i = Math.max(0, servers.indexOf(s as ServerConf));
  return HOST_PALETTE[i % HOST_PALETTE.length]!.hex;
}

/** Which registry entry an absolute URL points at (longest baseUrl prefix). */
function serverOfUrl(url: string): ServerConf | undefined {
  let best: ServerConf | undefined;
  for (const s of servers) {
    if (!s.baseUrl) continue;
    if ((url === s.baseUrl || url.startsWith(`${s.baseUrl}/`)) && (!best || s.baseUrl.length > best.baseUrl.length)) best = s;
  }
  return best;
}

/** Build a full request URL for a server (primary by default). Appends ?token= when that server has one. */
export function apiUrl(path: string, host?: string | null): string {
  let url: string;
  let server: ServerConf | undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    url = path;
    server = serverOfUrl(url) ?? (host ? serverFor(host) : undefined);
    if (!server || !server.baseUrl) return url; // foreign URL: never leak a token onto it
  } else {
    server = serverFor(host);
    const p = path.startsWith('/') ? path : `/${path}`;
    url = server?.baseUrl ? `${server.baseUrl}${p}` : p;
  }
  const token = server?.token;
  if (!token || /[?&]token=/.test(url)) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** POST JSON; returns the response so callers can branch on status (409 etc.).
 *  `host` picks the server for a bare path (absolute paths route themselves). */
export async function post(path: string, body: unknown, host?: string | null): Promise<Response> {
  return fetch(apiUrl(path, host), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** GET helper that goes through apiUrl (token-aware). */
export async function get(path: string, host?: string | null): Promise<Response> {
  return fetch(apiUrl(path, host));
}

export async function errorOf(r: Response): Promise<string> {
  try {
    return ((await r.json()) as { error?: string }).error ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

/** `/api/agent/<pane>/<action>` on the pane's own server: relative for the
 *  primary, absolute (token added by apiUrl on the way out) for `@host` ids. */
export function agentPath(paneId: string, action: string): string {
  const { local, host } = splitHost(paneId);
  const p = `/api/agent/${encodeURIComponent(local)}/${action}`;
  const s = host ? serverFor(host) : undefined;
  return s?.baseUrl && host ? `${s.baseUrl}${p}` : p;
}

/** Same for a server-level route (`/api/projects`, `/api/chats`…): absolute for a non-primary host. */
export function hostPath(path: string, host: string | null | undefined): string {
  const s = host ? serverFor(host) : undefined;
  return s?.baseUrl && host ? `${s.baseUrl}${path}` : path;
}

/* ---------------- management verbs (rename / close) ---------------- */

export const renameAgent = (paneId: string, name: string) =>
  post(agentPath(paneId, 'rename'), { name });
export const closeAgent = (paneId: string) => post(agentPath(paneId, 'close'), {});
const workspacePath = (workspaceId: string, action: string) => {
  const { local, host } = splitHost(workspaceId);
  return hostPath(`/api/workspace/${encodeURIComponent(local)}/${action}`, host);
};
export const renameWorkspace = (workspaceId: string, name: string) =>
  post(workspacePath(workspaceId, 'rename'), { name });
export const closeWorkspace = (workspaceId: string) => post(workspacePath(workspaceId, 'close'), {});


/* ---------------- file viewer places: ⌂ home + pins ---------------- */

export interface Places {
  /** the session's project root (git toplevel of its cwd, else the cwd) */
  home: string;
  /** `pin` as stored (`~/Sync`), `path` resolved on that host */
  pins: { pin: string; path: string }[];
}

export async function fetchPlaces(cwd: string | null, host?: string | null): Promise<Places | null> {
  try {
    const r = await get(`/api/places?cwd=${encodeURIComponent(cwd ?? '')}`, host);
    return r.ok ? ((await r.json()) as Places) : null;
  } catch {
    return null;
  }
}

/** pin or unpin a folder (absolute path); the host's new list, or null on failure */
export async function togglePin(places: Places, dir: string, host?: string | null): Promise<Places['pins'] | null> {
  const on = places.pins.some((p) => p.path === dir);
  const pins = on ? places.pins.filter((p) => p.path !== dir).map((p) => p.pin) : [...places.pins.map((p) => p.pin), dir];
  try {
    const r = await fetch(apiUrl('/api/places', host), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pins }),
    });
    return r.ok ? ((await r.json()) as { pins: Places['pins'] }).pins : null;
  } catch {
    return null;
  }
}

/** The host the client is configured against, for messages — '' on web (relative URLs). */
export function apiHost(host?: string | null): string {
  try {
    const base = serverFor(host)?.baseUrl;
    return base ? new URL(base).host : '';
  } catch {
    return '';
  }
}

const NETWORK_RE =
  /offline|network request failed|could not connect|connection (?:refused|reset|lost|closed)|timed? ?out|ENOTFOUND|ECONN|internet connection|load failed|network error|host (?:is )?unreachable/i;

/** Peel the wrappers RN/Expo/undici put around a native error message. */
function unwrap(msg: string): string {
  let m = msg.replace(/\s*\(at [^)]*\.(?:swift|kt|java|mm?|cpp):\d+\)\s*$/i, '').trim();
  for (;;) {
    const next = m.replace(/^(?:fetch failed|TypeError|Error|UnexpectedException|Exception)\s*:\s*/i, '');
    if (next === m) return m;
    m = next.trim();
  }
}

/**
 * A human sentence for a thrown error. Network-class failures (the runtime
 * couldn't reach the server at all) collapse to "can't reach <host>"; anything
 * else keeps its message minus the wrappers RN/Expo put around native errors,
 * e.g. `fetch failed: UnexpectedException: … (at ExpoModulesCore/Promise.swift:56)`.
 */
export function describeError(e: unknown, host?: string | null): string {
  if (e == null) return 'something went wrong';
  const raw =
    e instanceof Error ? e.message : typeof e === 'string' ? e : ((e as { message?: unknown }).message ?? e);
  const msg = String(raw ?? '').trim();
  if (!msg) return 'something went wrong';
  const inner = unwrap(msg);
  // undici/RN throw a bare "fetch failed" / "Network request failed" with no detail: that's a network error too
  if (!inner || /^fetch failed$/i.test(msg) || NETWORK_RE.test(inner)) {
    const h = apiHost(host);
    return h ? `can't reach ${h}` : "can't reach the server";
  }
  return inner;
}
