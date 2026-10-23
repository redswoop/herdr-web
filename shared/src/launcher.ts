/* The launcher model behind both ＋ dialogs (web NewChatDialog, Capra
   NewChatSheet): where a session can start, the spawn-time permission
   ladder per agent kind, and what each remembers. Pure data + platform.kv;
   the dialogs own the rendering. */
import { getPlatform } from './platform';
import { dominant } from './roster-groups';
import type { Agent, NewChatRequest, Project, Roster, Workspace } from './types';

/** Where the new session starts. The launcher is place-first: pick the
 *  destination, then the agent. */
export type Dest =
  | { type: 'workspace'; workspaceId: string; cwd?: string } // join an open workspace
  | { type: 'project'; path: string } // fresh workspace in a known dir
  | { type: 'worktree-open'; repoCwd: string; path: string } // open existing checkout
  | { type: 'worktree-new'; repoCwd: string } // create checkout (branch below)
  | { type: 'resume'; dir: string; sessionId: string; title: string | null; kind: string } // past session
  | { type: 'path' }; // custom dir

export const destKey = (d: Dest): string =>
  d.type === 'workspace' ? `ws:${d.workspaceId}`
  : d.type === 'project' ? `proj:${d.path}`
  : d.type === 'worktree-open' ? `wt:${d.path}`
  : d.type === 'worktree-new' ? `wtnew:${d.repoCwd}`
  : d.type === 'resume' ? `resume:${d.sessionId}`
  : 'path';

/** Spawn-time permission mode — claude and grok share the --permission-mode
 *  vocabulary. yolo differs per kind: claude keeps the legacy flag
 *  (--permission-mode bypassPermissions needs a settings opt-in, the flag
 *  doesn't) and grok spells it --always-approve. */
export type SpawnMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'yolo';
export const SPAWN_MODES: Record<SpawnMode, { label: string; args: string[]; hint: string }> = {
  // no flag at all: whatever the agent's own settings say (claude's
  // defaultMode may well be auto) — calling this "manual" was a lie
  default: { label: 'default', args: [], hint: 'the agent’s own setting' },
  acceptEdits: {
    label: 'edits',
    args: ['--permission-mode', 'acceptEdits'],
    hint: 'file edits auto-approved',
  },
  plan: { label: 'plan', args: ['--permission-mode', 'plan'], hint: 'read-only until you approve a plan' },
  auto: { label: 'auto', args: ['--permission-mode', 'auto'], hint: 'runs tools without asking' },
  yolo: {
    label: 'yolo',
    args: ['--dangerously-skip-permissions'],
    hint: 'no permission checks at all',
  },
};
export const SPAWN_MODE_ORDER = Object.keys(SPAWN_MODES) as SpawnMode[];

// codex has no claude-style permission modes — its ladder is sandbox ×
// approval policy, mapped onto the nearest rung
const CODEX_MODE_ARGS: Record<SpawnMode, string[]> = {
  default: [],
  acceptEdits: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
  plan: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
  auto: ['--approve-for-me'],
  yolo: ['--dangerously-bypass-approvals-and-sandbox'],
};

export const spawnModeArgs = (kind: string, m: SpawnMode): string[] => {
  if (kind === 'codex') return CODEX_MODE_ARGS[m];
  return m === 'yolo' && kind === 'grok' ? ['--always-approve'] : SPAWN_MODES[m].args;
};

/** kinds that take a spawn-time permission mode */
export const MODE_KINDS = ['claude', 'grok', 'codex'];
/** kinds whose past sessions the server can list and --resume (pi has no
 *  permission modes — it never asks — but resumes fine) */
export const RESUME_KINDS = [...MODE_KINDS, 'pi'];

const modeKey = (kind: string) => `herdr.spawnMode.${kind}`;
/** each kind remembers its own last spawn mode */
export const lastMode = (kind: string): SpawnMode => {
  const v = getPlatform().kv.get(modeKey(kind));
  return v && v in SPAWN_MODES ? (v as SpawnMode) : 'default';
};
export const rememberMode = (kind: string, m: SpawnMode) => getPlatform().kv.set(modeKey(kind), m);

/** A folder you work in — a project, its live herdr spaces, its activity.
 *  The launcher's unit of "where": herdr's workspace/project split stays
 *  under the hood (a place with a live space gets a new tab there). */
