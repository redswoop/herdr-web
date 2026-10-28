import { createContext, memo, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Image,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {
  AUX_LABEL,
  EPOCH_MS,
  HERDING,
  MINE_STATUS,
  baseName,
  buildNodes,
  isImagePath,
  turnTexts,
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
import { MdView, copy, mdIsWide } from './MdView';
import { quoteIntoComposer } from '../compose-bus';
import { tick } from '../toast';
import { SegText } from './SegText';

import { transcriptDebug } from './debug';
import { fileRawUrl } from '../api-urls';
export { transcriptDebug };

export function Transcript({
  items,
  error,
  loaded,
  working,
  cancellableKey,
  onInterrupt,
  onOpenFile,
  host = null,
  paneId = '',
  older = 0,
  loadingOlder = false,
  onLoadOlder,
}: {
  items: Item[];
  error: string | null;
  loaded: boolean;
  working: boolean;
  cancellableKey: number | null;
  onInterrupt: () => void;
  onOpenFile: (path: string) => void;
  /** the pane's own server — sent files live on that host's disk */
  host?: string | null;
  /** which composer "Quote in reply" lands in (agent screens stack) */
  paneId?: string;
  /** events above the loaded window (server-side tail); 0 = all here */
  older?: number;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
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
    // your own send always lands in view, however far up you were reading;
    // someone else's new content only lights the pill
    if (last?.type === 'mine') {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
      setFresh(false);
      return;
    }
    if (away) setFresh(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);
  useEffect(() => {
    if (!away) setFresh(false);
  }, [away]);
  const nodes = useMemo(() => buildNodes(items, working), [items, working]);
  // read at long-press time through a stable ref, so a streaming turn
  // doesn't re-render every memo'd bubble on each new chunk
  const turns = useMemo(() => turnTexts(nodes), [nodes]);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;
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
    <PaneIdContext.Provider value={paneId}>
    <TurnsContext.Provider value={turnsRef}>
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
      // inverted: the end of the list is the TOP — reaching it pages history in
      onEndReached={older > 0 && !loadingOlder && onLoadOlder ? () => onLoadOlder() : undefined}
      onEndReachedThreshold={0.6}
      // the footer sits at the top too: progress while paging, a tap if the
      // threshold didn't fire
      ListFooterComponent={
        older > 0 && onLoadOlder ? (
          <Pressable
            style={({ pressed }) => [styles.older, pressed && styles.copyPress]}
            onPress={onLoadOlder}
            disabled={loadingOlder}
            accessibilityLabel="load earlier"
          >
            <Text style={styles.olderText}>
              {loadingOlder ? 'loading…' : `▲ earlier · ${older} more`}
            </Text>
          </Pressable>
        ) : null
      }
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
    </TurnsContext.Provider>
    </PaneIdContext.Provider>
  );

  function renderNode(n: (typeof data)[number]) {
        if (n.type === 'working') return <WorkingPill />;
        if (n.type === 'group') {
          return <ActivityGroup node={n} live={working && n === nodes[nodes.length - 1]} onOpenFile={onOpenFile} />;
        }
        if (n.type === 'meta') return <TurnMeta dur={n.dur} tok={n.tok} ctx={n.ctx} nodeKey={n.key} />;
        if (n.type === 'command') {
          return <CommandPill name={n.name} args={n.args} out={n.out} err={n.err} />;
        }
        if (n.type === 'files') {
          return (
            <SentFiles files={n.files} caption={n.caption} attach={n.attach} host={host} onOpenFile={onOpenFile} />
          );
        }
        const it = n.item;
        return it.type === 'mine' ? (
          <MineBubble
            mine={it.mine}
            cancellable={it.mine.key === cancellableKey}
            onInterrupt={onInterrupt}
            onOpenFile={onOpenFile}
            nodeKey={n.key}
          />
        ) : (
          <EventNode ev={it.ev} onOpenFile={onOpenFile} nodeKey={n.key} />
        );
  }
}

/** node key → whole-turn text (turnTexts); a ref so lookups never re-render */
const TurnsContext = createContext<{ current: Map<string, string> }>({ current: new Map() });
/** the pane this transcript belongs to — the quote bus addresses its composer by it */
const PaneIdContext = createContext<string>('');

/** A bubble whose long-press opens its actions: copy it, copy the whole
 *  turn, quote it into the composer, share. No dim on touch-down: every
 *  scroll starts as a touch on some bubble, and a pressed-state dim flashed
 *  the row under your thumb on each flick (read as "it's copying").
 *  delayLongPress is under the 500 ms default — the longer the hold, the more
 *  chance a few points of drift hand the touch to the list instead. */
function CopyBubble({
  text,
  nodeKey,
  style,
  children,
}: {
  text: string;
  nodeKey?: string;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const turns = useContext(TurnsContext);
  const paneId = useContext(PaneIdContext);
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (!hot) return;
    const id = setTimeout(() => setHot(false), 420);
    return () => clearTimeout(id);
  }, [hot]);
  const open = () => {
    tick();
    setHot(true);
    const turn = nodeKey ? turns.current.get(nodeKey) : undefined;
    const acts: Array<[string, () => void]> = [
      ['Copy', () => copy(text)],
      ...(turn && turn !== text ? [['Copy whole turn', () => copy(turn)] as [string, () => void]] : []),
      ['Quote in reply', () => quoteIntoComposer(paneId, text)],
      ['Share…', () => void Share.share({ message: text }).catch(() => {})],
    ];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...acts.map((a) => a[0]), 'Cancel'], cancelButtonIndex: acts.length, userInterfaceStyle: 'dark' },
        (i) => acts[i]?.[1](),
      );
    } else {
      // Android dialogs hold three buttons; share is the one left out
      Alert.alert('', undefined, acts.slice(0, 3).map(([label, run]) => ({ text: label, onPress: run })), { cancelable: true });
    }
  };
  return (
    <Pressable
      style={[style, hot && styles.copyPress]}
      delayLongPress={380}
      onLongPress={open}
      accessibilityHint="Long press for copy, quote and share"
    >
      {children}
    </Pressable>
  );
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
  nodeKey,
}: {
  ev: TEvent;
  onOpenFile: (path: string) => void;
  nodeKey?: string;
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
  // long-press copies the whole message (CopyBubble) — replaces per-glyph
  // selection, disabled while the selectable/Fabric black-box bug is in play
  if (ev.kind === 'user') {
    return (
      <CopyBubble text={ev.text} nodeKey={nodeKey} style={[styles.msg, styles.user, mdIsWide(ev.text) && styles.msgWide]}>
        {t.cyber && <Text style={styles.you}>▸ YOU</Text>}
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </CopyBubble>
    );
  }
  if (ev.kind === 'assistant') {
    return (
      <CopyBubble text={ev.text} nodeKey={nodeKey} style={[styles.msg, styles.assistant, mdIsWide(ev.text) && styles.msgWide]}>
        {t.cyber && <View style={styles.diamond} />}
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </CopyBubble>
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
  // `!` bash mode: the output is what you asked for — show it
  const [open, setOpen] = useState(name === '!');
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

/** SendUserFile: thumbnails for images, chips for the rest; tap opens the
 *  file viewer. Scratchpad files die with a reboot — a dead thumbnail folds
 *  to a "gone" chip. A wrapped row, not a horizontal ScrollView: no
 *  scrollers inside transcript cells (the Fabric black-box bug). */
const SentFiles = memo(function SentFiles({
  files,
  caption,
  attach,
  host,
  onOpenFile,
}: {
  files: string[];
  caption: string;
  attach: boolean;
  host: string | null;
  onOpenFile: (path: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const imgs = attach ? [] : files.filter((f) => isImagePath(f) && !gone.has(f));
  const chips = files.filter((f) => !imgs.includes(f));
  const solo = imgs.length === 1;
  return (
    <View style={styles.sent}>
      {!!caption && <Text style={styles.sentCaption}>{caption}</Text>}
      {imgs.length > 0 && (
        <View style={styles.sentThumbs}>
          {imgs.map((f) => (
            <Pressable
              key={f}
              onPress={() => onOpenFile(f)}
              style={[styles.sentThumb, solo ? styles.sentSolo : styles.sentTile]}
              accessibilityLabel={`open ${baseName(f)}`}
            >
              <Image
                source={{ uri: fileRawUrl(f, null, host) }}
                style={styles.sentImg}
                resizeMode={solo ? 'contain' : 'cover'}
                onError={() => setGone((g) => new Set(g).add(f))}
              />
            </Pressable>
          ))}
        </View>
      )}
      {chips.length > 0 && (
        <View style={styles.sentThumbs}>
          {chips.map((f) => (
            <Pressable
              key={f}
              disabled={gone.has(f)}
              onPress={() => onOpenFile(f)}
              style={[styles.cmd, gone.has(f) && styles.sentGone]}
            >
              <Text style={styles.cmdName} numberOfLines={1}>
                {gone.has(f) ? `${baseName(f)} · gone` : `📎 ${baseName(f)}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
});

const TurnMeta = memo(function TurnMeta({
  dur,
  tok,
  ctx,
  nodeKey,
}: {
  dur: number | null;
  tok: number;
  ctx: number | null;
  nodeKey: string;
}) {
  const styles = useStyles(makeStyles);
  const turns = useContext(TurnsContext);
  const parts = [
    dur !== null ? fmtDur(dur) : null,
    tok > 0 ? `${fmtTok(tok)} tokens` : null,
    ctx !== null && ctx > 0 ? `ctx ${fmtTok(ctx)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  // the turn's footer is the one-tap "copy this whole exchange"
  return (
    <View style={styles.turnMetaRow}>
      <Text style={styles.turnMeta}>{parts.join(' · ')}</Text>
      <Pressable
        onPress={() => {
          const turn = turns.current.get(nodeKey);
          if (turn) copy(turn);
        }}
        hitSlop={10}
        unstable_pressDelay={100}
        style={({ pressed }) => [styles.turnCopy, pressed && styles.copyPress]}
        accessibilityLabel="copy whole turn"
      >
        <Text style={[styles.turnMeta, styles.turnCopyText]}>copy turn</Text>
      </Pressable>
    </View>
  );
});

const MineBubble = memo(function MineBubble({
  mine,
  cancellable,
  onInterrupt,
  onOpenFile,
  nodeKey,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
  onOpenFile?: (path: string) => void;
  nodeKey?: string;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  // hold-to-stop lives on the status line only; bubble-body long-press copies
  // (the status Text captures its own long-press first, so they don't collide)
  return (
    <CopyBubble
      text={mine.text}
      nodeKey={nodeKey}
      style={[styles.mine, mdIsWide(mine.text) && styles.mineWide, cancellable && styles.mineCancellable]}
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
    </CopyBubble>
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
  pillText: { color: t.colors.accentInk, fontSize: t.sz('chat', 11), ...t.font('ui', '700'), ...t.hud },
  listContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { ...t.font('ui'), color: t.colors.sub, textAlign: 'center' },
  older: { alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 16, marginBottom: 8 },
  olderText: { ...t.font(t.cyber ? 'mono' : 'ui'), ...t.hud, color: t.colors.sub, fontSize: t.sz('chat', 12) },
  msg: { borderRadius: t.r(14), padding: 12, maxWidth: '92%' },
  // tables/code need a definite width — see mdIsWide in MdView
  msgWide: { width: '92%' },
  mineWide: { width: '85%' },
  copyPress: { opacity: 0.6 }, // copy confirmation (CopyBubble) / tap dim (footer)
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
  you: { ...t.font('mono'), fontSize: t.sz('chat', 10), letterSpacing: 3, color: t.colors.red, marginBottom: 5, ...t.glow(t.colors.red, 8) },
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
    fontSize: t.sz('chat', 12),
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
  actCount: { color: t.colors.text, ...t.font('ui', '600'), fontSize: t.sz('chat', 13), ...(t.cyber ? { ...t.font('mono'), letterSpacing: 0.8 } : {}) },
  actNames: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('chat', 12), flex: 1 },
  actDur: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('chat', 11) },
  step: { marginTop: 6, paddingLeft: 8 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepName: { color: t.colors.accent, fontSize: t.sz('chat', 12), ...t.font('ui', '600'), ...t.glow(t.colors.accent, 6) },
  stepSum: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('chat', 12), flex: 1 },
  stepFile: { color: t.colors.accent, textDecorationLine: 'underline' },
  pending: { color: t.colors.working },
  pre: {
    ...t.font('mono'),
    color: t.colors.sub,
    fontSize: t.sz('code', 11),
    marginTop: 4,
  },
  detailLabel: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('chat', 11), marginTop: 6 },
  aux: { padding: 6 },
  auxSum: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('chat', 12) },
  cmd: {
    backgroundColor: t.glass2,
    borderRadius: t.r(10),
    padding: 8,
    alignSelf: 'flex-start',
  },
  cmdHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sent: { gap: 6, marginVertical: 4 },
  sentCaption: { ...t.font('ui'), color: t.colors.sub, fontSize: t.sz('chat', 13) },
  sentThumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sentThumb: {
    borderRadius: t.r(8),
    borderWidth: 1,
    borderColor: t.cyber ? alpha(t.colors.accent, 0.35) : t.colors.hairline,
    backgroundColor: t.glass2,
    overflow: 'hidden',
  },
  sentSolo: { width: '100%', height: 240 },
  sentTile: { width: 104, height: 104 },
  sentImg: { width: '100%', height: '100%' },
  sentGone: { opacity: 0.5 },
  cmdGlyph: { color: t.colors.accent },
  cmdName: { color: t.colors.text, fontSize: t.sz('chat', 13), ...t.font('mono'), },
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
    fontSize: t.sz('chat', 11),
    marginVertical: 4,
  },
  turnMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  turnCopy: {
    paddingHorizontal: 8,
    borderRadius: t.r(999),
    borderWidth: 1,
    borderColor: alpha(t.colors.accent, 0.35),
  },
  turnCopyText: { color: t.colors.accent, ...t.hud },
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
  mineText: { ...t.font('ui'), color: t.cyber ? t.colors.text : t.colors.accentInk, fontSize: t.sz('chat', 15) },
  mineStatus: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.cyber ? t.colors.red : t.colors.accentInk, opacity: 0.8, fontSize: t.sz('chat', 11), marginTop: 4, ...t.hud },
});
