/**
 * Platform seam: the only browser/RN touchpoints the shared hooks need.
 * Web and mobile each register an adapter before mounting UI.
 */

export interface SseClient {
  addEventListener(type: string, listener: (e: MessageEvent) => void): void;
  removeEventListener?(type: string, listener: (e: MessageEvent) => void): void;
  onopen: ((ev?: Event) => void) | null;
  onerror: ((ev?: Event) => void) | null;
  /** true when the stream is closed / unusable */
  isClosed(): boolean;
  close(): void;
}

export interface KvStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Platform {
  openSse(url: string): SseClient;
  kv: KvStore;
  /** Subscribe to foreground/online wake events. Returns unsubscribe. */
  onWake(cb: () => void): () => void;
  isForeground(): boolean;
  notifyError(msg: string): void;
}

let platform: Platform | null = null;

export function setPlatform(p: Platform): void {
  platform = p;
}

export function getPlatform(): Platform {
  if (!platform) throw new Error('@herdr/shared: platform not registered — call setPlatform() first');
  return platform;
}
