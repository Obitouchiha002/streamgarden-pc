# StreamGarden for Windows

The desktop companion to the [Android app](https://github.com/Obitouchiha002/streamgarden) —
same idea, laid out for a big screen and a keyboard.

Electron + React + TypeScript. **yt-dlp** does the extraction and **ffmpeg** the merging and
converting; both ship inside the installer, so nothing has to be installed separately.

## What it does that the phone can't

- **Clipboard watcher that actually works.** Android blocks background clipboard reads;
  Windows doesn't. Copy a link anywhere and the offer appears immediately.
- **A real queue** — several downloads at once, each one pausable and resumable. Pausing
  kills the process and leaves the `.part` file, so resuming continues instead of restarting.
- **Trim before saving** — keep only 2:30–4:10 of a long video.
- **Subtitles**, downloaded and optionally embedded into the file.
- **More containers** — MP4, MKV, WebM, MP3, M4A, WAV, FLAC.
- **Auto-organise** into a folder per channel.
- **System tray, global shortcut, taskbar progress.**

## Running it

```bash
npm install
npm run dev          # vite + electron together
```

`npm run dev` needs `yt-dlp` and `ffmpeg` on your PATH, or dropped into `resources/bin/`.
The Settings screen shows which it found.

Opening `http://localhost:5180` in a plain browser also works — a stand-in for the Electron
bridge fills in with sample data so the interface can be reviewed. Downloads are simulated
there; nothing is fetched.

## Building the Windows installer

A Windows `.exe` can only be produced on Windows, so this is done by GitHub Actions:

- **Actions → Build Windows installer → Run workflow** — the installer appears as an artifact.
- Or push a tag (`git tag v1.0 && git push --tags`) to attach it to a Release.

The workflow downloads `yt-dlp.exe` and `ffmpeg.exe` into `resources/bin` before packaging,
so users install one file and nothing else.

Building locally on a Windows machine: `npm run pack:win`.

## Layout

```
src/main/       Electron main process
  main.ts       window, tray, clipboard watcher, hotkey, IPC
  queue.ts      the download queue — parallel slots, pause/resume, progress parsing
  probe.ts      turns a URL into a title, formats and subtitle list
  tools.ts      finds yt-dlp and ffmpeg (bundled, else PATH)
  preload.ts    the only bridge the renderer gets
src/renderer/   the React interface
src/shared/     types both sides agree on
```

## Licence

GPL-3.0. StreamGarden hosts nothing and breaks no copy protection — it reads the same public
streams a browser does. What you download, and whether you're allowed to, is on you.
