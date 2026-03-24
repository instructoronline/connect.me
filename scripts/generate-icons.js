#!/usr/bin/env node

/**
 * Text-only icon pipeline from the single SVG source of truth.
 *
 * Inputs:
 *   - assets/branding/connectme-logo.svg
 *
 * Expected outputs (not committed here):
 *   - assets/branding/generated/chrome/icon-16.png
 *   - assets/branding/generated/chrome/icon-32.png
 *   - assets/branding/generated/chrome/icon-48.png
 *   - assets/branding/generated/chrome/icon-128.png
 *   - assets/branding/generated/desktop/icon-64.png
 *   - assets/branding/generated/desktop/icon-128.png
 *   - assets/branding/generated/desktop/icon-256.png
 *   - assets/branding/generated/desktop/icon-512.png
 *   - assets/branding/generated/desktop/icon.icns (optional, macOS)
 *   - assets/branding/generated/desktop/icon.ico (optional, Windows)
 */

const { mkdirSync, existsSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = process.cwd();
const sourceSvg = join(root, 'assets/branding/connectme-logo.svg');
const chromeDir = join(root, 'assets/branding/generated/chrome');
const desktopDir = join(root, 'assets/branding/generated/desktop');

const chromeSizes = [16, 32, 48, 128];
const desktopSizes = [64, 128, 256, 512];

function hasCommand(command) {
  const which = spawnSync('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return which.status === 0;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

if (!existsSync(sourceSvg)) {
  console.error(`Missing master SVG: ${sourceSvg}`);
  process.exit(1);
}

mkdirSync(chromeDir, { recursive: true });
mkdirSync(desktopDir, { recursive: true });

const canUseInkscape = hasCommand('inkscape');
const canUseRsvg = hasCommand('rsvg-convert');

if (!canUseInkscape && !canUseRsvg) {
  console.error('No SVG rasterizer found. Install inkscape or librsvg (rsvg-convert).');
  console.error('Then rerun: node scripts/generate-icons.js');
  process.exit(1);
}

function renderPng(size, outPath) {
  if (canUseInkscape) {
    run('inkscape', [
      sourceSvg,
      `--export-filename=${outPath}`,
      `--export-width=${size}`,
      `--export-height=${size}`
    ]);
    return;
  }

  run('rsvg-convert', ['-w', String(size), '-h', String(size), sourceSvg, '-o', outPath]);
}

for (const size of chromeSizes) {
  renderPng(size, join(chromeDir, `icon-${size}.png`));
}

for (const size of desktopSizes) {
  renderPng(size, join(desktopDir, `icon-${size}.png`));
}

if (hasCommand('magick')) {
  run('magick', [
    join(desktopDir, 'icon-64.png'),
    join(desktopDir, 'icon-128.png'),
    join(desktopDir, 'icon-256.png'),
    join(desktopDir, 'icon-512.png'),
    join(desktopDir, 'icon.ico')
  ]);
} else {
  console.warn('Skipping icon.ico generation (ImageMagick `magick` not found).');
}

if (process.platform === 'darwin' && hasCommand('iconutil')) {
  console.warn('icon.icns generation is environment-specific; create an iconset and run iconutil if needed.');
}

console.log('Icon generation complete. PNG targets are ready under assets/branding/generated/.');
