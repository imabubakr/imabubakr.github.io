// Render the social preview image (assets/img/og.png, 1200x630) from the live hero.
//
//   python3 -m http.server 8000            # in the repo root
//   npm i --no-save playwright && npx playwright install chromium   # once, in tools/og
//   node tools/og/make_og.mjs http://localhost:8000/ assets/img/og.png
//
// Then shrink it to a 256-colour PNG (keeps the orange coordinates):
//   python3 -c "from PIL import Image; im=Image.open('assets/img/og.png').convert('RGB'); \
//     im.quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save('assets/img/og.png', optimize=True)"
import { chromium } from 'playwright';

const [, , url = 'http://localhost:8000/', out = 'assets/img/og.png'] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, colorScheme: 'light' });
await page.goto(url, { waitUntil: 'networkidle' });
// Hero only: hide the nav and make the hero exactly the image height.
await page.addStyleTag({ content: '.site-nav{display:none!important} .sheet{--hero-h:630px!important}' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
