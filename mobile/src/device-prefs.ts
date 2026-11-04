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

/* "Scroll to my send": a prompt you submit always comes into view, however
   far up you were reading. On by default; off leaves you where you were and
   lights the jump pill instead. Both transcript engines read it. */
const SCROLL_ON_SEND_KEY = 'herdr.scrollOnSend';
let scrollOnSend: boolean | null = null;

function readScrollOnSend(): boolean {
  if (scrollOnSend === null) {
    try {
      scrollOnSend = getPlatform().kv.get(SCROLL_ON_SEND_KEY) !== '0';
    } catch {
      scrollOnSend = true;
    }
  }
  return scrollOnSend;
}

export function setScrollOnSend(v: boolean) {
  scrollOnSend = v;
  try {
    getPlatform().kv.set(SCROLL_ON_SEND_KEY, v ? '1' : '0');
  } catch {}
  for (const cb of listeners) cb();
}

export function useScrollOnSend(): boolean {
  return useSyncExternalStore(subscribe, readScrollOnSend, readScrollOnSend);
}
