import { useEffect, useMemo, useRef, useState } from 'react';
import { errorOf, post } from '../api';
import type { AgentKind, NewChatRequest, Roster } from '../types';

const NEW_WS = '__new__';

/** Modal form for starting a fresh agent chat: kind + workspace + cwd. */
export function NewChatDialog({
  roster,
  onClose,
  onCreated,
}: {
  roster: Roster;
  onClose: () => void;
  onCreated: (paneId: string) => void;
}) {
  const [kinds, setKinds] = useState<AgentKind[] | null>(null);
  const [kind, setKind] = useState('');
  const [workspaceId, setWorkspaceId] = useState(
    roster.workspaces?.find((w) => w.focused)?.workspaceId ?? roster.workspaces?.[0]?.workspaceId ?? NEW_WS,
  );
  const [cwd, setCwd] = useState('');
  const [name, setName] = useState('');
  const [argsText, setArgsText] = useState('');
  const [yolo, setYolo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstField = useRef<HTMLSelectElement>(null);

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
        setKind((k) => k || sorted.find((x) => x.installed)?.kind || '');
      })
      .catch(() => alive && setError('couldn’t load agent kinds'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    firstField.current?.focus();
  }, [kinds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  // cwd suggestions: everywhere an agent already runs, plus worktree checkouts
  const cwdSuggestions = useMemo(() => {
    const dirs = new Set<string>();
    for (const a of roster.agents) if (a.cwd) dirs.add(a.cwd);
    for (const w of roster.workspaces ?? []) {
      if (w.worktree?.checkoutPath) dirs.add(w.worktree.checkoutPath);
    }
    return [...dirs].sort();
  }, [roster]);

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
      cwd: cwd.trim() || undefined,
      workspaceId: workspaceId === NEW_WS ? undefined : workspaceId,
      args: args.length ? args : undefined,
    };
    try {
      const r = await post('/api/chats', body);
      if (!r.ok) throw new Error(await errorOf(r));
      const { paneId } = (await r.json()) as { paneId: string };
      onCreated(paneId);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal"
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

        <label className="field">
          <span>agent</span>
          <select
            ref={firstField}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={!kinds}
          >
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
          <span>workspace</span>
          <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
            {(roster.workspaces ?? []).map((w) => (
              <option key={w.workspaceId} value={w.workspaceId}>
                {w.label || `workspace ${w.number}`}
                {w.worktree?.isLinked ? ` ⎇ ${w.worktree.repoName ?? ''}` : ''}
              </option>
            ))}
            <option value={NEW_WS}>＋ new workspace</option>
          </select>
        </label>

        <label className="field">
          <span>directory</span>
          <input
            value={cwd}
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
        </label>

        <label className="field">
          <span>name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="optional — names the tab & agent"
            spellCheck={false}
          />
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
