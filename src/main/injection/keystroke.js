// Simulated-keystroke text injection.
//
// Implemented with each OS's native automation layer invoked as a
// subprocess (osascript / PowerShell SendKeys / xdotool / ydotool) rather
// than a compiled native-node module — same capability as a robotjs-style
// library, zero native build steps, and text always passes via argv or an
// environment variable so nothing is ever shell-interpolated.
'use strict';

const { spawn } = require('child_process');
const wayland = require('./waylandDetect');

function run(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { ...options, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.trim()}`));
    });
  });
}

// SendKeys treats these characters as commands; wrap them in braces.
function escapeSendKeys(text) {
  return text.replace(/[+^%~(){}[\]]/g, (ch) => `{${ch}}`);
}

async function typeDarwin(text) {
  // Text goes in as an AppleScript argument — never spliced into the script.
  await run('osascript', [
    '-e', 'on run argv',
    '-e', 'tell application "System Events" to keystroke (item 1 of argv)',
    '-e', 'end run',
    text,
  ]);
}

async function typeWindows(text) {
  // Text travels via environment variable to sidestep PowerShell quoting.
  await run(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; ' +
        '[System.Windows.Forms.SendKeys]::SendWait($env:SUSURRO_TEXT)',
    ],
    { env: { ...process.env, SUSURRO_TEXT: escapeSendKeys(text) } }
  );
}

async function typeLinux(text) {
  const env = wayland.detect();
  if (env.wayland) {
    if (env.tools.ydotool) {
      await run('ydotool', ['type', '--', text]);
      return;
    }
    if (env.tools.wtype) {
      await run('wtype', ['--', text]);
      return;
    }
    throw new Error('No Wayland typing tool available');
  }
  await run('xdotool', ['type', '--clearmodifiers', '--delay', '2', '--', text]);
}

// Returns true if keystroke injection is expected to work in this session.
function available() {
  if (process.platform !== 'linux') return true;
  const env = wayland.detect();
  if (env.wayland) return env.tools.ydotool || env.tools.wtype;
  return env.tools.xdotool;
}

async function type(text) {
  if (!text) return;
  switch (process.platform) {
    case 'darwin':
      return typeDarwin(text);
    case 'win32':
      return typeWindows(text);
    default:
      return typeLinux(text);
  }
}

module.exports = { type, available, escapeSendKeys };
