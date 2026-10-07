/** Mirror of lib/scene.js shapes. */
export interface SceneCard {
  id: string;
  plugin: string;
  title: string | null;
  props: Record<string, unknown>;
  /** last source emission (command-watch etc.); null for static plugins */
  data: unknown;
  /** last button press on this card and what came of it */
  lastAction?: ActionResult;
  mountedAt: number;
  updatedAt: number;
}

export interface ActionResult {
  name: string;
  at: number;
  ok: boolean;
  text: string;
}

/** service-control's `data` payload */
export interface ServiceData {
  at: number;
  ok: boolean;
  err?: string;
  load: string | null;
  active: string | null;
  sub: string | null;
  result: string | null;
  pid: number | null;
  restarts: number;
  description: string | null;
  uptimeSec: number | null;
  log?: string;
}

export interface Scene {
  scope: string;
  rev: number;
  cards: SceneCard[];
}

export type SceneOp =
  | { op: 'mount'; plugin: string; id?: string; title?: string; props?: Record<string, unknown>; at?: number }
  | { op: 'update'; id: string; title?: string; props?: Record<string, unknown> }
  | { op: 'unmount'; id: string }
  | { op: 'move'; id: string; to: number }
  | { op: 'clear' };

/** command-watch's `data` payload */
export interface WatchData {
  at: number;
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  ms: number;
  out: string;
  err: string;
  value?: number;
  kv?: [string, string][];
  history?: { t: number; v: number }[];
}
