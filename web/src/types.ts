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

export type EventKind = 'user' | 'assistant' | 'thought' | 'tool_use' | 'tool_result' | 'note';

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
}

export type Item =
  | { type: 'event'; ev: TEvent; key: number }
  | { type: 'mine'; mine: Mine };

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
  | { kind: 'permission'; tool: string; detail: string }
  | {
      kind: 'menu';
      header: string;
      question: string;
      detail: string;
      options: { n: number; label: string; description: string; selected: boolean }[];
    };
