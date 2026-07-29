import { FolderOpen, Check, AlertTriangle, Lock, Youtube } from 'lucide-react';
import type { Settings } from '../shared/types';
import { COOKIE_BROWSERS } from '../shared/types';

const sg = window.sg;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SettingsView({ settings, onChange, tools, premium, onUpsell }: {
  settings: Settings;
  onChange: (s: Settings) => void;
  tools: { ytDlp: string | null; ffmpeg: string | null; ready: boolean } | null;
  premium: boolean;
  onUpsell: () => void;
}) {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onChange({ ...settings, [k]: v });

  return (
    <section>
      <h1>Settings</h1>
      <p className="sub">Changes save as you make them.</p>

      <div className="card mt" style={{ padding: 18 }}>
        <div className="eyebrow">Where files go</div>
        <div className="gap" style={{ marginTop: 10 }}>
          <input className="field" readOnly value={settings.downloadDir} style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={async () => {
            const d = await sg.pickFolder();
            if (d) set('downloadDir', d);
          }}>
            <FolderOpen /> Change
          </button>
          <button className="btn btn-ghost" onClick={() => sg.openPath(settings.downloadDir)}>Open</button>
        </div>

        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={settings.organiseByUploader}
            onChange={(e) => set('organiseByUploader', e.target.checked)} />
          <span>Put each channel's files in its own folder</span>
        </label>
      </div>

      <div className="card mt" style={{ padding: 18 }}>
        <div className="eyebrow">Speed</div>
        <div className="opts" style={{ marginTop: 10 }}>
          <div className="opt">
            <label>Downloads at once</label>
            <select className="field" value={settings.maxParallel}
              onChange={(e) => set('maxParallel', Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="opt">
            <label>Connections per download</label>
            <select className="field" value={settings.connectionsPerDownload}
              onChange={(e) => set('connectionsPerDownload', Number(e.target.value))}>
              {[1, 2, 4, 8, 12, 16].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="opt">
            <label>Default format</label>
            <select className="field" value={settings.defaultContainer}
              onChange={(e) => set('defaultContainer', e.target.value as Settings['defaultContainer'])}>
              <option value="auto">Same as source</option>
              <option value="mp4">MP4</option>
              <option value="mkv">MKV</option>
              <option value="mp3">MP3</option>
            </select>
          </div>
        </div>
        <p className="sub" style={{ marginTop: 8 }}>
          More connections is usually faster, but some sites throttle or refuse if you push too hard.
        </p>
      </div>

      <div className="card mt" style={{ padding: 18 }}>
        <div className="eyebrow">Behaviour</div>
        <label className="check" style={{ marginTop: 8 }}>
          <input type="checkbox" checked={settings.clipboardWatch}
            onChange={(e) => set('clipboardWatch', e.target.checked)} />
          <span>Offer to fetch links as soon as I copy them</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.minimiseToTray}
            onChange={(e) => set('minimiseToTray', e.target.checked)} />
          <span>Keep running in the tray when the window is closed</span>
        </label>

        <div className="opts" style={{ marginTop: 10 }}>
          <div className="opt">
            <label>Global shortcut</label>
            <select className="field" value={settings.globalHotkey}
              onChange={(e) => set('globalHotkey', e.target.value)}>
              <option value="CommandOrControl+Shift+D">Ctrl + Shift + D</option>
              <option value="CommandOrControl+Shift+S">Ctrl + Shift + S</option>
              <option value="CommandOrControl+Alt+D">Ctrl + Alt + D</option>
              <option value="">Off</option>
            </select>
          </div>
          <div className="opt">
            <label>Appearance</label>
            <select className="field" value={settings.theme}
              onChange={(e) => set('theme', e.target.value as Settings['theme'])}>
              <option value="system">Follow Windows</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>
        <p className="sub" style={{ marginTop: 8 }}>
          The shortcut grabs whatever link is on your clipboard and starts reading it, from anywhere.
        </p>
      </div>

      <div className="card mt" style={{ padding: 18 }}>
        <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Youtube style={{ width: 15, height: 15, color: 'var(--sage)' }} /> YouTube account · Premium
        </div>
        <p className="sub" style={{ marginTop: 8 }}>
          Use your browser's YouTube login so <b>members-only</b> videos, age-restricted clips and
          Premium-quality streams download too. Sign in to YouTube in that browser first.
        </p>
        {premium ? (
          <div className="opt" style={{ marginTop: 12, maxWidth: 300 }}>
            <label>Read my login from</label>
            <select className="field" value={settings.ytCookies}
              onChange={(e) => set('ytCookies', e.target.value as Settings['ytCookies'])}>
              <option value="">Off</option>
              {COOKIE_BROWSERS.map((b) => <option key={b} value={b}>{cap(b)}</option>)}
            </select>
          </div>
        ) : (
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={onUpsell}>
            <Lock style={{ width: 15, height: 15 }} /> Unlock with Premium
          </button>
        )}
        <p className="sub" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--dim)' }}>
          Only works for channels you're actually a member of — it's your own login, on your own PC.
          Nothing is uploaded; the app just reads the cookie your browser already stored.
        </p>
      </div>

      <div className="card mt" style={{ padding: 18 }}>
        <div className="eyebrow">Engine</div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 7 }}>
          <ToolRow name="yt-dlp" path={tools?.ytDlp ?? null} />
          <ToolRow name="ffmpeg" path={tools?.ffmpeg ?? null} />
        </div>
        <p className="sub" style={{ marginTop: 10 }}>
          These do the actual downloading and converting. The installer ships both; running from
          source uses whatever is on your PATH.
        </p>
      </div>

      <p className="sub mt" style={{ maxWidth: '70ch' }}>
        StreamGarden hosts nothing and breaks no copy protection — it reads the same public
        streams your browser does. What you download, and whether you're allowed to, is on you.
      </p>
    </section>
  );
}

function ToolRow({ name, path }: { name: string; path: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
      {path
        ? <Check style={{ width: 15, height: 15, color: 'var(--ok)', flex: 'none' }} />
        : <AlertTriangle style={{ width: 15, height: 15, color: 'var(--danger)', flex: 'none' }} />}
      <b style={{ minWidth: 62 }}>{name}</b>
      <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {path ?? 'not found'}
      </span>
    </div>
  );
}
