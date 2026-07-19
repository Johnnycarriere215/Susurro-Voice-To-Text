// On-disk JSON settings. One file, atomic writes, no cloud, no sync.
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  onboarded: false,
  model: null, // 'tiny' | 'base' | 'small' | 'medium'
  hotkey: 'CommandOrControl+Shift+Space',
  injectionMethod: 'auto', // 'auto' | 'keystroke' | 'clipboard'
  ollamaEnabled: false,
  ollamaModel: null,
  launchOnStartup: false,
  overlayPosition: null, // { x, y }
  waylandNoticeShown: false,
  pythonPath: null, // override; otherwise auto-detected
};

let cache = null;
const listeners = new Set();

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    for (const key of Object.keys(DEFAULTS)) {
      if (key in raw) cache[key] = raw[key];
    }
  } catch {
    // first run or unreadable file — defaults apply
  }
  return cache;
}

function persist() {
  const file = filePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, file);
}

function getAll() {
  return { ...load() };
}

function get(key) {
  return load()[key];
}

function set(patch) {
  load();
  let changed = false;
  for (const [key, value] of Object.entries(patch || {})) {
    if (!(key in DEFAULTS)) continue;
    if (JSON.stringify(cache[key]) !== JSON.stringify(value)) {
      cache[key] = value;
      changed = true;
    }
  }
  if (changed) {
    persist();
    for (const fn of listeners) fn(getAll());
  }
  return getAll();
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { getAll, get, set, onChange, DEFAULTS };
