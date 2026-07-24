import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download, ListVideo, Settings as SettingsIcon, Search, Loader2, X,
  Film, AlertTriangle, ClipboardCheck, Minus, Square, ShieldAlert,
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
  const [hits, setHits] = useState<{ url: string; title: string; uploader: string; duration: number; thumbnail: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [blocked, setBlocked] = useState<null | { reason: string | null; code: string | null; until: string | null }>(null);
  const [nameInput, setNameInput] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [claiming, setClaiming] = useState(false);
  // Guards the welcome screen: without it the app flashes it before settings arrive.
  const [loaded, setLoaded] = useState(false);

  // ── boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    sg.settings.get().then((s2) => { setSettings(s2); setLoaded(true); });
    sg.queue.all().then(setItems);
    sg.toolStatus().then(setTools);
    // Register this PC with the same dashboard the phones report to.
    sg.admin.checkin().then((r) => {
      if (r.blocked) setBlocked({ reason: r.reason, code: r.code, until: r.until });
    }).catch(() => { /* fail open — a backend problem must not stop the app */ });
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

  // Anything that isn't a link is treated as a search, run a beat after you stop typing.
  useEffect(() => {
    const q = url.trim();
    if (!q || /^https?:\/\//i.test(q)) { setHits([]); setSearching(false); return; }
    if (q.length < 3) { setHits([]); return; }
    setSearching(true);
    let alive = true;
    const t = setTimeout(() => {
      sg.search(q)
        .then((r) => { if (alive) setHits(r); })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 350);
    return () => { alive = false; clearTimeout(t); setSearching(false); };
  }, [url]);

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

  // Names are unique across every device, so the backend has the final say.
  const saveProfile = async () => {
    const n = nameInput.trim();
    if (!n) return;
    setClaiming(true); setNameErr('');
    const r = await sg.admin.claimName(n).catch(() => 'offline' as const);
    setClaiming(false);
    if (r === 'taken') { setNameErr('Someone is already using that name. Try another.'); return; }
    if (r === 'invalid') { setNameErr('Please use 1–40 characters.'); return; }
    // 'offline' still lets you in — the name is kept and claimed on the next launch.
    setSettings(await sg.settings.set({ ...settings, profileName: n }));
    sg.admin.checkin().catch(() => { /* fail open */ });
  };

  const enqueue = async (req: DownloadRequest) => {
    await sg.queue.add(req);
    setTab('queue');
  };

  const active = useMemo(
    () => items.filter((i) => ['queued', 'downloading', 'merging', 'converting', 'probing'].includes(i.phase)).length,
    [items]
  );

  if (blocked) {
    const until = blocked.until ? new Date(blocked.until) : null;
    return (
      <>
        <TitleBar />
        <div className="blocked">
          <ShieldAlert style={{ width: 34, height: 34, color: 'var(--danger)' }} />
          <div className="code">Error {blocked.code || '403'}</div>
          <h2>Access suspended</h2>
          <p className="sub">
            {blocked.reason ? `Your access has been suspended: ${blocked.reason}.`
                            : 'Your access to this app has been suspended by the administrator.'}
          </p>
          <p className="sub">
            {until ? `Suspension lifts on ${until.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                   : 'This suspension is permanent.'}
          </p>
          <button className="btn btn-ghost btn-sm" onClick={() =>
            sg.admin.checkin().then((r) => setBlocked(r.blocked ? { reason: r.reason, code: r.code, until: r.until } : null))}>
            Retry
          </button>
        </div>
      </>
    );
  }

  // First launch: ask what to call this machine, once. It's the only thing collected, and
  // it's what makes the dashboard readable instead of a list of hostnames.
  if (loaded && !settings.profileName) {
    return (
      <>
        <TitleBar />
        <div className="blocked">
          <span className="mark" style={{ width: 46, height: 46, borderRadius: 14 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="#12160B" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
              style={{ width: 24, height: 24 }}>
              <path d="M12 3v12" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" />
            </svg>
          </span>
          <h2>Welcome to StreamGarden</h2>
          <p className="sub">What should we call this computer?</p>
          <input
            className="field" autoFocus maxLength={40} value={nameInput}
            onChange={(e) => { setNameInput(e.target.value); setNameErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') saveProfile(); }}
            placeholder="Your name"
            style={{ maxWidth: 300, textAlign: 'center', borderColor: nameErr ? 'var(--danger)' : undefined }}
          />
          {nameErr && <p className="sub" style={{ color: 'var(--danger)', marginTop: 0 }}>{nameErr}</p>}
          <button className="btn btn-primary" disabled={claiming || !nameInput.trim()} onClick={saveProfile}>
            {claiming ? <><Loader2 className="spin" /> Checking…</> : 'Continue'}
          </button>
          <p className="sub" style={{ fontSize: 11.5, color: 'var(--dim)', maxWidth: '34ch' }}>
            Just a name — no account, no password, no email. Each name can only be used once.
            Nothing about what you search for or download is ever sent anywhere.
          </p>
        </div>
      </>
    );
  }

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
                  placeholder="Paste a link, or type what you are looking for…" spellCheck={false} autoFocus
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

              {(searching || hits.length > 0) && !info && (
                <div className="hits">
                  {searching && hits.length === 0 && (
                    <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px' }}>
                      <Loader2 className="spin" style={{ width: 15, height: 15 }} /> Searching…
                    </div>
                  )}
                  {hits.map((h) => (
                    <button key={h.url} className="hit" onClick={() => { setUrl(h.url); analyse(h.url); }}>
                      {h.thumbnail
                        ? <img src={h.thumbnail} alt="" />
                        : <span style={{ width: 84, height: 48, borderRadius: 6, background: 'var(--surface-2)', flex: 'none' }} />}
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="ht">{h.title}</span>
                        <span className="hu">{h.uploader}</span>
                      </span>
                      {h.duration > 0 && <span className="hd">{mmss(h.duration)}</span>}
                    </button>
                  ))}
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

function mmss(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function shortPath(p: string) {
  if (!p) return '—';
  const parts = p.split(/[\\/]/);
  return parts.length <= 2 ? p : `…${p.slice(-1) === '/' ? '' : '/'}${parts.slice(-2).join('/')}`;
}
