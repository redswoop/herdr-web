import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootProvider } from '../src/boot';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <BootProvider>
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            headerTitleStyle: { fontWeight: '600' },
            contentStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="index" options={{ title: 'herdr' }} />
          <Stack.Screen name="settings" options={{ title: 'settings', presentation: 'modal' }} />
          <Stack.Screen
            name="new-chat"
            options={{ title: 'new chat', presentation: 'modal', headerShown: false }}
          />
          <Stack.Screen name="agent/[paneId]/index" options={{ title: 'agent' }} />
          <Stack.Screen
            name="agent/[paneId]/file"
            options={{ title: 'file', headerShown: false, presentation: 'card' }}
          />
        </Stack>
      </BootProvider>
    </SafeAreaProvider>
  );
}
