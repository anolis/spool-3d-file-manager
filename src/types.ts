export interface Model {
  id: string; name: string; title: string; format: string; size: number; added: string;
  tags: string[]; source?: string; notes?: string; favorite?: boolean; printed?: boolean;
  archiveId?: string; archiveName?: string; archivePath?: string; originalPath?: string;
  path?: string; relativePath?: string; directory?: boolean;
}
export interface Provider { id: string; name: string; color: string; connected: boolean; mode: 'live' | 'index'; env?: string }
export interface RemoteModel { id: string; title: string; creator: string; image?: string; originalImage?: string; source: string; provider: string; searchMode?: string; summary?: string }
export async function api<T = unknown>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
export const fileUrl = (item: Model) => item.path ? `/api/local-file?path=${encodeURIComponent(item.path)}` : `/api/files/${item.id}`;
export function sizeLabel(bytes: number) { return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes/1024).toFixed(1)} KB` : `${(bytes/1048576).toFixed(1)} MB`; }
export function sourceName(url?: string) { try { return new URL(url!).hostname.replace(/^www\./,''); } catch { return ''; } }
export interface ModelFolder { id: string; name: string; path: string; count: number; scannedAt?: string; truncated?: boolean }
export interface FolderScan { folder: ModelFolder; items: Model[]; warnings: string[]; truncated: boolean; scannedAt: string }
declare global {
  interface Window { spoolDesktop?: {
    chooseFolder(): Promise<string | null>;
    saveFile(url: string, name: string): Promise<boolean>;
    showStorage(): Promise<string>;
    onAddFolder(callback: () => void): () => void;
  } }
}
