import { ChildProcess } from 'child_process';
import * as path from 'path';
import { spawnYtDlp } from './tools';
import type { DownloadItem, DownloadRequest, Settings, Phase } from '../shared/types';

/**
 * The download queue. Several items run at once (settings.maxParallel); the rest wait.
 * Each running item is one yt-dlp process, which we parse progress out of and can kill.
 *
 * Pause is a kill plus a flag — yt-dlp resumes from the .part file when restarted, so a
 * paused item picks up where it left off rather than starting over.
 */

type Emit = (item: DownloadItem) => void;

export class DownloadQueue {
  private items = new Map<string, DownloadItem>();
  private procs = new Map<string, ChildProcess>();
  private settings: Settings;
  private emit: Emit;

  constructor(settings: Settings, emit: Emit) {
    this.settings = settings;
    this.emit = emit;
  }

  updateSettings(s: Settings) {
    this.settings = s;
    this.pump();
  }

  all(): DownloadItem[] {
    return [...this.items.values()].sort((a, b) => a.addedAt - b.addedAt);
  }

  add(req: DownloadRequest): DownloadItem {
    const item: DownloadItem = {
      ...req,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      phase: 'queued',
      progress: 0,
      speed: '',
      eta: '',
      received: 0,
      total: 0,
      addedAt: Date.now(),
    };
    this.items.set(item.id, item);
    this.emit(item);
    this.pump();
    return item;
  }

  pause(id: string) {
    const item = this.items.get(id);
    if (!item) return;
    this.kill(id);
    this.set(id, { phase: 'paused', speed: '', eta: '' });
    this.pump();
  }

  resume(id: string) {
    const item = this.items.get(id);
    if (!item || (item.phase !== 'paused' && item.phase !== 'failed')) return;
    this.set(id, { phase: 'queued', error: undefined });
    this.pump();
  }

  cancel(id: string) {
    this.kill(id);
    this.set(id, { phase: 'cancelled', speed: '', eta: '' });
    this.pump();
  }

  remove(id: string) {
    this.kill(id);
    this.items.delete(id);
    this.pump();
  }

  clearFinished() {
    for (const [id, it] of this.items) {
      if (it.phase === 'done' || it.phase === 'cancelled' || it.phase === 'failed') {
        this.items.delete(id);
      }
    }
  }

  // ── internals ────────────────────────────────────────────────────────────
  private set(id: string, patch: Partial<DownloadItem>) {
    const cur = this.items.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.items.set(id, next);
    this.emit(next);
  }

  private kill(id: string) {
    const p = this.procs.get(id);
    if (p && !p.killed) { try { p.kill(); } catch { /* already gone */ } }
    this.procs.delete(id);
  }

  private running(): number {
    return [...this.items.values()].filter(
      (i) => i.phase === 'downloading' || i.phase === 'merging' || i.phase === 'converting' || i.phase === 'probing'
    ).length;
  }

  /** Start as many queued items as the parallel limit allows. */
  private pump() {
    let free = Math.max(0, this.settings.maxParallel - this.running());
    if (free <= 0) return;
    for (const item of this.all()) {
      if (free <= 0) break;
      if (item.phase !== 'queued') continue;
      this.start(item);
      free--;
    }
  }

  private outputTemplate(item: DownloadItem): string {
    const dir = this.settings.downloadDir;
    const sub = (item.organiseByUploader || this.settings.organiseByUploader)
      ? path.join(dir, '%(uploader,channel,extractor)s')
      : dir;
    return path.join(sub, '%(title).150B.%(ext)s');
  }

  private args(item: DownloadItem): string[] {
    const a: string[] = [
      item.url,
      '-o', this.outputTemplate(item),
      '--newline',                       // one progress line at a time, easy to parse
      '--no-warnings',
      '--no-playlist',
      '--continue',                      // resume from a .part file after a pause
      '--concurrent-fragments', String(Math.max(1, this.settings.connectionsPerDownload)),
      '--embed-thumbnail',
      '--add-metadata',
    ];

    // The cover image: fetch the picture itself, skip every media step.
    if (item.formatId === 'thumbnail') {
      return [
        item.url,
        '-o', this.outputTemplate(item),
        '--newline', '--no-warnings', '--no-playlist',
        '--write-thumbnail', '--convert-thumbnails', 'jpg',
        '--skip-download',
      ];
    }

    // MP3 is produced locally; everything else asks the site for a format id.
    if (item.formatId.startsWith('mp3-')) {
      const kbps = item.formatId.split('-')[1] || '192';
      a.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', `${kbps}K`);
    } else if (item.audioOnly) {
      a.push('-f', item.formatId);
      if (item.container !== 'auto') a.push('-x', '--audio-format', item.container);
    } else {
      // Video-only streams need audio merged back in.
      a.push('-f', `${item.formatId}+bestaudio/${item.formatId}/best`);
      a.push('--merge-output-format', item.container === 'auto' ? 'mp4' : item.container);
    }

    if (item.subtitleLangs.length) {
      a.push('--sub-langs', item.subtitleLangs.join(','));
      a.push(item.embedSubtitles ? '--embed-subs' : '--write-subs');
      a.push('--convert-subs', 'srt');
    }

    // Trim with ffmpeg. yt-dlp accepts a time range and cuts while downloading.
    if (item.trimStart !== null || item.trimEnd !== null) {
      const s = item.trimStart ?? 0;
      const e = item.trimEnd ?? '';
      a.push('--download-sections', `*${fmt(s)}-${e === '' ? 'inf' : fmt(e as number)}`);
      a.push('--force-keyframes-at-cuts');
    }

    return a;
  }

