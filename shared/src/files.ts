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

/** the folder sort choices, in menu order; `natural` is the direction a fresh pick starts in */
export const DIR_SORTS: { key: DirSort; label: string; natural: 'asc' | 'desc' }[] = [
  { key: 'name', label: 'name', natural: 'asc' },
  { key: 'kind', label: 'kind', natural: 'asc' },
  { key: 'size', label: 'size', natural: 'desc' },
  { key: 'mtime', label: 'date', natural: 'desc' },
];

/** a sort pick: its key, whether it runs against its natural direction, and
 *  whether folders sit on top or mix in with the files */
export interface DirOrder {
  sort: DirSort;
  reversed: boolean;
  foldersFirst: boolean;
}

/** does `key` currently run descending (for its arrow)? an unpicked key shows its natural way */
export function dirDesc(o: DirOrder, key: DirSort = o.sort): boolean {
  const nat = DIR_SORTS.find((s) => s.key === key)?.natural ?? 'asc';
  return (nat === 'desc') !== (o.sort === key && o.reversed);
}

/** "date ↓" — what the sort button reads */
export const dirOrderLabel = (o: DirOrder) =>
  `${DIR_SORTS.find((s) => s.key === o.sort)?.label ?? o.sort} ${dirDesc(o) ? '↓' : '↑'}`;

/** query suffix for /api/file — empty for the server's default (name, A→Z, folders first) */
export function dirOrderQuery(o: DirOrder): string {
  const mix = o.foldersFirst ? '' : '&folders=mix';
  if (o.sort === 'name' && !o.reversed) return mix;
  return `&sort=${o.sort}&desc=${dirDesc(o) ? 1 : 0}${mix}`;
}

/** picking a sort: a new key starts natural, the current key flips */
export const nextDirOrder = (o: DirOrder, key: DirSort): DirOrder =>
  o.sort === key ? { ...o, reversed: !o.reversed } : { ...o, sort: key, reversed: false };

/** stored as `mtime`, `mtime:r`, `mtime:r:mix` — older values parse unchanged */
export function parseDirOrder(s: string | null | undefined): DirOrder {
  const [sort, ...flags] = (s ?? '').split(':');
  return {
    sort: DIR_SORTS.some((x) => x.key === sort) ? (sort as DirSort) : 'name',
    reversed: flags.includes('r'),
    foldersFirst: !flags.includes('mix'),
  };
}
export const formatDirOrder = (o: DirOrder) =>
  `${o.sort}${o.reversed ? ':r' : ''}${o.foldersFirst ? '' : ':mix'}`;
