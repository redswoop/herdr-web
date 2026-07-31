import { useCallback, useSyncExternalStore } from 'react';

/** Desktop layout breakpoint — must match the 720/721px media queries in style.css. */
export const WIDE = '(min-width: 721px)';

/** Reactive matchMedia — re-renders when the query flips. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches);
}
