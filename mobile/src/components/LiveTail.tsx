import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, get, getPlatform, stripChrome, type ModeState } from '@herdr/shared';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const OPEN_KEY = 'herdr.liveTail';

export function LiveTail({
  paneId,
  online = true,
  onMode,
}: {
  paneId: string;
  /** false while the link is down: the poll pauses and the header says so */
  online?: boolean;
  /** the /screen payload carries the footer-parsed permission mode — feed it
   *  to the header chip so it stays live while the agent works */
  onMode?: (mode: ModeState) => void;
}) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const kv = getPlatform().kv;
  const [open, setOpen] = useState(() => kv.get(OPEN_KEY) !== 'closed');
  const [text, setText] = useState<string | null>(null);
  // the last poll failed: the frame on screen is old
  const [stalled, setStalled] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const paused = !online || stalled;

  useEffect(() => {
    if (!open) {
      setText(null);
      setStalled(false);
      return;
    }
    if (!online) return; // no point polling into a dead link; the frame stays as a hint
    let alive = true;
    const tick = async () => {
      try {
        const r = await get(agentPath(paneId, 'screen'));
        if (!alive) return;
        setStalled(!r.ok);
        if (!r.ok) return;
        const { text: raw, mode } = (await r.json()) as { text?: string; mode?: ModeState };
        if (!alive) return;
        if (mode) onMode?.(mode);
        // grok paints a █ scrollbar column on the right edge — pure noise here
        const lines = (raw ?? '').split('\n').map((l) => l.replace(/\s*█\s*$/, ''));
        const end = stripChrome(lines);
        const body = lines.slice(0, end).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
        if (alive) setText(body || null);
      } catch {
        if (alive) setStalled(true); // transient or not, say the frame is stale
      }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paneId, open, online, onMode]);

  useEffect(() => {
    if (text != null) scrollRef.current?.scrollToEnd({ animated: false });
  }, [text]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    kv.set(OPEN_KEY, next ? 'open' : 'closed');
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={toggle}>
        <View style={styles.headLeft}>
          <View style={[styles.liveDot, paused && styles.liveDotOff]} />
          <Text style={styles.title}>live screen</Text>
        </View>
        <Text style={[styles.sub, paused && styles.subOff]} numberOfLines={1}>
          {paused
            ? online
              ? 'tail paused — last poll failed, retrying'
              : 'tail paused — link down'
            : open
              ? 'streaming from the TUI — transcript catches up as steps complete'
              : 'tap to watch the TUI while it works'}
        </Text>
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={16} color={t.colors.sub} />
      </Pressable>
      {open && text !== null && (
        <ScrollView ref={scrollRef} style={styles.body} nestedScrollEnabled>
          <Text selectable style={styles.pre} allowFontScaling={false}>{text}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.cyber ? alpha(t.colors.accent, 0.3) : t.colors.hairline,
    backgroundColor: t.cyber ? alpha('#000000', 0.6) : t.colors.surface,
    maxHeight: 180,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: {
    ...t.dot(7),
    backgroundColor: t.colors.working,
    ...t.boxGlow(t.colors.working, 9, 0.8),
  },
  liveDotOff: {
    backgroundColor: t.colors.blocked,
    ...t.boxGlow(t.colors.blocked, 9, 0.8),
  },
  subOff: { color: t.colors.blocked },
  title: { color: t.cyber ? t.colors.working : t.colors.sub, fontSize: t.cyber ? 11 : 12, ...t.font('ui', '600'), textTransform: 'uppercase', ...t.hud, ...t.glow(t.colors.working, 6) },
  sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: t.sz('code', 11), flex: 1, opacity: 0.8 },
  chev: { color: t.colors.sub },
  body: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 140 },
  pre: {
    ...t.font('mono'),
    color: t.cyber ? mix(t.colors.text, t.colors.accent, 0.45) : t.colors.sub,
    fontSize: t.px('code', 11),
    lineHeight: t.px('code', 16),
    ...t.glow(alpha(t.colors.accent, 0.35), 4),
  },
});
