import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { errorOf, post } from '../api';
import { rememberKind, lastKind, type SpawnTarget } from '../spawn';
import type { AgentKind, NewChatRequest, Project, Roster, WorktreeEntry } from '../types';

/** Where the new session starts. The launcher is place-first: pick the
 *  destination, then the agent. */
type Dest =
  | { type: 'workspace'; workspaceId: string; cwd?: string } // join an open workspace
  | { type: 'project'; path: string } // fresh workspace in a known dir
  | { type: 'worktree-open'; repoCwd: string; path: string } // open existing checkout
  | { type: 'worktree-new'; repoCwd: string } // create checkout (branch below)
  | { type: 'path' }; // custom dir

const destKey = (d: Dest) =>
  d.type === 'workspace' ? `ws:${d.workspaceId}`
  : d.type === 'project' ? `proj:${d.path}`
  : d.type === 'worktree-open' ? `wt:${d.path}`
  : d.type === 'worktree-new' ? `wtnew:${d.repoCwd}`
  : 'path';

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
const shortPath = (p: string) => p.replace(/^\/home\/[^/]+/, '~');

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

/** Modal form for starting a fresh agent chat: destination + kind. */
export function NewChatDialog({
  roster,
  target,
  onClose,
  onCreated,
}: {
  roster: Roster;
  /** pre-aim from a group ＋ right-click: preselect this place */
  target?: SpawnTarget;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}) {
  const workspaces = roster.workspaces ?? [];
  const [kinds, setKinds] = useState<AgentKind[] | null>(null);
  const [kind, setKind] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  // repo path -> its checkouts (fetched when a repo project is opened)
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeEntry[] | null>>({});
  const [openProject, setOpenProject] = useState<string | null>(null);
  const [dest, setDest] = useState<Dest>(() => {
    const w = target?.workspaceId
      ? workspaces.find((x) => x.workspaceId === target.workspaceId)
      : (workspaces.find((x) => x.focused) ?? workspaces[0]);
    if (target?.cwd && !w) return { type: 'path' };
    return w
      ? { type: 'workspace', workspaceId: w.workspaceId, cwd: target?.cwd ?? w.worktree?.checkoutPath ?? undefined }
      : { type: 'path' };
  });
  const [cwd, setCwd] = useState(target?.cwd ?? '');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [argsText, setArgsText] = useState('');
  const [yolo, setYolo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const branchField = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  // opening a repo project pulls its checkout list once
  const openRepo = (p: Project) => {
    const next = openProject === p.key ? null : p.key;
    setOpenProject(next);
    if (next) setDest({ type: 'project', path: p.path });
    if (next && p.repo && worktrees[p.path] === undefined) {
      setWorktrees((w) => ({ ...w, [p.path]: null }));
      fetch(`/api/worktrees?cwd=${encodeURIComponent(p.path)}`)
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((j: { worktrees: WorktreeEntry[] }) =>
          setWorktrees((w) => ({ ...w, [p.path]: j.worktrees })),
        )
        .catch(() => setWorktrees((w) => ({ ...w, [p.path]: [] })));
    }
  };

  // cwd suggestions for the custom-path row
  const cwdSuggestions = useMemo(() => {
    const dirs = new Set<string>();
    for (const a of roster.agents) if (a.cwd) dirs.add(a.cwd);
    for (const p of projects ?? []) for (const d of p.dirs) dirs.add(d);
    return [...dirs].sort();
  }, [roster, projects]);

  const submit = async () => {
    if (!kind || busy) return;
    setBusy(true);
    setError(null);
    const args = [
      ...(kind === 'claude' && yolo ? ['--dangerously-skip-permissions'] : []),
      ...(argsText.trim() ? argsText.trim().split(/\s+/) : []),
    ];
    const body: NewChatRequest = {
      kind,
      name: name.trim() || undefined,
      label: name.trim() || undefined,
      args: args.length ? args : undefined,
    };
    if (dest.type === 'workspace') {
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
      rememberKind(kind);
      const { paneId } = (await r.json()) as { paneId: string };
      onCreated(paneId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  const key = destKey(dest);
  const row = (
    d: Dest,
    label: ReactNode,
    extra?: ReactNode,
    onPick?: () => void,
  ) => (
    <button
      type="button"
      key={destKey(d)}
      className={`dest ${key === destKey(d) ? 'on' : ''}`}
      onClick={() => {
        setDest(d);
        onPick?.();
      }}
    >
      <span className="dest-label">{label}</span>
      {extra}
    </button>
  );

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

        <div className="dest-list">
          {workspaces.length > 0 && <div className="dest-sec">open workspaces</div>}
          {workspaces.map((w) =>
            row(
              {
                type: 'workspace',
                workspaceId: w.workspaceId,
                cwd: w.worktree?.checkoutPath ?? undefined,
              },
              <>
                <span className={`status-dot ${w.status}`} />
                {w.label || `workspace ${w.number}`}
              </>,
              w.worktree?.isLinked ? (
                <span className="dest-badge">⎇ {w.worktree.repoName}</span>
              ) : undefined,
            ),
          )}

          <div className="dest-sec">
            projects <span className="sub">— starts a fresh workspace</span>
          </div>
          {projects === null && <div className="dest-note sub">loading…</div>}
          {projects?.map((p) => {
            const open = openProject === p.key;
            const wts = worktrees[p.path];
            const subs = (wts ?? []).filter((t) => t.path !== p.path);
            return (
              <div key={p.key}>
                <button
                  type="button"
                  className={`dest ${!open && key === `proj:${p.path}` ? 'on' : ''}`}
                  onClick={() => openRepo(p)}
                >
                  <span className="dest-label">
                    {p.repo && <span className="dest-badge">⎇</span>}
                    {p.name}
                    {p.live > 0 && <span className="dest-live">{p.live} live</span>}
                  </span>
                  <span className="dest-badge">{shortPath(p.path)}</span>
                </button>
                {open && p.repo && (
                  <div className="dest-subs">
                    {row({ type: 'project', path: p.path }, 'main checkout', (
                      <span className="dest-badge">{shortPath(p.path)}</span>
                    ))}
                    {wts === null && <div className="dest-note sub">loading worktrees…</div>}
                    {subs.map((t) =>
                      row(
                        { type: 'worktree-open', repoCwd: p.path, path: t.path },
                        <>⎇ {t.branch ?? t.label}</>,
                        t.openWorkspaceId ? (
                          <span className="dest-badge">open</span>
                        ) : (
                          <span className="dest-badge">{basename(t.path)}</span>
                        ),
                      ),
                    )}
                    {row(
                      { type: 'worktree-new', repoCwd: p.path },
                      '＋ new worktree',
                      undefined,
                      () => branchField.current?.focus(),
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
                  </div>
                )}
                {open && !p.repo && (
                  <div className="dest-subs">
                    {row({ type: 'project', path: p.path }, 'start here', (
                      <span className="dest-badge">{shortPath(p.path)}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="dest-sec">elsewhere</div>
          <div className={`dest dest-path ${key === 'path' ? 'on' : ''}`}>
            <input
              value={cwd}
              onFocus={() => setDest({ type: 'path' })}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="~ (herdr default)"
              list="cwd-suggestions"
              spellCheck={false}
              autoCapitalize="off"
            />
            <datalist id="cwd-suggestions">
              {cwdSuggestions.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </div>
        </div>

        <label className="field">
          <span>agent</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={!kinds}>
            {!kinds && <option>loading…</option>}
            {kinds?.map((k) => (
              <option key={k.kind} value={k.kind} disabled={!k.installed}>
                {k.kind}
                {k.installed ? '' : ' (not installed)'}
              </option>
            ))}
          </select>
        </label>

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

        {kind === 'claude' && (
          <label className="checkline">
            <input type="checkbox" checked={yolo} onChange={(e) => setYolo(e.target.checked)} />
            <span>
              auto-approve tools <em className="sub">(--dangerously-skip-permissions)</em>
            </span>
          </label>
        )}

        <label className="field">
          <span>extra args</span>
          <input
            value={argsText}
            onChange={(e) => setArgsText(e.target.value)}
            placeholder="optional — e.g. --resume <id>"
            spellCheck={false}
            autoCapitalize="off"
            className="mono"
          />
        </label>

        {error && <div className="modal-error">{error}</div>}

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || !kind}>
            {busy ? `starting ${kind}…` : 'start chat'}
          </button>
        </footer>
      </form>
    </div>
  );
}
