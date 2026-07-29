import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Download, ListVideo, Settings as SettingsIcon, Search, Loader2, X,
  Film, AlertTriangle, ClipboardCheck, Minus, Square, ShieldAlert, Lock, Sparkles, Check, FileText,
} from 'lucide-react';
import { TranscriptView } from './TranscriptView';
import type { DownloadItem, DownloadRequest, MediaInfo, Settings } from '../shared/types';
import { DEFAULT_SETTINGS, isSupportedUrl } from '../shared/types';
import { QueueView } from './Queue';
import { SettingsView } from './SettingsView';
import { MediaPanel } from './MediaPanel';

const sg = window.sg;
type Tab = 'get' | 'queue' | 'transcript' | 'settings';

/**
 * Pull every supported link out of a blob of text. Pasting ten links at once — whether
 * they arrive on separate lines or all on one, since a single-line input flattens newlines
 * into spaces — is the whole point of batch mode, so we scan rather than parse one URL.
 * Deduplicated, order preserved.
 */
function extractUrls(text: string): string[] {
  // Put a space before every link first, so links glued together with no separator — which
  // is what happens when a multi-line paste loses its newlines — still split into several.
  const normalized = text.replace(/(https?:\/\/)/gi, ' $1');
  const found = normalized.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of found) {
    const u = raw.replace(/[.,)\]]+$/, '');   // trailing punctuation isn't part of the link
    if (isSupportedUrl(u) && !seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}

