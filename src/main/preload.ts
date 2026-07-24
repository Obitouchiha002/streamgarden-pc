import { contextBridge, ipcRenderer } from 'electron';
import type { DownloadItem, DownloadRequest, MediaInfo, Settings } from '../shared/types';

/**
 * The only surface the renderer gets. Node stays out of the web layer entirely —
 * everything crosses this bridge, so a page can't reach the filesystem on its own.
 */
const api = {
  toolStatus: (): Promise<{ ytDlp: string | null; ffmpeg: string | null; ready: boolean }> =>
    ipcRenderer.invoke('tools:status'),

  probe: (url: string): Promise<MediaInfo> => ipcRenderer.invoke('probe', url),

  /** Type-ahead search; results come back fast enough to run on each keystroke. */
  search: (q: string): Promise<{ url: string; title: string; uploader: string; duration: number; thumbnail: string }[]> =>
    ipcRenderer.invoke('search', q),

  /** A local URL a <video> can scrub without downloading the file. */
  previewUrl: (url: string): Promise<string> => ipcRenderer.invoke('preview-url', url),

  admin: {
    checkin: (): Promise<{
      blocked: boolean; reason: string | null; code: string | null; until: string | null;
      premium: boolean; latest_version: string | null; update_url: string | null; update_note: string | null;
    }> => ipcRenderer.invoke('admin:checkin'),
    device: (): Promise<{ id: string; name: string }> => ipcRenderer.invoke('admin:device'),
    claimName: (name: string): Promise<'ok' | 'taken' | 'invalid' | 'offline'> =>
      ipcRenderer.invoke('admin:claimName', name),
  },

  queue: {
    add: (req: DownloadRequest): Promise<DownloadItem> => ipcRenderer.invoke('queue:add', req),
    all: (): Promise<DownloadItem[]> => ipcRenderer.invoke('queue:all'),
    pause: (id: string) => ipcRenderer.invoke('queue:pause', id),
    resume: (id: string) => ipcRenderer.invoke('queue:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('queue:cancel', id),
    remove: (id: string) => ipcRenderer.invoke('queue:remove', id),
    clearFinished: (): Promise<DownloadItem[]> => ipcRenderer.invoke('queue:clearFinished'),
  },

  settings: {
    get: (): Promise<Settings> => ipcRenderer.invoke('settings:get'),
    set: (s: Settings): Promise<Settings> => ipcRenderer.invoke('settings:set', s),
  },

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  openPath: (p: string) => ipcRenderer.invoke('open-path', p),
  showInFolder: (p: string) => ipcRenderer.invoke('show-in-folder', p),
  openExternal: (u: string) => ipcRenderer.invoke('open-external', u),

  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },

  // Events from the main process. Each returns an unsubscribe function.
  onQueueItem: (cb: (item: DownloadItem) => void) => {
    const h = (_e: unknown, item: DownloadItem) => cb(item);
    ipcRenderer.on('queue-item', h);
    // Returns void, not the IpcRenderer — React expects a plain cleanup function.
    return () => { ipcRenderer.removeListener('queue-item', h); };
  },
  onClipboardLink: (cb: (url: string) => void) => {
    const h = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('clipboard-link', h);
    return () => { ipcRenderer.removeListener('clipboard-link', h); };
  },
  onOpenUrl: (cb: (url: string) => void) => {
    const h = (_e: unknown, url: string) => cb(url);
    ipcRenderer.on('open-url', h);
    return () => { ipcRenderer.removeListener('open-url', h); };
  },

  platform: process.platform,
};

contextBridge.exposeInMainWorld('sg', api);
export type SgApi = typeof api;
