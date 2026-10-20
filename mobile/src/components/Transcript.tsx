import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  AUX_LABEL,
  EPOCH_MS,
  HERDING,
  MINE_STATUS,
  buildNodes,
  clip,
  firstLine,
  fmtDur,
  fmtTok,
  stepFile,
  stepSummary,
  type Item,
  type Mine,
  type Node,
  type Step,
  type TEvent,
} from '@herdr/shared';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';
import { MdView, mdIsWide } from './MdView';
import { SegText } from './SegText';

import { transcriptDebug } from './debug';
export { transcriptDebug };

export function Transcript({
  items,
  error,
  loaded,
  working,
  cancellableKey,
  onInterrupt,
  onOpenFile,
}: {
  items: Item[];
  error: string | null;
  loaded: boolean;
  working: boolean;
  cancellableKey: number | null;
  onInterrupt: () => void;
  onOpenFile: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const listRef = useRef<FlatList>(null);
  // scrolled up into history: the newest cell is off the bottom. New content
  // then arrives out of sight, so a pill offers the way back (web's jump pill).
  const [away, setAway] = useState(false);
  const [fresh, setFresh] = useState(false);
  const last = items[items.length - 1];
  const lastKey = !last ? '' : last.type === 'mine' ? `m${last.mine.key}` : `e${last.key}`;
  useEffect(() => {
    if (away) setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);
  useEffect(() => {
    if (!away) setFresh(false);
  }, [away]);
  const nodes = useMemo(() => buildNodes(items, working), [items, working]);
  // inverted list: reverse so newest is near index 0 (keyboard side)
  const data = useMemo(() => {
    const showPill = working && nodes[nodes.length - 1]?.type !== 'group';
    const list: Array<Node | { type: 'working' }> = showPill
      ? [...nodes, { type: 'working' }]
      : nodes;
    return [...list].reverse();
  }, [nodes, working]);

  if (items.length === 0) {
    return (
      <View style={styles.emptyWrap}>
        {working ? (
          <WorkingPill />
        ) : (
          (error || loaded) && (
            <Text style={styles.empty}>{error ?? 'fresh session — say something'}</Text>
          )
        )}
      </View>
    );
  }

  return (
    <View style={styles.list}>
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={data}
      inverted={!transcriptDebug.noInverted}
      onScroll={(e) => {
        const y = e.nativeEvent.contentOffset.y;
        setAway((a) => (a ? y > 80 : y > 240));
      }}
      scrollEventThrottle={100}
      keyExtractor={(n, i) => ('key' in n ? n.key : `w${i}`)}
      maintainVisibleContentPosition={
        transcriptDebug.noMvcp ? undefined : { minIndexForVisible: 0, autoscrollToTopThreshold: 120 }
      }
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item: n }) => {
        const key = 'key' in n ? n.key : 'working';
        const cell = renderNode(n);
        if (!transcriptDebug.log) return cell;
        return (
          <View
            onLayout={(e) => {
              const l = e.nativeEvent.layout;
              const what =
                n.type === 'item'
                  ? `${n.item.type === 'mine' ? 'mine' : n.item.ev.kind} ${n.item.type === 'mine' ? n.item.mine.text.length : n.item.ev.text.length}ch`
                  : n.type;
              console.log(`[cell] ${key} ${what} h=${Math.round(l.height)} y=${Math.round(l.y)} w=${Math.round(l.width)}`);
            }}
          >
            {cell}
          </View>
        );
      }}
    />
    {away && (
      <Pressable
        style={[styles.pill, fresh && styles.pillFresh]}
        onPress={() => listRef.current?.scrollToOffset({ offset: 0, animated: true })}
        accessibilityLabel="jump to latest"
      >
        <Icon name="down" size={16} color={fresh ? t.colors.accentInk : t.colors.accent} />
        {fresh && <Text style={styles.pillText}>new</Text>}
      </Pressable>
    )}
    </View>
  );

  function renderNode(n: (typeof data)[number]) {
        if (n.type === 'working') return <WorkingPill />;
        if (n.type === 'group') {
          return <ActivityGroup node={n} live={working && n === nodes[nodes.length - 1]} onOpenFile={onOpenFile} />;
        }
        if (n.type === 'meta') return <TurnMeta dur={n.dur} tok={n.tok} ctx={n.ctx} />;
        if (n.type === 'command') {
          return <CommandPill name={n.name} args={n.args} out={n.out} err={n.err} />;
        }
        const it = n.item;
        return it.type === 'mine' ? (
          <MineBubble
            mine={it.mine}
            cancellable={it.mine.key === cancellableKey}
            onInterrupt={onInterrupt}
            onOpenFile={onOpenFile}
          />
        ) : (
          <EventNode ev={it.ev} onOpenFile={onOpenFile} />
        );
  }
}

