/* Which transcript Capra draws: the native FlatList one, or the web one in a
   WebView (PLAN-HTML-TRANSCRIPT.md). Both take the same props, so the pane
   screen swaps one line. A two-finger double-tap on the transcript flips it
   on the fly for A/B — each engine detects the gesture on its own side (the
   page can't see RN touches and RN can't reliably see the WebView's). Per
   device, kv-backed, like device-prefs.ts. */
import { useSyncExternalStore } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { getPlatform } from '@herdr/shared';
import { tick, toast } from './toast';

export type TxEngine = 'native' | 'html';

const KEY = 'herdr.txEngine';
const listeners = new Set<() => void>();
let engine: TxEngine | null = null;

function read(): TxEngine {
  if (engine === null) {
    try {
      engine = getPlatform().kv.get(KEY) === 'html' ? 'html' : 'native';
    } catch {
      engine = 'native';
    }
  }
  return engine;
}

export function setTxEngine(v: TxEngine) {
  engine = v;
  try {
    getPlatform().kv.set(KEY, v);
  } catch {}
  for (const cb of listeners) cb();
}

/** the A/B gesture's action: swap, buzz, say which one is up now */
export function flipTxEngine() {
  const next: TxEngine = read() === 'html' ? 'native' : 'html';
  setTxEngine(next);
  tick();
  toast(next === 'html' ? 'HTML transcript' : 'native transcript');
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useTxEngine(): TxEngine {
  return useSyncExternalStore(subscribe, read, read);
}

/** two fingers down twice within the window = the flip gesture. Returns an
 *  onTouchStart for the View around the native transcript; the HTML engine
 *  does the same in the page (web/src/webview/main.tsx) and reports `gesture`. */
export const FLIP_WINDOW_MS = 450;
export function twoFingerDoubleTap(cb: () => void): (e: GestureResponderEvent) => void {
  let last = 0;
  return (e) => {
    if (e.nativeEvent.touches.length !== 2) return;
    const now = Date.now();
    if (now - last < FLIP_WINDOW_MS) {
      last = 0;
      cb();
    } else last = now;
  };
}
