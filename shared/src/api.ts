/** Configurable API client. Web uses relative URLs + cookies; RN passes baseUrl + token. */

let baseUrl = '';
let token: string | null = null;

export function configureApi(opts: { baseUrl?: string; token?: string | null }): void {
  if (opts.baseUrl !== undefined) baseUrl = opts.baseUrl.replace(/\/$/, '');
  if (opts.token !== undefined) token = opts.token;
}

export function getApiConfig(): { baseUrl: string; token: string | null } {
  return { baseUrl, token };
}

/** Build a full request URL. Appends ?token= when a token is configured. */
export function apiUrl(path: string): string {
  let url: string;
  if (path.startsWith('http://') || path.startsWith('https://')) {
    url = path;
  } else {
    const p = path.startsWith('/') ? path : `/${path}`;
    url = baseUrl ? `${baseUrl}${p}` : p;
  }
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** POST JSON; returns the response so callers can branch on status (409 etc.). */
export async function post(path: string, body: unknown): Promise<Response> {
  return fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** GET helper that goes through apiUrl (token-aware). */
export async function get(path: string): Promise<Response> {
  return fetch(apiUrl(path));
}

export async function errorOf(r: Response): Promise<string> {
  try {
    return ((await r.json()) as { error?: string }).error ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

export const agentPath = (paneId: string, action: string) =>
  `/api/agent/${encodeURIComponent(paneId)}/${action}`;

/* ---------------- management verbs (rename / close) ---------------- */

export const renameAgent = (paneId: string, name: string) =>
  post(agentPath(paneId, 'rename'), { name });
export const closeAgent = (paneId: string) => post(agentPath(paneId, 'close'), {});
export const renameWorkspace = (workspaceId: string, name: string) =>
  post(`/api/workspace/${encodeURIComponent(workspaceId)}/rename`, { name });
export const closeWorkspace = (workspaceId: string) =>
  post(`/api/workspace/${encodeURIComponent(workspaceId)}/close`, {});


/** The host the client is configured against, for messages — '' on web (relative URLs). */
export function apiHost(): string {
  try {
    return baseUrl ? new URL(baseUrl).host : '';
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
export function describeError(e: unknown): string {
  if (e == null) return 'something went wrong';
  const raw =
    e instanceof Error ? e.message : typeof e === 'string' ? e : ((e as { message?: unknown }).message ?? e);
  const msg = String(raw ?? '').trim();
  if (!msg) return 'something went wrong';
  const inner = unwrap(msg);
  // undici/RN throw a bare "fetch failed" / "Network request failed" with no detail: that's a network error too
  if (!inner || /^fetch failed$/i.test(msg) || NETWORK_RE.test(inner)) {
    const host = apiHost();
    return host ? `can't reach ${host}` : "can't reach the server";
  }
  return inner;
}