export interface Place {
  key: string;
  name: string;
  path: string;
  repo: boolean;
  live: number;
  lastActive: number;
  /** open herdr spaces in this folder, most recently active first */
  spaces: Workspace[];
  dirs: string[];
}

export const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
/** /home/<user>/… (linux) or /Users/<user>/… (mac) → ~/… for display */
export const shortPath = (p: string) => p.replace(/^\/(?:home|Users)\/[^/]+/, '~');

const placeKeyOf = (a: Agent) => a.repoRoot ?? a.cwd;
const placeName = (path: string) => (/^\/(?:home|Users)\/[^/]+\/?$/.test(path) ? '~' : basename(path) || path);

export function buildPlaces(roster: Roster, projects: Project[] | null): Place[] {
  const places = new Map<string, Place>();
  const get = (key: string, seed?: Partial<Place>) => {
    let p = places.get(key);
    if (!p) {
      p = { key, name: placeName(key), path: key, repo: false, live: 0, lastActive: 0, spaces: [], dirs: [key], ...seed };
      places.set(key, p);
    }
    return p;
  };
  for (const pr of projects ?? []) {
    // a live project's lastActive is just "the roster refreshed" — the
    // agents below give the real number
    get(pr.key, { name: placeName(pr.path), path: pr.path, repo: pr.repo, dirs: pr.dirs, lastActive: pr.live ? 0 : pr.lastActive });
  }
  const agentsIn = new Map<string, Agent[]>();
  for (const a of roster.agents) {
    (agentsIn.get(a.workspaceId) ?? agentsIn.set(a.workspaceId, []).get(a.workspaceId)!).push(a);
    const k = placeKeyOf(a);
    if (!k) continue;
    const p = get(k, { repo: !!a.repoRoot });
    p.live += 1;
    p.lastActive = Math.max(p.lastActive, a.lastActiveAt ?? 0);
  }
  const spaceAt = (w: Workspace) =>
    Math.max(0, ...(agentsIn.get(w.workspaceId) ?? []).map((a) => a.lastActiveAt ?? 0));
  for (const w of roster.workspaces ?? []) {
    const k = w.worktree?.isLinked
      ? w.worktree.checkoutPath
      : (dominant(agentsIn.get(w.workspaceId) ?? [], placeKeyOf) ?? w.worktree?.checkoutPath);
    if (!k) continue; // an agentless plain space — a fresh space in the folder is the same thing
    get(k).spaces.push(w);
  }
  for (const p of places.values()) p.spaces.sort((a, b) => spaceAt(b) - spaceAt(a));
  const all = [...places.values()];
  // ~/src only shows up because something once ran there: a cold folder that
  // merely contains other places is noise
  const paths = all.map((p) => p.path);
  return all
    .filter((p) => p.live > 0 || p.spaces.length > 0 || !paths.some((q) => q !== p.path && q.startsWith(`${p.path}/`)))
    .sort((a, b) => b.lastActive - a.lastActive || b.live - a.live || a.name.localeCompare(b.name));
}

/** The default destination for a place: a new tab in its busiest live
 *  space, else a fresh space in the folder. */
export function placeDest(p: Place, roster: Roster): Dest {
  const w = p.spaces[0];
  if (!w) return { type: 'project', path: p.path };
  const inSpace = roster.agents.filter((a) => a.workspaceId === w.workspaceId);
  return {
    type: 'workspace',
    workspaceId: w.workspaceId,
    cwd: w.worktree?.checkoutPath ?? dominant(inSpace, (a) => a.cwd) ?? p.path,
  };
}

/** Where a ＋ was pressed → the launcher's opening destination. */
export function initialDest(
  roster: Roster,
  target: { workspaceId?: string; cwd?: string } | undefined,
): Dest {
  const workspaces = roster.workspaces ?? [];
  const roughPlaces = buildPlaces(roster, null);
  if (target?.workspaceId && workspaces.some((x) => x.workspaceId === target.workspaceId)) {
    const w = workspaces.find((x) => x.workspaceId === target.workspaceId)!;
    return { type: 'workspace', workspaceId: w.workspaceId, cwd: target.cwd ?? w.worktree?.checkoutPath ?? undefined };
  }
  if (target?.cwd) {
    const p = roughPlaces.find((x) => x.path === target.cwd || x.dirs.includes(target.cwd!));
    return p ? placeDest(p, roster) : { type: 'project', path: target.cwd };
  }
  return roughPlaces[0] ? placeDest(roughPlaces[0], roster) : { type: 'path' };
}

