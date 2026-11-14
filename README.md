# Mini DJ

Two‑deck DJ app built with React, Vite and Tailwind — everything runs locally in the browser via the Web Audio API (no backend, tracks never leave your machine). Beat‑aware coloured waveforms, an LCD panel per deck, song‑structure countdowns, continuous sync, named cues, advanced loops and rolls, a real mixer section with filter and EQ kills, true dBFS meters, headphone pre‑listen, session recording and a persistent crate.

## Features

### Decks

- Transport (play/pause/stop), elapsed/remaining toggle, smooth seeking, and per‑deck key lock (`preservesPitch`): keep the musical key while changing tempo; off = vinyl mode.
- Pitch fader like a Technics turntable (up = slower, down = faster), ±8/16/50 % range, and momentary pitch‑bend buttons; live BPM readout reflects tempo changes.
- CUE points: positioning the track while paused sets the cue; Stop returns to it. Auto‑cue lands on the first sound / first detected beat (orange marker on the waveform).
- 8 named hot cues per deck (right‑click or Shift+click clears, double‑click names them) drawn on the waveform with their label; the pads reserve their space, so naming a cue never shifts the layout.
- Loops: manual IN/OUT, auto 4/8/16‑beat loops on the grid, move the loop back/forward by its own length, halve/double its length, and **loop rolls** (1/8 – 4 beats) while you hold the pad — on release playback continues where it would be if the roll had never happened. Loops are timed with a scheduled jump (not a per‑frame check) and the leftover latency is carried into the loop start, so even a 1/8‑beat loop keeps its phase.
- Saved loops per track: store several with a name, recall and arm them from the deck.
- Hot cues and loops are saved with the track in IndexedDB and restored when you load it again, in this session or after restarting the app. They belong to the user: no re‑analysis or reload ever overwrites them, and deleting the track from the crate deletes them with it.
- Traktor‑style beat jump: selectable size (1–32 beats) with « / » to jump backward or forward.
- Quantize (the Q pad, off by default so a cue placed by hand lands exactly where you put it): hot cues, loop in/out, loop rolls and beat jumps snap to the grid — rolls to the subdivision of their own size.
- Grid TAP: tap the TAP button (or the BPM display) on the beats while the track plays — each tap re‑anchors the beat grid in real time and several taps recompute the BPM. Taps are measured in track time, so pitch doesn't skew the result.
- Manual beat‑grid editing, both axes: `« ‹ › »` shift the grid anchor (10 ms / 1 ms) when the grid is out of phase with the hits, and `−− − + ++` stretch or squeeze the spacing between beats (±0.1 / ±0.01 BPM) pivoting on the anchor, for a grid that starts square and drifts. `÷2` / `×2` fix a tempo detected at half or double, and `⟳` re‑runs the detection _around_ the BPM and anchor you set by hand instead of from scratch. All of it changes the track's **base BPM**, never the pitch, and every change propagates at once to waveform markers, quantize, auto loops and rolls, beat jump, the beat‑match panel and the BPM feeding SYNC.
- Waveform screen: the zoomed wave, which always follows the playhead (zoom with buttons or mouse wheel, click‑to‑seek, beat markers, cue/hot‑cue/loop overlays), over a full‑track overview strip you can click to jump anywhere in the track. Vinyl‑style dragging: while paused, push the wave to position the track under the playhead; while playing, dragging nudges the tempo like a pitch bend.
- **Song structure**: the track is analysed once into sections with and without a beat, aligned to phrases (16 kicks by default, configurable) including the intro offset electronic tracks usually carry. A readout in the corner of the wave counts down to the next change — `♪ ▼32 ▲80` (beat playing, break in 32, beat back 80 later), `○ ▲16` (in a break) — colouring the number as it gets close, and switching to kicks left to the end (`▪ n`) when no change remains ahead. Hovering explains it in words. Counting in kicks or bars is a setting.
- **Musical key** detected on load, shown on the LCD in Camelot notation (can be hidden in ⚙) and used by the crate to mark harmonic matches.
- Manual structure tuning per deck: shift the phrase (fine and coarse), pick the phrase size, re‑detect over the grid you have set by hand, or reset to what the analysis found. Like the grid, a hand adjustment is never overwritten.
- **End‑of‑track warning**: the wave border pulses red when the track is running out, triggered by seconds left or by percentage left (configurable, and it honours reduced‑motion).
- LCD panel per deck showing name, time, duration, track and effective BPM, key, pitch and bend, drawn with seven/fourteen‑segment and 5×7 dot‑matrix cells (generated SVG, no external fonts) — plain text or lit panel, your choice in ⚙.
- Deck tools are grouped into tabs by what they do: **Position** (hot cues + jump), **BPM** (grid + structure) and **Loops and rolls**.
- Analysis feedback over the waveform ("Analyzing track…", "Detecting BPM…", "Adjusting grid…").

