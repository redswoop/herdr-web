import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { getPlatform } from '@herdr/shared';
import { useRoster } from '../../../src/roster';
import { FileViewer } from '../../../src/components/FileViewer';
import { fileScreenFor } from '../../../src/file-routes';
import { useStyles, type Tokens } from '../../../src/theme';

export default function FileScreen() {
  const styles = useStyles(makeStyles);
  const { paneId: rawPane, path: rawPath, depth: rawDepth } = useLocalSearchParams<{
    paneId: string;
    path: string;
    depth?: string;
  }>();
  const paneId = decodeURIComponent(rawPane ?? '');
  const path = decodeURIComponent(rawPath ?? '');
  // how many file cards sit between this one and the chat: X dismisses them all
  const depth = Math.max(1, Number(rawDepth) || 1);
  const router = useRouter();
  const navigation = useNavigation();
  // Every hop (a folder, `..`, a link inside a markdown file) is its own
  // screen, so the swipe-back gesture retraces your steps instead of dumping
  // you in the chat. Images open as a sheet (swipe down lets go). The X is
  // the way out in one go.
  const navigate = useCallback(
    (p: string) =>
      router.push({ pathname: fileScreenFor(p), params: { paneId, path: p, depth: String(depth + 1) } }),
    [router, paneId, depth],
  );
  // a zoomed image is being dragged around: the sheet must not take the drag
  const onZoomed = useCallback(
    (z: boolean) => navigation.setOptions({ gestureEnabled: !z }),
    [navigation],
  );
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
        onZoomed={onZoomed}
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
