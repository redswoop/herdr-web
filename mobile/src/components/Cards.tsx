/* The two composer-driven cards that aren't a blocked prompt: /rewind's
   checkpoint picker (claude) and /resume's past-session list (every kind the
   server can --resume). Same card grammar as BlockedCard, accent-framed
   instead of hazard-taped: these are yours, not the agent's. */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { get, post, type RewindState, type SessionEntry } from '@herdr/shared';
import { Brackets } from '../cyber';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';

export function ago(ms: number): string {
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)}m ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)}h ago`;
  return `${Math.round(d / 86_400_000)}d ago`;
}

/** Two-step /rewind driver: checkpoint list → restore-type confirm. All
 *  state is screen-parsed server-side and every tap round-trips, so the card
 *  can never drift from what the TUI actually shows. */
export function RewindCard({
  state,
  onOp,
  onClose,
}: {
  state: Exclude<RewindState, { step: 'closed' } | { step: 'empty' }>;
  onOp: (body: { op: string; index?: number; option?: number }) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (id: string, body: { op: string; index?: number; option?: number }) => {
    setBusy(id);
    try {
      await onOp(body);
    } finally {
      setBusy(null);
    }
  };
  const opt = (id: string, label: string, desc: string | null | undefined, onPress: () => void, off = false, cls?: 'deny') => (
    <Pressable
      key={id}
      style={[styles.option, cls === 'deny' && styles.deny, (busy === id || off) && styles.busy]}
      disabled={busy !== null || off}
      onPress={onPress}
    >
      {busy === id ? (
        <ActivityIndicator color={t.colors.text} />
      ) : (
        <>
          <Text style={styles.optLabel}>{label}</Text>
          {!!desc && <Text style={styles.optDesc}>{desc}</Text>}
        </>
      )}
    </Pressable>
  );

  return (
    <View style={styles.card}>
      <Brackets color={t.colors.accent} />
      <View style={styles.body}>
        {state.step === 'list' && (
          <>
            <Text style={styles.qText}>⏪ restore to the point before…</Text>
            {state.checkpoints.map((c) =>
              opt(`s${c.index}`, c.message, c.detail, () => run(`s${c.index}`, { op: 'select', index: c.index }), c.current),
            )}
          </>
        )}
        {state.step === 'confirm' && (
          <>
            <Text style={styles.qText}>⏪ restore to before:</Text>
            <Text style={styles.detail}>{state.message}</Text>
            {state.effects.map((e) => (
              <Text style={styles.sub} key={e}>
                {e}
              </Text>
            ))}
            {!!state.warning && <Text style={styles.sub}>{state.warning}</Text>}
            {state.options.map((o) =>
              opt(`o${o.n}`, o.label, o.description, () => run(`o${o.n}`, { op: 'confirm', option: o.n })),
            )}
          </>
        )}
        {opt('cancel', 'cancel', null, onClose, false, 'deny')}
      </View>
    </View>
  );
}

/** Local override for /resume typed in the composer: past sessions for this
 *  pane's cwd, resumed into a NEW pane (a live session can't swap its own
 *  transcript out from under itself). Rows already bound to a live pane jump
 *  there instead of resuming twice. */
export function ResumeCard({
  cwd,
  kind,
  selfPaneId,
  onGo,
  onClose,
}: {
  cwd: string;
  kind: string;
  selfPaneId: string;
  onGo: (paneId: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    get(`/api/sessions?cwd=${encodeURIComponent(cwd)}&kind=${encodeURIComponent(kind)}`)
      .then((r) => (r.ok ? r.json() : r.json().then((j: { error?: string }) => Promise.reject(new Error(j.error)))))
      .then((j: { sessions: SessionEntry[] }) => {
        if (!dead) setSessions(j.sessions);
      })
      .catch((e) => {
        if (!dead) setError(String((e as Error).message ?? e));
      });
    return () => {
      dead = true;
    };
  }, [cwd, kind]);

  const resume = async (s: SessionEntry) => {
    setBusy(s.sessionId);
    try {
      const r = await post('/api/chats', {
        kind,
        cwd,
        resume: s.sessionId,
        name: s.title ?? undefined,
        label: s.title ?? undefined,
      });
      const j = (await r.json().catch(() => ({}))) as { error?: string; paneId?: string };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      onGo(j.paneId as string);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(null);
    }
  };

  const rows = sessions?.filter((s) => s.livePaneId !== selfPaneId);

  return (
    <View style={styles.card}>
      <Brackets color={t.colors.accent} />
      <View style={styles.body}>
        <Text style={styles.qText}>⏵ resume a session — opens a new pane</Text>
        {rows === undefined && !error && <Text style={styles.sub}>loading sessions…</Text>}
        {!!error && <Text style={styles.sub}>{error}</Text>}
        {rows && rows.length === 0 && <Text style={styles.sub}>no other sessions here</Text>}
        {rows?.map((s) => (
          <Pressable
            key={s.sessionId}
            style={[styles.option, busy === s.sessionId && styles.busy]}
            disabled={busy !== null}
            onPress={() => (s.livePaneId ? onGo(s.livePaneId) : resume(s))}
          >
            {busy === s.sessionId ? (
              <ActivityIndicator color={t.colors.text} />
            ) : (
              <>
                <Text style={styles.optLabel} numberOfLines={2}>
                  {s.title ?? s.firstPrompt ?? s.sessionId.slice(0, 8)}
                </Text>
                <Text style={[styles.optDesc, !!s.livePaneId && styles.live]}>{s.livePaneId ? 'live — jump to it' : ago(s.mtime)}</Text>
              </>
            )}
          </Pressable>
        ))}
        <Pressable style={[styles.option, styles.deny]} disabled={busy !== null} onPress={onClose}>
          <Text style={styles.optLabel}>cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.cyber ? alpha(t.colors.surface, 0.96) : t.colors.surface,
      borderTopWidth: t.cyber ? 1 : StyleSheet.hairlineWidth,
      borderTopColor: t.cyber ? alpha(t.colors.accent, 0.5) : t.colors.accent,
      padding: 12,
      ...t.boxGlow(t.colors.accent, 26, 0.3),
      maxHeight: 420,
    },
    body: { gap: 8 },
    qText: { color: t.cyber ? mix(t.colors.text, '#ffffff', 0.5) : t.colors.text, fontSize: 15, ...t.font('ui', '600'), ...t.phosphor },
    detail: {
      ...t.font('mono'),
      color: t.cyber ? mix(t.colors.accent, t.colors.text, 0.55) : t.colors.sub,
      fontSize: 12,
      backgroundColor: t.cyber ? alpha('#000000', 0.5) : t.colors.surface2,
      borderLeftWidth: t.cyber ? 2 : 0,
      borderLeftColor: t.colors.accent,
      padding: 8,
      borderRadius: t.radius.sm,
    },
    sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 12 },
    option: {
      backgroundColor: t.cyber ? alpha(t.colors.accent, 0.08) : t.colors.surface2,
      borderRadius: t.radius.md,
      padding: 12,
      borderWidth: t.cyber ? 0 : 1,
      borderColor: t.colors.hairline,
      borderLeftWidth: t.cyber ? 2 : 1,
      borderLeftColor: t.cyber ? t.colors.accent : t.colors.hairline,
    },
    deny: t.cyber
      ? { borderLeftColor: t.colors.red, backgroundColor: alpha(t.colors.red, 0.12) }
      : { borderColor: t.colors.blocked },
    busy: { opacity: 0.5 },
    optLabel: { color: t.colors.text, fontSize: 15, ...t.font('ui', '600') },
    optDesc: { ...t.font('ui'), color: t.colors.sub, fontSize: 12, marginTop: 2 },
    live: { color: t.colors.working, ...t.glow(t.colors.working, 6) },
  });
