import { useState } from 'react';

/**
 * Full-screen unlock shown when the server answers 401. Pasting the token
 * probes an API URL with ?token= — the server sets the year-long cookie on
 * that response (works through the vite proxy too), then a reload boots
 * the app normally.
 */
export function TokenGate() {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = token.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/roster?token=${encodeURIComponent(t)}`);
      if (r.status === 401) {
        setError('that token didn’t match');
        setBusy(false);
        return;
      }
      if (!r.ok) throw new Error(r.statusText);
      location.reload();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div className="token-gate">
      <form
        className="token-card"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="placeholder-emoji">🔒</div>
        <h2>this herd is fenced</h2>
        <p className="sub">
          paste the access token (from <code>HERDR_WEB_TOKEN</code> on the server), or open a{' '}
          <code>?token=…</code> link
        </p>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="access token"
          autoFocus
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
        />
        {error && <div className="modal-error">{error}</div>}
        <button type="submit" className="btn primary" disabled={busy || !token.trim()}>
          {busy ? 'checking…' : 'unlock'}
        </button>
      </form>
    </div>
  );
}
