// Render the 3D landslide scenario (landslide3d.html) frame by frame in headless
// Chromium. Needs `landslide.py --3d` first; then `landslide.py --compose3d`.
//
//   cd tools/media && node render_landslide3d.mjs [--only 0,200,449]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../assets/plates');
const frames = path.join(here, 'work/landslide_3d');
const limit = process.argv.includes('--frames') ? +process.argv[process.argv.indexOf('--frames') + 1] : Infinity;
// --only 0,180,359: render just these frames (previews), no encoding
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',').map(Number) : null;

const server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: here, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.error('page error', e.message));
  await page.goto('http://127.0.0.1:8766/landslide3d.html');
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  console.log('renderer', await page.evaluate(() => window.renderer));
  const n = Math.min(await page.evaluate(() => window.frameCount), limit);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (only && !only.includes(i)) continue;
    await page.evaluate(async (k) => await window.renderFrame(k), i);
    await page.locator('canvas').screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.png') });
    if (i % 30 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();
  server.kill();
  console.log('done');
} finally {
  server.kill();
}
