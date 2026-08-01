import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  useAgentSession,
  useBlockedContext,
  useRoster,
} from '@herdr/shared';
import { BlockedCard } from '../../../src/components/BlockedCard';
import { Composer } from '../../../src/components/Composer';
import { LiveTail } from '../../../src/components/LiveTail';
import { ScreenMirror } from '../../../src/components/ScreenMirror';
import { Transcript } from '../../../src/components/Transcript';
import { colors, statusColor } from '../../../src/theme';

export default function AgentScreen() {
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

  const [keysPinned, setKeysPinned] = useState(false);
  const [keysForced, setKeysForced] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ sinceKey: number } | null>(null);
  const [poke, setPoke] = useState(0);
  const armRef = useRef<{ timer: ReturnType<typeof setTimeout>; sinceKey: number } | null>(null);
  const preDialogRef = useRef<{ cmd: string; lines: Set<string> } | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: agent ? agent.label || agent.title || paneId : paneId,
      headerRight: () => (
        <View style={styles.headerRight}>
          <View style={[styles.statusChip, { backgroundColor: statusColor(status) }]}>
            <Text style={styles.statusChipText}>{status ?? '—'}</Text>
          </View>
        </View>
      ),
    });
  }, [navigation, agent, paneId, status]);

  useEffect(() => {
    if (status !== 'blocked') {
      setKeysForced(false);
      setScreen(null);
    }
  }, [status]);

  const peekScreen = async () => {
    if (screen !== null) {
      setScreen(null);
      return;
    }
    try {
      const r = await get(agentPath(paneId, 'screen'));
      const { text } = (await r.json()) as { text?: string };
      setScreen((text ?? '').replace(/\n{3,}/g, '\n\n').trimEnd());
    } catch (e) {
      getPlatform().notifyError(String((e as Error).message ?? e));
    }
  };

  const closeDialog = useCallback(() => {
    if (armRef.current) {
      clearTimeout(armRef.current.timer);
      armRef.current = null;
    }
    setDialog(null);
  }, []);

  const sendFromComposer = useCallback(
    async (text: string) => {
      const slash = text.trim().startsWith('/');
      if (slash) {
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
    [send, closeDialog, paneId],
  );

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
        {
          kind: 'command_err',
          text: residue.map((l) => l.replace(/^●\s*/, '')).join('\n'),
        },
      ]);
    },
    [closeDialog, inject],
  );

  useEffect(() => {
    const since = armRef.current?.sinceKey ?? dialog?.sinceKey;
    if (since == null) return;
    const done = items.some(
      (it) =>
        it.type === 'event' &&
        it.key > since &&
        (it.ev.kind === 'command' || it.ev.kind === 'user'),
    );
    if (done) closeDialog();
  }, [items, dialog, closeDialog]);

  useEffect(() => closeDialog, [paneId, closeDialog]);

  const cancellableKey = useMemo(() => {
    if (!working) return null;
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (
        it.type === 'mine' &&
        (it.mine.state === 'sending' || it.mine.state === 'sent' || it.mine.state === 'confirmed')
      ) {
        return it.mine.key;
      }
    }
    return null;
  }, [items, working]);

  const onAnswer = async (keys: string[], expect: string | null) => {
    const r = await post(agentPath(paneId, 'answer'), { keys, expect });
    if (r.status === 409) {
      setKeysForced(true);
      getPlatform().notifyError('The screen changed — showing raw keys instead.');
      return false;
    }
    if (!r.ok) {
      getPlatform().notifyError(await errorOf(r));
      return false;
    }
    setTimeout(refresh, 600);
    return true;
  };

  const onOpenFile = useCallback(
    (path: string) => {
      router.push({
        pathname: '/agent/[paneId]/file',
        params: { paneId, path },
      });
    },
    [paneId, router],
  );

  const blocked = status === 'blocked';
  const showBlockedCard =
    blocked && !keysForced && ctx != null && ctx.kind !== 'none' && ctx.kind !== 'unknown';
  const showKeys =
    keysPinned || dialog !== null || (blocked && (keysForced || ctx?.kind === 'unknown'));

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding" keyboardVerticalOffset={insets.top + 44}>
      {blocked && (
        <View style={styles.blockedBanner}>
          <Text style={styles.blockedText}>agent is waiting on you</Text>
          <Pressable onPress={peekScreen} hitSlop={8}>
            <Text style={styles.peekBtn}>{screen !== null ? 'hide screen' : 'view screen'}</Text>
          </Pressable>
        </View>
      )}
      {screen !== null && (
        <ScrollView style={styles.screenPeek} nestedScrollEnabled>
          <Text style={styles.screenPre}>{screen}</Text>
        </ScrollView>
      )}
      {!!agent?.cwd && (
        <Text style={styles.cwd} numberOfLines={1}>
          {[agent.displayAgent ?? agent.agent, agent.cwd].filter(Boolean).join(' · ')}
        </Text>
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
      {showBlockedCard && ctx && <BlockedCard ctx={ctx} onAnswer={onAnswer} />}
      {working && !dialog && !blocked && <LiveTail paneId={paneId} />}
      {dialog && (
        <ScreenMirror
          paneId={paneId}
          poke={poke}
          onClose={closeDialog}
          onGone={onDialogGone}
        />
      )}
      <Composer
        paneId={paneId}
        working={working}
        cooldown={cooldown}
        restoredDraft={restoredDraft}
        showKeys={showKeys}
        onSend={sendFromComposer}
        onInterrupt={interrupt}
        onToggleKeys={() => setKeysPinned((p) => !p)}
        onKeyTap={() => setPoke((p) => p + 1)}
      />
      <View style={{ height: insets.bottom }} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRight: { marginRight: 4 },
  statusChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusChipText: { color: colors.accentInk, fontSize: 11, fontWeight: '700' },
  blockedBanner: {
    backgroundColor: 'rgba(247,118,142,0.2)',
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  blockedText: { color: colors.blocked, textAlign: 'center', fontWeight: '600', fontSize: 13 },
  peekBtn: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  screenPeek: {
    maxHeight: 160,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  screenPre: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: colors.sub,
    fontSize: 11,
    lineHeight: 15,
  },
  cwd: {
    color: colors.sub,
    fontSize: 11,
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
});
