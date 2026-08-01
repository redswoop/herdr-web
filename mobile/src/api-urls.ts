import { apiUrl } from '@herdr/shared';

/** GET /api/file — metadata + content */
export function fileInfoUrl(path: string, cwd: string | null): string {
  return apiUrl(
    `/api/file?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`,
  );
}

/** GET /api/file/raw — bytes (images etc.) */
export function fileRawUrl(path: string, cwd: string | null = null): string {
  return apiUrl(
    `/api/file/raw?path=${encodeURIComponent(path)}&cwd=${encodeURIComponent(cwd ?? '')}`,
  );
}
