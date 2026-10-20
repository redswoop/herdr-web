import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { agentPath, chromeVisible, get } from '@herdr/shared';
import { alpha, useStyles, type Tokens } from '../theme';

/**
 * Live mirror of the pane while a local TUI dialog is up (/model, /resume, …).
 * Dismisses when normal composer chrome returns. `pinned` = opened by hand
 * (the blocked banner's "view screen"): never self-dismisses, no salvage.
 */
export function ScreenMirror({
  paneId,
  poke,
  pinned = false,
  onClose,
  onGone,
}: {
  paneId: string;
  poke: number;
  pinned?: boolean;
  onClose: () => void;
  onGone?: (finalScreen: string) => void;
}) {
  const styles = useStyles(makeStyles);
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
      if (!pinned && chromeVisible(raw ?? '')) {
        if (++chromeRuns.current >= 2) {
          closedRef.current = true;
          onGone?.(raw ?? '');
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
        <Text style={styles.bannerText}>
          {pinned ? 'live TUI screen — use keys below' : 'local dialog — use keys below'}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.hide}>hide</Text>
        </Pressable>
      </View>
      <ScrollView ref={scrollRef} style={styles.body} nestedScrollEnabled>
        <Text style={styles.pre} allowFontScaling={false}>{text}</Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.colors.working,
    backgroundColor: t.colors.surface,
    maxHeight: 220,
  },
  banner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: alpha(t.colors.working, 0.15),
  },
  bannerText: { color: t.colors.working, fontSize: t.sz('code', 12), ...t.font('ui', '600'), flex: 1 },
  hide: { ...t.font('ui'), color: t.colors.accent, fontSize: t.sz('code', 13) },
  body: { paddingHorizontal: 12, paddingBottom: 8, maxHeight: 180 },
  pre: {
    ...t.font('mono'),
    color: t.colors.text,
    fontSize: t.px('code', 11),
    lineHeight: t.px('code', 16),
  },
});
