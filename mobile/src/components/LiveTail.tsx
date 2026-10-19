import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, get, getPlatform, stripChrome } from '@herdr/shared';
import { alpha, mix, useStyles, useTheme, type Tokens } from '../theme';
import { Icon } from './Icon';

const OPEN_KEY = 'herdr.liveTail';

export function LiveTail({ paneId }: { paneId: string }) {
  const t = useTheme();
  const styles = useStyles(makeStyles);
  const kv = getPlatform().kv;
  const [open, setOpen] = useState(() => kv.get(OPEN_KEY) !== 'closed');
  const [text, setText] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!open) {
      setText(null);
      return;
    }
    let alive = true;
    const tick = async () => {
      try {
        const r = await get(agentPath(paneId, 'screen'));
        if (!r.ok || !alive) return;
        const { text: raw } = (await r.json()) as { text?: string };
        const lines = (raw ?? '').split('\n');
        const end = stripChrome(lines);
        const body = lines.slice(0, end).join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
        if (alive) setText(body || null);
      } catch {
        // ignore transient
      }
    };
    tick();
    const id = setInterval(tick, 1200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [paneId, open]);

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
          <View style={styles.liveDot} />
          <Text style={styles.title}>live screen</Text>
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {open
            ? 'streaming from the TUI — transcript catches up as steps complete'
            : 'tap to watch the TUI while it works'}
        </Text>
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={16} color={t.colors.sub} />
      </Pressable>
      {open && text !== null && (
        <ScrollView ref={scrollRef} style={styles.body} nestedScrollEnabled>
          <Text selectable style={styles.pre}>{text}</Text>
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
  title: { color: t.cyber ? t.colors.working : t.colors.sub, fontSize: t.cyber ? 11 : 12, ...t.font('ui', '600'), textTransform: 'uppercase', ...t.hud, ...t.glow(t.colors.working, 6) },
  sub: { ...t.font(t.cyber ? 'mono' : 'ui'), color: t.colors.sub, fontSize: 11, flex: 1, opacity: 0.8 },
  chev: { color: t.colors.sub },
  body: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 140 },
  pre: {
    ...t.font('mono'),
    color: t.cyber ? mix(t.colors.text, t.colors.accent, 0.45) : t.colors.sub,
    fontSize: 11,
    lineHeight: 16,
    ...t.glow(alpha(t.colors.accent, 0.35), 4),
  },
});