/** A short, readable label for a queued batch link before its real title is known. */
function shortUrl(u: string): string {
  try {
    const { hostname, pathname, searchParams } = new URL(u);
    const host = hostname.replace(/^www\./, '');
    const id = searchParams.get('v') || pathname.split('/').filter(Boolean).pop() || '';
    return id ? `${host} · ${id}` : host;
  } catch { return u; }
}

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
  const [blocked, setBlocked] = useState<null | { reason: string | null; code: string | null; until: string | null; updateUrl?: string | null }>(null);
  const [nameInput, setNameInput] = useState('');
  const [nameErr, setNameErr] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [premium, setPremium] = useState(false);
  const [upsell, setUpsell] = useState(false);
  const [batchKind, setBatchKind] = useState<'video' | 'mp3'>('video');
  // Guards the welcome screen: without it the app flashes it before settings arrive.
  const [loaded, setLoaded] = useState(false);

  // More than one link in the box means batch mode: skip the per-link format picker and
  // queue them all at one chosen quality.
  const batchUrls = useMemo(() => extractUrls(url), [url]);

  // ── boot ────────────────────────────────────────────────────────────────
  useEffect(() => {
    sg.settings.get().then((s2) => { setSettings(s2); setLoaded(true); });
    sg.queue.all().then(setItems);
    sg.toolStatus().then(setTools);
    // Register this PC with the same dashboard the phones report to.
    sg.admin.checkin().then((r) => {
      if (r.blocked) setBlocked({ reason: r.reason, code: r.code, until: r.until, updateUrl: r.update_url });
      setPremium(r.premium);
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
  // Two or more links is a batch, not a search query. Whenever the query stops being a search
  // (cleared, became a link, became a batch), tell the backend to kill the running yt-dlp —
  // otherwise superseded searches keep running and clog everything, which is what made it slow.
  useEffect(() => {
    const q = url.trim();
    const stop = () => { setHits([]); setSearching(false); sg.cancelSearch(); };
    if (batchUrls.length >= 2) return stop();
    if (!q || /^https?:\/\//i.test(q)) return stop();
    if (q.length < 3) { setHits([]); return; }
    setSearching(true);
    let alive = true;
    const t = setTimeout(() => {
      sg.search(q)
        .then((r) => { if (alive) setHits(r); })
        .catch(() => { if (alive) setHits([]); })
        .finally(() => { if (alive) setSearching(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [url, batchUrls.length]);

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

  // Queue every link at once. No probing — 'best' and 'mp3-192' don't need a format list,
  // so ten links become ten queued items instantly and the queue runs them maxParallel at
  // a time. yt-dlp names each file from its real title; the queue row shows the link until
  // the download starts filling it in.
  const enqueueBatch = async () => {
    // Multi-link (queue many at once) is a premium feature — free users see it, then upgrade.
    if (!premium) { setUpsell(true); return; }
    const audio = batchKind === 'mp3';
    for (const u of batchUrls) {
      await sg.queue.add({
        url: u,
        title: shortUrl(u),
        formatId: audio ? 'mp3-192' : 'bestvideo',
        container: audio ? 'mp3' : (settings.defaultContainer === 'auto' ? 'mp4' : settings.defaultContainer),
        audioOnly: audio,
        subtitleLangs: [],
        embedSubtitles: false,
        trimStart: null,
        trimEnd: null,
        organiseByUploader: settings.organiseByUploader,
      });
    }
    setUrl('');
    setTab('queue');
  };

  const active = useMemo(
    () => items.filter((i) => ['queued', 'downloading', 'merging', 'converting', 'probing'].includes(i.phase)).length,
    [items]
  );

  if (blocked) {
    const until = blocked.until ? new Date(blocked.until) : null;

    // 426 = this build is below the required minimum. Not a suspension — an update prompt.
    if (blocked.code === '426') {
      const site = blocked.updateUrl || 'https://streamgd.lzworth.in';
      return (
        <>
          <TitleBar />
          <div className="blocked">
            <span className="mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
              <Sparkles style={{ width: 24, height: 24, color: '#12160B' }} />
            </span>
            <h2>Time to update</h2>
            <p className="sub" style={{ maxWidth: '40ch' }}>
              A newer version of StreamGarden is out. This one has stopped working — grab the
              latest from the website to keep going.
            </p>
            <button className="btn btn-primary" onClick={() => sg.openExternal(site)}>
              <Download style={{ width: 15, height: 15 }} /> Update now
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() =>
              sg.admin.checkin().then((r) => setBlocked(r.blocked ? { reason: r.reason, code: r.code, until: r.until, updateUrl: r.update_url } : null))}>
              I've updated — retry
            </button>
          </div>
        </>
      );
    }

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
          <NavItem icon={<FileText />} label="Transcript" on={tab === 'transcript'} onClick={() => setTab('transcript')} />
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

              <form className="searchrow"
                onSubmit={(e) => { e.preventDefault(); if (batchUrls.length >= 2) enqueueBatch(); else analyse(url); }}>
                <div className="field-wrap">
                  <input className="field" value={url} onChange={(e) => setUrl(e.target.value)}
                    placeholder="Paste a link (or ten), or type what you are looking for…" spellCheck={false} autoFocus
                    onPaste={(e) => {
                      const t = e.clipboardData.getData('text').trim();
                      if (!t) return;
                      // Several links pasted at once? Let it become batch mode instead of probing one.
                      if (extractUrls(t).length >= 2) { e.preventDefault(); setUrl(t); return; }
                      setUrl(t); setTimeout(() => analyse(t), 0);
                    }} />
                  {url && (
                    <button type="button" className="field-clear" aria-label="Clear"
                      onClick={() => { setUrl(''); setInfo(null); setErr(''); sg.cancelSearch(); }}>
                      <X style={{ width: 15, height: 15 }} />
                    </button>
                  )}
                </div>
                <button className="btn btn-primary" disabled={busy || (batchUrls.length < 2 && !url.trim())}>
                  {busy ? <Loader2 className="spin" /> : batchUrls.length >= 2 ? <ListVideo /> : <Search />}
                  {busy ? 'Reading…' : batchUrls.length >= 2 ? `Download ${batchUrls.length}` : 'Fetch'}
                </button>
              </form>

              {batchUrls.length >= 2 && (
                <div className="batch mt">
                  <div className="batch-head">
                    <span className="batch-count">
                      <ListVideo style={{ width: 16, height: 16 }} /> {batchUrls.length} links ready
                      {!premium && <span className="pill" style={{ marginLeft: 8 }}><Lock style={{ width: 10, height: 10 }} /> Premium</span>}
                    </span>
                    <div className="seg">
                      <button type="button" className={batchKind === 'video' ? 'on' : ''} onClick={() => setBatchKind('video')}>Video</button>
                      <button type="button" className={batchKind === 'mp3' ? 'on' : ''}
                        onClick={() => premium ? setBatchKind('mp3') : setUpsell(true)}>
                        MP3 {!premium && <Lock style={{ width: 11, height: 11, verticalAlign: -1 }} />}
                      </button>
                    </div>
                  </div>
                  <ul className="batch-list">
                    {batchUrls.map((u) => (
                      <li key={u} title={u}>{shortUrl(u)}</li>
                    ))}
                  </ul>
                  <div className="batch-foot">
                    <span className="sub" style={{ fontSize: 12 }}>
                      {premium
                        ? `${batchKind === 'mp3' ? 'MP3 audio, 192 kbps' : 'Best quality, merged to video'} · ${settings.maxParallel} at a time`
                        : 'Downloading many links at once is a premium feature'}
                    </span>
                    <div className="gap">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setUrl('')}>Clear</button>
                      <button type="button" className="btn btn-primary btn-sm" onClick={enqueueBatch}>
                        {premium
                          ? <><Download style={{ width: 15, height: 15 }} /> Download all {batchUrls.length}</>
                          : <><Lock style={{ width: 14, height: 14 }} /> Unlock Premium</>}
                      </button>
                    </div>
                  </div>
                </div>
              )}

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

              {info && <MediaPanel info={info} settings={settings} premium={premium} onUpsell={() => setUpsell(true)} onDownload={enqueue} />}

              {!info && !busy && !err && batchUrls.length < 2 && (
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

          {tab === 'transcript' && <TranscriptView premium={premium} onUpsell={() => setUpsell(true)} />}

          {tab === 'settings' && (
            <SettingsView settings={settings} onChange={async (s) => setSettings(await sg.settings.set(s))} tools={tools} premium={premium} onUpsell={() => setUpsell(true)} />
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

      {upsell && (
        <div className="modal-veil" onClick={() => setUpsell(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <button className="btn-icon modal-x" onClick={() => setUpsell(false)} aria-label="Close"><X /></button>
            <span className="mark" style={{ width: 44, height: 44, borderRadius: 13 }}>
              <Sparkles style={{ width: 22, height: 22, color: '#12160B' }} />
            </span>
            <h2 style={{ marginTop: 12 }}>Unlock Premium</h2>
            <p className="sub" style={{ maxWidth: '34ch' }}>
              One payment, ₹99, yours for life. Unlocks everything the free plan holds back.
            </p>
            <ul className="perk">
              <li><Check style={{ width: 15, height: 15, color: 'var(--sage)' }} /> Full resolution, up to 4K</li>
              <li><Check style={{ width: 15, height: 15, color: 'var(--sage)' }} /> MP3 audio downloads</li>
              <li><Check style={{ width: 15, height: 15, color: 'var(--sage)' }} /> Ten links at once (multi-link)</li>
              <li><Check style={{ width: 15, height: 15, color: 'var(--sage)' }} /> No filename branding</li>
            </ul>
            <div className="gap" style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => { sg.openExternal('https://streamgd.lzworth.in/#premium'); setUpsell(false); }}>
                <Sparkles style={{ width: 15, height: 15 }} /> Get Premium — ₹99
              </button>
              <button className="btn btn-ghost" onClick={() => setUpsell(false)}>Not now</button>
            </div>
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
        <span className="ver">1.6</span>
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
