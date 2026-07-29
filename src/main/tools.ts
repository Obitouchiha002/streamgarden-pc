import { app } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

/**
 * yt-dlp and ffmpeg do the actual work. They ship inside the installer under
 * resources/bin, but during development we fall back to whatever is on PATH so the app is
 * runnable without vendoring binaries first.
 */

const isWin = process.platform === 'win32';
const exe = (n: string) => (isWin ? `${n}.exe` : n);

function bundled(name: string): string | null {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(app.getAppPath(), 'resources', 'bin');
  const p = path.join(dir, exe(name));
  return fs.existsSync(p) ? p : null;
}

function onPath(name: string): string | null {
  const probe = spawnSync(isWin ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (probe.status !== 0) return null;
  const first = (probe.stdout || '').split(/\r?\n/).find(Boolean);
  return first ? first.trim() : null;
}

let cachedYtDlp: string | null | undefined;
let cachedFfmpeg: string | null | undefined;

export function ytDlpPath(): string | null {
  if (cachedYtDlp === undefined) cachedYtDlp = bundled('yt-dlp') || onPath('yt-dlp');
  return cachedYtDlp;
}
export function ffmpegPath(): string | null {
  if (cachedFfmpeg === undefined) cachedFfmpeg = bundled('ffmpeg') || onPath('ffmpeg');
  return cachedFfmpeg;
}

export interface ToolStatus { ytDlp: string | null; ffmpeg: string | null; ready: boolean }

export function toolStatus(): ToolStatus {
  const y = ytDlpPath(), f = ffmpegPath();
  return { ytDlp: y, ffmpeg: f, ready: Boolean(y && f) };
}

// When Premium + the user opts in, yt-dlp reads their browser's YouTube login so members-only
// videos, age-restricted and Premium-quality streams work. Set from the main process.
let cookieArgs: string[] = [];
export function setCookieBrowser(browser: string) {
  cookieArgs = browser ? ['--cookies-from-browser', browser] : [];
}

/** Run yt-dlp and collect stdout. Used for the JSON probe. */
export function ytDlpJson(args: string[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const bin = ytDlpPath();
    if (!bin) return reject(new Error('yt-dlp is not available'));

    const ff = ffmpegPath();
    const full = [...cookieArgs, ...(ff ? ['--ffmpeg-location', ff] : []), ...args];
    const child = spawn(bin, full, { windowsHide: true });

    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `yt-dlp exited ${code}`));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error('Could not read the response from yt-dlp')); }
    });
  });
}

/** Spawn yt-dlp for a download; the caller wires up progress and cancellation. */
export function spawnYtDlp(args: string[]): ChildProcess {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available');
  const ff = ffmpegPath();
  const full = [...cookieArgs, ...(ff ? ['--ffmpeg-location', ff] : []), ...args];
  return spawn(bin, full, { windowsHide: true });
}
