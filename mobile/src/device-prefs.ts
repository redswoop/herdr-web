/* Small per-device switches that aren't appearance (those live in prefs.ts):
   kv-backed, read synchronously, subscribable from react. */
import { useSyncExternalStore } from 'react';
import { getPlatform } from '@herdr/shared';

const AUTOCORRECT_KEY = 'herdr.autocorrect';
const listeners = new Set<() => void>();
let autocorrect: boolean | null = null;

function read(): boolean {
  if (autocorrect === null) {
    try {
      autocorrect = getPlatform().kv.get(AUTOCORRECT_KEY) === '1';
    } catch {
      autocorrect = false;
    }
  }
  return autocorrect;
}

/** iOS autocorrect + auto-capitalisation + spell check in the composer.
 *  Off by default: prompts carry paths, flags and identifiers that the
 *  keyboard rewrites — but that's the user's call, so it's a switch. */
export function setAutocorrect(v: boolean) {
  autocorrect = v;
  try {
    getPlatform().kv.set(AUTOCORRECT_KEY, v ? '1' : '0');
  } catch {}
  for (const cb of listeners) cb();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useAutocorrect(): boolean {
  return useSyncExternalStore(subscribe, read, read);
}
