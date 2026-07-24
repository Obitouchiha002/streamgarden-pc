import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download, ListVideo, Settings as SettingsIcon, Search, Loader2, X,
  Film, AlertTriangle, ClipboardCheck, Minus, Square,
} from 'lucide-react';
import type { DownloadItem, DownloadRequest, MediaInfo, Settings } from '../shared/types';
import { DEFAULT_SETTINGS } from '../shared/types';
import { QueueView } from './Queue';
import { SettingsView } from './SettingsView';
import { MediaPanel } from './MediaPanel';

const sg = window.sg;
type Tab = 'get' | 'queue' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('get');
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const [items, setItems] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [tools, setTools] = useState<{ ytDlp: string | null; ffmpeg: string | null; ready: boolean } | null>(null);
  const [clip, setClip] = useState<string | null>(null);

  // ── boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    sg.settings.get().then(setSettings);
    sg.queue.all().then(setItems);
    sg.toolStatus().then(setTools);
  }, []);

  // Live queue updates: one item at a time, patched in place.
  useEffect(() => sg.onQueueItem((it) => {
    setItems((prev) => {
      const i = prev.findIndex((p) => p.id === it.id);
      if (i === -1) return [...prev, it];
      const next = prev.slice();
      next[i] = it;
      return next;
    });
  }), []);

  const analyse = useCallback(async (target: string) => {
    const t = target.trim();
    if (!t) return;
    setBusy(true); setErr(''); setInfo(null); setTab('get');
    try {
      setInfo(await sg.probe(t));
    } catch (e: any) {
      setErr(e?.message?.replace(/^Error invoking remote method '[^']+':\s*/, '') || 'Could not read that link.');
    } finally { setBusy(false); }
  }, []);

  useEffect(() => sg.onClipboardLink((u) => setClip(u)), []);
  useEffect(() => sg.onOpenUrl((u) => { setUrl(u); analyse(u); }), [analyse]);

  const theme = settings.theme;
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const light = theme === 'light' || (theme === 'system' && media.matches);
      root.dataset.theme = light ? 'light' : 'dark';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  const enqueue = async (req: DownloadRequest) => {
    await sg.queue.add(req);
    setTab('queue');
  };

  const active = useMemo(
    () => items.filter((i) => ['queued', 'downloading', 'merging', 'converting', 'probing'].includes(i.phase)).length,
    [items]
  );

  return (
    <>
      <TitleBar />

      <div className="shell">
        <nav className="sidebar">
          <NavItem icon={<Download />} label="Get media" on={tab === 'get'} onClick={() => setTab('get')} />
          <NavItem icon={<ListVideo />} label="Downloads" on={tab === 'queue'} onClick={() => setTab('queue')}
            count={active || undefined} />
          <NavItem icon={<SettingsIcon />} label="Settings" on={tab === 'settings'} onClick={() => setTab('settings')} />

          <div className="sidebar-foot">
            <div className="row"><span>Saved to</span></div>
            <button className="row" style={{ width: '100%' }} onClick={() => sg.openPath(settings.downloadDir)}
              title={settings.downloadDir}>
              <span style={{ color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shortPath(settings.downloadDir)}
              </span>
            </button>
          </div>
        </nav>

        <main className="main">
          {tools && !tools.ready && <ToolsWarning tools={tools} />}

          {tab === 'get' && (
            <section>
              <h1>Get media</h1>
              <p className="sub">Paste a link from YouTube, Instagram, TikTok, X, Vimeo, Reddit and more.</p>

              <form className="searchrow" onSubmit={(e) => { e.preventDefault(); analyse(url); }}>
                <input className="field" value={url} onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…" spellCheck={false} autoFocus
                  onPaste={(e) => {
                    const t = e.clipboardData.getData('text').trim();
                    if (t) { setUrl(t); setTimeout(() => analyse(t), 0); }
                  }} />
                <button className="btn btn-primary" disabled={busy || !url.trim()}>
                  {busy ? <Loader2 className="spin" /> : <Search />}
                  {busy ? 'Reading…' : 'Fetch'}
                </button>
              </form>

              {err && (
                <div className="warn mt">
                  <AlertTriangle />
                  <div>{err}</div>
                </div>
              )}

              {info && <MediaPanel info={info} settings={settings} onDownload={enqueue} />}

              {!info && !busy && !err && (
                <div className="empty mt">
                  <Film />
                  <div>Nothing loaded yet — paste a link above.</div>
                  {settings.clipboardWatch && (
                    <div style={{ fontSize: 12, marginTop: 6, color: 'var(--dim)' }}>
                      Copy a link anywhere and StreamGarden will offer to fetch it.
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {tab === 'queue' && <QueueView items={items} onRefresh={setItems} />}

          {tab === 'settings' && (
            <SettingsView settings={settings} onChange={async (s) => setSettings(await sg.settings.set(s))} tools={tools} />
          )}
        </main>
      </div>

      {clip && (
        <div className="toast">
          <ClipboardCheck style={{ width: 19, height: 19, color: 'var(--sage)', flex: 'none' }} />
          <div style={{ minWidth: 0 }}>
            <div className="t">Link copied — fetch it?</div>
            <div className="u">{clip}</div>
          </div>
          <div className="gap">
            <button className="btn btn-primary btn-sm" onClick={() => { const u = clip; setClip(null); setUrl(u); analyse(u); }}>
              Fetch
            </button>
            <button className="btn-icon" onClick={() => setClip(null)} aria-label="Dismiss"><X /></button>
          </div>
        </div>
      )}
    </>
  );
}

// ── pieces ────────────────────────────────────────────────────────────────
function TitleBar() {
  return (
    <div className="titlebar">
      <div className="brand">
        <span className="mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="#12160B" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" />
          </svg>
        </span>
        StreamGarden
        <span className="ver">1.0</span>
      </div>
      {/* Windows draws its own buttons over the overlay; other platforms get ours. */}
      {sg.platform !== 'win32' && (
        <div className="win-controls">
          <button onClick={() => sg.window.minimize()} aria-label="Minimise"><Minus /></button>
          <button onClick={() => sg.window.maximize()} aria-label="Maximise"><Square /></button>
          <button className="close" onClick={() => sg.window.close()} aria-label="Close"><X /></button>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, on, onClick, count }: {
  icon: React.ReactNode; label: string; on: boolean; onClick: () => void; count?: number;
}) {
  return (
    <button className={`navitem${on ? ' on' : ''}`} onClick={onClick}>
      {icon}<span>{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </button>
  );
}

function ToolsWarning({ tools }: { tools: { ytDlp: string | null; ffmpeg: string | null } }) {
  const missing = [!tools.ytDlp && 'yt-dlp', !tools.ffmpeg && 'ffmpeg'].filter(Boolean).join(' and ');
  return (
    <div className="warn">
      <AlertTriangle />
      <div>
        <b>{missing} not found.</b> The installer normally ships both. If you're running from
        source, install them and restart — on Windows: <code>winget install yt-dlp ffmpeg</code>,
        on macOS: <code>brew install yt-dlp ffmpeg</code>.
      </div>
    </div>
  );
}

function shortPath(p: string) {
  if (!p) return '—';
  const parts = p.split(/[\\/]/);
  return parts.length <= 2 ? p : `…${p.slice(-1) === '/' ? '' : '/'}${parts.slice(-2).join('/')}`;
}