### Mixing

- Mixer with **dipless crossfader** (each deck at full gain on its own half; only the opposite side attenuates) and deck volume faders.
- **True dBFS meters** per deck and for the mix, with peak hold and a clip warning, measured where a desk would measure (a channel's meter does not drop when you cross the fader away from it, and the master meter reads the real output). Two looks, switchable in ⚙: a continuous neon bar or a discrete LED ladder like a mixing desk.
- Mixing-desk style faders (`Fader` component, reused everywhere): rectangular head with a centre line, lit travelled section over a darker rail, optional scale ticks, fill from the start or from the centre (pitch, crossfader), and right‑click to snap back to the default position — all configurable per instance.
- Per‑deck EQ (gain/high/mid/low) with band **kills** (right‑click a knob; double‑click resets), plus auto‑gain (on by default): the whole track is analyzed once on load and a single static gain is applied — no pumping during playback — referenced to the loud part of the song and capped so peaks never pass −1 dBFS.
- DJ **filter** knob per deck: one control sweeping LPF (left) ↔ HPF (right), off at center.
- Continuous **SYNC** per deck: while engaged the deck keeps following its tempo source — the other deck's effective BPM or the adjustable **Master Sync** BPM — and the button shows which (SYNC·A/B or SYNC·MST). Pitch range auto‑expands as needed.
- Beat‑match panel: both decks' waveforms and beat markers around the playhead to line them up visually.
- Headphone pre‑listen (PFL) per deck with its own volume.
- Safety limiter before the output so summing decks never clips; master level stays where you put it (no dynamic auto-leveling).
- Session recording: record the master mix and download it as `.webm`.

### Library

- Track list (crate): add multiple songs, load them to Deck A/B with one click, badges showing what's loaded where and (in gray) where each song was already played.
- ID3 tags (artist, title, album) and cover art read locally; the artwork column can be hidden.
- Key column with harmonic hints: against the deck that is playing (the last one started if both are), each track is marked as the same key, compatible (a neighbour on the Camelot wheel or the relative major/minor) or a clash.
- Persists in IndexedDB across reloads (including a hand‑adjusted beat grid, hot cues and saved loops, which the background analysis never overwrites); BPM/duration analyzed slowly in the background (idle time, one at a time) or only on deck load (configurable).
- Search box (name, title, artist, album), sorting by order added, name, BPM, duration or key, and CSV export (with artist, key and where each track was played).
- **Load lock** (on by default): a deck that is playing will not accept a new track, and its → A / → B button greys out in the list, so a wrong click cannot kill a live mix. Switchable in ⚙.

### Extras

- Keyboard shortcuts on the active deck (click a deck or Q/P to switch): Space play/pause, C cue/stop, 1‑8 hot cues (Shift+n clears), I/O loop in/out, L loop toggle, A S D F G H loop roll (1/8 – 4 beats, while held), `[` `]` move the loop, `-` `=` halve/double it, R save the loop (Shift+R arms the saved one), `,` `.` pick a saved loop, ←/→ nudge.
- Config dialog (⚙), organised in tabs: **audio** (outputs for the master mix, the headphone cue and optionally each deck for external‑mixer mode; pitch range and bend strength), **library** (analysis mode, artwork and key columns), **display** (meter style, waveform palette, structure readout, LCD look), **safety** (load lock, end‑of‑track warning) and the error **log**.
- Waveform palettes: the house frequency colouring, looks inspired by Serato, Traktor and rekordbox, the flat green of earlier versions, or your own three colours.
- Pitch fader range and bend strength live in ⚙ and apply to both decks; the range is the starting point — SYNC widens it on its own when it needs to.
- **11 languages** (Spanish, English, Catalan, Galician, Basque, French, Italian, Portuguese, Chinese, Japanese, Korean), auto‑detected from the browser with English as fallback and a selector under the title; the choice is remembered.
- Responsive layout down to phone widths (decks stack, mixer moves below); Dark Reader–friendly. Controls reserve stable widths so translated or changing labels never shift the layout.

## Quick start

1. Install deps: `npm install` (Node 22+; CI builds on Node 24).
2. Run dev server: `npm run dev` then open the shown local URL.
3. Load audio files into Deck A/B and start mixing.

## Scripts

### Web

- `npm run dev` – start Vite dev server with HMR.
- `npm run build` – production build.
- `npm run preview` – preview the production build locally.
- `npm run lint` – run ESLint.
- `npm run format` – format the repo with Prettier (default style); `npm run format:check` only checks, as CI does.

### Tests

- `npm test` – run the whole suite once (Vitest).
- `npm run test:watch` – watch mode while developing.
- `npm run test:coverage` – suite plus a coverage report (`coverage/index.html`).

Two projects share one config (`vitest.config.js`):

- **unit** – plain Node, no DOM: audio logic (`beatGrid`, `engine`, `utils`,
  `levelMeter`, `keyDetect`), `src/lib` and the locale dictionaries. The Web
  Audio graph is faked in `tests/helpers/fakeAudio.js`, and test signals are
  generated on the fly in `tests/helpers/signals.js` – no audio fixtures in the
  repo.
- **dom** – jsdom + React Testing Library for the components.

Browser (end-to-end) tests live apart in `vitest.e2e.config.js`:

- `npm run test:e2e` – five user flows (load a track and detect its BPM, play,
  sync two decks, settings survive a reload, switching language does not break
  the layout).
- They drive the **system Chrome** through `puppeteer-core` (no browser is
  downloaded); set `MINI_DJ_CHROME` if it lives somewhere unusual. With no
  Chrome around they skip themselves instead of failing, and `npm test` never
  runs them, so CI cannot go flaky because of them.
- They read each deck's BPM from its `data-bpm` / `data-running-bpm` attributes, not from
  the LCD, which draws it rounded and in segments.
- `AudioContext.resume()` never settles without an audio device, so the harness
  replaces it with a resolved promise before the app loads.

### Desktop (Electron)

- `npm run desktop:dev` – Vite dev server + Electron pointed at it (HMR, DevTools open).
- `npm run desktop:preview` – build and run Electron against `dist/`, the exact production code path.
- `npm run desktop:dir` – build an unpacked app in `release/` (no installer).
- `npm run desktop:build` – build installers for the current platform.
- `npm run dist:win` / `dist:linux` / `dist:mac` – build for one platform.

## Desktop app (Electron)

The desktop build is a thin wrapper around the same web bundle — the audio engine,
the UI and the storage code are unchanged.

Targets: **Windows** NSIS installer + portable `.exe`, **Linux** AppImage + `.deb`,
**macOS** `.dmg` (x64 and arm64). Configuration lives in `electron-builder.yml`;
output goes to `release/`.

How it is wired:

- `electron/main.cjs` – main process. `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. In development it loads the Vite dev server; in production it serves
  `dist/` over a custom `app://` scheme registered as _standard_ and _secure_ (not `file://`,
  which is an opaque origin and makes IndexedDB/localStorage unreliable and breaks secure-context
  APIs like `getUserMedia` and `setSinkId`). A CSP is sent as a response header on that scheme.
