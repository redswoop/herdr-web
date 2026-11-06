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
  /** a parked claude: the session the pane was parked from (still its own — not resumable elsewhere) */
  continuedFrom?: string | null;
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
  entries?: DirEntry[];
  clipped?: boolean;
}

/** a folder row; mtime is ms. Order is the server's (?sort=&desc=), folders first. */
export interface DirEntry {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
}

/** GET /api/file?sort= — `desc` unset means the natural direction (A→Z, biggest, newest);
 *  `kind` groups by type (folders, images, video, audio, then by extension) */
export type DirSort = 'name' | 'kind' | 'size' | 'mtime';

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
  /** multi-select ask: commit the ticked boxes — walks ❯ onto the TUI's
   *  Submit row, Enters, and clears the "Review your answers" confirm */
  submit?: true;
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
      /** multi-select ask: the unnumbered "Submit" cursor row that commits the
       *  ticked boxes, drawn right after option `after` */
      submit?: { after: number; selected: boolean };
      /** options scrolled under the pinned Submit/Chat footer (short pane): numbering has holes */
      scrolled?: boolean;
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

// ---------- signals (lib/signals.js) ----------

export type SignalState = 'ok' | 'warn' | 'alarm' | 'busy' | 'idle' | 'needs-you' | 'down';
export type SignalKind = 'gauge' | 'job' | 'list' | 'text';
/** the three things a human tells apart at a glance; null = plain */
export type SignalTone = 'needs-you' | 'broken' | 'working' | null;

export interface SignalItem {
  id: string;
  label: string;
  sub?: string;
  state?: SignalState;
  pct?: number;
  href?: string;
  at?: number | null;
  /** a swatch, e.g. a filament colour (#rrggbb) */
  color?: string | null;
  /** scene casts: the row inside the referenced list signal this pick is about */
  item?: string | null;
}

/** One probed fact. The fields past `detail` are per-kind extras. */
export interface Signal {
  key: string;
  source: string;
  kind: SignalKind;
  title: string;
  sub?: string;
  state: SignalState;
  tone?: SignalTone;
  host?: string;
  detail?: string;
  /** failures: what the output means, one line for a human */
  meaning?: string | null;
  /** failures: commits in the job's cwd since it finished */
  commitsSince?: number | null;
  actionHelp?: Record<string, string>;
  href?: string;
  updatedAt: number;
  /** gauges: the number the sparkline tracks */
  value?: number | null;
  unit?: string;
  total?: number | null;
  used?: number;
  pct?: number | null;
  /** jobs */
  done?: number | null;
  eta?: number | null;
  rate?: number | null;
  phase?: string;
  jobState?: string;
  needs?: string;
  startedAt?: number | null;
  /** bambu: temperatures, layer, and the tray feeding the nozzle */
  temps?: { nozzle: number | null; nozzleTarget: number | null; bed: number | null; bedTarget: number | null; chamber: number | null };
  layer?: { n: number; of: number } | null;
  wifi?: string | null;
  feeding?: { unit: number | null; slot: number | null; type?: string; color: string | null; remain: number | null } | null;
  finishedAt?: number | null;
  runMs?: number | null;
  /** lists */
  items?: SignalItem[];
  /** gpu/host extras */
  mem?: { used: number; total: number } | null;
  temp?: number;
  power?: number | null;
  powerLimit?: number | null;
  self?: boolean;
  remote?: boolean;
  /** the session this belongs to, if the probe could tell */
  attach?: { cwd?: string; repoRoot?: string; paneId?: string };
  actions?: string[];
  /** store-kept: [[epoch ms, value]…] */
  history?: [number, number][];
  since?: number;
  first?: number;
  expiresAt?: number;
  /** herd beats (kind text, key beat:<paneId>) */
  status?: AgentStatus;
  agent?: string;
  cwd?: string | null;
  turns?: number;
  asked?: string;
  said?: string;
  turnAt?: number | null;
  recap?: { now: string; next: string; at: number; model?: string } | null;
  /** scene casts (kind list, key scene:<paneId>): who picked them */
  by?: 'director' | 'rule';
}

export interface SignalSource {
  id: string;
  title: string;
  every: number;
  ok: boolean | null;
  error: string | null;
  ranAt: number;
  ms: number;
}

export interface SignalSnapshot {
  signals: Signal[];
  sources: SignalSource[];
  updatedAt: number;
}
