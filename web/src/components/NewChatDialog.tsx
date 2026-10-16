import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dominant } from '@herdr/shared';
import { errorOf, post } from '../api';
import { rememberKind, lastKind, type SpawnTarget } from '../spawn';
import { ago, agoShort, basename, shortPath } from '../util';
import type {
  Agent,
  AgentKind,
  NewChatRequest,
  Project,
  Roster,
  SessionEntry,
  Workspace,
  WorktreeEntry,
} from '../types';

/** Where the new session starts. The launcher is place-first: pick the
 *  destination, then the agent. */
type Dest =
  | { type: 'workspace'; workspaceId: string; cwd?: string } // join an open workspace
  | { type: 'project'; path: string } // fresh workspace in a known dir
  | { type: 'worktree-open'; repoCwd: string; path: string } // open existing checkout
  | { type: 'worktree-new'; repoCwd: string } // create checkout (branch below)
  | { type: 'resume'; dir: string; sessionId: string; title: string | null; kind: string } // past session
  | { type: 'path' }; // custom dir

const destKey = (d: Dest) =>
  d.type === 'workspace' ? `ws:${d.workspaceId}`
  : d.type === 'project' ? `proj:${d.path}`
  : d.type === 'worktree-open' ? `wt:${d.path}`
  : d.type === 'worktree-new' ? `wtnew:${d.repoCwd}`
  : d.type === 'resume' ? `resume:${d.sessionId}`
  : 'path';

/** Mirror of the server's agent-name cleanup (herdr wants ^[a-z][a-z0-9_-]{0,31}$).
 *  Typed text is kept verbatim for the tab label; this is what the agent runs as. */
const cleanAgentName = (raw: string) =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .replace(/-{2,}/g, '-')
    .replace(/-+$/, '')
    .slice(0, 32);

/** Spawn-time permission mode — claude and grok share the --permission-mode
 *  vocabulary. yolo differs per kind: claude keeps the legacy flag
 *  (--permission-mode bypassPermissions needs a settings opt-in, the flag
 *  doesn't) and grok spells it --always-approve. */
type SpawnMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'yolo';
const SPAWN_MODES: Record<SpawnMode, { label: string; args: string[]; hint: string }> = {
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
// codex has no claude-style permission modes — its ladder is sandbox ×
// approval policy, mapped onto the nearest rung
const CODEX_MODE_ARGS: Record<SpawnMode, string[]> = {
  default: [],
  acceptEdits: ['--sandbox', 'workspace-write', '--ask-for-approval', 'on-request'],
  plan: ['--sandbox', 'read-only', '--ask-for-approval', 'on-request'],
  auto: ['--approve-for-me'],
  yolo: ['--dangerously-bypass-approvals-and-sandbox'],
};
const spawnModeArgs = (kind: string, m: SpawnMode) => {
  if (kind === 'codex') return CODEX_MODE_ARGS[m];
  return m === 'yolo' && kind === 'grok' ? ['--always-approve'] : SPAWN_MODES[m].args;
};
const MODE_KINDS = ['claude', 'grok', 'codex'];
const modeKey = (kind: string) => `herdr.spawnMode.${kind}`;
const lastMode = (kind: string): SpawnMode => {
  try {
    const v = localStorage.getItem(modeKey(kind));
    return v && v in SPAWN_MODES ? (v as SpawnMode) : 'default';
  } catch {
    return 'default';
  }
};
const rememberMode = (kind: string, m: SpawnMode) => {
  try {
    localStorage.setItem(modeKey(kind), m);
  } catch {}
};
// kinds whose past sessions the server can list and --resume (pi has no
// permission modes — it never asks — but resumes fine)
const RESUME_KINDS = [...MODE_KINDS, 'pi'];

/** A folder you work in — a project, its live herdr spaces, its activity.
 *  The launcher's unit of "where": herdr's workspace/project split stays
 *  under the hood (a place with a live space gets a new tab there). */
interface Place {
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

const placeKeyOf = (a: Agent) => a.repoRoot ?? a.cwd;
const placeName = (path: string) => (/^\/home\/[^/]+\/?$/.test(path) ? '~' : basename(path) || path);

function buildPlaces(roster: Roster, projects: Project[] | null): Place[] {
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
function placeDest(p: Place, roster: Roster): Dest {
  const w = p.spaces[0];
  if (!w) return { type: 'project', path: p.path };
  const inSpace = roster.agents.filter((a) => a.workspaceId === w.workspaceId);
  return {
    type: 'workspace',
    workspaceId: w.workspaceId,
    cwd: w.worktree?.checkoutPath ?? dominant(inSpace, (a) => a.cwd) ?? p.path,
  };
}

/** Modal for starting a chat. Every ＋ lands here, pre-aimed: the common
 *  case is a glance at "start claude in X" and Enter. The place list, resume
 *  and worktrees fold away until asked for. */
export function NewChatDialog({
  roster,
  target,
  onClose,
  onCreated,
}: {
  roster: Roster;
  /** pre-aim: a space's ＋, or the chat you're looking at */
  target?: SpawnTarget;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}) {
  const workspaces = roster.workspaces ?? [];
  const [kinds, setKinds] = useState<AgentKind[] | null>(null);
  const [kind, setKind] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  // repo path -> its checkouts (fetched when a place is expanded)
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeEntry[] | null>>({});
  // place key -> resumable sessions across the place's dirs
  const [sessions, setSessions] = useState<
    Record<string, (SessionEntry & { dir: string; kind: string })[] | null>
  >({});
  const [openPlace, setOpenPlace] = useState<string | null>(null);
  const places = useMemo(() => buildPlaces(roster, projects), [roster, projects]);
  const [dest, setDest] = useState<Dest>(() => {
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
  });
  // the place list stays folded when we already know where you're going
  const [picking, setPicking] = useState(() => dest.type === 'path');
  const [filter, setFilter] = useState('');
  const [cwd, setCwd] = useState('');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [argsText, setArgsText] = useState('');
  const [spawnMode, setSpawnMode] = useState<SpawnMode>('default');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branchField = useRef<HTMLInputElement>(null);
  const filterField = useRef<HTMLInputElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/kinds')
      .then((r) => r.json())
      .then((j: { kinds: AgentKind[] }) => {
        if (!alive) return;
        const sorted = [...j.kinds].sort(
          (a, b) => Number(b.installed) - Number(a.installed) || a.kind.localeCompare(b.kind),
        );
        setKinds(sorted);
        setKind((k) => k
          || (sorted.find((x) => x.kind === lastKind() && x.installed)?.kind ?? '')
          || sorted.find((x) => x.installed)?.kind
          || '');
      })
      .catch(() => alive && setError('couldn’t load agent kinds'));
    fetch('/api/projects')
      .then((r) => r.json())
      .then((j: { projects: Project[] }) => alive && setProjects(j.projects))
      .catch(() => alive && setProjects([]));
    return () => {
      alive = false;
    };
  }, []);

  // each kind remembers its own last permission mode
  useEffect(() => {
    if (kind) setSpawnMode(lastMode(kind));
  }, [kind]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  // Enter-to-start: focus the start button when the dialog opens pre-aimed
  // (not on touch — focusing there does nothing useful)
  useEffect(() => {
    if (!picking && matchMedia('(pointer: fine)').matches) startBtn.current?.focus();
    if (picking && matchMedia('(pointer: fine)').matches) filterField.current?.focus();
  }, [picking]);

  // expanding a place pulls its checkouts and resumable sessions once
  const expand = (p: Place) => {
    const next = openPlace === p.key ? null : p.key;
    setOpenPlace(next);
    if (!next) return;
    if (p.repo && worktrees[p.path] === undefined) {
      setWorktrees((w) => ({ ...w, [p.path]: null }));
      fetch(`/api/worktrees?cwd=${encodeURIComponent(p.path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { worktrees: WorktreeEntry[] }) =>
          setWorktrees((w) => ({ ...w, [p.path]: j.worktrees })),
        )
        .catch(() => setWorktrees((w) => ({ ...w, [p.path]: [] })));
    }
    // resumable sessions live per-dir and per-kind; a place can span several
    if (sessions[p.key] === undefined) {
      setSessions((s) => ({ ...s, [p.key]: null }));
      Promise.all(
        p.dirs.flatMap((d) =>
          RESUME_KINDS.map((k) =>
            fetch(`/api/sessions?cwd=${encodeURIComponent(d)}&kind=${k}`)
              .then((r) => (r.ok ? r.json() : Promise.reject()))
              .then((j: { sessions: SessionEntry[] }) =>
                j.sessions.map((s) => ({ ...s, dir: d, kind: k })))
              .catch(() => [] as (SessionEntry & { dir: string; kind: string })[]),
          ),
        ),
      ).then((lists) => {
        const merged = lists.flat().sort((a, b) => b.mtime - a.mtime).slice(0, 8);
        setSessions((s) => ({ ...s, [p.key]: merged }));
      });
    }
  };

  const pickDest = (d: Dest) => {
    setDest(d);
    if (d.type !== 'worktree-new') setPicking(false);
  };

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? places.filter((p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)) : places;
  }, [places, filter]);

  // a resume row already knows its agent kind — the kind picker is moot
  const isResume = dest.type === 'resume';
  const effKind = dest.type === 'resume' ? dest.kind : kind;

  // which place the destination sits in, and how to say it
  const destPlace =
    dest.type === 'workspace' ? places.find((p) => p.spaces.some((w) => w.workspaceId === dest.workspaceId))
    : dest.type === 'project' ? places.find((p) => p.path === dest.path)
    : dest.type === 'worktree-open' || dest.type === 'worktree-new' ? places.find((p) => p.path === dest.repoCwd)
    : dest.type === 'resume' ? places.find((p) => p.dirs.includes(dest.dir))
    : undefined;
  const destWs = dest.type === 'workspace' ? workspaces.find((w) => w.workspaceId === dest.workspaceId) : undefined;
  const destName =
    dest.type === 'path' ? (cwd.trim() ? basename(cwd.trim()) : '~')
    : dest.type === 'workspace' ? (destPlace?.name ?? destWs?.label ?? 'workspace')
    : dest.type === 'project' ? (destPlace?.name ?? basename(dest.path))
    : dest.type === 'worktree-open' ? basename(dest.path)
    : dest.type === 'worktree-new' ? (destPlace?.name ?? basename(dest.repoCwd))
    : (dest.title ?? dest.sessionId.slice(0, 8));
  const destHow =
    dest.type === 'workspace'
      ? (destPlace && destPlace.spaces.length > 1) || (destWs && destPlace && destWs.label !== destPlace.name)
        ? `new tab in space ${destWs?.number ?? '?'}${destWs?.label && destWs.label !== destName ? ` · ${destWs.label}` : ''}`
        : 'new tab in its space'
      : dest.type === 'project' ? 'fresh space'
      : dest.type === 'worktree-open' ? 'open worktree'
      : dest.type === 'worktree-new' ? 'new worktree'
      : dest.type === 'resume' ? `resume · ${dest.kind}`
      : 'fresh space · custom folder';

  const submit = async () => {
    if (!effKind || busy) return;
    setBusy(true);
    setError(null);
    const args = [
      ...(MODE_KINDS.includes(effKind) ? spawnModeArgs(effKind, spawnMode) : []),
      ...(argsText.trim() ? argsText.trim().split(/\s+/) : []),
    ];
    // an untitled resume inherits the session's title so the tab reads right
    const effName = name.trim() || (dest.type === 'resume' ? (dest.title ?? '') : '');
    const body: NewChatRequest = {
      kind: effKind,
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
      if (!branch.trim()) {
        setError('branch name required for a new worktree');
        setBusy(false);
        return;
      }
      body.worktree = { repoCwd: dest.repoCwd, branch: branch.trim() };
    } else {
      body.cwd = cwd.trim() || undefined;
    }
    try {
      const r = await post('/api/chats', body);
      if (!r.ok) throw new Error(await errorOf(r));
      rememberKind(effKind);
      if (MODE_KINDS.includes(effKind)) rememberMode(effKind, spawnMode);
      const { paneId } = (await r.json()) as { paneId: string };
      onCreated(paneId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const key = destKey(dest);
  const row = (d: Dest, label: ReactNode, extra?: ReactNode, onPick?: () => void) => (
    <button
      type="button"
      key={destKey(d)}
      className={`dest ${key === destKey(d) ? 'on' : ''}`}
      onClick={() => {
        pickDest(d);
        onPick?.();
      }}
    >
      <span className="dest-label">{label}</span>
      {extra}
    </button>
  );

  // Past sessions under an expanded place. A session already bound to a live
  // pane can't be resumed twice — its row jumps there instead.
  const sessionRows = (p: Place) => {
    const list = sessions[p.key];
    if (list === null) return <div className="dest-note sub">loading sessions…</div>;
    if (!list?.length) return null;
    return (
      <>
        <div className="dest-sec">resume</div>
        {list.map((s) => {
          const label = s.title ?? s.firstPrompt ?? s.sessionId.slice(0, 8);
          return s.livePaneId ? (
            <button type="button" key={s.sessionId} className="dest" onClick={() => onCreated(s.livePaneId!)}>
              <span className="dest-label">↻ {label}</span>
              <span className="dest-live">live</span>
            </button>
          ) : (
            row(
              { type: 'resume', dir: s.dir, sessionId: s.sessionId, title: s.title, kind: s.kind },
              <>↻ {label}</>,
              <span className="dest-badge">
                {s.kind} · {ago(s.mtime)}
              </span>,
            )
          );
        })}
      </>
    );
  };

  const details = (p: Place) => {
    const wts = worktrees[p.path];
    const subs = (wts ?? []).filter((t) => t.path !== p.path);
    return (
      <div className="dest-subs">
        {p.spaces.map((w) =>
          row(
            placeDest({ ...p, spaces: [w] }, roster),
            <>
              <span className={`status-dot ${w.status}`} />
              new tab in space {w.number}
              {w.label && w.label !== p.name ? ` · ${w.label}` : ''}
            </>,
          ),
        )}
        {row({ type: 'project', path: p.path }, p.spaces.length ? 'fresh space' : 'start here', (
          <span className="dest-badge">{shortPath(p.path)}</span>
        ))}
        {p.repo && (
          <>
            {wts === null && <div className="dest-note sub">loading worktrees…</div>}
            {subs.map((t) =>
              row(
                { type: 'worktree-open', repoCwd: p.path, path: t.path },
                <>⎇ {t.branch ?? t.label}</>,
                <span className="dest-badge">{t.openWorkspaceId ? 'open' : basename(t.path)}</span>,
              ),
            )}
            {row({ type: 'worktree-new', repoCwd: p.path }, '⎇ new worktree…', undefined, () =>
              setTimeout(() => branchField.current?.focus(), 0),
            )}
            {key === `wtnew:${p.path}` && (
              <input
                ref={branchField}
                className="dest-branch mono"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                placeholder="branch name"
                spellCheck={false}
                autoCapitalize="off"
              />
            )}
          </>
        )}
        {sessionRows(p)}
      </div>
    );
  };

  const optSummary = [
    MODE_KINDS.includes(effKind) && !isResume && spawnMode !== 'default' ? SPAWN_MODES[spawnMode].label : null,
    name.trim() ? `“${name.trim()}”` : null,
    argsText.trim() ? '+args' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal launcher"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <header className="modal-head">
          <h2>new chat</h2>
          <button type="button" className="ghost" aria-label="close" onClick={onClose}>
            ✕
          </button>
        </header>

        {/* where: the pick, as one row; tap to change */}
        <button
          type="button"
          className={`nc-where ${picking ? 'open' : ''}`}
          onClick={() => setPicking((v) => !v)}
          aria-expanded={picking}
        >
          <span className="nc-where-main">
            <span className="nc-where-name">{dest.type === 'resume' ? `↻ ${destName}` : destName}</span>
            <span className="nc-where-how sub">
              {destHow}
              {destPlace && destPlace.live > 0 && dest.type !== 'resume' ? ` · ${destPlace.live} live` : ''}
            </span>
          </span>
          <span className="nc-where-change">{picking ? 'done' : 'change'}</span>
        </button>

        {picking && (
          <div className="dest-list nc-picker">
            <input
              ref={filterField}
              className="nc-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault(); // Enter picks the top match, it doesn't start
                if (shown[0]) pickDest(placeDest(shown[0], roster));
              }}
              placeholder="filter places…"
              spellCheck={false}
              autoCapitalize="off"
            />
            {projects === null && places.length === 0 && <div className="dest-note sub">loading…</div>}
            {shown.map((p) => {
              const open = openPlace === p.key;
              const here = destPlace?.key === p.key;
              return (
                <div key={p.key}>
                  <div className={`place-row ${here && !open ? 'on' : ''}`}>
                    <button type="button" className="dest place-pick" onClick={() => pickDest(placeDest(p, roster))}>
                      <span className="dest-label">
                        {p.repo && <span className="dest-badge">⎇</span>}
                        {p.name}
                        {p.live > 0 && <span className="dest-live">{p.live} live</span>}
                      </span>
                      {p.lastActive > 0 && <span className="dest-badge">{agoShort(p.lastActive)}</span>}
                    </button>
                    <button
                      type="button"
                      className={`place-chev ${open ? 'open' : ''}`}
                      aria-label={`more ways to start in ${p.name}`}
                      aria-expanded={open}
                      onClick={() => expand(p)}
                    >
                      ›
                    </button>
                  </div>
                  {open && details(p)}
                </div>
              );
            })}
            <div className={`dest dest-path ${key === 'path' ? 'on' : ''}`}>
              <input
                value={cwd}
                onFocus={() => setDest({ type: 'path' })}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="other folder… (~ if blank)"
                list="cwd-suggestions"
                spellCheck={false}
                autoCapitalize="off"
              />
              <datalist id="cwd-suggestions">
                {places.flatMap((p) => p.dirs).map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        {/* agent: one tap, remembers the last */}
        {isResume ? (
          <div className="field-hint sub">resuming a {effKind} session</div>
        ) : (
          <div className="seg-row kind-row" role="radiogroup" aria-label="agent">
            {!kinds && <span className="sub">loading agents…</span>}
            {/* herdr knows ~two dozen kinds; only what's on PATH is a choice */}
            {kinds?.filter((k) => k.installed).map((k) => (
              <button
                type="button"
                key={k.kind}
                role="radio"
                aria-checked={kind === k.kind}
                className={`seg ${kind === k.kind ? 'on' : ''}`}
                title={k.version ?? k.kind}
                onClick={() => setKind(k.kind)}
              >
                {k.kind}
              </button>
            ))}
          </div>
        )}

        {/* the rarely-touched stuff, summarized when it's not default */}
        <button
          type="button"
          className={`nc-options-toggle ${optionsOpen ? 'open' : ''}`}
          onClick={() => setOptionsOpen((v) => !v)}
          aria-expanded={optionsOpen}
        >
          <span className="chev-mini">›</span> options
          {optSummary && <span className="sub"> · {optSummary}</span>}
        </button>
        {optionsOpen && (
          <div className="nc-options">
            {MODE_KINDS.includes(effKind) && !isResume && (
              <label className="field">
                <span>permission mode</span>
                <div className="seg-row">
                  {(Object.keys(SPAWN_MODES) as SpawnMode[]).map((m) => (
                    <button
                      type="button"
                      key={m}
                      className={`seg ${spawnMode === m ? 'on' : ''}`}
                      title={SPAWN_MODES[m].hint}
                      onClick={() => setSpawnMode(m)}
                    >
                      {SPAWN_MODES[m].label}
                    </button>
                  ))}
                </div>
                <span className="field-hint sub">{SPAWN_MODES[spawnMode].hint}</span>
              </label>
            )}
            <label className="field">
              <span>name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="optional — names the tab & agent"
                spellCheck={false}
              />
              {name.trim() && cleanAgentName(name) !== name.trim() && (
                <span className="field-hint sub">
                  agent will run as <code>{cleanAgentName(name) || 'an auto-generated name'}</code>
                  {' '}— tab keeps “{name.trim()}”
                </span>
              )}
            </label>
            <label className="field">
              <span>extra args</span>
              <input
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder="optional — passed through verbatim"
                spellCheck={false}
                autoCapitalize="off"
                className="mono"
              />
            </label>
          </div>
        )}

        {error && <div className="modal-error">{error}</div>}

        <footer className="modal-foot nc-foot">
          <button ref={startBtn} type="submit" className="btn primary nc-start" disabled={busy || !effKind}>
            {busy
              ? isResume ? 'resuming…' : `starting ${effKind}…`
              : isResume ? `resume in ${destPlace?.name ?? basename(dest.type === 'resume' ? dest.dir : '')}`
              : `start ${effKind || 'chat'} in ${destName}`}
          </button>
        </footer>
      </form>
    </div>
  );
}