- `electron/preload.cjs` – minimal bridge; exposes only `window.miniDJDesktop`
  (`isDesktop`, `platform`, versions, and the update state / install call). No Node API
  reaches the page.
- `electron/updater.cjs` – auto-update; see below.
- `electron/security.cjs` – the main-process rules, kept free of Electron so they are unit
  tested: a request to `app://` resolves only inside `dist/` (malformed or escaping paths get
  a 403), the window only navigates within the app's own origin, only `http(s)` links open in
  the system browser, and the page can write at most 50 log lines a second (the dropped ones
  are counted in the log).
- Media permission is granted in the session, only to the app's own origin. Without it
  `enumerateDevices()` returns outputs with empty labels and the ⚙ Config device pickers
  come up blank.
- `backgroundThrottling` is disabled so waveforms and background analysis keep running
  when the window loses focus.
- Downloads (the recorded `.webm`, the tracklist CSV) open the native save dialog,
  defaulting to the system Downloads folder.
- Track library (IndexedDB) and settings/language (localStorage) persist between launches.

### Releases

Pushing a `v*` tag runs `.github/workflows/release.yml`. A single Linux job checks first —
lint, tests, and that the tag matches the `version` in `package.json` (the installers are
named after it) — and only then builds on Windows, Linux and macOS runners and uploads the
binaries to a **draft** GitHub release. Review it and publish manually. No secrets are
needed beyond the default `GITHUB_TOKEN`.

