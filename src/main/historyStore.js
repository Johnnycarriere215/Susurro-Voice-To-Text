// Local-only transcription history: last 50 entries, on disk, one-click clear.
'use strict';

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 50;

let cache = null;
const listeners = new Set();

function filePath() {
  return path.join(app.getPath('userData'), 'history.json');
}

function load() {
  if (cache) return cache;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    cache = Array.isArray(raw) ? raw.slice(0, MAX_ENTRIES) : [];
  } catch {
    cache = [];
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

function notify() {
  for (const fn of listeners) fn(list());
}

function list() {
  return load().map((e) => ({ ...e }));
}

function add(text) {
  load();
  cache.unshift({ text, ts: Date.now() });
  cache = cache.slice(0, MAX_ENTRIES);
  persist();
  notify();
}

function clear() {
  cache = [];
  persist();
  notify();
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

module.exports = { list, add, clear, onChange };
