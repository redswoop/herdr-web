export type AgentStatus = 'blocked' | 'working' | 'idle' | 'done' | 'unknown';

export interface Agent {
  /** herdr pane id; `w19:p1@blackstar` when it lives on a non-primary server (see api.splitHost) */
  paneId: string;
  workspaceId: string;
  tabId: string;
  /** registry id of the server this came from ('' = web's own origin); set by useRoster */
  host?: string;
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
  /** the harness's own session title (claude ai-title, grok generated_title, pi name) */
  sessionTitle?: string | null;
  /** first user prompt, truncated — the description of last resort */
  firstPrompt?: string | null;
  /** epoch ms: newest of transcript mtime / an observed status flip */
  lastActiveAt?: number | null;
}

export interface Workspace {
  workspaceId: string;
  host?: string;
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
  host?: string;
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
  /** session controls the adapter supports (command deck); [] = none yet */
  commands?: KindCommand[];
}

/** Shared verbs the command deck lays out in fixed slots. */
export type CommandVerb =
  | 'new'
  | 'rewind'
  | 'resume'
  | 'compact'
  | 'effort'
  | 'perms'
  | 'model'
  | 'context';

/** One deck entry, as the adapter reports it (lib/adapters.js). */
export interface KindCommand {
  verb: CommandVerb;
  label: string;
  desc?: string;
  /** slash text to fire through the composer path */
  send?: string;
  /** a first-class client panel instead of a slash command */
  ui?: 'rewind' | 'resume' | 'mode';
  /** pick list, fired as `${send} ${value}` */
  values?: string[];
  /** optional free-text argument (placeholder text) */
  arg?: string;
  /** 'session' = the pane moves to a new session file */
  effect?: 'session';
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
  /** session uuid to resume — claude and grok both take --resume; the server
   *  pins the pane's transcript binding to that session */
  resume?: string;
}

/** GET /api/sessions?cwd=&kind= — resumable sessions for one directory
 *  (kind defaults to claude; grok lists ~/.grok summary.json inventories) */
export interface SessionEntry {
  sessionId: string;
  mtime: number;
  size: number;
  /** claude's ai-title / grok's generated title, when the session earned one */
  title: string | null;
  /** first real user message, truncated — the fallback label */
  firstPrompt: string | null;
  /** already bound to a live pane: jump there instead of resuming twice */
  livePaneId: string | null;
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
  /** the server's own short name (its MagicDNS label) */
  host?: string;
  /** merged rosters only: one entry per registered server (useRoster) */
  hosts?: HostState[];
}

/** One registered server's link, as the merged roster reports it. */
export interface HostState {
  id: string;
  name: string;
  primary: boolean;
  /** its roster stream is up */
  connected: boolean;
  /** it answered 401 — token missing or rotated */
  authNeeded: boolean;
  /** the server is up but its herdr isn't */
  herdrDown: boolean;
  error?: string;
  /** its last roster's server-side stamp (0 = never heard from it) */
  updatedAt: number;
  /** client clock when we last applied a roster from it */
  syncedAt: number;
  build?: string;
}

/** GET /api/whoami */
export interface WhoAmI {
  host: string;
  publicUrl: string;
  build: string;
  bootedAt: string;
}

export type EventKind =
  | 'user'
  | 'assistant'
  | 'thought'
  | 'tool_use'
  | 'tool_result'
  | 'note'
  | 'usage' // zero-render: per-turn token accounting (grok ships it once per turn)
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
  /** output tokens + context size: claude ships it inline on message events,
   *  grok as a standalone 'usage' event at turn end */
  usage?: { out: number; ctx: number };
  /** claude: model id + effort level of the API call that produced this */
  model?: string;
  effort?: string;
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
  kind: 'text' | 'image' | 'video' | 'audio' | 'binary' | 'dir' | 'special';
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

/** GET/POST /api/agent/:id/rewind — claude's /rewind panel, screen-parsed.
 *  step 'list' is the checkpoint picker, 'confirm' the restore-type menu. */
export interface RewindCheckpoint {
  index: number;
  /** the user message this checkpoint precedes; "(current)" marks the tail */
  message: string;
  /** file-change summary lines shown under the message */
  detail: string;
  selected: boolean;
  current: boolean;
}
export type RewindState =
  | { step: 'closed' }
  | { step: 'empty' } // panel open but "Nothing to rewind to yet."
  | { step: 'list'; checkpoints: RewindCheckpoint[] }
  | {
      step: 'confirm';
      message: string;
      effects: string[];
      warning: string | null;
      options: MenuOption[];
    };

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
      /** 'ask' = AskUserQuestion drawn on screen; it has a free-text row */
      form?: 'ask';
      /** unnumbered cursor menu (claude's folder-trust prompt): digits do
       *  nothing — answer with {option}, never keys */
      nav?: true;
    }
  | {
      kind: 'plan';
      /** the plan markdown from the pending ExitPlanMode call; '' when only
       *  the screen was available */
      plan: string;
      question?: string;
      options?: MenuOption[];
      /** grok's plan.md preview (a/s/q); absent = claude's numbered menu */
      dialect?: 'claude' | 'grok';
      /** pending inline comments on grok's preview (approve-with-comments) */
      comments?: number;
    };
