import { ChildProcess } from 'child_process';
import { spawnYtDlp } from './tools';

export interface SearchHit {
  url: string;
  title: string;
  uploader: string;
  duration: number;
  thumbnail: string;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Only one search matters at a time — the latest keystroke. We keep a handle on both the (rare)
// yt-dlp fallback child AND the scrape's AbortController so a new query instantly supersedes the
// old one and stale searches don't pile up.
let current: ChildProcess | null = null;
let currentAbort: AbortController | null = null;

export function cancelSearch() {
  if (current && !current.killed) { try { current.kill(); } catch { /* already gone */ } }
  current = null;
  if (currentAbort) { try { currentAbort.abort(); } catch { /* already gone */ } currentAbort = null; }
}

// "3:52" / "1:02:03" → seconds. Empty/odd → 0.
function toSeconds(t: string): number {
  const parts = (t || '').split(':').map((n) => Number(n));
  if (!parts.length || parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// Primary search: scrape YouTube's results page. This is ONE lightweight web request that returns
// in ~1s even when yt-dlp's extraction is being rate-limited (the reason search "crawled") — the
// results page is served like any normal page, not through the throttled innertube path.
async function scrapeYouTube(query: string, n: number, signal: AbortSignal): Promise<SearchHit[]> {
  const r = await fetch(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&gl=US`,
    {
      signal,
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'en-US,en',
        // Consent cookie — skips the cookie-consent interstitial (which carries no results).
        Cookie:
          'CONSENT=YES+cb; SOCS=CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMTA5LjA1X3AwGgJlbiADGgYIgLC_rQY',
      },
    },
  );
  const html = await r.text();
  const m = html.match(/ytInitialData\s*=\s*({.+?});\s*<\/script>/s);
  if (!m) return [];
  const j = JSON.parse(m[1]);
  const sections =
    j.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];
  const items = sections.flatMap((c: any) => c.itemSectionRenderer?.contents || []);
  return items
    .filter((i: any) => i.videoRenderer?.videoId)
    .slice(0, n)
    .map((i: any) => {
      const v = i.videoRenderer;
      return {
        url: `https://www.youtube.com/watch?v=${v.videoId}`,
        title: v.title?.runs?.[0]?.text || 'Untitled',
        uploader: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || '',
        duration: toSeconds(v.lengthText?.simpleText || ''),
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
      };
    });
}

// Fallback: yt-dlp ytsearch (used only if the scrape returns nothing, e.g. YouTube changed markup).
function ytDlpSearch(query: string, limit: number): Promise<SearchHit[]> {
  return new Promise((resolve) => {
    const child = spawnYtDlp(
      [`ytsearch${limit}:${query}`, '--dump-single-json', '--flat-playlist', '--no-warnings'],
      { noCookies: true },
    );
    current = child;
    let out = '';
    child.stdout?.on('data', (d) => (out += d.toString()));
    child.on('error', () => { if (current === child) current = null; resolve([]); });
    child.on('close', () => {
      if (current === child) current = null;
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

/**
 * Search as you type. Scrapes the results page first (fast + rate-limit-proof); only if that comes
 * back empty does it spend a yt-dlp call. Each call supersedes the one before it.
 */
export function search(query: string, limit = 12): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) { cancelSearch(); return Promise.resolve([]); }

  cancelSearch(); // supersede whatever was running
  const ac = new AbortController();
  currentAbort = ac;

  return scrapeYouTube(q, limit, ac.signal)
    .then((hits) => {
      if (ac.signal.aborted) return [];
      if (currentAbort === ac) currentAbort = null;
      return hits.length ? hits : ytDlpSearch(q, limit);
    })
    .catch(() => (ac.signal.aborted ? [] : ytDlpSearch(q, limit)));
}
