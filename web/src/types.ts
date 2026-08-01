export type AgentStatus = 'blocked' | 'working' | 'idle' | 'done' | 'unknown';

export interface Agent {
  paneId: string;
  workspaceId: string;
  tabId: string;
  agent: string;
  /** herdr's pretty name for the agent binary (e.g. "Claude Code") */
  displayAgent: string | null;
  /** user-assigned pane label in herdr */
  label: string | null;
  title: string;
  status: AgentStatus;
  cwd: string | null;
  /** root of the git repo containing cwd (server-side .git walk), if any */
  repoRoot: string | null;
  /** this pane currently has focus in the TUI */
  focused: boolean;
  /** agent.start issued but the process hasn't come up yet */
  launchPending: boolean;
  /** freeform per-pane labels herdr's detectors attach (mode, model, …) */
  stateLabels: Record<string, string>;
  revision: number;
  hasTranscript: boolean;
  sessionId: string | null;
}

export interface Workspace {
  workspaceId: string;
  number: number;
  label: string;
  focused: boolean;
  /** herdr's rollup over the workspace's panes */
  status: AgentStatus;
  worktree: {
    repoName: string | null;
    repoRoot: string | null;
    isLinked: boolean;
    checkoutPath: string | null;
  } | null;
}

export interface Tab {
  tabId: string;
  workspaceId: string;
  number: number;
  /** herdr's display label — the tab's position number unless renamed */
  label: string;
  focused: boolean;
  paneCount: number;
  status: AgentStatus;
}

export interface AgentKind {
  kind: string;
  version: string | null;
  /** the kind's executable is on the daemon's PATH */
  installed: boolean;
}

export interface NewChatRequest {
  kind: string;
  name?: string;
  cwd?: string;
  /** omit to create a fresh workspace */
  workspaceId?: string;
  label?: string;
  args?: string[];
  /** create (branch) or open (path) a worktree-bound workspace and start there */
  worktree?: { repoCwd: string; branch?: string; base?: string; path?: string };
}

/** GET /api/projects — everywhere agents run or have run, repo-collapsed */
export interface Project {
  key: string;
  path: string;
  name: string;
  repo: boolean;
  /** live agent count right now */
  live: number;
  lastActive: number;
  dirs: string[];
}

/** GET /api/worktrees?cwd= — a repo's checkouts (herdr worktree.list) */
export interface WorktreeEntry {
  path: string;
  branch: string | null;
  label: string;
  openWorkspaceId: string | null;
  isLinked: boolean;
}

export interface Roster {
  agents: Agent[];
  workspaces?: Workspace[];
  tabs?: Tab[];
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
  | 'command' // slash command run in the TUI (name = /command, text = args)
  | 'command_out' // its stdout; merged into the preceding command pill
  | 'command_err' // client-only: error text salvaged off the screen; rendered expanded
  | 'salvage' // client-only: screen capture taken at interrupt time
  | 'interrupted'; // client-only: divider marking where the stream was cut

export interface TEvent {
  kind: EventKind;
  text: string;
  name?: string;
  ts?: string;
  id?: string;
  input?: unknown;
  /** API message id — usage repeats per content-block line, dedupe on this */
  msgId?: string;
  /** claude only: output tokens + context size for the API call */
  usage?: { out: number; ctx: number };
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

/** GET /api/file — server-side stat + read of a path on the host */
export interface FileInfo {
  path: string;
  size: number;
  mtime: number;
  kind: 'text' | 'image' | 'binary' | 'dir' | 'special';
  content?: string;
  truncated?: boolean;
  entries?: { name: string; dir: boolean }[];
  clipped?: boolean;
}

export interface AskQuestion {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[];
}

export interface MenuOption {
  n: number;
  label: string;
  description: string;
  selected: boolean;
  /** free-text row (plan feedback): typing goes here, digits don't select */
  input?: boolean;
}

/** POST /api/agent/:id/answer — either raw keys+expect, or cursor navigation */
export interface AnswerBody {
  keys?: string[];
  expect?: string | null;
  /** arrow the ❯ onto this option and Enter (safe on free-text-row menus) */
  option?: number;
  /** type into the menu's free-text row and Enter (plan reject-with-feedback) */
  feedback?: string;
}

/** claude's permission modes, footer-parsed server-side (GET/POST /mode) */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions';
export type ModeState = PermissionMode | 'unknown';

export type BlockedCtx =
  | { kind: 'none' }
  | { kind: 'unknown' }
  | { kind: 'ask'; questions: AskQuestion[] }
  | {
      kind: 'permission';
      tool: string;
      detail: string;
      /** real options parsed off the screen; absent when the parse failed */
      options?: MenuOption[];
    }
  | {
      kind: 'menu';
      header: string;
      question: string;
      detail: string;
      options: MenuOption[];
    }
  | {
      kind: 'plan';
      /** the plan markdown from the pending ExitPlanMode call; '' when only
       *  the screen was available */
      plan: string;
      question?: string;
      options?: MenuOption[];
    };
