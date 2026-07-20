# Susurro — Setup

Susurro is a free, permanently local voice-dictation app. Everything —
recording, transcription, optional cleanup — runs on your machine. No
account, no cloud, no telemetry.

## Requirements

| Component | Why | Install |
|-----------|-----|---------|
| Node.js ≥ 18 + npm | build/run the Electron app | https://nodejs.org |
| Python 3.9+ | runs the local speech-to-text engine | https://python.org (or your package manager) |
| `faster-whisper` (pip) | the speech-to-text engine itself | `pip install faster-whisper` |

### The one-time local Python dependency

Susurro does **not** bundle a Python runtime. It looks for `python3` (or
`python`) on your PATH and runs the STT engine as a local subprocess. The
only Python package needed:

```sh
pip install faster-whisper
```

### If pip refuses with "externally-managed-environment" (PEP 668)

Recent Debian/Ubuntu/Fedora ship a system Python that blocks system-wide
`pip install`. Use a virtual environment — the recommended approach anyway:

```sh
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install faster-whisper
```

Susurro runs whichever `python3` is first on your `PATH`, so **either**:

- keep the venv **activated in the same shell** you launch `npm start` from
  (its `python3` shadows the system one), **or**
- point Susurro straight at the venv interpreter once, so activation is never
  needed: set `"pythonPath"` in `settings.json` to the venv's python, e.g.
  `"pythonPath": "/absolute/path/to/Susurro-Voice-To-Text/.venv/bin/python"`
  (`…\.venv\Scripts\python.exe` on Windows). See “Where Susurro stores data”
  below for the file location. This is the most reliable option if you launch
  Susurro from a desktop shortcut rather than a terminal.

As a last resort you can install into the system Python with
`pip install --break-system-packages faster-whisper`, but a venv is cleaner
and won't risk your OS packages.

## Run from source

Run every command **inside the cloned project directory** — not your home
folder:

```sh
git clone https://github.com/Johnnycarriere215/Susurro-Voice-To-Text.git
cd Susurro-Voice-To-Text

npm install        # also copies the Vue runtime into the renderer (postinstall)
npm run icons      # generate build/icons (committed, only needed after edits)
npm start
```

On first launch Susurro walks you through microphone permission, the
injection permission for your OS, and downloading a Whisper model
(tiny / base / small / medium — the model download is the only network
request the app ever makes).

## Per-OS notes

### macOS
- **Microphone** and **Accessibility** permissions are requested during
  onboarding. Accessibility is what lets Susurro type into other apps
  (System Settings → Privacy & Security → Accessibility).

### Windows
- No special permission needed; typing uses the system SendKeys automation.
- PowerShell must be present (it is, on any stock Windows 10/11).

### Linux — X11
- Install `xdotool` for keystroke injection: `sudo apt install xdotool`
  (the .deb recommends it automatically).

### Linux — Wayland
- Wayland blocks apps from simulating keystrokes by design. Susurro detects
  Wayland at runtime and, in order of preference:
  1. uses **ydotool** if installed *and* its daemon (`ydotoold`) is running,
  2. uses **wtype** if present (wlroots compositors),
  3. falls back to **clipboard-copy + simulated paste** (via XWayland's
     `xdotool` when available),
  4. as a last resort copies the text and notifies you to press Ctrl+V.
- A one-time in-app note explains this the first time the fallback is used.
- To enable direct typing: `sudo apt install ydotool` and enable the
  `ydotool` service; Susurro picks it up automatically, no restart needed.

### Optional: Ollama cleanup pass
If an Ollama instance is already running on `localhost:11434`, Susurro
offers an optional local grammar/filler-word cleanup pass and a model
picker in Preferences. If Ollama isn't detected the feature is hidden.
Susurro never installs, launches, or downloads Ollama, and never talks to
any host other than localhost for this feature.

## Where Susurro stores data (all local, all yours)

| File | Contents |
|------|----------|
| `<userData>/settings.json` | preferences, hotkey, overlay position |
| `<userData>/history.json` | last 50 transcriptions (clearable in-app) |
| `<userData>/models/<name>/` | downloaded Whisper models |

`<userData>` is `~/Library/Application Support/Susurro` (macOS),
`%APPDATA%/Susurro` (Windows), or `~/.config/Susurro` (Linux).

To verify a downloaded model file manually, compare
`shasum -a 256 model.bin` against the value published on the
`Systran/faster-whisper-*` Hugging Face repository the file came from.

## Packaging installers

```sh
npm run dist:mac     # .dmg + .pkg   (run on macOS)
npm run dist:win     # .exe (NSIS) + .msi   (run on Windows)
npm run dist:linux   # .AppImage + .deb     (run on Linux)
npm run release:manifest   # writes releases/releases.json + RELEASES.md
```

Code-signing configuration (all optional for local use) is documented at the
top of `electron-builder.yml`.
