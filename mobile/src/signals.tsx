import { createContext, useContext, type ReactNode } from 'react';
import { useSignals as useSignalsStream } from '@herdr/shared';

type SignalsState = ReturnType<typeof useSignalsStream>;

const SignalsContext = createContext<SignalsState | null>(null);

/** One signals stream for the whole app (the deck, beats, the meanwhile
 *  strip all read the same snapshot). Mounted next to RosterProvider so a
 *  settings change remounts it against the new API config. */
export function SignalsProvider({ children }: { children: ReactNode }) {
  const state = useSignalsStream();
  return <SignalsContext.Provider value={state}>{children}</SignalsContext.Provider>;
}

export function useSignals(): SignalsState {
  const ctx = useContext(SignalsContext);
  if (!ctx) throw new Error('useSignals outside SignalsProvider');
  return ctx;
}
