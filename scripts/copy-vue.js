#!/usr/bin/env node
// Copies the Vue 3 runtime (single prebuilt file, no bundler) into the
// renderer's vendor directory. Runs automatically on `npm install`.
'use strict';

const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'node_modules', 'vue', 'dist', 'vue.global.prod.js');
const destDir = path.join(__dirname, '..', 'src', 'renderer', 'assets', 'vendor');
const dest = path.join(destDir, 'vue.global.prod.js');

if (!fs.existsSync(src)) {
  console.error('[copy-vue] vue not found in node_modules — run `npm install` first.');
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
console.log('[copy-vue] copied Vue runtime to src/renderer/assets/vendor/');
