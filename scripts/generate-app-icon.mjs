// generate-app-icon.mjs
// Pipeline: resources/icon-source.png → resources/icon.ico (multi-size Windows icon).
//
// Source PNG is expected to be RGBA (alpha channel already baked in) and
// square-ish. The pipeline is pure resize — no background removal — because
// the current source ships transparent corners and fills the frame edge-to-edge.
//
// If a future source needs background removal, restore the flood-fill pass
// from git history (commit 93bde7a).
//
// Rerun whenever resources/icon-source.png changes.

import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const SRC_PATH = resolve(ROOT, 'resources', 'icon-source.png');
const ICO_PATH = resolve(ROOT, 'resources', 'icon.ico');

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  console.log(`[icon] reading ${SRC_PATH}`);
  const meta = await sharp(SRC_PATH).metadata();
  console.log(`[icon] source: ${meta.width}x${meta.height}, ${meta.channels} channels, ${meta.hasAlpha ? 'has' : 'no'} alpha`);

  console.log(`[icon] generating sizes: ${ICON_SIZES.join(', ')}`);
  const resizedBuffers = await Promise.all(
    ICON_SIZES.map((size) =>
      sharp(SRC_PATH)
        .ensureAlpha()
        .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  );

  const icoBuffer = await pngToIco(resizedBuffers);
  writeFileSync(ICO_PATH, icoBuffer);
  console.log(`[icon] wrote ${ICO_PATH} (${(icoBuffer.length / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error('[icon] failed:', err);
  process.exit(1);
});
