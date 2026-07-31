export type AgentStatus = 'blocked' | 'working' | 'idle' | 'done' | 'unknown';

export interface Agent {
  paneId: string;
  workspaceId: string;
  agent: string;
  title: string;
  status: AgentStatus;
  cwd: string | null;
  revision: number;
  hasTranscript: boolean;
  sessionId: string | null;
}

export interface Roster {
  agents: Agent[];
  herdrDown?: boolean;
  error?: string;
  updatedAt: number;
  build?: string;
  bootedAt?: string;
}

export type EventKind =
  | 'user'
  | 'assistant'
  | 'thought'
  | 'tool_use'
  | 'tool_result'
  | 'note'
  | 'salvage' // client-only: screen capture taken at interrupt time
  | 'interrupted'; // client-only: divider marking where the stream was cut

export interface TEvent {
  kind: EventKind;
  text: string;
  name?: string;
  ts?: string;
  id?: string;
  input?: unknown;
}

/** A locally-sent prompt: rendered instantly, reconciled against the session file. */
export type MineState = 'sending' | 'sent' | 'confirmed' | 'stopping' | 'stopped';
export interface Mine {
  key: number;
  text: string;
  state: MineState;
  /** this bubble already consumed its session-file user event (stopped bubbles
   *  keep their ⏹ state, so the flag stops them swallowing a re-send of the
   *  same text) */
  reconciled?: boolean;
}

/** A stopped prompt handed back to the composer; n makes repeats distinct. */
export interface RestoredDraft {
  text: string;
  n: number;
}

/** `at` is the sort key (ms): events use their session-file timestamp, local
 *  items (bubbles, salvage, divider) use server time or a monotonic fallback,
 *  so late-arriving stream events insert above the interrupt marker. */
export type Item =
  | { type: 'event'; ev: TEvent; key: number; at: number }
  | { type: 'mine'; mine: Mine; at: number };

export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export type BlockedCtx =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'ask'; questions: AskQuestion[] }
  | {
      kind: 'permission';
      tool: string;
      detail: string;
      /** real options parsed off the screen; absent when the parse failed */
      options?: { n: number; label: string; description: string; selected: boolean }[];
    }
  | {
      kind: 'menu';
      header: string;
      question: string;
      detail: string;
      options: { n: number; label: string; description: string; selected: boolean }[];
    };
