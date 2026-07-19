#!/usr/bin/env node
// Generates Susurro's icon set as PNGs with zero dependencies (raw PNG
// encoding via zlib). Outputs to build/icons/. electron-builder converts the
// 512px icon.png into .icns/.ico at package time.
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---- minimal PNG encoder -------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- tiny software rasterizer -------------------------------------------

function canvas(size) {
  return { size, px: Buffer.alloc(size * size * 4) };
}

function put(c, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const sa = a / 255;
  c.px[i] = Math.round(r * sa + c.px[i] * (1 - sa));
  c.px[i + 1] = Math.round(g * sa + c.px[i + 1] * (1 - sa));
  c.px[i + 2] = Math.round(b * sa + c.px[i + 2] * (1 - sa));
  c.px[i + 3] = Math.max(c.px[i + 3], a);
}

// Coverage-based rounded rectangle with 4x supersampling for smooth edges.
function roundRect(c, x0, y0, w, h, radius, color) {
  const r = Math.min(radius, w / 2, h / 2);
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4;
          const py = y + (sy + 0.5) / 4;
          if (px < x0 || px > x0 + w || py < y0 || py > y0 + h) continue;
          const cx = Math.min(Math.max(px, x0 + r), x0 + w - r);
          const cy = Math.min(Math.max(py, y0 + r), y0 + h - r);
          const dx = px - cx;
          const dy = py - cy;
          if (dx * dx + dy * dy <= r * r) cover++;
        }
      }
      if (cover > 0) put(c, x, y, [color[0], color[1], color[2], Math.round((color[3] * cover) / 16)]);
    }
  }
}

// ---- Susurro artwork -----------------------------------------------------

const CREAM = [0xf7, 0xf3, 0xe4, 255];
const INK = [0x14, 0x12, 0x0f, 255];
const BLUSH = [0xf2, 0xbe, 0xe0, 255];
const GRAY = [0x8c, 0x8c, 0x86, 255];

// Five vertical waveform bars, middle-heavy — the Susurro "whisper" mark.
function drawBars(c, cx, cy, unit, color, accentMiddle) {
  const heights = [0.32, 0.62, 1.0, 0.62, 0.32];
  const barW = unit * 0.42;
  const gap = unit * 0.78;
  heights.forEach((hFrac, i) => {
    const h = unit * 2.6 * hFrac;
    const x = cx + (i - 2) * gap - barW / 2;
    const col = accentMiddle && i === 2 ? BLUSH : color;
    roundRect(c, x, cy - h / 2, barW, h, barW / 2, col);
  });
}

function appIcon(size) {
  const c = canvas(size);
  const s = size / 512;
  roundRect(c, 32 * s, 32 * s, 448 * s, 448 * s, 96 * s, CREAM);
  drawBars(c, size / 2, size / 2, 110 * s, INK, true);
  return c;
}

function trayIcon(size, color) {
  const c = canvas(size);
  drawBars(c, size / 2, size / 2, size * 0.24, color, false);
  return c;
}

const outDir = path.join(__dirname, '..', 'build', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const outputs = [
  ['icon.png', appIcon(512)],
  ['icon-256.png', appIcon(256)],
  // macOS template tray icons (pure black + alpha; macOS recolors them).
  ['trayTemplate.png', trayIcon(22, [0, 0, 0, 255])],
  ['trayTemplate@2x.png', trayIcon(44, [0, 0, 0, 255])],
  // Windows/Linux tray (mid-gray reads on both light and dark bars).
  ['tray.png', trayIcon(32, GRAY)],
];

for (const [name, c] of outputs) {
  fs.writeFileSync(path.join(outDir, name), encodePng(c.size, c.size, c.px));
  console.log(`[icons] wrote build/icons/${name}`);
}
