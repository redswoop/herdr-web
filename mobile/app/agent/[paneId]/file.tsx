import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getPlatform } from '@herdr/shared';
import { useRoster } from '../../../src/roster';
import { FileViewer } from '../../../src/components/FileViewer';
import { useStyles, type Tokens } from '../../../src/theme';

export default function FileScreen() {
  const styles = useStyles(makeStyles);
  const { paneId: rawPane, path: rawPath, depth: rawDepth, via } = useLocalSearchParams<{
    paneId: string;
    path: string;
    depth?: string;
    via?: string;
  }>();
  const paneId = decodeURIComponent(rawPane ?? '');
  const path = decodeURIComponent(rawPath ?? '');
  // how many file cards sit between this one and the chat: X dismisses them all
  const depth = Math.max(1, Number(rawDepth) || 1);
  const router = useRouter();
  // Every hop (a folder, `..`, a link inside a markdown file) is its own card,
  // so the swipe-back gesture retraces your steps instead of dumping you in
  // the chat. The X is the way out in one go.
  const navigate = useCallback(
    (p: string, v?: 'dir') =>
      router.push({
        pathname: '/agent/[paneId]/file',
        params: { paneId, path: p, depth: String(depth + 1), ...(v ? { via: v } : {}) },
      }),
    [router, paneId, depth],
  );
  // Swipe-down on an image means "back to the folder". Picked from a folder
  // listing: that card is right underneath. Opened from the chat: there is no
  // folder card, so this one becomes the folder.
  const dismissImage = useCallback(() => {
    if (via === 'dir') router.back();
    else
      router.replace({
        pathname: '/agent/[paneId]/file',
        params: { paneId, path: path.replace(/\/[^/]+\/?$/, '') || '/', depth: String(depth) },
      });
  }, [via, router, paneId, path, depth]);
  const { roster } = useRoster();
  const agent = roster.agents.find((a) => a.paneId === paneId);
  const cwd = agent?.cwd ?? null;

  const histKey = `herdr.fileHist.${paneId}`;
  const kv = getPlatform().kv;
  const [history, setHistory] = useState<string[]>(() => {
    try {
      const j = JSON.parse(kv.get(histKey) ?? '[]');
      return Array.isArray(j) ? j.filter((x: unknown) => typeof x === 'string').slice(0, 30) : [];
    } catch {
      return [];
    }
  });

  const mutateHist = useCallback(
    (fn: (h: string[]) => string[]) => {
      setHistory((h) => {
        const next = fn(h);
        kv.set(histKey, JSON.stringify(next));
        return next;
      });
    },
    [histKey, kv],
  );

  const onLoaded = useCallback(
    (p: string) => mutateHist((h) => [p, ...h.filter((x) => x !== p)].slice(0, 30)),
    [mutateHist],
  );

  return (
    // no native header here; the card's own safe area keeps the path bar
    // clear of the status bar on both platforms
    <SafeAreaView edges={['top']} style={styles.root}>
      <FileViewer
        path={path}
        cwd={cwd}
        history={history}
        onBack={() => router.back()}
        onClose={() => router.dismiss(depth)}
        onNavigate={navigate}
        onDismissImage={dismissImage}
        onLoaded={onLoaded}
        onRemoveHist={(p) => mutateHist((h) => h.filter((x) => x !== p))}
      />
    </SafeAreaView>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
});
