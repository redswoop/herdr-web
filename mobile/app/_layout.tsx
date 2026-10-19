import { Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootProvider } from '../src/boot';
import { CyberBackdrop, CyberOverlay, NeonRail } from '../src/cyber';
import { alpha, useTheme } from '../src/theme';

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
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {t.cyber && <CyberBackdrop />}
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.cyber ? alpha(t.colors.bg, 0.8) : t.colors.surface },
        headerBackground: t.cyber
          ? () => (
              <View style={{ flex: 1, backgroundColor: alpha(t.colors.bg, 0.8), justifyContent: 'flex-end' }}>
                <NeonRail />
              </View>
            )
          : undefined,
        headerTintColor: t.cyber ? t.colors.red : t.colors.text,
        headerTitleStyle: { fontWeight: '600' },
        // a Text, not headerTitleStyle: the native header ignores runtime-loaded faces on Android
        headerTitle: t.cyber
          ? ({ children }) => (
              <Text
                numberOfLines={1}
                style={{
                  ...t.font('display', children === 'Capra' ? '900' : '700'),
                  color: t.colors.red,
                  fontSize: children === 'Capra' ? 18 : 14,
                  letterSpacing: children === 'Capra' ? 3 : 1.5,
                  ...t.glow(t.colors.red, 12),
                }}
              >
                {String(children).toUpperCase()}
              </Text>
            )
          : undefined,
        contentStyle: { backgroundColor: t.canvas },
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
      {t.cyber && <CyberOverlay />}
    </View>
  );
}