```
npm version patch   # or minor / major
git push --follow-tags
```

### Error log

Failures are typed: each one carries a code naming the area it broke in
(`AUDIO-SINK-CUE`, `TRACK-LOAD`, `ANALYSIS-BEATS`, `LIB-DB-SAVE`, `UPDATE-CHECK`…),
the context of the moment and the original error. Messages are always in English and
never translated — the UI speaks eleven languages, the log cannot, or the same
failure would read eleven different ways and be impossible to search or compare.

The catalogue lives in `src/lib/log.js` (renderer) and `electron/logger.cjs` (main
process); both write the same line format. The page keeps the last 200 entries in
`localStorage` and shows them under ⚙ Settings › Log, where they can be downloaded,
copied or cleared. The desktop app also appends everything — including the lines the
page forwards over IPC — to a single file:

```
Windows   %APPDATA%\mini-dj\mini-dj.log
Linux     ~/.config/mini-dj/mini-dj.log
macOS     ~/Library/Application Support/mini-dj/mini-dj.log
```

The folder is `mini-dj`, not `Mini DJ`: `app.getName()` reads the `name` field of the
packaged `package.json`, while `productName` only lives in `electron-builder.yml` and
governs the executable and installer names. **Do not "fix" this.** Renaming it moves
the whole `userData` directory, orphaning the IndexedDB track library, the settings
and the chosen language — the app would come back empty.

### Auto-update

Enabled on Windows and on the Linux AppImage, via `electron-updater`
(`electron/updater.cjs`). Eight seconds after start-up the app asks GitHub for the
latest **published** release, downloads the installer in the background and shows a
toast offering to restart and install; if you dismiss it, the update is applied when
you close the app. While it works it says so — "Checking for updates…", then either
the download or "You are on the latest version" — and a failed check (no network,
rate limit) is reported rather than swallowed, but never interrupts a set.

Three things worth knowing:

- **A draft release does not exist for the updater.** The public GitHub API does not
  return drafts, so the release has to be published before anyone gets it. The
  workflow still uploads as a draft on purpose, so you review before shipping.
- **The version that checks is the installed one.** Any build older than the one that
  first shipped `electron-updater` will never update itself, however many releases go
  out; it has to be installed by hand once.
- **macOS is excluded** because auto-update requires a signed app, and **the Linux
  `.deb` is excluded** because that is the package manager's job. Both are skipped
  explicitly rather than left to fail at run time.

### Desktop limitations

- **Windows**: the installer and the app are not code-signed. SmartScreen will show
  "Windows protected your PC" on first run; the user has to click _More info → Run anyway_.
  Removing that warning requires a paid code-signing certificate.
- **macOS**: not signed and not notarized (no Apple Developer account). The first launch is
  blocked by Gatekeeper; the user has to right-click the app → _Open_ → _Open_. A plain
  double-click will only offer to move it to the Bin. On some macOS versions the app may also
  need `xattr -dr com.apple.quarantine "/Applications/Mini DJ.app"`.
