/* Upload fixture files to a live Cô Sign instance and record document ids.
 *
 * Usage:
 *   E2E_EMAIL=... E2E_PASSWORD=... node upload-fixtures.js [file1 file2 ...]
 * With no args, uploads every known fixture file present in the directory.
 * Writes docids.json ({ filename: documentId }).
 *
 * Sandbox note: behind a TLS-intercepting egress proxy, launch args need
 * PLAYWRIGHT_PROXY=1 to route Chromium through HTTPS_PROXY with TLS 1.2.
 */
const { chromium } = require('playwright');
const fs = require('fs');

// The instance to upload to: your own, such as the Docker stack's gateway.
const BASE_URL = process.env.COSIGN_BASE_URL || 'http://localhost:3000';
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD');
  process.exit(1);
}

const KNOWN = [
  'underscore-form.pdf', 'labelvalue-form.pdf', 'acroform-form.pdf', 'form-photo.png',
  'photo-skew.png', 'photo-shadow.jpg', 'photo-lowres.jpg', 'scanned-3page.pdf',
  'comb-form.pdf', 'lease.pdf', 'i-9.pdf', 'handwriting-photo.png', 'acroform2-form.pdf',
  'checkbox-glyph-form.pdf', 'landscape-form.pdf', 'encrypted-owner.pdf', 'encrypted-user.pdf',
  'mixed-form.pdf', 'table-form.pdf', 'photocopy.jpg',
];
const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : KNOWN.filter(f => fs.existsSync(f));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

(async () => {
  const launch = { };
  if (process.env.PLAYWRIGHT_PROXY) {
    launch.proxy = { server: process.env.HTTPS_PROXY };
    launch.args = ['--ssl-version-max=tls1.2'];
  }
  if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  const browser = await chromium.launch(launch);
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  page.on('dialog', (d) => d.accept());
  await page.goto(`${BASE_URL}/en/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
  await page.waitForTimeout(7000);
  const ids = {};
  for (const f of FILES) {
    try {
      await page.locator('input[type="file"]').setInputFiles([f]);
      await page.waitForURL('**/documents/**', { timeout: 120000 });
      ids[f] = page.url().match(/documents\/([0-9a-f-]+)/)?.[1];
      log('uploaded', f, '->', ids[f]);
      await page.waitForTimeout(5000);
    } catch (e) {
      ids[f] = { error: e.message.split('\n')[0] };
      log('FAILED', f, e.message.split('\n')[0]);
    }
    await page.goto(`${BASE_URL}/en/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  }
  fs.writeFileSync('docids.json', JSON.stringify(ids, null, 1));
  log('done —', Object.keys(ids).length, 'files');
  await browser.close();
})().catch(e => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });
