/* The home-screen icon: one goat per CyberDOS palette (tools/capra-icons.py
   draws them). 'auto' follows the cyber palette; otherwise a pinned pick.
   Per-device (kv), like text size: it's this phone's home screen.
   iOS shows its own "You have changed the icon" alert on every switch, so
   we only ask when the wanted icon actually differs from what's showing. */
import { useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { getPlatform } from '@herdr/shared';
import { currentTheme, paletteOf, subscribePrefs } from './prefs';

type Native = {
  supportsAlternateIcons: boolean;
  setAlternateAppIcon(name: string | null): Promise<string | null>;
  getAppIconName(): string | null;
};
// optional: an OTA bundle can land on a binary built before the module was
const native =
  Platform.OS === 'ios' ? requireOptionalNativeModule<Native>('ExpoAlternateAppIcons') : null;

export const PRIMARY_ICON = 'kabuki'; // the art as drawn; AppIcon in the asset catalog
export const ICON_THUMBS: Record<string, number> = {
  'night-city': require('../assets/icons/night-city.png'),
  arasaka: require('../assets/icons/arasaka.png'),
  militech: require('../assets/icons/militech.png'),
  netrunner: require('../assets/icons/netrunner.png'),
  kabuki: require('../assets/icons/kabuki.png'),
  afterlife: require('../assets/icons/afterlife.png'),
  'trauma-team': require('../assets/icons/trauma-team.png'),
  silverhand: require('../assets/icons/silverhand.png'),
  blackwall: require('../assets/icons/blackwall.png'),
};

const KEY = 'herdr.appIcon';
const listeners = new Set<() => void>();
let choice: string | null = null; // 'auto' | palette id

export const iconsSupported = (): boolean => !!native?.supportsAlternateIcons;

function read(): string {
  if (choice === null) {
    try {
      choice = getPlatform().kv.get(KEY) ?? 'auto';
    } catch {
      choice = 'auto';
    }
  }
  return choice;
}

/** the palette whose goat should be on the home screen right now */
export function wantedIcon(): string {
  const c = read();
  if (c !== 'auto') return c;
  if (currentTheme() !== 'cyber') return PRIMARY_ICON;
  const p = paletteOf('cyber');
  return p in ICON_THUMBS ? p : PRIMARY_ICON; // custom colours keep the stock goat
}

const nativeName = (id: string) => (id === PRIMARY_ICON ? null : `AppIcon-${id}`);

let ready = false; // set a beat after launch
let inflight = false;
let tries = 0;
async function sync() {
  if (!ready || !iconsSupported() || inflight || AppState.currentState !== 'active') return;
  const want = nativeName(wantedIcon());
  if (native!.getAppIconName() === want) return;
  inflight = true;
  try {
    await native!.setAlternateAppIcon(want);
    tries = 0;
  } catch (e) {
    // iOS answers EIO / EAGAIN while launch or another transition is settling
    if (++tries <= 3) setTimeout(() => void sync(), 2000 * 2 ** (tries - 1));
    else {
      tries = 0;
      console.warn('[app-icon]', e);
    }
  } finally {
    inflight = false;
  }
}

export function setIconChoice(c: string) {
  choice = c;
  try {
    getPlatform().kv.set(KEY, c);
  } catch {}
  for (const cb of listeners) cb();
  void sync();
}

/** call once at boot: follows palette changes (local or synced from another device) */
export function startIconSync() {
  if (!iconsSupported()) return;
  subscribePrefs(() => void sync());
  // iOS refuses the switch while backgrounded; a synced change waits for the foreground
  AppState.addEventListener('change', (s) => s === 'active' && void sync());
  setTimeout(() => {
    ready = true; // asking during launch fails outright
    void sync();
  }, 2500);
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

export function useIconChoice(): string {
  return useSyncExternalStore(subscribe, read, read);
}
