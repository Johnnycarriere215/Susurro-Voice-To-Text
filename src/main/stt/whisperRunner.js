// Spawns and manages the faster-whisper Python subprocess.
// The process is started lazily on first transcription, kept warm so the
// model stays loaded, and killed on Quit (verified — no orphans).
'use strict';

const { app } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_SCRIPT = path.join(__dirname, 'whisper_server.py');
const TRANSCRIBE_TIMEOUT_MS = 180000;

let proc = null;
let ready = null; // promise resolving when the server prints {"event":"ready"}
let nextId = 1;
let loadedDir = null;
const pending = new Map(); // id -> { resolve, reject, timer }

// Finds a usable Python 3 interpreter. The user can pin one via the
// pythonPath setting; otherwise we probe the conventional names.
function findPython(preferred) {
  const candidates = [preferred, 'python3', 'python'].filter(Boolean);
  for (const cmd of candidates) {
    try {
      const res = spawnSync(cmd, ['--version'], { timeout: 5000 });
      if (res.status === 0 && /Python 3/.test(String(res.stdout) + String(res.stderr))) {
        return cmd;
      }
    } catch { /* try next */ }
  }
  return null;
}

function scriptPath() {
  // In packaged builds the .py file is asar-unpacked to a real path.
  return SERVER_SCRIPT.replace('app.asar', 'app.asar.unpacked');
}

function start(pythonPath) {
  if (proc) return ready;
  const python = findPython(pythonPath);
  if (!python) {
    return Promise.reject(new Error(
      'Python 3 not found. Susurro needs a local Python with faster-whisper installed — see SETUP.md.'
    ));
  }

  proc = spawn(python, [scriptPath()], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  ready = new Promise((resolve, reject) => {
    let buffer = '';
    const startupTimer = setTimeout(() => {
      reject(new Error('STT engine took too long to start.'));
      stop();
    }, 30000);

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.event === 'ready') {
          clearTimeout(startupTimer);
          resolve();
          continue;
        }
        const entry = pending.get(msg.id);
        if (entry) {
          pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.ok) entry.resolve(msg);
          else entry.reject(new Error(msg.error || 'STT error'));
        }
      }
    });

    let stderrTail = '';
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-2000);
    });

    proc.on('exit', (code) => {
      clearTimeout(startupTimer);
      const hint = /No module named .?faster_whisper/.test(stderrTail)
        ? 'faster-whisper is not installed for this Python — see SETUP.md.'
        : stderrTail.split('\n').filter(Boolean).pop() || `exit code ${code}`;
      const err = new Error(`STT engine stopped: ${hint}`);
      reject(err);
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(err);
      }
      pending.clear();
      proc = null;
      ready = null;
      loadedDir = null;
    });
  });
  return ready;
}

function request(cmd, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Transcription timed out.'));
    }, TRANSCRIBE_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(`${JSON.stringify({ id, cmd, ...params })}\n`);
  });
}

// Transcribes a local WAV file with the model in modelDir. Loads/reloads the
// model inside the warm subprocess only when the directory changes.
async function transcribe(modelDir, wavPath, pythonPath) {
  await start(pythonPath);
  if (loadedDir !== modelDir) {
    await request('load', { model_dir: modelDir, compute_type: 'int8' });
    loadedDir = modelDir;
  }
  const res = await request('transcribe', { path: wavPath });
  return res.text || '';
}

// Encodes 16-bit mono PCM into a WAV file the Python side can read directly.
function writeWav(pcm16Buffer, sampleRate, filePath) {
  const header = Buffer.alloc(44);
  const dataSize = pcm16Buffer.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([header, pcm16Buffer]));
}

function tempWavPath() {
  return path.join(app.getPath('temp'), 'susurro', `dictation-${Date.now()}.wav`);
}

function isRunning() {
  return proc !== null;
}

// Hard stop — called on Quit. Must leave no background process behind.
function stop() {
  if (!proc) return;
  const p = proc;
  proc = null;
  ready = null;
  loadedDir = null;
  try { p.stdin.end(); } catch { /* ignore */ }
  try { p.kill('SIGTERM'); } catch { /* ignore */ }
  // Escalate if SIGTERM is ignored so Quit never strands a process.
  const killer = setTimeout(() => {
    try { p.kill('SIGKILL'); } catch { /* ignore */ }
  }, 1500);
  p.on('exit', () => clearTimeout(killer));
}

module.exports = { transcribe, writeWav, tempWavPath, stop, isRunning, findPython };