function WorkingPill() {
  const styles = useStyles(makeStyles);
  const [i] = useState(() => Math.floor(Math.random() * HERDING.length));
  return (
    <View style={styles.activity}>
      <View style={styles.actHead}>
        <View style={styles.liveDot} />
        <Text style={styles.actCount}>{HERDING[i]}…</Text>
      </View>
    </View>
  );
}

// memo'd: `ev` objects are stable references across SSE batches (applyEvents
// copies the array, not the events) and onOpenFile is useCallback'd upstream —
// so streaming re-renders skip every already-rendered row.
const EventNode = memo(function EventNode({
  ev,
  onOpenFile,
}: {
  ev: TEvent;
  onOpenFile: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  if (ev.kind === 'interrupted') {
    return <Text style={styles.interrupt}>⏹ interrupted</Text>;
  }
  if (ev.kind === 'note' && ev.name === 'compact') {
    return <Text style={styles.interrupt}>⟲ context compacted</Text>;
  }
  // pi: a turn that died (model error, abort) is the reply — show it, don't
  // fold it under a generic note
  if (ev.kind === 'note' && ev.name === 'aborted') {
    return <Text style={styles.interrupt}>⏹ turn interrupted</Text>;
  }
  if (ev.kind === 'note' && ev.name === 'error') {
    return (
      <View style={styles.noteError}>
        <SegText style={[styles.pre, styles.cmdErr]} text={`⚠ ${clip(ev.text)}`} />
      </View>
    );
  }
  // long-press copies the whole message — replaces per-glyph selection, which
  // is disabled while the selectable/Fabric black-box bug is in play (MdView)
  if (ev.kind === 'user') {
    return (
      <Pressable
        style={({ pressed }) => [styles.msg, styles.user, mdIsWide(ev.text) && styles.msgWide, pressed && styles.copyPress]}
        onLongPress={() => Clipboard.setStringAsync(ev.text)}
      >
        {t.cyber && <Text style={styles.you}>▸ YOU</Text>}
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </Pressable>
    );
  }
  if (ev.kind === 'assistant') {
    return (
      <Pressable
        style={({ pressed }) => [styles.msg, styles.assistant, mdIsWide(ev.text) && styles.msgWide, pressed && styles.copyPress]}
        onLongPress={() => Clipboard.setStringAsync(ev.text)}
      >
        {t.cyber && <View style={styles.diamond} />}
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </Pressable>
    );
  }
  return (
    // emoji in the shared labels don't draw on iOS (two '?' glyphs) — words only
    <Details label={(AUX_LABEL[ev.kind] ?? ev.kind).replace(/^[^\p{L}]+/u, '')} body={clip(ev.text)} />
  );
});

function Details({ label, body }: { label: string; body: string }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.aux}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Text style={styles.auxSum}>{label}</Text>
      </Pressable>
      {open && <SegText style={styles.pre} text={body} />}
    </View>
  );
}

function ActivityGroup({
  node,
  live,
  onOpenFile,
}: {
  node: Node & { type: 'group' };
  live: boolean;
  onOpenFile: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const tools = node.steps.filter((s) => s.type === 'tool');
  const thoughts = node.steps.length - tools.length;
  const tally = new Map<string, number>();
  for (const t of tools) if (t.type === 'tool') tally.set(t.name, (tally.get(t.name) ?? 0) + 1);
  const names = [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([n, c]) => (c > 1 ? `${n} ×${c}` : n))
    .join(' · ');
  const last = node.steps[node.steps.length - 1];
  const runningName = last?.type === 'tool' && last.result === null ? last.name : 'thinking';
  const dur =
    node.startAt > EPOCH_MS && node.endAt > node.startAt ? node.endAt - node.startAt : null;
  const count = tools.length
    ? `${tools.length} tool${tools.length === 1 ? '' : 's'}`
    : `thought${thoughts === 1 ? '' : ` ×${thoughts}`}`;

  return (
    <View style={styles.activity}>
      <Pressable style={styles.actHead} onPress={() => setOpen((o) => !o)}>
        <Icon
          name={open ? 'chevron-down' : 'chevron-right'}
          size={14}
          color={t.colors.sub}
          style={styles.chev}
        />
        {live ? (
          <>
            <View style={styles.liveDot} />
            <Text style={styles.actCount}>{runningName}…</Text>
          </>
        ) : (
          <Text style={styles.actCount}>{count}</Text>
        )}
        {!!names && <Text style={styles.actNames} numberOfLines={1}>{names}</Text>}
        {dur !== null && dur >= 1000 && <Text style={styles.actDur}>{fmtDur(dur)}</Text>}
      </Pressable>
      {open &&
        node.steps.map((s) => <StepRow key={s.key} step={s} onOpenFile={onOpenFile} />)}
    </View>
  );
}

function StepRow({ step, onOpenFile }: { step: Step; onOpenFile: (path: string) => void }) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  if (step.type === 'thought' || step.type === 'result') {
    return (
      <View style={styles.step}>
        <Pressable style={styles.stepHead} onPress={() => setOpen((o) => !o)}>
          <Text style={styles.stepName}>{step.type === 'thought' ? '💭' : 'result'}</Text>
          <Text style={styles.stepSum} numberOfLines={1}>
            {firstLine(step.text)}
          </Text>
        </Pressable>
        {open && <SegText style={styles.pre} text={clip(step.text)} />}
      </View>
    );
  }
  const file = stepFile(step.name, step.input);
  return (
    <View style={styles.step}>
      <Pressable style={styles.stepHead} onPress={() => setOpen((o) => !o)}>
        <Text style={styles.stepName}>{step.name}</Text>
        <Pressable
          onPress={file ? () => onOpenFile(file) : undefined}
          style={{ flex: 1 }}
        >
          <Text style={[styles.stepSum, file ? styles.stepFile : null]} numberOfLines={1}>
            {stepSummary(step.name, step.input, step.args)}
          </Text>
        </Pressable>
        {step.result === null && <Text style={styles.pending}>…</Text>}
      </Pressable>
      {open && (
        <View>
          {!!step.args && <SegText style={styles.pre} text={clip(step.args)} />}
          {step.result !== null && (
            <>
              <Text style={styles.detailLabel}>result</Text>
              <SegText style={styles.pre} text={clip(step.result)} />
            </>
          )}
        </View>
      )}
    </View>
  );
}

