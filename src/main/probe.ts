import { ytDlpJson, cancelJson } from './tools';
import type { MediaInfo, MediaFormat, Subtitle } from '../shared/types';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// yt-dlp's extraction can be rate-limited to 20s+ on a hammered IP. Cap the wait, then hand back
// fast generic options instead of hanging the "paste a link" screen.
const PROBE_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('probe-timeout')), ms)),
  ]);
}

// Fast path: page title/uploader/thumbnail from oembed (one quick web request) plus a standard
// quality ladder. The ids are yt-dlp format *selectors* (bestvideo[height<=N]), resolved at
// download time — which stays fast even when the metadata probe is being throttled.
async function fastMedia(url: string): Promise<MediaInfo> {
  let title = 'Video', thumbnail = '', uploader = '';
  try {
    const r = await withTimeout(
      fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`, {
        headers: { 'User-Agent': UA },
      }),
      3500,
    );
    if (r.ok) {
      const j: any = await r.json();
      title = j.title || title;
      thumbnail = j.thumbnail_url || '';
      uploader = j.author_name || '';
    }
  } catch { /* keep defaults — the options still work */ }

  const video: MediaFormat[] = [1080, 720, 480, 360].map((h) => ({
    id: `bestvideo[height<=${h}]`,
    label: `${h}p`,
    kind: 'video',
    ext: 'mp4',
    height: h,
    note: h === 1080 ? 'best available' : undefined,
  }));
  const mp3: MediaFormat[] = [320, 192, 128].map((b) => ({
    id: `mp3-${b}`, label: `MP3 ${b} kbps`, kind: 'audio', ext: 'mp3', bitrate: b, note: 'converted on this PC',
  }));

  return {
    url, title, uploader, duration: 0, thumbnail,
    formats: [...video, ...mp3],
    subtitles: [], isPlaylist: false,
  };
}

/**
 * Ask yt-dlp what a URL actually offers. Playlists come back as a list of entries the user
 * can tick; a single video comes back with its real format list rather than a fixed menu.
 */
// Playlist / channel / set pages — only these get the cheap flat listing. A normal watch URL
// (even watch?v=…&list=…) is a single video and takes the fast single-call path.
const LIST_URL = /(\/playlist\b)|(\/(channel|c|user)\/)|(\/@[\w.-]+\/(videos|streams|shorts))|(soundcloud\.com\/[^/]+\/sets\/)/i;

function asPlaylist(url: string, raw: any): MediaInfo {
  return {
    url,
    title: raw.title || 'Playlist',
    uploader: raw.uploader || raw.channel || '',
    duration: 0,
    thumbnail: raw.thumbnails?.[raw.thumbnails.length - 1]?.url || '',
    formats: [],
    subtitles: [],
    isPlaylist: true,
    entries: (raw.entries || []).filter(Boolean).map((e: any) => ({
      url: e.url || e.webpage_url || e.id,
      title: e.title || 'Untitled',
      duration: e.duration || 0,
    })),
  };
}

export async function probe(url: string): Promise<MediaInfo> {
  // Playlist page → one cheap flat call. Otherwise a single video → ONE full call (was two
  // before: a flat call that returns no formats, then the real one — pure wasted time).
  if (LIST_URL.test(url)) {
    const raw = await ytDlpJson(['--dump-single-json', '--no-warnings', '--flat-playlist', url]);
    if (raw._type === 'playlist' && Array.isArray(raw.entries)) return asPlaylist(url, raw);
    return single(url, raw.formats ? raw : await ytDlpJson(['--dump-single-json', '--no-warnings', url]));
  }

  // Single video: the rich yt-dlp probe is best, but its extraction can be rate-limited to 20s+.
  // Kick off the fast fallback in parallel and hand it back if yt-dlp doesn't answer quickly, so
  // pasting a link always shows options within a second or two.
  const fastP = fastMedia(url).catch(() => null);
  const richP = ytDlpJson(['--dump-single-json', '--no-warnings', '--no-playlist', url]);
  richP.catch(() => { /* if the timeout wins, swallow the later rejection (no unhandled warning) */ });
  try {
    const full = await withTimeout(richP, PROBE_TIMEOUT_MS);
    if (full._type === 'playlist' && Array.isArray(full.entries)) return asPlaylist(url, full);
    return single(url, full);
  } catch {
    cancelJson(); // stop the slow yt-dlp if it's still grinding
    const fast = await fastP;
    if (fast) return fast;
    // No fast data (odd site + oembed miss) → wait out the real probe rather than fail.
    const full = await ytDlpJson(['--dump-single-json', '--no-warnings', '--no-playlist', url]);
    return single(url, full);
  }
}

function single(url: string, j: any): MediaInfo {
  const seenVideo = new Set<number>();
  const video: MediaFormat[] = [];
  const audio: MediaFormat[] = [];
  let addedSizelessVideo = false;

  for (const f of j.formats || []) {
    const hasV = f.vcodec && f.vcodec !== 'none';
    const hasA = f.acodec && f.acodec !== 'none';

    if (hasV) {
      const h = f.height || 0;
      // Instagram/TikTok reels often report no height — before, that dropped the whole video
      // and only the thumbnail was left (so "video" downloaded an image). Keep it as one entry.
      if (h) { if (seenVideo.has(h)) continue; seenVideo.add(h); }
      else { if (addedSizelessVideo) continue; addedSizelessVideo = true; }
      video.push({
        id: f.format_id,
        label: h ? `${h}p${f.fps && f.fps >= 50 ? f.fps : ''}` : (f.format_note || (f.width ? `${f.width}px` : 'Video')),
        kind: 'video',
        ext: f.ext || 'mp4',
        height: h || undefined,
        filesize: f.filesize || f.filesize_approx || undefined,
        note: hasA ? undefined : 'merged with best audio',
      });
    } else if (hasA) {
      audio.push({
        id: f.format_id,
        label: `${Math.round(f.abr || f.tbr || 0)} kbps${f.ext ? ` · ${f.ext.toUpperCase()}` : ''}`,
        kind: 'audio',
        ext: f.ext || 'm4a',
        bitrate: Math.round(f.abr || f.tbr || 0),
        filesize: f.filesize || f.filesize_approx || undefined,
      });
    }
  }

  video.sort((a, b) => (b.height || 0) - (a.height || 0));
  audio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

  // MP3 is never served by a site; it's produced locally, so offer it as its own choice.
  const mp3: MediaFormat[] = [320, 192, 128].map((b) => ({
    id: `mp3-${b}`,
    label: `MP3 ${b} kbps`,
    kind: 'audio',
    ext: 'mp3',
    bitrate: b,
    note: 'converted on this PC',
  }));

  // The cover image as its own choice, alongside the video and audio options.
  const image: MediaFormat[] = j.thumbnail
    ? [{ id: 'thumbnail', label: 'Thumbnail (cover image)', kind: 'image', ext: 'jpg', note: 'highest resolution available' }]
    : [];

  const subtitles: Subtitle[] = Object.entries(j.subtitles || {}).map(([lang, tracks]: [string, any]) => ({
    lang,
    name: tracks?.[0]?.name || lang,
  }));

  return {
    url: j.webpage_url || url,
    title: j.title || 'Untitled',
    uploader: j.uploader || j.channel || '',
    duration: j.duration || 0,
    thumbnail: j.thumbnail || '',
    formats: [...video, ...mp3, ...audio.slice(0, 6), ...image],
    subtitles,
    isPlaylist: false,
  };
}
