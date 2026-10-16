/** Roster freshness as the headers show it, plus the manual refresh. */
export interface Sync {
  syncedAt: number;
  refreshing: boolean;
  onRefresh: () => Promise<void>;
}
