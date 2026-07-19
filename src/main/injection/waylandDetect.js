// Runtime detection of Linux display-server session type and which
// injection helper tools are actually available on this machine.
'use strict';

const { spawnSync } = require('child_process');

let cached = null;

function hasCommand(cmd) {
  try {
    const res = spawnSync('which', [cmd], { timeout: 3000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

// ydotool needs its daemon (ydotoold) reachable, not just the binary on PATH.
function ydotoolWorks() {
  if (!hasCommand('ydotool')) return false;
  try {
    const res = spawnSync('ydotool', ['debug'], { timeout: 3000 });
    return res.status === 0;
  } catch {
    return false;
  }
}

function detect() {
  if (cached) return cached;

  const isLinux = process.platform === 'linux';
  const wayland =
    isLinux &&
    (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY);

  cached = {
    platform: process.platform,
    wayland,
    tools: isLinux
      ? {
          ydotool: ydotoolWorks(),
          wtype: hasCommand('wtype'),
          xdotool: hasCommand('xdotool'),
        }
      : {},
  };
  return cached;
}

// For tests/preferences "re-detect" without restarting the app.
function reset() {
  cached = null;
}

module.exports = { detect, reset };
