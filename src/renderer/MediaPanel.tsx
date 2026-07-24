import { useEffect, useMemo, useState } from 'react';
import { Download, Film, Music, Scissors, Captions, Check, Image as ImageIcon } from 'lucide-react';
import type { DownloadRequest, MediaInfo, Settings } from '../shared/types';
import { Trimmer } from './Trimmer';

/**
 * Everything you choose before a download starts: which quality, what container, whether to
 * pull subtitles, and whether to keep only a section. Playlists show their entries with
 * checkboxes instead — nothing is queued until you pick.
 */
export function MediaPanel({ info, settings, onDownload }: {
  info: MediaInfo;
  settings: Settings;
  onDownload: (r: DownloadRequest) => void;
}) {
  const [formatId, setFormatId] = useState('');
  const [container, setContainer] = useState<DownloadRequest['container']>(settings.defaultContainer);
  const [subs, setSubs] = useState<string[]>([]);
  const [embedSubs, setEmbedSubs] = useState(true);
  const [trimOn, setTrimOn] = useState(false);
  // Set by the trimmer; null means "the whole thing".
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [organise, setOrganise] = useState(settings.organiseByUploader);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  useEffect(() => {
    setFormatId(info.formats[0]?.id ?? '');
    setPicked(new Set());
    setSubs([]);
    setTrimOn(false);
    setRange(null);
  }, [info]);

  const chosen = useMemo(() => info.formats.find((f) => f.id === formatId), [info, formatId]);
  const audioOnly = chosen?.kind === 'audio';
  const isImage = chosen?.kind === 'image';

  // Containers that make sense for what's selected.
  const containers = audioOnly
    ? (['auto', 'mp3', 'm4a', 'wav', 'flac'] as const)
    : (['auto', 'mp4', 'mkv', 'webm', 'gif'] as const);

  useEffect(() => {
    if (!containers.includes(container as never)) setContainer('auto');
  }, [audioOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── playlist ────────────────────────────────────────────────────────────
  if (info.isPlaylist) {
    const entries = info.entries ?? [];
    const toggle = (i: number) => setPicked((p) => {
      const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n;
    });
    const queueAll = () => {
      [...picked].sort((a, b) => a - b).forEach((i) => {
        const e = entries[i];
        onDownload({
          url: e.url, title: e.title, formatId: 'best', container, audioOnly: false,
          subtitleLangs: [], embedSubtitles: false, trimStart: null, trimEnd: null,
          organiseByUploader: organise, uploader: info.uploader,
        });
      });
    };

    return (
      <section className="mt">
        <div className="head">
          <div>
            <h2>{info.title}</h2>
            <div className="sub">{entries.length} videos · tick the ones you want</div>
          </div>
          <div className="gap">
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set(entries.map((_, i) => i)))}>Select all</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
            <button className="btn btn-primary btn-sm" disabled={!picked.size} onClick={queueAll}>
              <Download /> Queue {picked.size || ''}
            </button>
          </div>
        </div>

        <div className="card mt rows" style={{ maxHeight: 460, overflowY: 'auto' }}>
          {entries.map((e, i) => (
            <label key={i} className="qitem" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)}
                style={{ width: 15, height: 15, accentColor: 'var(--sage)' }} />
              <div className="grow">
                <div className="name">{e.title}</div>
                {e.duration > 0 && <div className="line">{hhmm(e.duration)}</div>}
              </div>
            </label>
          ))}
        </div>
      </section>
    );
  }

  // ── single item ─────────────────────────────────────────────────────────
  const start = () => {
    if (!chosen) return;
    onDownload({
      url: info.url,
      title: info.title,
      formatId: chosen.id,
      container,
      audioOnly,
      subtitleLangs: subs,
      embedSubtitles: embedSubs,
      trimStart: trimOn && range ? range.start : null,
      trimEnd: trimOn && range ? range.end : null,
      organiseByUploader: organise,
      thumbnail: info.thumbnail,
      uploader: info.uploader,
    });
  };

  return (
    <section className="media">
      <div>
        {info.thumbnail
          ? <img className="thumb" src={info.thumbnail} alt="" />
          : <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}><Film style={{ width: 28, height: 28, color: 'var(--dim)' }} /></div>}
        <div className="title">{info.title}</div>
        <div className="meta">
          {[info.uploader, info.duration ? hhmm(info.duration) : null].filter(Boolean).join(' · ')}
        </div>
        <button className="btn btn-primary mt" style={{ width: '100%' }} onClick={start} disabled={!chosen}>
          <Download /> Add to downloads
        </button>
      </div>

      <div>
        <div className="eyebrow">Quality</div>
        <div className="fmt-list mt" style={{ marginTop: 9 }}>
          {info.formats.map((f) => (
            <button key={f.id} className={`fmt${f.id === formatId ? ' on' : ''}`} onClick={() => setFormatId(f.id)}>
              {f.kind === 'audio' ? <Music style={{ width: 15, height: 15, color: 'var(--sage)', flex: 'none' }} />
                : f.kind === 'image' ? <ImageIcon style={{ width: 15, height: 15, color: 'var(--sage)', flex: 'none' }} />
                : <Film style={{ width: 15, height: 15, color: 'var(--sage)', flex: 'none' }} />}
              <span>
                <span className="lbl">{f.label}</span>
                {f.note && <span className="note"> — {f.note}</span>}
              </span>
              {f.id === formatId && <Check style={{ width: 14, height: 14, color: 'var(--sage)' }} />}
              <span className="size">{f.filesize ? mb(f.filesize) : f.ext.toUpperCase()}</span>
            </button>
          ))}
        </div>

        <div className="opts" hidden={isImage}>
          <div className="opt">
            <label>Save as</label>
            <select className="field" value={container} onChange={(e) => setContainer(e.target.value as DownloadRequest['container'])}>
              {containers.map((c) => <option key={c} value={c}>{c === 'auto' ? 'Same as source' : c.toUpperCase()}</option>)}
            </select>
          </div>

          {info.subtitles.length > 0 && (
            <div className="opt">
              <label><Captions style={{ width: 12, height: 12, display: 'inline', verticalAlign: -2 }} /> Subtitles</label>
              <select className="field" value={subs[0] ?? ''} onChange={(e) => setSubs(e.target.value ? [e.target.value] : [])}>
                <option value="">None</option>
                {info.subtitles.map((s) => <option key={s.lang} value={s.lang}>{s.name} ({s.lang})</option>)}
              </select>
            </div>
          )}

          <div className="opt">
            <label>&nbsp;</label>
            <label className="check">
              <input type="checkbox" checked={organise} onChange={(e) => setOrganise(e.target.checked)} />
              <span>Folder per channel</span>
            </label>
          </div>
        </div>

        {subs.length > 0 && (
          <label className="check">
            <input type="checkbox" checked={embedSubs} onChange={(e) => setEmbedSubs(e.target.checked)} />
            <span>Embed subtitles into the file (otherwise saved as .srt beside it)</span>
          </label>
        )}

        <label className="check" style={{ marginTop: 6 }} hidden={isImage}>
          <input type="checkbox" checked={trimOn} onChange={(e) => { setTrimOn(e.target.checked); if (!e.target.checked) setRange(null); }} />
          <span><Scissors style={{ width: 13, height: 13, display: 'inline', verticalAlign: -2 }} /> Only keep a section</span>
        </label>

        {trimOn && !isImage && <Trimmer url={info.url} duration={info.duration} onChange={setRange} />}
      </div>
    </section>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────
function hhmm(sec: number) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
function mb(b: number) {
  return b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
}
