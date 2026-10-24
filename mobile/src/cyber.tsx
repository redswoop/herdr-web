/* The skin's chrome, from @redswoop/cyberdos/native. Only `Screen` is
   herdr's: it knows expo-router focus, so a stack of screens costs one rain. */
import { useCallback, useState, type ReactNode } from 'react';
import type { ViewStyle } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { CyberScreen } from '@redswoop/cyberdos/native';

export { Brackets, CyberBackdrop, CyberOverlay, HazardTape, NeonRail, StripeFill } from '@redswoop/cyberdos/native';

/** A screen's root: opaque in the theme's bg (whatever the navigator puts
 *  the card over — a cold deep link once showed a white sheet behind a
 *  transparent card, and eggshell text on it), with the cyber backdrop
 *  inside. The rain runs only while the screen is focused. */
export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <CyberScreen focused={focused} style={style}>
      {children}
    </CyberScreen>
  );
}
