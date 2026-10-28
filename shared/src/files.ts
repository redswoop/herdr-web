import type { DirSort } from './types';

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** a folder row's date: "14:32" today, "Oct 3" this year, "Oct 3 2024" before */
export function fmtStamp(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString())
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return d.getFullYear() === n.getFullYear() ? md : `${md} ${d.getFullYear()}`;
}

/** the folder sort choices, in strip order; `natural` is the direction a fresh pick starts in */
export const DIR_SORTS: { key: DirSort; label: string; natural: 'asc' | 'desc' }[] = [
  { key: 'name', label: 'name', natural: 'asc' },
  { key: 'size', label: 'size', natural: 'desc' },
  { key: 'mtime', label: 'date', natural: 'desc' },
];

/** a sort pick: its key and whether it runs against its natural direction */
export interface DirOrder {
  sort: DirSort;
  reversed: boolean;
}

/** query suffix for /api/file — empty for the server's default (name, A→Z) */
export function dirOrderQuery(o: DirOrder): string {
  if (o.sort === 'name' && !o.reversed) return '';
  const nat = DIR_SORTS.find((s) => s.key === o.sort)?.natural ?? 'asc';
  const desc = (nat === 'desc') !== o.reversed;
  return `&sort=${o.sort}&desc=${desc ? 1 : 0}`;
}

/** tapping a sort: a new key starts natural, the current key flips */
export const nextDirOrder = (o: DirOrder, key: DirSort): DirOrder =>
  o.sort === key ? { sort: key, reversed: !o.reversed } : { sort: key, reversed: false };

export function parseDirOrder(s: string | null | undefined): DirOrder {
  const [sort, r] = (s ?? '').split(':');
  return DIR_SORTS.some((x) => x.key === sort) ? { sort: sort as DirSort, reversed: r === 'r' } : { sort: 'name', reversed: false };
}
export const formatDirOrder = (o: DirOrder) => `${o.sort}${o.reversed ? ':r' : ''}`;
