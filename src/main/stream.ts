import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { ytDlpJson } from './tools';

/**
 * A tiny local server that proxies a media URL to the renderer's <video> element.
 *
 * The point is scrubbing without downloading. The real stream URLs answer Range requests
 * (206 + Accept-Ranges), so a video element pointed at this proxy can seek anywhere in a
 * ten-minute file having fetched only a few hundred KB. Going through a proxy rather than
 * straight at the URL means we can attach the headers the site expects (User-Agent,
 * Referer) and sidestep the renderer's cross-origin rules.
 */

let server: http.Server | null = null;
let port = 0;

/** url → { url, headers } for the preview-quality stream, so we resolve each page once. */
const resolved = new Map<string, { url: string; headers: Record<string, string> }>();

export async function previewUrlFor(pageUrl: string): Promise<string> {
  if (!resolved.has(pageUrl)) {
    // A modest progressive stream: small enough to seek instantly, complete with audio.
    const info = await ytDlpJson([
      '--no-warnings',
      '-f', 'best[height<=480][ext=mp4]/best[ext=mp4]/best',
      '--dump-single-json',
      pageUrl,
    ]);
    if (!info?.url) throw new Error('No previewable stream for this link');
    resolved.set(pageUrl, { url: info.url, headers: info.http_headers || {} });
  }
  await ensureServer();
  return `http://127.0.0.1:${port}/s?u=${encodeURIComponent(pageUrl)}`;
}

function ensureServer(): Promise<void> {
  if (server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let target: { url: string; headers: Record<string, string> } | undefined;
      try {
        const q = new URL(req.url || '', `http://127.0.0.1:${port}`);
        target = resolved.get(q.searchParams.get('u') || '');
      } catch { /* falls through to 404 */ }

      if (!target) { res.writeHead(404).end('unknown stream'); return; }

      const upstream = new URL(target.url);
      const headers: Record<string, string> = { ...target.headers };
      // Pass the seek position through untouched — this is what makes scrubbing cheap.
      if (req.headers.range) headers.Range = req.headers.range as string;
      delete headers['Accept-Encoding'];

      const client = upstream.protocol === 'http:' ? http : https;
      const proxied = client.request(
        { protocol: upstream.protocol, hostname: upstream.hostname, port: upstream.port,
          path: upstream.pathname + upstream.search, method: 'GET', headers },
        (up) => {
          res.writeHead(up.statusCode || 200, {
            'Content-Type': up.headers['content-type'] || 'video/mp4',
            'Accept-Ranges': 'bytes',
            ...(up.headers['content-length'] ? { 'Content-Length': up.headers['content-length'] } : {}),
            ...(up.headers['content-range'] ? { 'Content-Range': up.headers['content-range'] } : {}),
            'Access-Control-Allow-Origin': '*',
          });
          up.pipe(res);
        }
      );
      // A seek abandons the previous request; that's normal, not an error worth surfacing.
      proxied.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.on('close', () => proxied.destroy());
      proxied.end();
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      port = (server!.address() as { port: number }).port;
      resolve();
    });
  });
}

export function stopStreamServer() {
  server?.close();
  server = null;
  resolved.clear();
}
