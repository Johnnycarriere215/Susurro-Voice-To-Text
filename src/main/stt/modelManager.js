// Download / verify / delete faster-whisper (CTranslate2) models.
//
// Models come from the Systran/faster-whisper-* Hugging Face repositories —
// this is the ONLY network endpoint Susurro ever contacts, and only when the
// user explicitly asks to download a model. Files land under
// <userData>/models/<name>/ and are used strictly locally afterwards.
'use strict';

const { app, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILES = ['config.json', 'tokenizer.json', 'vocabulary.txt', 'model.bin'];

const MODELS = {
  tiny: {
    name: 'tiny',
    label: 'Tiny',
    approxBytes: 78 * 1024 * 1024,
    downloadLabel: '~75 MB',
    note: 'Fastest, lowest accuracy. Fine for quick notes on any hardware.',
  },
  base: {
    name: 'base',
    label: 'Base',
    approxBytes: 148 * 1024 * 1024,
    downloadLabel: '~145 MB',
    note: 'Good speed/accuracy balance — the recommended starting point.',
  },
  small: {
    name: 'small',
    label: 'Small',
    approxBytes: 488 * 1024 * 1024,
    downloadLabel: '~465 MB',
    note: 'Noticeably more accurate; needs a reasonably modern CPU.',
  },
  medium: {
    name: 'medium',
    label: 'Medium',
    approxBytes: 1536 * 1024 * 1024,
    downloadLabel: '~1.5 GB',
    note: 'Most accurate offered; slowest — best with a fast CPU or GPU.',
  },
};

const activeDownloads = new Map(); // name -> { cancelled, request }

function modelsRoot() {
  return path.join(app.getPath('userData'), 'models');
}

function modelDir(name) {
  return path.join(modelsRoot(), name);
}

function markerFile(name) {
  return path.join(modelDir(name), '.complete');
}

function isInstalled(name) {
  if (!MODELS[name]) return false;
  if (!fs.existsSync(markerFile(name))) return false;
  return FILES.every((f) => fs.existsSync(path.join(modelDir(name), f)));
}

function list() {
  return Object.values(MODELS).map((m) => ({
    ...m,
    installed: isInstalled(m.name),
    downloading: activeDownloads.has(m.name),
    dir: modelDir(m.name),
  }));
}

function fileUrl(name, file) {
  return `https://huggingface.co/Systran/faster-whisper-${name}/resolve/main/${file}`;
}

// Streams one file to disk via Electron's net module (follows redirects,
// honors system proxy). Reports byte progress through onBytes.
function downloadFile(url, dest, state, onBytes) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, useSessionCookies: false });
    state.request = request;
    const tmp = `${dest}.part`;
    const out = fs.createWriteStream(tmp);

    const fail = (err) => {
      out.destroy();
      fs.rm(tmp, { force: true }, () => {});
      reject(err);
    };

    request.on('response', (response) => {
      if (response.statusCode !== 200) {
        response.on('data', () => {});
        return fail(new Error(`HTTP ${response.statusCode} for ${url}`));
      }
      response.on('data', (chunk) => {
        if (state.cancelled) {
          request.abort();
          return fail(new Error('cancelled'));
        }
        out.write(chunk);
        onBytes(chunk.length);
      });
      response.on('end', () => {
        out.end(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve();
          } catch (err) {
            fail(err);
          }
        });
      });
      response.on('error', fail);
    });
    request.on('error', fail);
    request.end();
  });
}

// Downloads all files for a model. onProgress({ name, received, total, file }).
async function download(name, onProgress) {
  const meta = MODELS[name];
  if (!meta) throw new Error(`Unknown model: ${name}`);
  if (isInstalled(name)) return { ok: true, already: true };
  if (activeDownloads.has(name)) return { ok: false, error: 'already downloading' };

  const state = { cancelled: false, request: null };
  activeDownloads.set(name, state);
  const dir = modelDir(name);
  fs.mkdirSync(dir, { recursive: true });

  let received = 0;
  try {
    for (const file of FILES) {
      if (state.cancelled) throw new Error('cancelled');
      await downloadFile(fileUrl(name, file), path.join(dir, file), state, (n) => {
        received += n;
        onProgress({
          name,
          file,
          received,
          total: meta.approxBytes,
          percent: Math.min(99, Math.round((received / meta.approxBytes) * 100)),
        });
      });
    }
    fs.writeFileSync(markerFile(name), JSON.stringify({ completedAt: Date.now() }));
    onProgress({ name, received, total: received, percent: 100, done: true });
    return { ok: true };
  } catch (err) {
    const cancelled = state.cancelled || /cancelled/.test(String(err.message));
    if (!cancelled) {
      onProgress({ name, error: String(err.message || err) });
    } else {
      onProgress({ name, cancelled: true });
    }
    return { ok: false, error: String(err.message || err), cancelled };
  } finally {
    activeDownloads.delete(name);
  }
}

function cancel(name) {
  const state = activeDownloads.get(name);
  if (!state) return false;
  state.cancelled = true;
  try { state.request?.abort(); } catch { /* already closed */ }
  return true;
}

function remove(name) {
  if (!MODELS[name]) return { ok: false, error: 'unknown model' };
  if (activeDownloads.has(name)) cancel(name);
  fs.rmSync(modelDir(name), { recursive: true, force: true });
  return { ok: true };
}

// sha256 of model.bin, used by SETUP.md's manual-verification instructions.
function checksum(name) {
  const file = path.join(modelDir(name), 'model.bin');
  if (!fs.existsSync(file)) return null;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

module.exports = { MODELS, list, isInstalled, download, cancel, remove, modelDir, checksum };
