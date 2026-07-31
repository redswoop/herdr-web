/** POST JSON; returns the response so callers can branch on status (409 etc.). */
export async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function errorOf(r: Response): Promise<string> {
  try {
    return (await r.json()).error ?? r.statusText;
  } catch {
    return r.statusText;
  }
}

export const agentPath = (paneId: string, action: string) =>
  `/api/agent/${encodeURIComponent(paneId)}/${action}`;
