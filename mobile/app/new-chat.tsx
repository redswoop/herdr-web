import { useLocalSearchParams, useRouter } from 'expo-router';
import { type SpawnTarget } from '@herdr/shared';
import { useRoster } from '../src/roster';
import { NewChatSheet } from '../src/components/NewChatSheet';
import { StyleSheet, View } from 'react-native';
import { useStyles, type Tokens } from '../src/theme';

export default function NewChatScreen() {
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const { roster } = useRoster();
  const params = useLocalSearchParams<{ workspaceId?: string; cwd?: string }>();

  const target: SpawnTarget | undefined =
    params.workspaceId || params.cwd
      ? {
          workspaceId: params.workspaceId || undefined,
          cwd: params.cwd || undefined,
        }
      : undefined;

  return (
    <View style={styles.root}>
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
