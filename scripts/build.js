// Build the Skyrim RP Bot Windows .exe distribution.
// Output: dist/SkyrimRPBot/  (exe + overlay + assets, ready to zip and ship)
//
// Pipeline: esbuild bundles ESM into a single CJS file, then pkg compiles it into the .exe.
//
// Run: npm run build
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, cp, rm, writeFile, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import esbuild from 'esbuild';

const run = promisify(exec);
const ROOT = path.resolve('.');
const STAGE = path.join(ROOT, 'dist', 'SkyrimRPBot');
const BUNDLE = path.join(ROOT, 'build', 'bundle.cjs');

async function main() {
  // 1. clean stage
  await rm(path.join(ROOT, 'dist'), { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });
  await mkdir(path.dirname(BUNDLE), { recursive: true });

  // 2a. bundle ESM source → single CJS file with esbuild (pkg's native ESM support is flaky)
  console.log('▸ Bundling source with esbuild...');
  await esbuild.build({
    entryPoints: ['src/index.js'],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    outfile: BUNDLE,
    minify: false,
    sourcemap: false,
    external: []
  });

  // 2b. compile bundle → exe via @yao-pkg/pkg
  console.log('▸ Building SkyrimRPBot.exe (this may take a minute)...');
  const pkgArgs = [
    `"${BUNDLE}"`,
    '--targets', 'node20-win-x64',
    '--output', `"${path.join(STAGE, 'SkyrimRPBot.exe')}"`
  ].join(' ');
  const { stdout, stderr } = await run(`npx @yao-pkg/pkg ${pkgArgs}`, { maxBuffer: 50 * 1024 * 1024 });
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);

  // 3. copy runtime assets
  console.log('▸ Copying overlay + assets...');
  await cp(path.join(ROOT, 'overlay'), path.join(STAGE, 'overlay'), { recursive: true });
  await cp(path.join(ROOT, 'assets'), path.join(STAGE, 'assets'), { recursive: true });

  // 5. include the README the user sees in the zip
  const pkgJson = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const readme = `# Skyrim RP Bot v${pkgJson.version}

## Quick start
1. Double-click **SkyrimRPBot.exe**.
2. A setup window opens in your browser. Follow the 5 steps (about 3 minutes).
3. Add a Browser Source in OBS: URL **http://localhost:3000/overlay/**, size **1920 x 1080**.

## Files
- SkyrimRPBot.exe   the bot
- overlay/          overlay HTML/CSS/JS (edit if you want to customize the look)
- assets/           fonts, images, sounds (edit to retheme)
- settings/         created on first run (config + tokens; do not share)

## Updating
Click the cogwheel in the dashboard, then "Check for Updates".
`;
  await writeFile(path.join(STAGE, 'README.txt'), readme);

  // 6. write version stamp
  await writeFile(path.join(STAGE, 'VERSION.txt'), `${pkgJson.version}\n`);

  const exeStat = await stat(path.join(STAGE, 'SkyrimRPBot.exe'));
  console.log(`\n✓ Build complete: ${STAGE}`);
  console.log(`  SkyrimRPBot.exe  ${(exeStat.size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  Zip the folder to ship it.`);
}

main().catch((err) => {
  console.error('build failed:', err);
  process.exit(1);
});