/** The place a destination sits in, if any. */
export function destPlaceOf(dest: Dest, places: Place[]): Place | undefined {
  return dest.type === 'workspace' ? places.find((p) => p.spaces.some((w) => w.workspaceId === dest.workspaceId))
    : dest.type === 'project' ? places.find((p) => p.path === dest.path)
    : dest.type === 'worktree-open' || dest.type === 'worktree-new' ? places.find((p) => p.path === dest.repoCwd)
    : dest.type === 'resume' ? places.find((p) => p.dirs.includes(dest.dir))
    : undefined;
}

/** How to say a destination: its name and the way the session starts there. */
export function describeDest(
  dest: Dest,
  roster: Roster,
  places: Place[],
  cwd: string,
): { name: string; how: string; place: Place | undefined } {
  const place = destPlaceOf(dest, places);
  const ws = dest.type === 'workspace' ? (roster.workspaces ?? []).find((w) => w.workspaceId === dest.workspaceId) : undefined;
  const name =
    dest.type === 'path' ? (cwd.trim() ? basename(cwd.trim()) : '~')
    : dest.type === 'workspace' ? (place?.name ?? ws?.label ?? 'workspace')
    : dest.type === 'project' ? (place?.name ?? basename(dest.path))
    : dest.type === 'worktree-open' ? basename(dest.path)
    : dest.type === 'worktree-new' ? (place?.name ?? basename(dest.repoCwd))
    : (dest.title ?? dest.sessionId.slice(0, 8));
  const how =
    dest.type === 'workspace'
      ? (place && place.spaces.length > 1) || (ws && place && ws.label !== place.name)
        ? `new tab in space ${ws?.number ?? '?'}${ws?.label && ws.label !== name ? ` · ${ws.label}` : ''}`
        : 'new tab in its space'
      : dest.type === 'project' ? 'fresh space'
      : dest.type === 'worktree-open' ? 'open worktree'
      : dest.type === 'worktree-new' ? 'new worktree'
      : dest.type === 'resume' ? `resume · ${dest.kind}`
      : 'fresh space · custom folder';
  return { name, how, place };
}

/** The POST /api/chats body for a destination + the option fields, or an
 *  error string when the form can't be submitted yet. */
export function buildSpawnRequest(opts: {
  dest: Dest;
  kind: string;
  spawnMode: SpawnMode;
  name: string;
  argsText: string;
  cwd: string;
  branch: string;
}): NewChatRequest | { error: string } {
  const { dest, kind, spawnMode, name, argsText, cwd, branch } = opts;
  const args = [
    ...(MODE_KINDS.includes(kind) && dest.type !== 'resume' ? spawnModeArgs(kind, spawnMode) : []),
    ...(argsText.trim() ? argsText.trim().split(/\s+/) : []),
  ];
  // an untitled resume inherits the session's title so the tab reads right
  const effName = name.trim() || (dest.type === 'resume' ? (dest.title ?? '') : '');
  const body: NewChatRequest = {
    kind,
    name: effName || undefined,
    label: effName || undefined,
    args: args.length ? args : undefined,
  };
  if (dest.type === 'resume') {
    body.cwd = dest.dir;
    body.resume = dest.sessionId;
  } else if (dest.type === 'workspace') {
    body.workspaceId = dest.workspaceId;
    body.cwd = dest.cwd;
  } else if (dest.type === 'project') {
    body.cwd = dest.path;
  } else if (dest.type === 'worktree-open') {
    body.worktree = { repoCwd: dest.repoCwd, path: dest.path };
  } else if (dest.type === 'worktree-new') {
    if (!branch.trim()) return { error: 'branch name required for a new worktree' };
    body.worktree = { repoCwd: dest.repoCwd, branch: branch.trim() };
  } else {
    body.cwd = cwd.trim() || undefined;
  }
  return body;
}

/** "3m ago" / "2h ago" / "5d ago" for picker rows and card badges */
export const ago = (ms: number, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/** "now" / "3m" / "2h" / "5d" — the compact form for list rows */
export const agoShort = (ms: number, now = Date.now()) => {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
};