function CommandPill({
  name,
  args,
  out,
  err,
}: {
  name: string;
  args: string;
  out: string;
  err: string;
}) {
  const styles = useStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const label = [name || 'command output', args].filter(Boolean).join(' ');
  return (
    <View style={styles.cmd}>
      <Pressable onPress={out ? () => setOpen((o) => !o) : undefined} style={styles.cmdHead}>
        <Text style={styles.cmdGlyph}>⌘</Text>
        <Text style={styles.cmdName} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      {open && !!out && <SegText style={styles.pre} text={clip(out)} />}
      {!!err && <SegText style={[styles.pre, styles.cmdErr]} text={clip(err)} />}
    </View>
  );
}

const TurnMeta = memo(function TurnMeta({
  dur,
  tok,
  ctx,
}: {
  dur: number | null;
  tok: number;
  ctx: number | null;
}) {
  const styles = useStyles(makeStyles);
  const parts = [
    dur !== null ? fmtDur(dur) : null,
    tok > 0 ? `${fmtTok(tok)} tokens` : null,
    ctx !== null && ctx > 0 ? `ctx ${fmtTok(ctx)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <Text style={styles.turnMeta}>{parts.join(' · ')}</Text>;
});

const MineBubble = memo(function MineBubble({
  mine,
  cancellable,
  onInterrupt,
  onOpenFile,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
  onOpenFile?: (path: string) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  // View (not Pressable) so message text stays selectable; hold-to-stop lives
  // on the status line only; bubble-body long-press copies (the status Text
  // captures its own long-press first, so stop and copy don't collide).
  return (
    <Pressable
      style={({ pressed }) => [
        styles.mine,
        mdIsWide(mine.text) && styles.mineWide,
        cancellable && styles.mineCancellable,
        pressed && styles.copyPress,
      ]}
      onLongPress={() => Clipboard.setStringAsync(mine.text)}
    >
      <MdView src={mine.text} onOpenFile={onOpenFile} />
      <Text
        style={styles.mineStatus}
        onLongPress={cancellable ? onInterrupt : undefined}
        accessibilityHint={cancellable ? 'Long press to stop' : undefined}
      >
        {cancellable ? 'hold to stop · ' : ''}
        {MINE_STATUS[mine.state] ?? ''}
      </Text>
    </Pressable>
  );
});

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  list: { flex: 1 },
  pill: {
    position: 'absolute',
    right: 14,
    bottom: 12,
    height: 34,
    minWidth: 34,
    paddingHorizontal: 9,
    borderRadius: t.r(17),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: t.cyber ? alpha(t.colors.bg, 0.9) : t.colors.surface2,
    borderWidth: 1,
    borderColor: alpha(t.colors.accent, 0.5),
    ...t.boxGlow(t.colors.accent, 12, 0.5),
  },
  pillFresh: { backgroundColor: t.colors.accent, borderColor: t.colors.accent },
  pillText: { color: t.colors.accentInk, fontSize: 11, ...t.font('ui', '700'), ...t.hud },
  listContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center' },
  msg: { borderRadius: t.r(14), padding: 12, maxWidth: '92%' },
  // tables/code need a definite width — see mdIsWide in MdView
  msgWide: { width: '92%' },
  mineWide: { width: '85%' },
  copyPress: { opacity: 0.6 }, // long-press feedback: copying, not selecting
  user: t.cyber
    ? {
        alignSelf: 'flex-end',
        backgroundColor: mix(t.colors.surface, t.colors.red, 0.14),
        borderRightWidth: 2,
        borderRightColor: t.colors.red,
        paddingTop: 8,
        boxShadow: `inset 0 0 24px ${alpha(t.colors.red, 0.12)}`,
      }
    : { alignSelf: 'flex-end', backgroundColor: t.colors.surface3 },
  you: { ...t.font('mono'), fontSize: 10, letterSpacing: 3, color: t.colors.red, marginBottom: 5, ...t.glow(t.colors.red, 8) },
  assistant: t.cyber
    ? {
        alignSelf: 'flex-start',
        backgroundColor: 'transparent',
        borderLeftWidth: 1,
        borderLeftColor: alpha(t.colors.accent, 0.3),
        paddingLeft: 13,
        paddingVertical: 2,
        paddingRight: 2,
        borderRadius: 0,
      }
    : { alignSelf: 'flex-start', backgroundColor: t.colors.surface },
  diamond: {
    position: 'absolute',
    left: -4,
    top: 7,
    width: 7,
    height: 7,
    backgroundColor: t.colors.accent,
    transform: [{ rotate: '45deg' }],
    ...t.boxGlow(t.colors.accent, 8, 0.9),
  },
  interrupt: {
    alignSelf: 'center',
    color: t.cyber ? t.colors.red : t.colors.working,
    ...t.font('ui'),
    ...t.hud,
    fontSize: 12,
    marginVertical: 8,
  },
  activity: {
    backgroundColor: t.glass,
    borderRadius: t.r(12),
    padding: 10,
    marginVertical: 2,
  },
  actHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chev: { color: t.colors.sub, width: 14 },
  liveDot: {
    ...t.dot(8),
    backgroundColor: t.colors.working,
    ...t.boxGlow(t.colors.working, 9, 0.8),
  },
  actCount: { color: t.colors.text, ...t.font('ui', '600'), fontSize: 13, ...(t.cyber ? { ...t.font('mono'), letterSpacing: 0.8 } : {}) },
  actNames: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 12, flex: 1 },
  actDur: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11 },
  step: { marginTop: 6, paddingLeft: 8 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepName: { color: t.colors.accent, fontSize: 12, ...t.font('ui', '600'), ...t.glow(t.colors.accent, 6) },
  stepSum: { ...t.font('ui'), color: t.colors.sub, fontSize: 12, flex: 1 },
  stepFile: { color: t.colors.accent, textDecorationLine: 'underline' },
  pending: { color: t.colors.working },
  pre: {
    ...t.font('mono'),
    color: t.colors.sub,
    fontSize: 11,
    marginTop: 4,
  },
  detailLabel: { ...t.font('ui'), color: t.colors.sub, fontSize: 11, marginTop: 6 },
  aux: { padding: 6 },
  auxSum: { ...t.font('ui'), color: t.colors.sub, fontSize: 12 },
  cmd: {
    backgroundColor: t.glass2,
    borderRadius: t.r(10),
    padding: 8,
    alignSelf: 'flex-start',
  },
  cmdHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cmdGlyph: { color: t.colors.accent },
  cmdName: { color: t.colors.text, fontSize: 13, ...t.font('mono'), },
  cmdErr: { color: t.colors.working, ...t.font('ui', '700') },
  noteError: {
    marginVertical: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderLeftWidth: 3,
    borderLeftColor: t.colors.working,
  },
  turnMeta: {
    alignSelf: 'center',
    color: t.colors.sub,
    ...t.font(t.cyber ? 'mono' : 'ui'),
    fontSize: 11,
    marginVertical: 4,
  },
  mineCancellable: { borderWidth: 1, borderColor: t.colors.working },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: t.cyber ? mix(t.colors.surface, t.colors.red, 0.3) : t.colors.accent,
    borderRightWidth: t.cyber ? 2 : 0,
    borderRightColor: t.colors.red,
    borderRadius: t.r(14),
    padding: 12,
    maxWidth: '85%',
  },
  mineText: { ...t.font('ui'), color: t.cyber ? t.colors.text : t.colors.accentInk, fontSize: 15 },
  mineStatus: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.cyber ? t.colors.red : t.colors.accentInk, opacity: 0.8, fontSize: 11, marginTop: 4, ...t.hud },
});
