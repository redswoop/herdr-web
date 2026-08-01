import { errorOf, post } from './api';
import type { NewChatRequest } from './types';

/** Where a quick-spawned session should land. */
export interface SpawnTarget {
  workspaceId?: string;
  cwd?: string;
}

const LAST_KIND_KEY = 'herdr.lastKind';

/** Agent kind for one-click spawns: whatever was started last (default claude). */
export const lastKind = () => localStorage.getItem(LAST_KIND_KEY) ?? 'claude';
export const rememberKind = (kind: string) => localStorage.setItem(LAST_KIND_KEY, kind);

/** POST /api/chats; resolves to the new paneId, throws with the server's error text. */
export async function spawnChat(req: NewChatRequest): Promise<string> {
  const r = await post('/api/chats', req);
  if (!r.ok) throw new Error(await errorOf(r));
  rememberKind(req.kind);
  const { paneId } = (await r.json()) as { paneId: string };
  return paneId;
}
