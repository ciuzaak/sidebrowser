/**
 * generate-app-icon.mjs
 * One-shot script to emit a placeholder Windows app icon (resources/icon.ico).
 * Uses only Node built-ins (zlib + fs) — no native deps, no new packages.
 *
 * Design: same sky-500 background + white pixel-art 'S' glyph as the tray icons,
 * scaled up to 256×256. A single 256×256 entry satisfies the ICO minimum for
 * electron-builder's Windows NSIS packager (Task 2 of M8).
 *
 * ICO format (PNG-embedded variant, supported by Windows Vista+):
 *   ICONDIR  header   6 bytes  { reserved=0, type=1, count=N }
 *   ICONDIRENTRY × N  16 bytes { w, h, colorCount, reserved, planes, bitCount,
 *                                bytesInRes, imageOffset }
 *   PNG data × N      full PNG file bytes (not raw BMP)
 *   width/height field = 0 means 256 in the ICO spec.
 *
 * Usage: node scripts/generate-app-icon.mjs
 *
 * Placeholder note: icon design is intentionally minimal for M8 packaging.
 * Replace with a polished asset in v1.1.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../resources');
fs.mkdirSync(outDir, { recursive: true });

// ── PNG encoder (verbatim from generate-tray-icons.mjs) ──────────────────────

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

// ── Pixel art 'S' glyph ───────────────────────────────────────────────────────
// Reference 5×7 grid (1 = white foreground, 0 = background):
const S_5x7 = [
  [0,1,1,1,0],
  [1,0,0,0,1],
  [1,0,0,0,0],
  [0,1,1,1,0],
  [0,0,0,0,1],
  [1,0,0,0,1],
  [0,1,1,1,0],
];

const BG = { r: 0x0e, g: 0xa5, b: 0xe9, a: 255 }; // sky-500
const FG = { r: 255,  g: 255,  b: 255,  a: 255 }; // white

function buildPixels(size) {
  const pixels = Array.from({ length: size * size }, () => ({ ...BG }));

  // Scale the 5×7 glyph to ~50% of icon width
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

// ── ICO encoder ───────────────────────────────────────────────────────────────

/**
 * Wrap an array of { size, pngData } entries into a valid .ico buffer.
 * Uses the PNG-embedded ICO variant (Vista+): each image entry is a full PNG
 * file, not a raw BMP DIB. Width/height = 0 in the dir entry encodes 256.
 */
function encodeIco(entries) {
  const count = entries.length;

  // ICONDIR: 6 bytes
  const iconDir = Buffer.alloc(6);
  iconDir.writeUInt16LE(0, 0); // reserved
  iconDir.writeUInt16LE(1, 2); // type = 1 (ICO)
  iconDir.writeUInt16LE(count, 4);

  // ICONDIRENTRY: 16 bytes × N
  // All image data starts after the header block: 6 + 16 * N bytes in.
  const dirEntrySize = 16;
  const dataOffset = 6 + dirEntrySize * count;

  const dirEntries = [];
  let currentOffset = dataOffset;

  for (const { size, pngData } of entries) {
    const entry = Buffer.alloc(dirEntrySize);
    entry[0] = size === 256 ? 0 : size; // width  (0 = 256)
    entry[1] = size === 256 ? 0 : size; // height (0 = 256)
    entry[2] = 0;                        // colorCount (0 = no palette)
    entry[3] = 0;                        // reserved
    entry.writeUInt16LE(1, 4);           // planes
    entry.writeUInt16LE(32, 6);          // bitCount (32-bit RGBA)
    entry.writeUInt32LE(pngData.length, 8);  // bytesInRes
    entry.writeUInt32LE(currentOffset, 12);  // imageOffset
    dirEntries.push(entry);
    currentOffset += pngData.length;
  }

  return Buffer.concat([
    iconDir,
    ...dirEntries,
    ...entries.map(e => e.pngData),
  ]);
}

// ── Generate ──────────────────────────────────────────────────────────────────

const SIZE = 256;
const pixels = buildPixels(SIZE);
const pngData = encodePng(SIZE, SIZE, pixels);
const icoData = encodeIco([{ size: SIZE, pngData }]);

const outPath = path.join(outDir, 'icon.ico');
fs.writeFileSync(outPath, icoData);

console.log(`wrote ${outPath}`);
console.log(`  PNG payload: ${pngData.length} bytes`);
console.log(`  ICO total:   ${icoData.length} bytes`);
console.log(`  Magic bytes: ${[...icoData.slice(0, 4)].map(b => b.toString(16).padStart(2, '0')).join(' ')} (expect 00 00 01 00)`);
console.log('Done.');
