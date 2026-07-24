import { Play, Pause, X, Trash2, FolderOpen, ListVideo, RotateCcw } from 'lucide-react';
import type { DownloadItem, Phase } from '../shared/types';

const sg = window.sg;

/** The download list: what's running, what's waiting, and what finished. */
export function QueueView({ items, onRefresh }: {
  items: DownloadItem[];
  onRefresh: (items: DownloadItem[]) => void;
}) {
  const finished = items.filter((i) => ['done', 'failed', 'cancelled'].includes(i.phase)).length;

  if (!items.length) {
    return (
      <section>
        <h1>Downloads</h1>
        <div className="empty mt"><ListVideo /><div>Nothing queued yet.</div></div>
      </section>
    );
  }

  return (
    <section>
      <div className="head">
        <div>
          <h1>Downloads</h1>
          <p className="sub">{items.length} item{items.length === 1 ? '' : 's'}</p>
        </div>
        {finished > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={async () => onRefresh(await sg.queue.clearFinished())}>
            <Trash2 /> Clear finished ({finished})
          </button>
        )}
      </div>

      <div className="card mt rows">
        {items.map((it) => <Row key={it.id} it={it} />)}
      </div>
    </section>
  );
}

function Row({ it }: { it: DownloadItem }) {
  const running = it.phase === 'downloading' || it.phase === 'merging' || it.phase === 'converting';
  const pct = Math.round(it.progress * 100);

  return (
    <div className="qitem">
      <div className="grow">
        <div className="name" title={it.title}>{it.title}</div>
        <div className="line">{detail(it)}</div>
        {(running || it.phase === 'paused') && (
          <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        )}
      </div>

      <span className={`pill ${pillClass(it.phase)}`}>{label(it.phase)}</span>

      <div className="gap">
        {running && (
          <button className="btn-icon" title="Pause" onClick={() => sg.queue.pause(it.id)}><Pause /></button>
        )}
        {(it.phase === 'paused' || it.phase === 'failed') && (
          <button className="btn-icon" title={it.phase === 'failed' ? 'Try again' : 'Resume'}
            onClick={() => sg.queue.resume(it.id)}>
            {it.phase === 'failed' ? <RotateCcw /> : <Play />}
          </button>
        )}
        {it.phase === 'done' && it.outputPath && (
          <button className="btn-icon" title="Show in folder" onClick={() => sg.showInFolder(it.outputPath!)}>
            <FolderOpen />
          </button>
        )}
        {(running || it.phase === 'queued' || it.phase === 'paused') && (
          <button className="btn-icon danger" title="Cancel" onClick={() => sg.queue.cancel(it.id)}><X /></button>
        )}
        {['done', 'failed', 'cancelled'].includes(it.phase) && (
          <button className="btn-icon danger" title="Remove from list" onClick={() => sg.queue.remove(it.id)}>
            <Trash2 />
          </button>
        )}
      </div>
    </div>
  );
}

function detail(it: DownloadItem): string {
  if (it.phase === 'failed') return it.error || 'Failed';
  if (it.phase === 'done') return it.outputPath ? it.outputPath : 'Saved';
  if (it.phase === 'downloading') {
    const bits = [`${Math.round(it.progress * 100)}%`];
    if (it.total) bits.push(size(it.total));
    if (it.speed) bits.push(it.speed);
    if (it.eta) bits.push(`ETA ${it.eta}`);
    return bits.join(' · ');
  }
  if (it.phase === 'merging') return 'Merging video and audio…';
  if (it.phase === 'converting') return 'Converting…';
  if (it.phase === 'paused') return `Paused at ${Math.round(it.progress * 100)}%`;
  if (it.phase === 'cancelled') return 'Cancelled';
  return 'Waiting for a free slot';
}

function label(p: Phase) {
  return p === 'downloading' ? 'downloading'
    : p === 'merging' ? 'merging'
    : p === 'converting' ? 'converting'
    : p === 'done' ? 'done'
    : p === 'failed' ? 'failed'
    : p === 'paused' ? 'paused'
    : p === 'cancelled' ? 'cancelled'
    : 'queued';
}

function pillClass(p: Phase) {
  if (p === 'done') return 'done';
  if (p === 'failed') return 'fail';
  if (p === 'downloading' || p === 'merging' || p === 'converting') return 'run';
  return '';
}

function size(b: number) {
  return b > 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`;
}
