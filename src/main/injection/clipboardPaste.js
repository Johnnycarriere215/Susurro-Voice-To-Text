// Clipboard-copy + simulated-paste injection.
// Used when keystroke injection is unavailable (typically Wayland) or when
// the user explicitly selects it. Preserves and restores the previous
// clipboard contents.
'use strict';

const { clipboard } = require('electron');
const { spawn } = require('child_process');
const wayland = require('./waylandDetect');

const RESTORE_DELAY_MS = 1200;

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function sendPasteChord() {
  switch (process.platform) {
    case 'darwin':
      return run('osascript', [
        '-e', 'tell application "System Events" to keystroke "v" using command down',
      ]);
    case 'win32':
      return run('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; ' +
          "[System.Windows.Forms.SendKeys]::SendWait('^v')",
      ]);
    default: {
      const env = wayland.detect();
      if (env.wayland) {
        if (env.tools.ydotool) {
          // key codes: 29 = LEFTCTRL, 47 = V
          return run('ydotool', ['key', '29:1', '47:1', '47:0', '29:0']);
        }
        if (env.tools.wtype) {
          return run('wtype', ['-M', 'ctrl', '-k', 'v', '-m', 'ctrl']);
        }
        if (env.tools.xdotool) {
          // XWayland-hosted apps can still receive X11 events.
          return run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
        }
        throw new Error('manual-paste'); // no simulation possible at all
      }
      return run('xdotool', ['key', '--clearmodifiers', 'ctrl+v']);
    }
  }
}

// Copies text, simulates the paste chord, then restores the old clipboard.
// Resolves { manualPaste: true } when no paste simulation is possible —
// the text stays on the clipboard for the user to paste themselves.
async function paste(text) {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  try {
    await sendPasteChord();
  } catch (err) {
    if (String(err.message) === 'manual-paste') {
      return { manualPaste: true }; // leave text on clipboard, do NOT restore
    }
    throw err;
  }
  setTimeout(() => {
    // Only restore if nothing else claimed the clipboard meanwhile.
    if (clipboard.readText() === text) clipboard.writeText(previous);
  }, RESTORE_DELAY_MS);
  return { manualPaste: false };
}

module.exports = { paste };
