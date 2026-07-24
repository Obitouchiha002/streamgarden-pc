/** The contract between the Electron main process and the React renderer. */

export type Phase =
  | 'queued'
  | 'probing'
  | 'downloading'
  | 'merging'
  | 'converting'
  | 'done'
  | 'paused'
  | 'failed'
  | 'cancelled';

export interface MediaFormat {
  id: string;
  label: string;          // "1080p", "MP3 320 kbps"
  kind: 'video' | 'audio';
  ext: string;
  height?: number;
  bitrate?: number;
  filesize?: number;      // bytes, when the source reports one
  note?: string;
}

export interface Subtitle {
  lang: string;
  name: string;
}

export interface MediaInfo {
  url: string;
  title: string;
  uploader: string;
  duration: number;       // seconds
  thumbnail: string;
  formats: MediaFormat[];
  subtitles: Subtitle[];
  isPlaylist: boolean;
  entries?: { url: string; title: string; duration: number }[];
}

/** Everything the user can ask for on one download. */
export interface DownloadRequest {
  url: string;
  title: string;
  formatId: string;
  /** Container/codec to end up in. 'auto' keeps whatever the source gives. */
  container: 'auto' | 'mp4' | 'mkv' | 'webm' | 'mp3' | 'm4a' | 'wav' | 'flac' | 'gif';
  audioOnly: boolean;
  /** Burn or embed subtitles in these languages. Empty = none. */
  subtitleLangs: string[];
  embedSubtitles: boolean;
  /** Trim to a section, in seconds. Both null = whole file. */
  trimStart: number | null;
  trimEnd: number | null;
  /** Put the file in a per-uploader folder. */
  organiseByUploader: boolean;
  thumbnail?: string;
  uploader?: string;
}

export interface DownloadItem extends DownloadRequest {
  id: string;
  phase: Phase;
  progress: number;        // 0..1
  speed: string;           // "4.2 MiB/s"
  eta: string;             // "00:42"
  received: number;        // bytes
  total: number;           // bytes
  outputPath?: string;
  error?: string;
  addedAt: number;
}

export interface Settings {
  downloadDir: string;
  maxParallel: number;          // how many downloads run at once
  connectionsPerDownload: number;
  clipboardWatch: boolean;
  minimiseToTray: boolean;
  globalHotkey: string;         // e.g. "CommandOrControl+Shift+D"
  organiseByUploader: boolean;
  theme: 'system' | 'light' | 'dark';
  defaultContainer: DownloadRequest['container'];
}

export const DEFAULT_SETTINGS: Settings = {
  downloadDir: '',
  maxParallel: 3,
  connectionsPerDownload: 8,
  clipboardWatch: true,
  minimiseToTray: true,
  globalHotkey: 'CommandOrControl+Shift+D',
  organiseByUploader: false,
  theme: 'system',
  defaultContainer: 'auto',
};

/** Links we offer to fetch when they appear on the clipboard. */
export const SUPPORTED_HOSTS =
  /(youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.watch|tiktok\.com|twitter\.com|x\.com|dailymotion\.com|archive\.org|vimeo\.com|reddit\.com|soundcloud\.com|twitch\.tv)/i;

export function isSupportedUrl(u: string): boolean {
  return /^https?:\/\//i.test(u) && SUPPORTED_HOSTS.test(u);
}
