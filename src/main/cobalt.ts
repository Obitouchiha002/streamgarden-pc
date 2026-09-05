/**
 * Cobalt fast-resolve. Public Cobalt instances do the heavy extraction on THEIR servers and hand
 * back a ready-to-download URL in ~0.5s — even when this machine's IP is rate-limited by YouTube
 * (which makes a local yt-dlp probe crawl to 20-40s). We try instances in order and return the
 * first usable URL; the caller falls back to yt-dlp if this returns null.
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const INSTANCES = [
  'https://co.otomir23.me',
  'https://dwnld.nichind.dev',
  'https://co.eepy.today',
];

export interface CobaltReq {
  audioOnly?: boolean;
  audioFormat?: string;   // 'mp3' | 'best' | …
  videoQuality?: string;  // '360' | '720' | '1080' | 'max'
}

/** Returns a direct/tunnel download URL, or null if no instance could produce one. */
export async function cobaltResolve(url: string, req: CobaltReq): Promise<string | null> {
  const body: Record<string, unknown> = { url };
  if (req.audioOnly) {
    body.downloadMode = 'audio';
    body.audioFormat = req.audioFormat || 'best';
  } else {
    body.downloadMode = 'auto';
    body.videoQuality = req.videoQuality || '1080';
  }

  for (const inst of INSTANCES) {
    try {
      const r = await fetch(inst + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
      const j: any = await r.json();
      if (j?.url && (j.status === 'tunnel' || j.status === 'redirect' || j.status === 'stream')) {
        return j.url as string;
      }
      // A carousel/picker (e.g. Instagram) — prefer the video item.
      if (j?.status === 'picker' && Array.isArray(j.picker) && j.picker.length) {
        const pick = j.picker.find((p: any) => p.type === 'video') || j.picker[0];
        if (pick?.url) return pick.url as string;
      }
      // Any other status (error / auth) → try the next instance.
    } catch {
      /* timeout / network / blocked → next instance */
    }
  }
  return null;
}
