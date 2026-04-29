// Generate an .ico from assets/images/Quest Door.png for the .exe build.
// Run: npm run build:icon
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import Jimp from 'jimp';
import pngToIco from 'png-to-ico';

const ROOT = path.resolve('.');
const SRC = path.join(ROOT, 'assets', 'images', 'Quest Door.png');
const OUT_DIR = path.join(ROOT, 'build');
const OUT = path.join(OUT_DIR, 'app.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Reading ${SRC}`);
  const src = await Jimp.read(SRC);

  // pad to square (1:1) on a transparent canvas, centered
  const w = src.bitmap.width;
  const h = src.bitmap.height;
  const side = Math.max(w, h);
  const square = new Jimp(side, side, 0x00000000);
  square.composite(src, Math.floor((side - w) / 2), Math.floor((side - h) / 2));

  const buffers = [];
  for (const size of SIZES) {
    const resized = square.clone().resize(size, size);
    const buf = await resized.getBufferAsync(Jimp.MIME_PNG);
    buffers.push(buf);
  }
  const ico = await pngToIco(buffers);
  await writeFile(OUT, ico);
  console.log(`Wrote ${OUT} (${ico.length} bytes, sizes: ${SIZES.join(', ')})`);
}

main().catch((err) => {
  console.error('icon build failed:', err);
  process.exit(1);
});
