import { useState } from 'react';
import { FileText, Loader2, Copy, Check, Lock, AlertTriangle } from 'lucide-react';

const sg = window.sg;

interface Result { title: string; uploader: string; caption: string; transcript: string; source: 'manual' | 'auto' | 'none'; }

export function TranscriptView({ premium, onUpsell }: { premium: boolean; onUpsell: () => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<Result | null>(null);

  // Premium gate — free users see what it does, then upgrade.
  if (!premium) {
    return (
      <section>
        <h1>Transcript</h1>
        <p className="sub">Pull the words out of any video — the spoken transcript and the caption text.</p>
        <div className="empty mt" style={{ paddingTop: 40 }}>
          <FileText />
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>A Premium tool</div>
          <div style={{ fontSize: 13, marginTop: 6, maxWidth: '42ch' }}>
            Paste a YouTube, Instagram or TikTok link and get its full transcript and caption —
            copy it, or save it as text. Great for notes, subtitles and repurposing.
          </div>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onUpsell}>
            <Lock style={{ width: 15, height: 15 }} /> Unlock with Premium
          </button>
        </div>
      </section>
    );
  }

  const run = async () => {
    const u = url.trim();
    if (!u) return;
    setBusy(true); setErr(''); setRes(null);
    try {
      const r = await sg.transcript(u);
      setRes(r);
      if (!r.transcript && !r.caption) setErr('No transcript or caption found for this link.');
    } catch (e: any) {
      setErr(e?.message?.replace(/^Error invoking remote method '[^']+':\s*/, '') || 'Could not read that link.');
    } finally { setBusy(false); }
  };

  return (
    <section>
      <h1>Transcript</h1>
      <p className="sub">Paste a link — get the spoken transcript and the caption text.</p>

      <form className="searchrow" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <input className="field" value={url} onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste a YouTube, Instagram or TikTok link…" spellCheck={false} autoFocus style={{ flex: 1 }} />
        <button className="btn btn-primary" disabled={busy || !url.trim()}>
          {busy ? <Loader2 className="spin" /> : <FileText />}
          {busy ? 'Reading…' : 'Get transcript'}
        </button>
      </form>

      {err && <div className="warn mt"><AlertTriangle /><div>{err}</div></div>}

      {res && (
        <div className="mt" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 650 }}>{res.title || 'Untitled'}</div>
            {res.uploader && <div className="sub" style={{ marginTop: 2 }}>{res.uploader}</div>}
          </div>

          {res.transcript && (
            <Block
              label={`Transcript${res.source === 'auto' ? ' (auto-captions)' : ''}`}
              text={res.transcript}
              filename={(res.title || 'transcript').slice(0, 60)}
            />
          )}
          {res.caption && (
            <Block label="Caption (poster's text)" text={res.caption} filename={(res.title || 'caption').slice(0, 60)} />
          )}
          {!res.transcript && (
            <p className="sub" style={{ fontSize: 12 }}>
              No spoken transcript here (this video has no captions). The Whisper tool can transcribe it from the audio — coming soon.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function Block({ label, text, filename }: { label: string; text: string; filename: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };
  const save = () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename.replace(/[^\w .-]+/g, '_')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <span className="eyebrow">{label} · {text.split(/\s+/).length} words</span>
        <div className="gap">
          <button className="btn btn-ghost btn-sm" onClick={copy}>
            {copied ? <Check style={{ width: 14, height: 14, color: 'var(--ok)' }} /> : <Copy style={{ width: 14, height: 14 }} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={save}>Save .txt</button>
        </div>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--muted)' }}>
        {text}
      </div>
    </div>
  );
}
