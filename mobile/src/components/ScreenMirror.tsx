import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, chromeVisible, get } from '@herdr/shared';
import { colors } from '../theme';

/**
 * Live mirror of the pane while a local TUI dialog is up (/model, /resume, …).
 * Dismisses when normal composer chrome returns.
 */
export function ScreenMirror({
  paneId,
  poke,
  onClose,
  onGone,
}: {
  paneId: string;
  poke: number;
  onClose: () => void;
  onGone: (finalScreen: string) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const chromeRuns = useRef(0);
  const closedRef = useRef(false);
  const scrollRef = useRef<ScrollView>(null);

  const tick = useRef(async () => {});
  tick.current = async () => {
    if (closedRef.current) return;
    try {
      const r = await get(agentPath(paneId, 'screen'));
      if (!r.ok) return;
      const { text: raw } = (await r.json()) as { text?: string };
      if (closedRef.current) return;
      if (chromeVisible(raw ?? '')) {
        if (++chromeRuns.current >= 2) {
          closedRef.current = true;
          onGone(raw ?? '');
          return;
        }
      } else {
        chromeRuns.current = 0;
      }
      setText((raw ?? '').replace(/\n{3,}/g, '\n\n').trimEnd());
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    closedRef.current = false;
    chromeRuns.current = 0;
    tick.current();
    const t = setInterval(() => tick.current(), 700);
    return () => {
      closedRef.current = true;
      clearInterval(t);
    };
  }, [paneId]);

  useEffect(() => {
    if (!poke) return;
    const t = setTimeout(() => tick.current(), 180);
    return () => clearTimeout(t);
  }, [poke]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [text]);

  if (text === null) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>local dialog — use keys below</Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.hide}>hide</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={styles.body} nestedScrollEnabled>
        <Text style={styles.pre}>{text}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.working,
    backgroundColor: colors.surface,
    maxHeight: 220,
  },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(224,175,104,0.15)',
  },
  bannerText: { color: colors.working, fontSize: 12, fontWeight: '600', flex: 1 },
  hide: { color: colors.accent, fontSize: 13 },
  body: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 180 },
  pre: {
    fontFamily: 'monospace',
    color: colors.text,
    fontSize: 11,
    lineHeight: 16,
  },
});
