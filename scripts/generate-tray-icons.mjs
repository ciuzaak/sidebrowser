/**
 * generate-tray-icons.mjs
 * One-shot script to emit placeholder tray icons for M7.
 * Uses only Node built-ins (zlib + fs) — no native deps, no new packages.
 *
 * Design: solid #0ea5e9 (sky-500) background with a white centred 'S' glyph
 * rendered as a simple pixel-art pattern. Sizes: 16×16, 24×24, 32×32.
 *
 * Usage: node scripts/generate-tray-icons.mjs
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../resources/tray');
fs.mkdirSync(outDir, { recursive: true });

// ── PNG encoder ──────────────────────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xffffffff;
  const table = crc32.table ?? (crc32.table = buildCrcTable());
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}
function buildCrcTable() {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crcBuf]);
}

function encodePng(width, height, rgbaRows) {
  // Build raw scanlines with filter byte 0 (None) prepended
  const scanlines = Buffer.alloc((1 + width * 4) * height);
  for (let y = 0; y < height; y++) {
    const base = y * (1 + width * 4);
    scanlines[base] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const px = rgbaRows[y * width + x]; // { r, g, b, a }
      scanlines[base + 1 + x * 4 + 0] = px.r;
      scanlines[base + 1 + x * 4 + 1] = px.g;
      scanlines[base + 1 + x * 4 + 2] = px.b;
      scanlines[base + 1 + x * 4 + 3] = px.a;
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const deflated = zlib.deflateSync(scanlines, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflated),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Pixel art 'S' glyphs (on a grid, scaled to fit each icon size) ───────────
// Reference 5×7 grid for 'S' (1 = white, 0 = bg):
const S_5x7 = [
  [0,1,1,1,0],
  [1,0,0,0,1],
  [1,0,0,0,0],
  [0,1,1,1,0],
  [0,0,0,0,1],
  [1,0,0,0,1],
  [0,1,1,1,0],
];

// Sky-500
const BG = { r: 0x0e, g: 0xa5, b: 0xe9, a: 255 };
const FG = { r: 255, g: 255, b: 255, a: 255 };

function buildPixels(size) {
  const pixels = Array.from({ length: size * size }, () => ({ ...BG }));

  // Scale the 5×7 glyph to ~50% of icon size
  const cellW = Math.max(1, Math.floor((size * 0.5) / 5));
  const cellH = Math.max(1, Math.floor((size * 0.6) / 7));
  const glyphW = cellW * 5;
  const glyphH = cellH * 7;
  const offX = Math.floor((size - glyphW) / 2);
  const offY = Math.floor((size - glyphH) / 2);

  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 5; gx++) {
      if (!S_5x7[gy][gx]) continue;
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const px = offX + gx * cellW + dx;
          const py = offY + gy * cellH + dy;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            pixels[py * size + px] = { ...FG };
          }
        }
      }
    }
  }

  return pixels;
}

// ── Generate ──────────────────────────────────────────────────────────────────

for (const size of [16, 24, 32]) {
  const pixels = buildPixels(size);
  const png = encodePng(size, size, pixels);
  const outPath = path.join(outDir, `tray-${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${size}×${size}, ${png.length} bytes)`);
}

console.log('Done.');
