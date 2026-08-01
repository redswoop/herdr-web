import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { hydrateKv, initNativePlatform } from './platform.native';
import { loadSettings } from './settings-store';
import { colors } from './theme';

interface BootCtx {
  /** Bump after settings change so hooks remount against the new API config. */
  remount: () => void;
  gen: number;
}

const BootContext = createContext<BootCtx>({ remount: () => {}, gen: 0 });

export function useBoot() {
  return useContext(BootContext);
}

export function BootProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [gen, setGen] = useState(0);

  useEffect(() => {
    (async () => {
      await hydrateKv();
      const s = await loadSettings();
      initNativePlatform({ baseUrl: s.baseUrl, token: s.token || null });
      setReady(true);
    })();
  }, []);

  const remount = useCallback(async () => {
    const s = await loadSettings();
    initNativePlatform({ baseUrl: s.baseUrl, token: s.token || null });
    setGen((g) => g + 1);
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <BootContext.Provider value={{ remount, gen }}>
      <View key={gen} style={styles.fill}>
        {children}
      </View>
    </BootContext.Provider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { flex: 1 },
});
