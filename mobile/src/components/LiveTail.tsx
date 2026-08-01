import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, get, getPlatform, stripChrome } from '@herdr/shared';
import { colors } from '../theme';

const OPEN_KEY = 'herdr.liveTail';

export function LiveTail({ paneId }: { paneId: string }) {
  const kv = getPlatform().kv;
  const [open, setOpen] = useState(() => kv.get(OPEN_KEY) !== 'closed');
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    kv.set(OPEN_KEY, next ? 'open' : 'closed');
  };

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.head} onPress={toggle}>
        <Text style={styles.title}>live tail</Text>
        <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open && (
        <ScrollView style={styles.body} nestedScrollEnabled>
          <Text style={styles.pre}>{text ?? '…'}</Text>
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
    maxHeight: 160,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  title: { color: colors.sub, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  chev: { color: colors.sub },
  body: { paddingHorizontal: 12, paddingBottom: 8 },
  pre: {
    fontFamily: 'monospace',
    color: colors.sub,
    fontSize: 11,
    lineHeight: 16,
  },
});
