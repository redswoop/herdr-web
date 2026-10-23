import { errorOf, joinHost, post } from './api';
import { getPlatform } from './platform';
import type { NewChatRequest } from './types';

/** Where a quick-spawned session should land. */
export interface SpawnTarget {
  workspaceId?: string;
  cwd?: string;
  /** server id; absent = wherever the workspaceId points, else the primary */
  host?: string;
}

const LAST_KIND_KEY = 'herdr.lastKind';

/** Agent kind for one-click spawns: whatever was started last (default claude). */
export const lastKind = () => getPlatform().kv.get(LAST_KIND_KEY) ?? 'claude';
export const rememberKind = (kind: string) => getPlatform().kv.set(LAST_KIND_KEY, kind);

/** POST /api/chats on `host` (primary by default); resolves to the new
 *  host-qualified paneId, throws with the server's error text. */
export async function spawnChat(req: NewChatRequest, host?: string | null): Promise<string> {
  const r = await post('/api/chats', req, host);
  if (!r.ok) throw new Error(await errorOf(r));
  rememberKind(req.kind);
  const { paneId } = (await r.json()) as { paneId: string };
  return joinHost(paneId, host);
}
