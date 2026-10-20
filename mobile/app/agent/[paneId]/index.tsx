import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  agentPath,
  errorOf,
  get,
  getPlatform,
  isTuiChrome,
  post,
  useAgentMode,
  useAgentSession,
  useBlockedContext,
  type AnswerBody,
  type RestoredDraft,
  type RewindState,
  type SessionEntry,
} from '@herdr/shared';
import { useRoster } from '../../../src/roster';
import { AgentHeader } from '../../../src/components/AgentHeader';
import { BlockedCard } from '../../../src/components/BlockedCard';
import { RewindCard, ResumeCard } from '../../../src/components/Cards';
import { Composer } from '../../../src/components/Composer';
import { LiveTail } from '../../../src/components/LiveTail';
import { ScreenMirror } from '../../../src/components/ScreenMirror';
import { Transcript } from '../../../src/components/Transcript';
import { Screen, StripeFill } from '../../../src/cyber';
import { AlarmSweep } from '../../../src/cyber-fx';
import { alpha, useStyles, type Tokens } from '../../../src/theme';

// every kind the server can list past sessions for and --resume
const RESUME_KINDS = ['claude', 'grok', 'codex', 'pi'];

export default function AgentScreen() {
  const styles = useStyles(makeStyles);
  const { paneId: raw } = useLocalSearchParams<{ paneId: string }>();
  const paneId = decodeURIComponent(raw ?? '');
  const { roster } = useRoster();
  const agent = roster.agents.find((a) => a.paneId === paneId);
  const status = agent?.status;
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { items, error, loaded, send, interrupt, cooldown, working, restoredDraft, inject } =
    useAgentSession(paneId, status, agent?.agent);
  const { ctx, refresh } = useBlockedContext(paneId, status);
  const { mode, busy: modeBusy, setMode, accept: acceptMode } = useAgentMode(paneId, agent?.agent, status);

  const [keysPinned, setKeysPinned] = useState(false);
  const [keysForced, setKeysForced] = useState(false);
  // live TUI mirror opened by hand — the blocked banner's "view screen", or a
  // multi-select card's toggle. Bottom-anchored and repainted per key tap (a
  // one-shot capture showed the top of the pane, so a prompt under the
  // shell's launch banner was off-screen).
  const [mirror, setMirror] = useState(false);
  // /rewind panel state, screen-parsed server-side; null = card closed
  const [rewind, setRewind] = useState<RewindState | null>(null);
  const [rewindBusy, setRewindBusy] = useState(false);
  // a conversation-restore hands back the rewound message as a composer draft
  const [rewindDraft, setRewindDraft] = useState<RestoredDraft | null>(null);
  const rewindNonce = useRef(0);
  // /resume typed in the composer — local override, opens the session card
  const [resumeOpen, setResumeOpen] = useState(false);
  const [dialog, setDialog] = useState<{ sinceKey: number } | null>(null);
  const [poke, setPoke] = useState(0);
  const armRef = useRef<{ timer: ReturnType<typeof setTimeout>; sinceKey: number } | null>(null);
  const preDialogRef = useRef<{ cmd: string; lines: Set<string> } | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const blocked = status === 'blocked';
  useEffect(() => {
    if (!blocked) {
      setKeysForced(false);
      setMirror(false);
    }
  }, [blocked]);

  // panel/card state is per-pane
  useEffect(() => {
    setRewind(null);
    setResumeOpen(false);
    setMirror(false);
  }, [paneId]);

  // an interrupt-restored draft outranks a stale rewind draft
  useEffect(() => {
    if (restoredDraft) setRewindDraft(null);
  }, [restoredDraft]);

  const goBack = useCallback(() => {
    if (navigation.canGoBack()) router.back();
    else router.replace('/');
  }, [navigation, router]);

  const go = useCallback((p: string) => router.push(`/agent/${encodeURIComponent(p)}`), [router]);

  const confirmClear = (msg: string) =>
    new Promise<boolean>((res) =>
      Alert.alert('rewind', `${msg}\n\nClear the TUI input line and open rewind?`, [
        { text: 'cancel', style: 'cancel', onPress: () => res(false) },
        { text: 'clear & open', onPress: () => res(true) },
      ]),
    );

  const rewindOp = useCallback(
    async function op(body: { op: string; index?: number; option?: number }, retried = false): Promise<void> {
      const r = await post(agentPath(paneId, 'rewind'), body);
      const j = (await r.json().catch(() => ({}))) as { error?: string; step?: string; draft?: string };
      if (!r.ok) {
        // a draft is stranded on the TUI composer — offer to clear it (one
        // C-c clears a non-empty claude input line) and try again
        if (
          !retried &&
          body.op === 'open' &&
          r.status === 409 &&
          /composer/.test(j.error ?? '') &&
          (await confirmClear(j.error ?? ''))
        ) {
          await post(agentPath(paneId, 'keys'), { keys: ['C-c'] }).catch(() => null);
          await new Promise((res) => setTimeout(res, 500));
          return op(body, true);
        }
        getPlatform().notifyError(j.error ?? r.statusText);
        setRewind(null);
        return;
      }
      if (j.step === 'list' || j.step === 'confirm') {
        setRewind(j as RewindState);
      } else {
        if (j.draft) setRewindDraft({ text: j.draft, n: rewindNonce.current++ });
        setRewind(null);
      }
    },
    [paneId],
  );

  const openRewind = useCallback(async () => {
    setRewindBusy(true);
    try {
      await rewindOp({ op: 'open' });
    } finally {
      setRewindBusy(false);
    }
  }, [rewindOp]);

  // /resume <id> typed with an argument: jump if that session is already live
  // in a pane, otherwise spawn a resumed pane. Prefix match spares typing a
  // full uuid; an id the list doesn't know is still tried verbatim.
  const resumeById = useCallback(
    async (id: string) => {
      const cwd = agent?.cwd ?? '';
      const kind = agent?.agent ?? 'claude';
      let title: string | null = null;
      try {
        const r = await get(`/api/sessions?cwd=${encodeURIComponent(cwd)}&kind=${encodeURIComponent(kind)}`);
        const { sessions } = (await r.json()) as { sessions: SessionEntry[] };
        const hit = sessions.find((s) => s.sessionId === id) ?? sessions.find((s) => s.sessionId.startsWith(id));
        if (hit?.livePaneId) return go(hit.livePaneId);
        if (hit) ({ sessionId: id, title } = hit);
      } catch {
        // list unavailable — try the id as typed
      }
      const r = await post('/api/chats', { kind, cwd, resume: id, name: title ?? undefined, label: title ?? undefined });
      const j = (await r.json().catch(() => ({}))) as { error?: string; paneId?: string };
      if (!r.ok) return getPlatform().notifyError(j.error ?? r.statusText);
      go(j.paneId as string);
    },
    [agent?.cwd, agent?.agent, go],
  );

  const closeDialog = useCallback(() => {
    if (armRef.current) {
      clearTimeout(armRef.current.timer);
      armRef.current = null;
    }
    setDialog(null);
  }, []);

  const sendFromComposer = useCallback(
    async (text: string) => {
      // Local overrides: commands with a first-class UI never reach the TUI —
      // the generic path below would only mirror the raw dialog. /rewind
      // opens the RewindCard (claude's panel); /resume [id] resumes into a
      // NEW pane (this one can't swap sessions under itself), or jumps if
      // already live.
      const ov = /^\/(rewind|resume)(?:\s+(\S+))?$/.exec(text.trim());
      if (ov?.[1] === 'rewind' && agent?.agent === 'claude') return openRewind();
      if (ov?.[1] === 'resume' && agent?.cwd && RESUME_KINDS.includes(agent.agent)) {
        return ov[2] ? resumeById(ov[2]) : setResumeOpen(true);
      }
      // Session switches that leave no record anywhere: pi's /new (and /clear,
      // aliased by an extension) and codex's /new only print a toast, so a
      // bubble would wait forever for its echo and the toast would read as a
      // dialog. Fire it raw — herdr reports the new session and the stream
      // resets onto it (claude's /clear does write a record, so it isn't here).
      if (
        (agent?.agent === 'pi' && /^\/(new|clear)$/.test(text.trim())) ||
        (agent?.agent === 'codex' && text.trim() === '/new')
      ) {
        const r = await post(agentPath(paneId, 'prompt'), { text: text.trim() });
        if (!r.ok) throw new Error(await errorOf(r));
        return;
      }
      const slash = text.trim().startsWith('/');
      if (slash) {
        // baseline the screen before the command runs, so dialog residue
        // (e.g. an "Unknown command" error) can be diffed out later
        try {
          const r = await get(agentPath(paneId, 'screen'));
          const { text: raw } = (await r.json()) as { text?: string };
          preDialogRef.current = {
            cmd: text.trim(),
            lines: new Set((raw ?? '').split('\n').map((l) => l.trim())),
          };
        } catch {
          preDialogRef.current = { cmd: text.trim(), lines: new Set() };
        }
      }
      await send(text);
      if (!slash) return;
      let sinceKey = -1;
      for (const it of itemsRef.current) {
        if (it.type === 'event' && it.key > sinceKey) sinceKey = it.key;
      }
      closeDialog();
      const timer = setTimeout(() => {
        armRef.current = null;
        setDialog({ sinceKey });
      }, 800);
      armRef.current = { timer, sinceKey };
    },
    [send, closeDialog, paneId, agent?.agent, agent?.cwd, openRewind, resumeById],
  );

  // The dialog closed without ever writing a session-file record (chrome came
  // back first). Whatever it printed exists only on the TUI screen — diff
  // against the pre-command baseline and inject it as a synthetic command
  // pill so the output isn't lost (e.g. "Unknown command: /mode").
  const onDialogGone = useCallback(
    (finalScreen: string) => {
      const base = preDialogRef.current;
      preDialogRef.current = null;
      closeDialog();
      if (!base) return;
      let residue = finalScreen
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !base.lines.has(l) && !isTuiChrome(l));
      if (!residue.length) return;
      if (residue.length > 12) residue = [...residue.slice(0, 12), '…'];
      inject([
        { kind: 'command', name: base.cmd, text: '' },
        { kind: 'command_err', text: residue.map((l) => l.replace(/^●\s*/, '')).join('\n') },
      ]);
    },
    [closeDialog, inject],
  );

  // command finished (its record hit the session file) → dismiss the mirror;
  // 'user' too — custom skill commands land as a plain prompt turn
  useEffect(() => {
    const since = armRef.current?.sinceKey ?? dialog?.sinceKey;
    if (since == null) return;
    const done = items.some(
      (it) => it.type === 'event' && it.key > since && (it.ev.kind === 'command' || it.ev.kind === 'user'),
    );
    if (done) closeDialog();
  }, [items, dialog, closeDialog]);

  useEffect(() => closeDialog, [paneId, closeDialog]);

  // the latest locally-sent bubble gets hold-to-stop while the agent works
  const cancellableKey = useMemo(() => {
    if (!working) return null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (it.type === 'mine' && (it.mine.state === 'sending' || it.mine.state === 'sent' || it.mine.state === 'confirmed')) {
        return it.mine.key;
      }
    }
    return null;
  }, [items, working]);

  const onAnswer = async (body: AnswerBody) => {
    const r = await post(agentPath(paneId, 'answer'), body);
    if (r.status === 409) {
      setKeysForced(true);
      getPlatform().notifyError('The screen changed — showing raw keys instead.');
      return false;
    }
    if (!r.ok) {
      getPlatform().notifyError(await errorOf(r));
      return false;
    }
    setPoke((p) => p + 1);
    setTimeout(refresh, 600);
    return true;
  };

  const onOpenFile = useCallback(
    (path: string) => {
      router.push({ pathname: '/agent/[paneId]/file', params: { paneId, path } });
    },
    [paneId, router],
  );

  const toggleMirror = useCallback(() => setMirror((m) => !m), []);

  const showBlockedCard = blocked && !keysForced && ctx != null && ctx.kind !== 'none' && ctx.kind !== 'unknown';
  const showKeys = keysPinned || dialog !== null || mirror || (blocked && (keysForced || ctx?.kind === 'unknown'));
  // grok's plan overlay is driven by a/s/q — none of which are on the default
  // pad, and Esc does not dismiss it. Keep them on the strip whenever this
  // card is up so a 409 fallback isn't another dead end.
  const extraKeys: [string, string][] =
    agent?.agent === 'grok' && ctx?.kind === 'plan' ? [['a', 'a'], ['s', 's'], ['q', 'q']] : [];

  return (
    <Screen>
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <AgentHeader
        paneId={paneId}
        agent={agent}
        status={status}
        working={working}
        mode={mode}
        modeBusy={modeBusy}
        rewindBusy={rewindBusy}
        onBack={goBack}
        onSetMode={setMode}
        onRewind={openRewind}
      />
      {blocked && (
        <View style={styles.blockedBanner}>
          <StripeFill />
          <AlarmSweep />
          <Text style={styles.blockedText}>agent is waiting on you</Text>
          <Text style={styles.peekBtn} onPress={toggleMirror}>
            {mirror ? 'hide screen' : 'view screen'}
          </Text>
        </View>
      )}
      <Transcript
        items={items}
        error={error}
        loaded={loaded}
        working={working}
        cancellableKey={cancellableKey}
        onInterrupt={interrupt}
        onOpenFile={onOpenFile}
      />
      {showBlockedCard && ctx && (
        <BlockedCard ctx={ctx} onAnswer={onAnswer} screenLive={mirror} onToggleScreen={toggleMirror} />
      )}
      {rewind && (rewind.step === 'list' || rewind.step === 'confirm') && (
        <RewindCard state={rewind} onOp={rewindOp} onClose={() => rewindOp({ op: 'cancel' })} />
      )}
      {resumeOpen && agent?.cwd && (
        <ResumeCard
          cwd={agent.cwd}
          kind={agent.agent}
          selfPaneId={paneId}
          onGo={(p) => {
            setResumeOpen(false);
            go(p);
          }}
          onClose={() => setResumeOpen(false)}
        />
      )}
      {working && !dialog && !blocked && <LiveTail paneId={paneId} onMode={acceptMode} />}
      {(dialog || mirror) && (
        <ScreenMirror
          paneId={paneId}
          poke={poke}
          pinned={!dialog}
          onClose={dialog ? closeDialog : toggleMirror}
          onGone={onDialogGone}
        />
      )}
      <Composer
        paneId={paneId}
        working={working}
        cooldown={cooldown}
        restoredDraft={rewindDraft ?? restoredDraft}
        showKeys={showKeys}
        extraKeys={extraKeys}
        onSend={sendFromComposer}
        onInterrupt={interrupt}
        onToggleKeys={() => setKeysPinned((p) => !p)}
        onKeyTap={() => setPoke((p) => p + 1)}
      />
      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
    </Screen>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
    root: { flex: 1 },
    blockedBanner: {
      backgroundColor: alpha(t.colors.blocked, t.cyber ? 0.1 : 0.2),
      padding: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      overflow: 'hidden',
    },
    blockedText: { color: t.colors.blocked, textAlign: 'center', ...t.font('ui', '600'), fontSize: t.cyber ? 12 : 13, ...t.hud, ...t.glow(t.colors.blocked, 6) },
    peekBtn: { color: t.colors.accent, fontSize: t.cyber ? 12 : 13, ...t.font('ui', '600'), ...t.hud, ...t.glow(t.colors.accent, 6) },
  });
