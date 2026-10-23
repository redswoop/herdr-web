import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useURL } from 'expo-linking';
import { hydrateKv, initNativePlatform } from './platform.native';
import { loadAsync as loadFonts } from 'expo-font';
import { adoptDeepLink, adoptUrlSettings, loadServers } from './settings-store';
import { currentTokens, initPrefs, pullPrefs, subscribePrefs } from './prefs';
import { initUpdates } from './updates';
import { RosterProvider } from './roster';
import { DEFAULT_TOKENS, FONT_FILES, ThemeProvider, useTokensFrom } from './theme';

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
      await adoptUrlSettings(); // ?server=&token= wins over stored settings
      initNativePlatform({ servers: await loadServers() });
      initPrefs(); // cached skin first; the server's answer lands when it lands
      initUpdates(); // OTA: quiet check now and on every foreground
      // bundled faces, a few hundred KB: wait rather than flash system type
      await loadFonts(FONT_FILES).catch(() => {});
      setReady(true);
    })();
  }, []);

  const remount = useCallback(async () => {
    initNativePlatform({ servers: await loadServers() });
    void pullPrefs(); // a different daemon may dress differently
    setGen((g) => g + 1);
  }, []);

  // capra://settings?server=…&token=…&name=… — QR onboarding; additive, so a
  // second host's link joins the registry instead of replacing the first.
  // useURL covers both the cold-start URL and links tapped while running;
  // gated on ready so adoption always lands on hydrated storage. adoptDeepLink
  // returns false for unchanged values, so re-fires of the same URL are no-ops.
  const url = useURL();
  useEffect(() => {
    if (!ready || !url) return;
    adoptDeepLink(url).then((changed) => {
      if (changed) remount();
    });
  }, [ready, url, remount]);

  // prefs.ts owns the tokens; this is the one place react learns of a flip
  const tokens = useTokensFrom(currentTokens, subscribePrefs);

  if (!ready) {
    return (
      <View style={[styles.boot, { backgroundColor: tokens.colors.bg }]}>
        <ActivityIndicator color={tokens.colors.accent} size="large" />
      </View>
    );
  }

  return (
    <BootContext.Provider value={{ remount, gen }}>
      <ThemeProvider tokens={tokens}>
        <View key={gen} style={[styles.fill, { backgroundColor: tokens.colors.bg }]}>
          <RosterProvider>{children}</RosterProvider>
        </View>
      </ThemeProvider>
    </BootContext.Provider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: DEFAULT_TOKENS.colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fill: { flex: 1 },
});
