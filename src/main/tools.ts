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

// The JSON extractions (probe, transcript) are the slow, cancellable ones. Keeping a handle on
// the running yt-dlp lets the UI stop a fetch instantly — pasted the wrong link, hit Stop, paste
// the right one — instead of waiting for a slow extraction to finish.
let jsonProc: ChildProcess | null = null;
export function cancelJson() {
  if (jsonProc && !jsonProc.killed) { try { jsonProc.kill('SIGKILL'); } catch { /* already gone */ } }
  jsonProc = null;
}

// A cookie-read failure looks like this. If the chosen browser is locked/inaccessible we must
// NOT let it take down normal (public) fetches — we retry once without cookies.
const isCookieError = (msg: string) => /cookies|could not (copy|find|open)|keyring|browser/i.test(msg);

function runJson(args: string[], useCookies: boolean): Promise<any> {
  return new Promise((resolve, reject) => {
    const bin = ytDlpPath();
    if (!bin) return reject(new Error('yt-dlp is not available'));
    const ff = ffmpegPath();
    const full = [...(useCookies ? cookieArgs : []), ...(ff ? ['--ffmpeg-location', ff] : []), ...args];
    const child = spawn(bin, full, { windowsHide: true });
    jsonProc = child;
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { if (jsonProc === child) jsonProc = null; reject(e); });
    child.on('close', (code) => {
      if (jsonProc === child) jsonProc = null;
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || 'cancelled'));
      try { resolve(JSON.parse(out)); }
      catch { reject(new Error('Could not read the response from yt-dlp')); }
    });
  });
}

/** Run yt-dlp and collect stdout (the JSON probe). `noCookies` skips the browser login (search
 *  never needs it); otherwise a cookie-read failure retries once without cookies. */
export async function ytDlpJson(args: string[], opts: { noCookies?: boolean } = {}): Promise<any> {
  const wantCookies = !opts.noCookies && cookieArgs.length > 0;
  try {
    return await runJson(args, wantCookies);
  } catch (e: any) {
    if (wantCookies && isCookieError(String(e?.message || e))) return runJson(args, false);
    throw e;
  }
}

/** Spawn yt-dlp for a download; the caller wires up progress and cancellation.
 *  `noCookies` skips the browser login — search never needs it and a locked browser cookie DB
 *  would otherwise make every search (and preview) fail or hang. */
export function spawnYtDlp(args: string[], opts: { noCookies?: boolean } = {}): ChildProcess {
  const bin = ytDlpPath();
  if (!bin) throw new Error('yt-dlp is not available');
  const ff = ffmpegPath();
  const full = [...(opts.noCookies ? [] : cookieArgs), ...(ff ? ['--ffmpeg-location', ff] : []), ...args];
  return spawn(bin, full, { windowsHide: true });
}
