import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BootProvider } from '../src/boot';
import { CyberOverlay, NeonRail } from '../src/cyber';
import { ToastHost } from '../src/toast';
import { BootLog, Glitch, Scramble } from '../src/cyber-fx';
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
  // the jack-in boot log plays once per cold launch, over the first paint
  const [booting, setBooting] = useState(true);
  const bootDone = useCallback(() => setBooting(false), []);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: t.colors.bg }}>
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
              <Glitch>
              <Scramble
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
              </Scramble>
              </Glitch>
            )
          : undefined,
        // opaque cards: each screen draws its own backdrop (see Screen)
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
      {/* draws its own header: back, who/where, rewind, mode, status */}
      <Stack.Screen name="agent/[paneId]/index" options={{ title: 'agent', headerShown: false }} />
      <Stack.Screen
        name="agent/[paneId]/file"
        options={{ title: 'file', headerShown: false, presentation: 'card' }}
      />
    </Stack>
      {t.cyber && <CyberOverlay />}
      <ToastHost />
      {booting && <BootLog onDone={bootDone} />}
    </GestureHandlerRootView>
  );
}