- **Linux**: the AppImage needs FUSE 2 (or `--appimage-extract-and-run`). The `.deb` declares
  the usual Chromium runtime dependencies.
- Only x64 is built for Windows and Linux; macOS gets both x64 and arm64.

## How to use

- Add songs to the crate (or load files directly on a deck); waveform, loudness and BPM analysis run locally.
- Click the waveform to seek; drag it to position (paused) or nudge (playing); wheel to zoom. Beat markers appear when BPM detection finishes — if the grid is off, tap TAP on the beats to fix it live.
- Engage SYNC to lock a deck to the other one (or enable Master Sync and dial a BPM); use the beat‑match panel to align beats visually.
- Shape the sound with EQ knobs (right‑click = kill), the Filter knob, and balance with faders and the dipless crossfader. `Auto` applies the suggested loudness trim.
- Watch the structure readout to mix on the drop: it tells you how many kicks are left before the beat drops out or comes back, and where you are inside the phrase.
- Pre‑listen a deck with PFL (pick the headphone output in ⚙ Config), record your set with ● REC.

## Project layout

- `src/MiniDJPlayer.jsx` – top-level layout, shared state, sync engine.
- `src/hooks/` – logic pulled out of the components: the track library and its background analysis queues, deck keyboard shortcuts, track loading and analysis, the loop/roll engine, song structure, pitch bend and playback rate.
- `src/audio/engine.js` – Web Audio graph (decks, EQ, filter, crossfader, cue bus, master limiter, meter taps, recording).
- `src/audio/utils.js` – loudness, waveform and frequency‑band analysis, and the per‑track auto‑gain.
- `src/audio/beatGrid.js` – BPM and beat‑grid detection (own MIT implementation: filter bank → onset envelope → autocorrelation → phase) plus the guided re‑analysis behind the manual controls.
- `src/audio/structure.js` – sections with and without a beat, phrase alignment and the countdown to the next change.
- `src/audio/keyDetect.js` / `src/lib/camelot.js` – musical key and its Camelot notation.
- `src/audio/levelMeter.js` – dBFS metering, peak hold and colour zones.
- `src/audio/loops.js`, `src/lib/cuePoints.js` – loop maths (roll, move, halve/double) and hot cue handling.
- `src/audio/metadata.js` – ID3 tags and cover art.
- `src/audio/analyzeTrack.js` – background analysis for the crate.
- `src/i18n/` – language provider, detection and the 11 locale dictionaries (English ships in the bundle; the others load on demand).
- `src/lib/` – IndexedDB track store and the per‑event track update rules, ⚙ config, shared constants, structure/warning preferences, sync maths, waveform palettes, CSV, error log, smooth playhead, device glass.
- `src/components/*` – decks (LCD panel, wave screen, structure readout), mixer, meters, track list, config dialog, the reusable `Fader`, `PadButton` and knobs; `deck/` holds the deck's tool tabs.
- `tests/` – `unit/` (pure logic, Node), `dom/` (components, jsdom), `e2e/` (Chrome + puppeteer-core), `helpers/` (Web Audio double, synthetic signals, WAV generator, a deck mount with a fake `<audio>`).
- `.github/workflows/ci.yml` – lint, format check, tests and build on every push and PR to main; `release.yml` – desktop builds on a `v*` tag.
- `electron/` – desktop wrapper (main process, preload, updater, logger, security rules).
- `scripts/electron-dev.mjs` – starts Vite and launches Electron against the resolved URL.
- `electron-builder.yml` – packaging targets and installer options.
- `build/` – application icons.

## Notes / limitations

- Runs in the browser or as an Electron desktop app; uses `AudioContext` and `createObjectURL`, so tracks stay local either way.
- Auto BPM detection can miss on unusual material; the grid TAP and the manual grid controls (phase / spacing / ÷2 / ×2 / guided re‑analysis) are the fallback.
- PFL and per‑deck outputs are only useful with more than one audio device (e.g. USB headphones): pick outputs in ⚙ Config; the master keeps playing on its own output.

## License

MIT — see [LICENSE](LICENSE). All the audio analysis (loudness, waveform, key and BPM/beat grid) is
first‑party code; no GPL/AGPL library is bundled.
