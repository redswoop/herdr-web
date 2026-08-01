import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, get, getPlatform, stripChrome } from '@herdr/shared';
import { colors } from '../theme';
import { Icon } from './Icon';

const OPEN_KEY = 'herdr.liveTail';

export function LiveTail({ paneId }: { paneId: string }) {
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
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={16} color={colors.sub} />
      </Pressable>
      {open && text !== null && (
        <ScrollView ref={scrollRef} style={styles.body} nestedScrollEnabled>
          <Text style={styles.pre}>{text}</Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: colors.surface,
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
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.working,
  },
  title: { color: colors.sub, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  sub: { color: colors.sub, fontSize: 11, flex: 1, opacity: 0.8 },
  chev: { color: colors.sub },
  body: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 140 },
  pre: {
    fontFamily: 'monospace',
    color: colors.sub,
    fontSize: 11,
    lineHeight: 16,
  },
});
