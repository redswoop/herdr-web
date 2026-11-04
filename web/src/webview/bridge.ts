/* The seam between the transcript page and whatever hosts it.
 *
 * Inside Capra the host is a react-native-webview: RN owns the socket and
 * pushes state in with injectJavaScript(`window.__tx.recv(...)`); the page
 * answers through window.ReactNativeWebView.postMessage. In a browser (the
 * dev harness at /webview.html) the host is harness.tsx, which drives the
 * same two functions. The page never fetches anything itself.
 *
 * PLAN-HTML-TRANSCRIPT.md §2 is the contract; bump V when a message changes
 * shape so a stale OTA bundle meets a new native shell loudly, not quietly. */
import type { Item } from '@herdr/shared';
import type { Theme } from '@herdr/shared/cyber';

export const V = 1;

export interface InitMsg {
  type: 'init';
  v: number;
  theme: Theme;
  /** cyber role overrides (chrome/live/signal/…) — the skin derives the rest */
  roles: Record<string, string>;
  /** the chat / code text-size knobs (1 = 100%) */
  fs: { chat: number; code: number };
  /** OS text scale (Dynamic Type); multiplies fs.chat */
  fontScale: number;
  platform: 'ios' | 'android' | 'web';
  /** where /api/file/raw lives for thumbnails, with its token */
  api: { baseUrl: string; token: string | null };
  paneId: string;
  host: string | null;
  /** px the native shell wants kept clear at the bottom (home indicator) */
  insetBottom: number;
}

export interface StateMsg {
  type: 'state';
  items: Item[];
  loaded: boolean;
  error: string | null;
  working: boolean;
  cancellableKey: number | null;
}

export type HostMsg = InitMsg | StateMsg | { type: 'scrollEnd' };

export type PageMsg =
  | { type: 'ready'; v: number }
  | { type: 'openFile'; path: string }
  | { type: 'openUrl'; url: string }
  | { type: 'interrupt' }
  | { type: 'copy'; text: string }
  | { type: 'away'; away: boolean; unseen: boolean }
  /** the A/B gesture (two-finger double-tap), detected in the page */
  | { type: 'gesture'; name: 'flip' }
  | { type: 'log'; level: 'log' | 'warn' | 'error'; msg: string };

type RNWebView = { postMessage(s: string): void };
declare global {
  interface Window {
    ReactNativeWebView?: RNWebView;
    __tx: { recv(msg: HostMsg): void; v: number };
    /** the browser harness hooks itself in here */
    __txHost?: (msg: PageMsg) => void;
  }
}

export const isNative = () => typeof window.ReactNativeWebView?.postMessage === 'function';

export function send(msg: PageMsg) {
  const s = JSON.stringify(msg);
  if (isNative()) window.ReactNativeWebView!.postMessage(s);
  else window.__txHost?.(msg);
}

/* ---- inbound: a tiny store the page subscribes to ---- */

type Listener = (msg: HostMsg) => void;
const listeners = new Set<Listener>();
let last: { init?: InitMsg; state?: StateMsg } = {};

export function onHost(fn: Listener): () => void {
  listeners.add(fn);
  // a late subscriber gets what already landed (init can beat the React mount)
  if (last.init) fn(last.init);
  if (last.state) fn(last.state);
  return () => listeners.delete(fn);
}

export function installBridge() {
  window.__tx = {
    v: V,
    recv(msg) {
      if (msg.type === 'init') last = { ...last, init: msg };
      else if (msg.type === 'state') last = { ...last, state: msg };
      for (const fn of listeners) fn(msg);
    },
  };
}
