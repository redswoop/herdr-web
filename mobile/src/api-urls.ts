import { apiUrl } from '@herdr/shared';

/** GET /api/file — metadata + content, on the pane's own server (`host`) */
export function fileInfoUrl(path: string, cwd: string | null, host: string | null = null): string {
  return apiUrl(
    `/api/file?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`,
    host,
  );
}

/** GET /api/file/raw — bytes (images etc.) */
export function fileRawUrl(path: string, cwd: string | null = null, host: string | null = null): string {
  return apiUrl(
    `/api/file/raw?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`,
    host,
  );
}
