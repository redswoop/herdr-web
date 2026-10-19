import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootProvider } from '../src/boot';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <StatusBar style="light" />
        <BootProvider>
          <Shell />
        </BootProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}

/** under BootProvider so the navigator chrome follows the theme */
function Shell() {
  const t = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.colors.surface },
        headerTintColor: t.cyber ? t.colors.red : t.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        // a Text, not headerTitleStyle: the native header ignores runtime-loaded faces on Android
        headerTitle: t.cyber
          ? ({ children }) => (
              <Text
                numberOfLines={1}
                style={{ ...t.font('display', '700'), color: t.colors.red, fontSize: 14, letterSpacing: 1.5 }}
              >
                {String(children).toUpperCase()}
              </Text>
            )
          : undefined,
        contentStyle: { backgroundColor: t.colors.bg },
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Capra' }} />
      <Stack.Screen name="settings" options={{ title: 'settings', presentation: 'modal' }} />
      <Stack.Screen name="lab" options={{ title: 'render lab' }} />
      <Stack.Screen name="replay" options={{ title: 'replay' }} />
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
  );
}
