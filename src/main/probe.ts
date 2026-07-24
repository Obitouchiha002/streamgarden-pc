import { ytDlpJson } from './tools';
import type { MediaInfo, MediaFormat, Subtitle } from '../shared/types';

/**
 * Ask yt-dlp what a URL actually offers. Playlists come back as a list of entries the user
 * can tick; a single video comes back with its real format list rather than a fixed menu.
 */
export async function probe(url: string): Promise<MediaInfo> {
  const raw = await ytDlpJson([
    '--dump-single-json',
    '--no-warnings',
    '--flat-playlist',
    url,
  ]);

  // A playlist: return the entries, don't try to describe formats for all of them.
  if (raw._type === 'playlist' && Array.isArray(raw.entries)) {
    return {
      url,
      title: raw.title || 'Playlist',
      uploader: raw.uploader || raw.channel || '',
      duration: 0,
      thumbnail: raw.thumbnails?.[raw.thumbnails.length - 1]?.url || '',
      formats: [],
      subtitles: [],
      isPlaylist: true,
      entries: raw.entries.filter(Boolean).map((e: any) => ({
        url: e.url || e.webpage_url || e.id,
        title: e.title || 'Untitled',
        duration: e.duration || 0,
      })),
    };
  }

  // A single item: --flat-playlist suppresses formats, so ask again properly.
  const full = raw.formats ? raw : await ytDlpJson(['--dump-single-json', '--no-warnings', url]);
  return single(url, full);
}

function single(url: string, j: any): MediaInfo {
  const seenVideo = new Set<number>();
  const video: MediaFormat[] = [];
  const audio: MediaFormat[] = [];

  for (const f of j.formats || []) {
    const hasV = f.vcodec && f.vcodec !== 'none';
    const hasA = f.acodec && f.acodec !== 'none';

    if (hasV && f.height) {
      // One entry per resolution — the highest-bitrate variant wins.
      if (seenVideo.has(f.height)) continue;
      seenVideo.add(f.height);
      video.push({
        id: f.format_id,
        label: `${f.height}p${f.fps && f.fps >= 50 ? f.fps : ''}`,
        kind: 'video',
        ext: f.ext || 'mp4',
        height: f.height,
        filesize: f.filesize || f.filesize_approx || undefined,
        note: hasA ? undefined : 'merged with best audio',
      });
    } else if (hasA && !hasV) {
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
    formats: [...video, ...mp3, ...audio.slice(0, 6)],
    subtitles,
    isPlaylist: false,
  };
}
