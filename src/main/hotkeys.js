// Global hotkey registration + conflict checking against common OS shortcuts.
'use strict';

const { globalShortcut } = require('electron');

// Accelerators we refuse to bind because stealing them breaks the OS or
// near-universal app shortcuts. Compared case-insensitively after normalizing
// CommandOrControl.
const RESERVED = [
  'CommandOrControl+C', 'CommandOrControl+V', 'CommandOrControl+X',
  'CommandOrControl+A', 'CommandOrControl+Z', 'CommandOrControl+Shift+Z',
  'CommandOrControl+S', 'CommandOrControl+N', 'CommandOrControl+T',
  'CommandOrControl+W', 'CommandOrControl+Q', 'CommandOrControl+F',
  'CommandOrControl+P', 'CommandOrControl+R', 'CommandOrControl+Tab',
  'Alt+Tab', 'Alt+F4', 'Command+Space', 'Command+Tab', 'Super+L',
  'CommandOrControl+Alt+Delete', 'PrintScreen', 'F1',
];

let current = null;

// Canonical spelling for every accelerator token we recognize, so the
// displayed hotkey is always clean regardless of the input's casing.
const MODIFIER_ALIASES = {
  cmd: 'Command', command: 'Command',
  ctrl: 'Control', control: 'Control',
  cmdorctrl: 'CommandOrControl', commandorcontrol: 'CommandOrControl',
  alt: 'Alt', option: 'Option',
  shift: 'Shift',
  super: 'Super', meta: 'Super',
  altgr: 'AltGr',
  space: 'Space',
};

function normalize(accel) {
  return String(accel || '')
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      const alias = MODIFIER_ALIASES[trimmed.toLowerCase()];
      if (alias) return alias;
      // Single character keys canonicalize to uppercase (a -> A); leave named
      // keys (F5, Escape, PageDown, …) exactly as supplied.
      if (trimmed.length === 1) return trimmed.toUpperCase();
      return trimmed;
    })
    .join('+');
}

function expandReserved(platform) {
  const primary = platform === 'darwin' ? 'Command' : 'Control';
  return RESERVED.map((a) => a.replace('CommandOrControl', primary).toLowerCase());
}

function isReserved(accel, platform = process.platform) {
  const primary = platform === 'darwin' ? 'Command' : 'Control';
  const norm = normalize(accel).replace('CommandOrControl', primary).toLowerCase();
  return expandReserved(platform).includes(norm);
}

// Registers `accel` and routes it to `callback`. Returns
// { ok } or { ok: false, reason: 'reserved' | 'invalid' | 'taken' }.
function register(accel, callback) {
  const norm = normalize(accel);
  if (!norm) return { ok: false, reason: 'invalid' };
  if (isReserved(norm)) return { ok: false, reason: 'reserved' };

  if (current) {
    try { globalShortcut.unregister(current); } catch { /* already gone */ }
  }
  let ok = false;
  try {
    ok = globalShortcut.register(norm, callback);
  } catch {
    ok = false;
  }
  if (!ok) {
    // Try to restore the previous binding so the user isn't left without one.
    if (current) {
      try { globalShortcut.register(current, callback); } catch { /* ignore */ }
    }
    return { ok: false, reason: 'taken' };
  }
  current = norm;
  return { ok: true };
}

function unregisterAll() {
  globalShortcut.unregisterAll();
  current = null;
}

module.exports = { register, unregisterAll, isReserved, normalize, RESERVED };
