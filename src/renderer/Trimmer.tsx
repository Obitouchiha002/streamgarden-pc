import { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, Scissors, Loader2, RotateCcw, AlertTriangle } from 'lucide-react';

const sg = window.sg;

/**
 * Pick a section by dragging, the way an editor does — no timestamps to type.
 *
 * The video plays from a local proxy that forwards Range requests, so scrubbing a
 * ten-minute file costs a few hundred KB rather than a download. Dragging a handle seeks
 * the video to that spot, so you always see the exact frame you're cutting on.
 */
export function Trimmer({ url, duration, onChange }: {
  url: string;
  duration: number;
  onChange: (range: { start: number; end: number } | null) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);

  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [len, setLen] = useState(duration || 0);

  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(duration || 0);
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<null | 'start' | 'end' | 'seek'>(null);

  // Resolve a scrubbable stream once per link.
  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(''); setSrc('');
    sg.previewUrl(url)
      .then((u) => { if (alive) { setSrc(u); setLoading(false); } })
      .catch((e: any) => {
        if (!alive) return;
        setErr(e?.message?.replace(/^Error invoking remote method '[^']+':\s*/, '') || 'No preview available');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [url]);

  useEffect(() => { setStart(0); setEnd(duration || 0); setLen(duration || 0); }, [url, duration]);

  // Tell the parent, but only when the range is actually a cut.
  useEffect(() => {
    const whole = start <= 0.05 && (len === 0 || end >= len - 0.05);
    onChange(whole ? null : { start, end });
  }, [start, end, len, onChange]);

  const pct = (t: number) => (len ? Math.max(0, Math.min(100, (t / len) * 100)) : 0);

  const timeAt = useCallback((clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || !len) return 0;
    return Math.max(0, Math.min(len, ((clientX - r.left) / r.width) * len));
  }, [len]);

  const seekTo = (t: number) => {
    setPos(t);
    if (video.current) video.current.currentTime = t;
  };

  // One pointer handler for all three grips; the video follows the finger so you can see
  // the frame you're landing on.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (drag === 'start') { const s = Math.min(t, end - 0.2); setStart(Math.max(0, s)); seekTo(Math.max(0, s)); }
      else if (drag === 'end') { const en = Math.max(t, start + 0.2); setEnd(Math.min(len, en)); seekTo(Math.min(len, en)); }
      else seekTo(t);
    };
    const up = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, start, end, len, timeAt]);

  // Preview the selection: play the chosen section and stop at its end.
  const playSelection = () => {
    const v = video.current;
    if (!v) return;
    if (playing) { v.pause(); return; }
    if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
    v.play().catch(() => setPlaying(false));
  };

  const onTime = () => {
    const v = video.current;
    if (!v) return;
    setPos(v.currentTime);
    if (v.currentTime >= end - 0.03 && !v.paused) { v.pause(); v.currentTime = start; }
  };

  const reset = () => { setStart(0); setEnd(len); seekTo(0); };
  const selected = Math.max(0, end - start);

  return (
    <div className="trim card">
      <div className="trim-head">
        <span className="eyebrow"><Scissors style={{ width: 12, height: 12, verticalAlign: -2 }} /> Choose the part you want</span>
        <button className="btn btn-ghost btn-sm" onClick={reset} disabled={start === 0 && end === len}>
          <RotateCcw /> Whole video
        </button>
      </div>

      <div className="trim-stage">
        {loading && <div className="trim-msg"><Loader2 className="spin" /> Loading preview…</div>}
        {err && <div className="trim-msg"><AlertTriangle style={{ color: 'var(--danger)' }} /> {err}</div>}
        {src && (
          <video
            ref={video}
            src={src}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const d = e.currentTarget.duration;
              if (isFinite(d) && d > 0) { setLen(d); if (!duration) setEnd(d); }
            }}
            onTimeUpdate={onTime}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onClick={playSelection}
          />
        )}
      </div>

      {/* timeline */}
      <div className="trim-track" ref={track}
        onPointerDown={(e) => { e.preventDefault(); setDrag('seek'); seekTo(timeAt(e.clientX)); }}>
        <div className="trim-dim" style={{ left: 0, width: `${pct(start)}%` }} />
        <div className="trim-dim" style={{ left: `${pct(end)}%`, right: 0 }} />
        <div className="trim-sel" style={{ left: `${pct(start)}%`, width: `${pct(end) - pct(start)}%` }} />
        <div className="trim-play" style={{ left: `${pct(pos)}%` }} />

        <button className="trim-grip" style={{ left: `${pct(start)}%` }} aria-label="Start"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag('start'); }}><span /></button>
        <button className="trim-grip" style={{ left: `${pct(end)}%` }} aria-label="End"
          onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); setDrag('end'); }}><span /></button>
      </div>

      <div className="trim-foot">
        <button className="btn btn-ghost btn-sm" onClick={playSelection} disabled={!src}>
          {playing ? <Pause /> : <Play />} {playing ? 'Pause' : 'Preview selection'}
        </button>

        {/* Drag the handles, or type the times — whichever you prefer. Each updates the
            other, and typing seeks the preview so you can check the frame. */}
        <div className="trim-inputs">
          <TimeBox label="From" value={start} max={len}
            onCommit={(t) => { const s = Math.min(Math.max(0, t), end - 0.2); setStart(s); seekTo(s); }} />
          <span className="trim-dash">→</span>
          <TimeBox label="To" value={end} max={len}
            onCommit={(t) => { const e2 = Math.max(Math.min(len, t), start + 0.2); setEnd(e2); seekTo(e2); }} />
          <span className="trim-len">{clock(selected)} selected</span>
        </div>
      </div>
    </div>
  );
}

/**
 * A typed time that only commits when you finish — so a half-written "1:" never yanks the
 * handle to zero mid-keystroke. Accepts 90, 1:30 or 0:01:30.
 */
function TimeBox({ label, value, max, onCommit }: {
  label: string; value: number; max: number; onCommit: (seconds: number) => void;
}) {
  const [text, setText] = useState(clock(value));
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (!editing) setText(clock(value)); }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const s = parseClock(text);
    if (s === null) { setText(clock(value)); return; }   // unreadable — put it back
    onCommit(Math.min(s, max || s));
  };

  return (
    <label className="trim-box">
      <span>{label}</span>
      <input
        value={text}
        onChange={(e) => { setEditing(true); setText(e.target.value); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur(); }
          if (e.key === 'Escape') { setEditing(false); setText(clock(value)); e.currentTarget.blur(); }
        }}
        inputMode="numeric"
        spellCheck={false}
        aria-label={`${label} time`}
      />
    </label>
  );
}

/** "90" | "1:30" | "0:01:30" → seconds. null when it can't be read. */
function parseClock(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  if (!/^\d{1,2}(:\d{1,2}){0,2}$/.test(t)) return null;
  const parts = t.split(':').map(Number);
  if (parts.some((n) => isNaN(n))) return null;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function clock(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}
