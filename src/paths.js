// Resolves runtime paths whether running via `node src/index.js` or as a packaged .exe.
import path from 'node:path';

const isPackaged = typeof process.pkg !== 'undefined';
export const APP_ROOT = isPackaged ? path.dirname(process.execPath) : path.resolve('.');

export function appPath(...parts) {
  return path.join(APP_ROOT, ...parts);
}
