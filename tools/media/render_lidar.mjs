// Render the point-cloud fly-around (lidar.html) frame by frame in headless
// Chromium and encode it. Needs work/lidar_*.bin from prep_lidar.py.
//
//   cd tools/media && node render_lidar.mjs [--frames N]
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '../../assets/plates');
const frames = path.join(here, 'work/lidar_frames');
const limit = process.argv.includes('--frames') ? +process.argv[process.argv.indexOf('--frames') + 1] : Infinity;
// --only 0,180,359: render just these frames (previews), no encoding
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',').map(Number) : null;

const server = spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: here, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
try {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  page.on('pageerror', (e) => console.error('page error', e.message));
  await page.goto('http://127.0.0.1:8765/lidar.html');
  await page.waitForFunction(() => window.ready, null, { timeout: 120000 });
  console.log('renderer', await page.evaluate(() => window.renderer));
  const n = Math.min(await page.evaluate(() => window.frameCount), limit);
  rmSync(frames, { recursive: true, force: true });
  mkdirSync(frames, { recursive: true });
  const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    if (only && !only.includes(i)) continue;
    await page.evaluate((k) => window.renderFrame(k), i);
    await page.locator('canvas').screenshot({ path: path.join(frames, String(i).padStart(4, '0') + '.png') });
    if (i % 30 === 0) console.log(`frame ${i}/${n}  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await browser.close();
  if (only || limit !== Infinity) { server.kill(); process.exit(0); }
  // Point clouds are noise to a video codec (92 MB at CRF 34), so: 1280 px and a
  // fixed bitrate (two-pass VP9 3.5 Mbit/s, capped x264), about 5-6 MB each.
  const pat = path.join(frames, '%04d.png');
  const vf = 'scale=1280:-2:flags=lanczos';
  const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a], { stdio: 'inherit', cwd: path.join(here, 'work') });
  const vp9 = ['-framerate', '30', '-i', pat, '-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '3500k', '-row-mt', '1', '-an'];
  ff(...vp9, '-pass', '1', '-f', 'null', '/dev/null');
  ff(...vp9, '-pass', '2', path.join(out, 'lidar-flyaround.webm'));
  ff('-framerate', '30', '-i', pat, '-vf', vf, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-b:v', '4000k',
     '-maxrate', '5000k', '-bufsize', '8000k', '-movflags', '+faststart', '-an', path.join(out, 'lidar-flyaround.mp4'));
  // poster: written by build step in Python (ffmpeg here may lack a WebP encoder)
  execFileSync(process.env.HOME + '/miniforge3/envs/geoai/bin/python', ['-c',
    `from PIL import Image; Image.open(r'${path.join(frames, String(n - 1).padStart(4, '0') + '.png')}').convert('RGB').resize((720, 405), Image.LANCZOS).save(r'${path.join(out, 'lidar-flyaround-720.webp')}', quality=80, method=6)`]);
  console.log('done');
} finally {
  server.kill();
}
