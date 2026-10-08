// electron-builder afterPack hook.
//
// Bypasses the winCodeSign/rcedit extraction that electron-builder normally runs
// on packaged .exe resources. That path fails on this machine without Windows
// Developer Mode (winCodeSign tarball contains POSIX symlinks that refuse to
// extract). electron-builder.yml therefore sets `signAndEditExecutable: false`,
// which also skips icon injection — leaving the main app .exe with Electron's
// default icon.
//
// This hook runs after electron-builder has assembled release/win-unpacked/ but
// before NSIS packages the installer. It patches the main app exe in place using
// the standalone `rcedit` npm package (which ships rcedit.exe binaries directly,
// no winCodeSign extraction required). NSIS then wraps the now-correctly-iconed
// exe into the installer — so the installed app shows our icon, not Electron's.

import { resolve, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// rcedit@5 ships as CJS with a named export; pull it via createRequire +
// destructuring because the default ESM interop returns the module namespace.
const require = createRequire(import.meta.url);
const { rcedit } = require('rcedit');

/** @param {import('electron-builder').AfterPackContext} context */
export default async function afterPack(context) {
  // Guard: only act on the Windows packager (we're Windows-only today).
  if (context.electronPlatformName !== 'win32') return;

  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const exePath = join(context.appOutDir, exeName);

  if (!existsSync(exePath)) {
    throw new Error(`[afterPack] expected packaged exe at ${exePath} but it was not found`);
  }

  const iconPath = resolve(process.cwd(), 'resources', 'icon.ico');
  if (!existsSync(iconPath)) {
    throw new Error(`[afterPack] icon not found at ${iconPath}`);
  }

  console.log(`[afterPack] rcedit --set-icon on ${exePath}`);
  await rcedit(exePath, { icon: iconPath });
  // Fail the build if any source icon image is missing from the patched exe.
  const ico = readFileSync(iconPath);
  const exe = readFileSync(exePath);
  const count = ico.readUInt16LE(4);
  if (count === 0) throw new Error('[afterPack] icon has no images');
  for (let i = 0; i < count; i++) {
    const entry = 6 + i * 16;
    const size = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    if (size === 0 || offset + size > ico.length ||
        !exe.includes(ico.subarray(offset, offset + size))) {
      throw new Error(`[afterPack] packaged exe is missing icon image ${i}`);
    }
  }
  console.log(`[afterPack] icon injected`);
}
