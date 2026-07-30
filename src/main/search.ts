import { ChildProcess } from 'child_process';
import { spawnYtDlp } from './tools';

export interface SearchHit {
  url: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
}

// Only one search matters at a time — the latest keystroke. Keeping a handle on the running
// yt-dlp lets us kill the previous one the moment a new query arrives, so stale searches don't
// pile up and choke the machine (which is what made results crawl in).
let current: ChildProcess | null = null;

export function cancelSearch() {
  if (current && !current.killed) { try { current.kill(); } catch { /* already gone */ } }
  current = null;
}

/**
 * Search as you type. `--flat-playlist` keeps this to one request that returns titles only —
 * no per-video work. Each call cancels the one before it, so only the newest query runs.
 */
export function search(query: string, limit = 12): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) { cancelSearch(); return Promise.resolve([]); }

  cancelSearch();   // supersede whatever was running

  return new Promise((resolve) => {
    const child = spawnYtDlp([
      `ytsearch${limit}:${q}`,
      '--dump-single-json',
      '--flat-playlist',
      '--no-warnings',
    ], { noCookies: true });
    current = child;

    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.on('error', () => { if (current === child) current = null; resolve([]); });
    child.on('close', () => {
      if (current === child) current = null;
      // A killed/superseded search just yields nothing; the newer one will answer.
      try {
        const raw = JSON.parse(out || 'null');
        resolve((raw?.entries || []).filter(Boolean).map((e: any) => ({
          url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
          title: e.title || 'Untitled',
          uploader: e.uploader || e.channel || '',
          duration: e.duration || 0,
          thumbnail: e.thumbnails?.[0]?.url || '',
        })));
      } catch { resolve([]); }
    });
  });
}
