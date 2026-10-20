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
  const { paneId: rawPane, path: rawPath } = useLocalSearchParams<{
    paneId: string;
    path: string;
  }>();
  const paneId = decodeURIComponent(rawPane ?? '');
  const initialPath = decodeURIComponent(rawPath ?? '');
  const [path, setPath] = useState(initialPath);
  const router = useRouter();
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
        onClose={() => router.back()}
        onNavigate={setPath}
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
