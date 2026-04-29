// Resolves runtime paths whether running via `node src/index.js` or as a packaged .exe.
import path from 'node:path';
import fs from 'node:fs';

const isPackaged = typeof process.pkg !== 'undefined';
export const APP_ROOT = isPackaged ? path.dirname(process.execPath) : path.resolve('.');

export function appPath(...parts) {
  return path.join(APP_ROOT, ...parts);
}

// Settings live in:
//   - dev mode:      <project-root>/settings    (convenient when iterating with npm start)
//   - packaged mode: %LOCALAPPDATA%\SkyrimRPBot\settings  (so updates don't lose them)
export const SETTINGS_DIR = (() => {
  if (!isPackaged) return path.join(APP_ROOT, 'settings');
  const localAppData = process.env.LOCALAPPDATA || process.env.APPDATA || process.env.TEMP || APP_ROOT;
  return path.join(localAppData, 'SkyrimRPBot', 'settings');
})();

// One-time migration: if the user's old version stored settings next to the .exe,
// copy them into the new global location so they don't have to re-run setup.
export function migrateLegacySettings() {
  if (!isPackaged) return;
  const legacyDir = path.join(APP_ROOT, 'settings');
  if (legacyDir === SETTINGS_DIR) return;
  if (!fs.existsSync(legacyDir)) return;
  if (!fs.existsSync(SETTINGS_DIR)) fs.mkdirSync(SETTINGS_DIR, { recursive: true });
  let migrated = 0;
  for (const file of ['config.json', 'tokens.json']) {
    const src = path.join(legacyDir, file);
    const dst = path.join(SETTINGS_DIR, file);
    if (fs.existsSync(src) && !fs.existsSync(dst)) {
      try { fs.copyFileSync(src, dst); migrated++; } catch (_e) { /* ignore */ }
    }
  }
  if (migrated > 0) {
    console.log(`[migration] copied ${migrated} settings file(s) from ${legacyDir} to ${SETTINGS_DIR}`);
  }
}
