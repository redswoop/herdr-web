import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  MODE_KINDS,
  RESUME_KINDS,
  SPAWN_MODES,
  SPAWN_MODE_ORDER,
  buildPlaces,
  buildSpawnRequest,
  cleanAgentName,
  describeDest,
  destKey,
  initialDest,
  lastMode,
  placeDest,
  rememberMode,
  type Dest,
  type Place,
  type SpawnMode,
} from '@herdr/shared';
import { errorOf, post } from '../api';
import { rememberKind, lastKind, type SpawnTarget } from '../spawn';
import { ago, agoShort, basename, shortPath } from '../util';
import type { AgentKind, Project, Roster, SessionEntry, WorktreeEntry } from '../types';

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
  const [dest, setDest] = useState<Dest>(() => initialDest(roster, target));
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
  const { name: destName, how: destHow, place: destPlace } = describeDest(dest, roster, places, cwd);

  const submit = async () => {
    if (!effKind || busy) return;
    const body = buildSpawnRequest({ dest, kind: effKind, spawnMode, name, argsText, cwd, branch });
    if ('error' in body) {
      setError(body.error);
      return;
    }
    setBusy(true);
    setError(null);
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
                  {SPAWN_MODE_ORDER.map((m) => (
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