  private start(item: DownloadItem) {
    this.set(item.id, { phase: 'downloading', error: undefined });

    let child: ChildProcess;
    try {
      child = spawnYtDlp(this.args(this.items.get(item.id)!));
    } catch (e: any) {
      this.set(item.id, { phase: 'failed', error: e?.message || 'Could not start yt-dlp' });
      return;
    }
    this.procs.set(item.id, child);

    let lastErr = '';
    const onLine = (line: string) => {
      const p = parseProgress(line);
      if (p) { this.set(item.id, p); return; }
      const dest = line.match(/\[(?:Merger|ExtractAudio|download)\]\s+(?:Merging formats into|Destination:)\s+"?(.+?)"?$/);
      if (dest) this.set(item.id, { outputPath: dest[1] });
      if (/\[Merger\]/.test(line)) this.set(item.id, { phase: 'merging' });
      if (/\[ExtractAudio\]|\[VideoConvertor\]/.test(line)) this.set(item.id, { phase: 'converting' });
    };

    buffer(child, onLine, (e) => { lastErr = e; });

    child.on('close', (code, signal) => {
      this.procs.delete(item.id);
      const cur = this.items.get(item.id);
      if (!cur) return;
      // A kill we asked for (pause/cancel) already set the phase.
      if (cur.phase === 'paused' || cur.phase === 'cancelled') { this.pump(); return; }
      if (code === 0) {
        this.set(item.id, { phase: 'done', progress: 1, speed: '', eta: '' });
      } else if (signal) {
        this.set(item.id, { phase: 'paused', speed: '', eta: '' });
      } else {
        this.set(item.id, { phase: 'failed', error: cleanError(lastErr) || `yt-dlp exited with code ${code}` });
      }
      this.pump();
    });
  }
}

// ── parsing helpers ────────────────────────────────────────────────────────
function buffer(child: ChildProcess, onLine: (l: string) => void, onErr: (e: string) => void) {
  let out = '';
  child.stdout?.on('data', (d) => {
    out += d.toString();
    const lines = out.split(/\r?\n/);
    out = lines.pop() || '';
    lines.forEach((l) => l.trim() && onLine(l.trim()));
  });
  child.stderr?.on('data', (d) => onErr(d.toString()));
}

/** yt-dlp --newline emits: [download]  42.1% of 12.34MiB at 1.23MiB/s ETA 00:09 */
function parseProgress(line: string): Partial<DownloadItem> | null {
  const m = line.match(
    /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+~?\s*([\d.]+)(\w+)(?:\s+at\s+([\d.]+\w+\/s|Unknown\s+B\/s))?(?:\s+ETA\s+([\d:]+|Unknown))?/
  );
  if (!m) return null;
  const pct = parseFloat(m[1]) / 100;
  const total = toBytes(parseFloat(m[2]), m[3]);
  return {
    phase: 'downloading',
    progress: Math.max(0, Math.min(1, pct)),
    total,
    received: Math.round(total * pct),
    speed: m[4] && !/Unknown/.test(m[4]) ? m[4] : '',
    eta: m[5] && !/Unknown/.test(m[5]) ? m[5] : '',
  };
}

function toBytes(n: number, unit: string): number {
  const u = unit.toUpperCase();
  const mult = u.startsWith('K') ? 1024 : u.startsWith('M') ? 1024 ** 2 : u.startsWith('G') ? 1024 ** 3 : 1;
  return Math.round(n * mult);
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

/** yt-dlp errors are verbose; keep the part a person can act on. */
function cleanError(err: string): string {
  const line = err.split(/\r?\n/).reverse().find((l) => /ERROR/i.test(l)) || '';
  return line.replace(/^ERROR:\s*/i, '').replace(/;.*$/, '').trim().slice(0, 200);
}
