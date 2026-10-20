import { createContext, useContext, type ReactNode } from 'react';
import { useRoster as useRosterStream } from '@herdr/shared';

type RosterState = ReturnType<typeof useRosterStream>;

const RosterContext = createContext<RosterState | null>(null);

/**
 * One roster stream for the whole app. Each screen used to call the shared
 * hook itself — four SSE connections, and since the wake handler started
 * POSTing /api/roster/refresh, four re-snapshots of herdr per wake. Mounted
 * under BootProvider's keyed View so a settings change remounts it against
 * the new API config.
 */
export function RosterProvider({ children }: { children: ReactNode }) {
  const state = useRosterStream();
  return <RosterContext.Provider value={state}>{children}</RosterContext.Provider>;
}

export function useRoster(): RosterState {
  const ctx = useContext(RosterContext);
  if (!ctx) throw new Error('useRoster outside RosterProvider');
  return ctx;
}
