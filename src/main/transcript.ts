// Pull the words out of a video: YouTube captions (manual or auto), and the caption text an
// Instagram/TikTok post was published with. No AI here — that's the Whisper path, separately.
import { ytDlpJson } from './tools';

export interface Transcript {
  title: string;
  uploader: string;
  caption: string;                       // the poster's own text (IG/TikTok/YouTube description)
  transcript: string;                    // the spoken words, from captions
  source: 'manual' | 'auto' | 'none';    // where the transcript came from
}

/** WebVTT → plain text: drop cues/timestamps/tags, and the duplicate lines auto-captions emit. */
function parseVtt(vtt: string): string {
  const out: string[] = [];
  for (let line of vtt.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('WEBVTT') || t.includes('-->') || /^\d+$/.test(t) ||
        t.startsWith('Kind:') || t.startsWith('Language:')) continue;
    line = t.replace(/<[^>]+>/g, '').trim();      // strip <c>, <00:00:00.000> etc.
    if (!line || out[out.length - 1] === line) continue;
    out.push(line);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** YouTube's json3 caption format → plain text. */
function parseJson3(s: string): string {
  try {
    const j = JSON.parse(s);
    const parts: string[] = [];
    for (const ev of j.events || []) for (const seg of ev.segs || []) if (seg.utf8) parts.push(seg.utf8);
    return parts.join('').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
}

export async function getTranscript(url: string): Promise<Transcript> {
  // We only need the caption tracks and the description — NOT the video formats. Skipping the
  // dash/hls manifests (and their slow signature work) makes this roughly twice as fast, and
  // a socket timeout means a bad network fails quickly instead of hanging.
  const j = await ytDlpJson([
    '-J', '--no-warnings', '--no-playlist',
    '--socket-timeout', '15',
    '--extractor-args', 'youtube:skip=dash,hls',
    url,
  ]);
  const title = j.title || '';
  const uploader = j.uploader || j.channel || j.uploader_id || '';
  const caption = (j.description || '').trim();

  // Prefer a human-made English track, then any manual, then auto-captions.
  const pick = (obj: any): any[] | null => {
    if (!obj) return null;
    return obj['en'] || obj['en-US'] || obj['en-orig'] || obj[Object.keys(obj)[0]] || null;
  };
  let track = pick(j.subtitles);
  let source: Transcript['source'] = 'manual';
  if (!track || !track.length) { track = pick(j.automatic_captions); source = 'auto'; }

  let transcript = '';
  if (track && track.length) {
    const fmt = track.find((f: any) => f.ext === 'json3')
      || track.find((f: any) => f.ext === 'vtt')
      || track.find((f: any) => f.ext === 'srv3')
      || track[0];
    if (fmt?.url) {
      try {
        const content = await fetch(fmt.url).then((r) => r.text());
        transcript = fmt.ext === 'json3' ? parseJson3(content) : parseVtt(content);
      } catch { /* leave empty */ }
    }
  }
  if (!transcript) source = 'none';
  return { title, uploader, caption, transcript, source };
}
