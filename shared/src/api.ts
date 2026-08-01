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
