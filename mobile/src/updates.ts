/* Over-the-air JS updates (expo-updates). Native builds are rationed (free
   EAS plan), so JS changes ship as updates on the "production" channel and
   land on the next launch. This module: a silent check+fetch on every
   foreground, a toast when one is ready, and the bits settings shows.
   Lazy-required so a dev client built before expo-updates still boots. */
import { describeError, getPlatform } from '@herdr/shared';
import { toast } from './toast';

type UpdatesMod = typeof import('expo-updates');
let mod: UpdatesMod | null | undefined;
function updates(): UpdatesMod | null {
  if (mod === undefined) {
    // a dev client never applies an update, and one built before expo-updates
    // redboxes on the require (the module logs before it throws) — skip it
    if (__DEV__) return (mod = null);
    try {
      mod = require('expo-updates') as UpdatesMod;
    } catch {
      mod = null;
    }
  }
  return mod;
}

export type UpdateInfo = {
  enabled: boolean;
  /** short id of the running update, or 'embedded' for the build's own bundle */
  id: string;
  createdAt: Date | null;
  channel: string | null;
  runtimeVersion: string | null;
};

export function updateInfo(): UpdateInfo {
  const u = updates();
  if (!u || !u.isEnabled) {
    return { enabled: false, id: 'embedded', createdAt: null, channel: null, runtimeVersion: null };
  }
  return {
    enabled: true,
    id: u.isEmbeddedLaunch || !u.updateId ? 'embedded' : u.updateId.slice(0, 8),
    createdAt: u.createdAt ?? null,
    channel: u.channel ?? null,
    runtimeVersion: u.runtimeVersion ?? null,
  };
}

let ready = false; // an update is fetched and waits for a restart
let busy = false;
export const updateReady = () => ready;

/** check + download; true when a new update is now waiting */
export async function checkForUpdate(opts: { quiet?: boolean } = {}): Promise<boolean> {
  const u = updates();
  if (!u || !u.isEnabled || busy) return ready;
  busy = true;
  try {
    const c = await u.checkForUpdateAsync();
    if (!c.isAvailable) {
      if (!opts.quiet) toast(ready ? 'update ready · restart to apply' : 'up to date');
      return ready;
    }
    const f = await u.fetchUpdateAsync();
    if (f.isNew) {
      ready = true;
      toast('update ready · restart to apply');
    }
    return ready;
  } catch (e) {
    if (!opts.quiet) getPlatform().notifyError(describeError(e));
    return ready;
  } finally {
    busy = false;
  }
}

export async function restartForUpdate(): Promise<void> {
  const u = updates();
  if (!u) return;
  await u.reloadAsync();
}

/** once at boot: a quiet check now and on every foreground */
export function initUpdates(): void {
  const u = updates();
  if (!u || !u.isEnabled) return;
  void checkForUpdate({ quiet: true });
  getPlatform().onWake(() => void checkForUpdate({ quiet: true }));
}
