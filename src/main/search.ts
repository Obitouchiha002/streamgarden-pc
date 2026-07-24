import { ytDlpJson } from './tools';

export interface SearchHit {
  url: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
}

/**
 * Search as you type. `--flat-playlist` keeps this to one request that returns titles
 * only — no per-video work — which is what makes it fast enough to run on each keystroke.
 * A search that's superseded is abandoned by the caller rather than cancelled here.
 */
export async function search(query: string, limit = 12): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  const raw = await ytDlpJson([
    `ytsearch${limit}:${q}`,
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
  ]);

  return (raw?.entries || [])
    .filter(Boolean)
    .map((e: any) => ({
      url: e.url || `https://www.youtube.com/watch?v=${e.id}`,
      title: e.title || 'Untitled',
      uploader: e.uploader || e.channel || '',
      duration: e.duration || 0,
      thumbnail: e.thumbnails?.[0]?.url || '',
    }));
}
