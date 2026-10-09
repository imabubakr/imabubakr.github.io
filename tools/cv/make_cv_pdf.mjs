// Render the complete CV as PDF (assets/cv/) from the print layout of both pages.
// The page itself shows a short CV; the PDF has everything (see .cv-full in site.css).
// Run after every CV change:
//
//   python3 -m http.server 8000            # in the repo root
//   cd tools/cv && npm i --no-save playwright && npx playwright install chromium   # once
//   node tools/cv/make_cv_pdf.mjs [http://localhost:8000/]
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = process.argv[2] || 'http://localhost:8000/';
const jobs = [
  { url: base, out: 'assets/cv/muhammad-abu-bakar-cv.pdf', title: 'Muhammad Abu Bakar – CV' },
  { url: base + 'de/', out: 'assets/cv/muhammad-abu-bakar-lebenslauf.pdf', title: 'Muhammad Abu Bakar – Lebenslauf' },
];

const browser = await chromium.launch();
for (const job of jobs) {
  const page = await browser.newPage({ colorScheme: 'light' });
  await page.goto(job.url, { waitUntil: 'networkidle' });
  await page.evaluate((t) => { document.title = t; return document.fonts.ready; }, job.title);
  await page.pdf({ path: path.join(root, job.out), preferCSSPageSize: true, printBackground: true });
  console.log('wrote', job.out);
  await page.close();
}
await browser.close();
