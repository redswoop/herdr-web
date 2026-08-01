import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRoster, type SpawnTarget } from '@herdr/shared';
import { NewChatSheet } from '../src/components/NewChatSheet';
import { View, StyleSheet } from 'react-native';
import { colors } from '../src/theme';

export default function NewChatScreen() {
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
