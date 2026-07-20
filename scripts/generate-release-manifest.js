#!/usr/bin/env node
// Phase 7 — releases manifest generator.
//
// Scans dist/ for built installers and writes releases/RELEASES.md plus the
// machine-readable releases/releases.json consumed by the (separate)
// marketing-site project. Installers that haven't been built on this machine
// yet (e.g. mac artifacts when running on Linux) are listed with
// status "pending" and null size/checksum so the shape is always complete.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const distDir = path.join(root, 'dist');
const outDir = path.join(root, 'releases');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const EXPECTED = [
  { platform: 'macos', ext: '.dmg', label: 'macOS disk image' },
  { platform: 'macos', ext: '.pkg', label: 'macOS installer package' },
  { platform: 'windows', ext: '.exe', label: 'Windows installer (NSIS)' },
  { platform: 'windows', ext: '.msi', label: 'Windows installer (MSI)' },
  { platform: 'linux', ext: '.AppImage', label: 'Linux AppImage' },
  { platform: 'linux', ext: '.deb', label: 'Debian/Ubuntu package' },
];

function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function human(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

const built = fs.existsSync(distDir)
  ? fs.readdirSync(distDir).filter((f) => EXPECTED.some((e) => f.endsWith(e.ext)))
  : [];

const artifacts = EXPECTED.map((expected) => {
  const match = built.find((f) => f.endsWith(expected.ext));
  if (!match) {
    const archGuess = expected.platform === 'macos' ? 'universal' : 'x64';
    const osGuess = expected.platform === 'macos' ? 'mac' : expected.platform === 'windows' ? 'win' : 'linux';
    return {
      platform: expected.platform,
      label: expected.label,
      filename: `Susurro-${pkg.version}-${osGuess}-${archGuess}${expected.ext}`,
      status: 'pending',
      bytes: null,
      size: null,
      sha256: null,
      url: '',
    };
  }
  const file = path.join(distDir, match);
  const bytes = fs.statSync(file).size;
  return {
    platform: expected.platform,
    label: expected.label,
    filename: match,
    status: 'built',
    bytes,
    size: human(bytes),
    sha256: sha256(file),
    url: '', // filled in by the developer once uploaded to hosting
  };
});

fs.mkdirSync(outDir, { recursive: true });

const manifest = {
  product: 'Susurro',
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  note: 'url fields are placeholders — fill in after uploading files to hosting.',
  artifacts,
};
fs.writeFileSync(path.join(outDir, 'releases.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const lines = [
  `# Susurro ${pkg.version} — Release Artifacts`,
  '',
  `Generated: ${manifest.generatedAt}`,
  '',
  '| Platform | Artifact | File | Size | SHA-256 | Status |',
  '|----------|----------|------|------|---------|--------|',
  ...artifacts.map((a) =>
    `| ${a.platform} | ${a.label} | \`${a.filename}\` | ${a.size ?? '—'} | ${a.sha256 ? `\`${a.sha256}\`` : '—'} | ${a.status} |`
  ),
  '',
  '`url` fields in `releases.json` are intentionally blank — fill them in once',
  'the files are uploaded to hosting. Artifacts marked *pending* must be built',
  'on their native platform (`npm run dist:mac` / `dist:win` / `dist:linux`),',
  'then re-run `npm run release:manifest` on a machine that has all files in `dist/`.',
  '',
];
fs.writeFileSync(path.join(outDir, 'RELEASES.md'), lines.join('\n'));

console.log(`[releases] wrote releases/releases.json + RELEASES.md (${built.length} built, ${artifacts.length - built.length} pending)`);
