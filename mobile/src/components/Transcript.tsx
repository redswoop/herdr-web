import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { colors } from '../theme';
import { MdView } from './MdView';

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
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.listContent}
      data={data}
      inverted
      keyExtractor={(n, i) => ('key' in n ? n.key : `w${i}`)}
      maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      renderItem={({ item: n }) => {
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
          />
        ) : (
          <EventNode ev={it.ev} onOpenFile={onOpenFile} />
        );
      }}
    />
  );
}

function WorkingPill() {
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

function EventNode({
  ev,
  onOpenFile,
}: {
  ev: TEvent;
  onOpenFile: (path: string) => void;
}) {
  if (ev.kind === 'interrupted') {
    return <Text style={styles.interrupt}>⏹ interrupted</Text>;
  }
  if (ev.kind === 'user') {
    return (
      <View style={[styles.msg, styles.user]}>
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </View>
    );
  }
  if (ev.kind === 'assistant') {
    return (
      <View style={[styles.msg, styles.assistant]}>
        <MdView src={ev.text} onOpenFile={onOpenFile} />
      </View>
    );
  }
  return (
    <Details label={AUX_LABEL[ev.kind] ?? ev.kind} body={clip(ev.text)} />
  );
}

function Details({ label, body }: { label: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.aux}>
      <Pressable onPress={() => setOpen((o) => !o)}>
        <Text style={styles.auxSum}>{label}</Text>
      </Pressable>
      {open && <Text style={styles.pre}>{body}</Text>}
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
        <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
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
        {open && <Text style={styles.pre}>{clip(step.text)}</Text>}
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
          {!!step.args && <Text style={styles.pre}>{clip(step.args)}</Text>}
          {step.result !== null && (
            <>
              <Text style={styles.detailLabel}>result</Text>
              <Text style={styles.pre}>{clip(step.result)}</Text>
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
      {open && !!out && <Text style={styles.pre}>{clip(out)}</Text>}
      {!!err && <Text style={[styles.pre, styles.cmdErr]}>{clip(err)}</Text>}
    </View>
  );
}

function TurnMeta({
  dur,
  tok,
  ctx,
}: {
  dur: number | null;
  tok: number;
  ctx: number | null;
}) {
  const parts = [
    dur !== null ? fmtDur(dur) : null,
    tok > 0 ? `${fmtTok(tok)} tokens` : null,
    ctx !== null && ctx > 0 ? `ctx ${fmtTok(ctx)}` : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <Text style={styles.turnMeta}>{parts.join(' · ')}</Text>;
}

function MineBubble({
  mine,
  cancellable,
  onInterrupt,
}: {
  mine: Mine;
  cancellable: boolean;
  onInterrupt: () => void;
}) {
  return (
    <Pressable
      style={styles.mine}
      onLongPress={cancellable ? onInterrupt : undefined}
    >
      <Text style={styles.mineText}>{mine.text}</Text>
      <Text style={styles.mineStatus}>{MINE_STATUS[mine.state] ?? ''}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  listContent: { paddingHorizontal: 14, paddingVertical: 10, gap: 8 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: colors.sub, textAlign: 'center' },
  msg: { borderRadius: 14, padding: 12, maxWidth: '92%' },
  user: { alignSelf: 'flex-end', backgroundColor: colors.surface3 },
  assistant: { alignSelf: 'flex-start', backgroundColor: colors.surface },
  interrupt: {
    alignSelf: 'center',
    color: colors.working,
    fontSize: 12,
    marginVertical: 8,
  },
  activity: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 10,
    marginVertical: 2,
  },
  actHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  chev: { color: colors.sub, width: 14 },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.working,
  },
  actCount: { color: colors.text, fontWeight: '600', fontSize: 13 },
  actNames: { color: colors.sub, fontSize: 12, flex: 1 },
  actDur: { color: colors.sub, fontSize: 11 },
  step: { marginTop: 6, paddingLeft: 8 },
  stepHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepName: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  stepSum: { color: colors.sub, fontSize: 12, flex: 1 },
  stepFile: { color: colors.accent, textDecorationLine: 'underline' },
  pending: { color: colors.working },
  pre: {
    fontFamily: 'monospace',
    color: colors.sub,
    fontSize: 11,
    marginTop: 4,
  },
  detailLabel: { color: colors.sub, fontSize: 11, marginTop: 6 },
  aux: { padding: 6 },
  auxSum: { color: colors.sub, fontSize: 12 },
  cmd: {
    backgroundColor: colors.surface2,
    borderRadius: 10,
    padding: 8,
    alignSelf: 'flex-start',
  },
  cmdHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cmdGlyph: { color: colors.accent },
  cmdName: { color: colors.text, fontSize: 13, fontFamily: 'monospace' },
  cmdErr: { color: colors.working, fontWeight: '700' },
  turnMeta: {
    alignSelf: 'center',
    color: colors.sub,
    fontSize: 11,
    marginVertical: 4,
  },
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accent,
    borderRadius: 14,
    padding: 12,
    maxWidth: '85%',
  },
  mineText: { color: colors.accentInk, fontSize: 15 },
  mineStatus: { color: colors.accentInk, opacity: 0.7, fontSize: 11, marginTop: 4 },
});
