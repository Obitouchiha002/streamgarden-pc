import type { DownloadItem, DownloadRequest, MediaInfo, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';

/**
 * Opening the renderer in a plain browser (vite dev server) means there is no Electron
 * preload, so `window.sg` is missing and every call would throw. This stands in for it with
 * believable data so the layout can be reviewed without launching the desktop app.
 *
 * It only installs itself when the real bridge is absent — inside Electron this is inert.
 */
export function installDevShim() {
  if ((window as any).sg) return;

  const listeners = { queue: [] as ((i: DownloadItem) => void)[] };
  let settings: Settings = { ...DEFAULT_SETTINGS, downloadDir: '/Users/you/Downloads/StreamGarden' };
  const items = new Map<string, DownloadItem>();

  const sample: MediaInfo = {
    url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
    title: 'Big Buck Bunny 60fps 4K — Official Blender Foundation Short Film',
    uploader: 'Blender',
    duration: 635,
    thumbnail: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/maxresdefault.jpg',
    isPlaylist: false,
    subtitles: [{ lang: 'en', name: 'English' }, { lang: 'hi', name: 'Hindi' }],
    formats: [
      { id: '313', label: '2160p60', kind: 'video', ext: 'webm', height: 2160, filesize: 1_362_000_000, note: 'merged with best audio' },
      { id: '308', label: '1440p60', kind: 'video', ext: 'webm', height: 1440, filesize: 473_000_000, note: 'merged with best audio' },
      { id: '299', label: '1080p60', kind: 'video', ext: 'mp4', height: 1080, filesize: 258_000_000, note: 'merged with best audio' },
      { id: '298', label: '720p60', kind: 'video', ext: 'mp4', height: 720, filesize: 151_000_000, note: 'merged with best audio' },
      { id: '18', label: '360p', kind: 'video', ext: 'mp4', height: 360, filesize: 17_800_000 },
      { id: 'mp3-320', label: 'MP3 320 kbps', kind: 'audio', ext: 'mp3', bitrate: 320, note: 'converted on this PC' },
      { id: 'mp3-192', label: 'MP3 192 kbps', kind: 'audio', ext: 'mp3', bitrate: 192, note: 'converted on this PC' },
      { id: '251', label: '160 kbps · WEBM', kind: 'audio', ext: 'webm', bitrate: 160, filesize: 12_400_000 },
    ],
  };

  /** Walks a fake download through its phases so the queue screen can be seen working. */
  function simulate(item: DownloadItem) {
    let p = 0;
    const tick = setInterval(() => {
      p = Math.min(1, p + 0.04 + Math.random() * 0.05);
      const next: DownloadItem = {
        ...items.get(item.id)!,
        phase: p >= 1 ? 'merging' : 'downloading',
        progress: p,
        total: 258_000_000,
        received: Math.round(258_000_000 * p),
        speed: `${(3 + Math.random() * 4).toFixed(1)} MiB/s`,
        eta: `00:${String(Math.max(0, Math.round((1 - p) * 40))).padStart(2, '0')}`,
      };
      items.set(item.id, next);
      listeners.queue.forEach((f) => f(next));

      if (p >= 1) {
        clearInterval(tick);
        setTimeout(() => {
          const done: DownloadItem = {
            ...items.get(item.id)!, phase: 'done', progress: 1, speed: '', eta: '',
            outputPath: `${settings.downloadDir}/${item.title}.mp4`,
          };
          items.set(item.id, done);
          listeners.queue.forEach((f) => f(done));
        }, 1400);
      }
    }, 500);
  }

  (window as any).sg = {
    platform: 'browser',
    toolStatus: async () => ({ ytDlp: '/usr/local/bin/yt-dlp', ffmpeg: '/usr/local/bin/ffmpeg', ready: true }),
    probe: async (url: string) => {
      await new Promise((r) => setTimeout(r, 700));
      if (/list=|playlist/i.test(url)) {
        return {
          ...sample, isPlaylist: true, title: 'Blender Open Movies', formats: [], subtitles: [],
          entries: ['Big Buck Bunny', 'Sintel', 'Tears of Steel', 'Elephants Dream', 'Cosmos Laundromat', 'Spring']
            .map((t, i) => ({ url: `https://example.com/${i}`, title: t, duration: 400 + i * 130 })),
        } as MediaInfo;
      }
      return { ...sample, url };
    },
    queue: {
      add: async (req: DownloadRequest) => {
        const item: DownloadItem = {
          ...req, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          phase: 'downloading', progress: 0, speed: '', eta: '', received: 0, total: 0, addedAt: Date.now(),
        };
        items.set(item.id, item);
        listeners.queue.forEach((f) => f(item));
        simulate(item);
        return item;
      },
      all: async () => [...items.values()],
      pause: async (id: string) => patch(id, { phase: 'paused', speed: '', eta: '' }),
      resume: async (id: string) => patch(id, { phase: 'downloading' }),
      cancel: async (id: string) => patch(id, { phase: 'cancelled', speed: '', eta: '' }),
      remove: async (id: string) => { items.delete(id); },
      clearFinished: async () => {
        [...items.values()].forEach((i) => {
          if (['done', 'failed', 'cancelled'].includes(i.phase)) items.delete(i.id);
        });
        return [...items.values()];
      },
    },
    settings: {
      get: async () => settings,
      set: async (s: Settings) => { settings = s; return settings; },
    },
    pickFolder: async () => '/Users/you/Downloads/StreamGarden',
    openPath: async (p: string) => console.info('[preview] open', p),
    showInFolder: async (p: string) => console.info('[preview] reveal', p),
    openExternal: async (u: string) => window.open(u, '_blank'),
    window: { minimize() {}, maximize() {}, close() {} },
    onQueueItem: (cb: (i: DownloadItem) => void) => {
      listeners.queue.push(cb);
      return () => { listeners.queue = listeners.queue.filter((f) => f !== cb); };
    },
    onClipboardLink: () => () => {},
    onOpenUrl: () => () => {},
  };

  function patch(id: string, p: Partial<DownloadItem>) {
    const cur = items.get(id);
    if (!cur) return;
    const next = { ...cur, ...p };
    items.set(id, next);
    listeners.queue.forEach((f) => f(next));
  }

  console.info('[StreamGarden] browser preview — downloads are simulated, nothing is fetched.');
}
