import { useLocalSearchParams, useRouter } from 'expo-router';
import { type SpawnTarget } from '@herdr/shared';
import { useRoster } from '../src/roster';
import { NewChatSheet } from '../src/components/NewChatSheet';
import { Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStyles, type Tokens } from '../src/theme';

export default function NewChatScreen() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { roster } = useRoster();
  // headerShown is off, so nothing pads the top for us. iOS presents the
  // modal as a page sheet below the status bar; Android's is full-screen and
  // put the title under the clock.
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'android' ? insets.top : 0;
  const params = useLocalSearchParams<{ workspaceId?: string; cwd?: string }>();

  const target: SpawnTarget | undefined =
    params.workspaceId || params.cwd
      ? {
          workspaceId: params.workspaceId || undefined,
          cwd: params.cwd || undefined,
        }
      : undefined;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <NewChatSheet
        roster={roster}
        target={target}
        onClose={() => router.back()}
        onCreated={(paneId) => {
          router.replace(`/agent/${encodeURIComponent(paneId)}`);
        }}
      />
    </View>
  );
}

const makeStyles = (t: Tokens) =>
  StyleSheet.create({
  root: { flex: 1, backgroundColor: t.colors.bg },
});
