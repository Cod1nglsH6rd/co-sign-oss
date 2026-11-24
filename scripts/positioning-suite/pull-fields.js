/* Pull detected fields for the documents in docids.json via Supabase REST
 * (user-scoped, RLS-safe) and write detected-fields.json for score.py.
 *
 * Usage:
 *   E2E_EMAIL=... E2E_PASSWORD=... \
 *   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
 *   node pull-fields.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

// The instance the fixtures were uploaded to (upload-fixtures.js).
const BASE_URL = process.env.COSIGN_BASE_URL || 'http://localhost:3000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;
if (!EMAIL || !PASSWORD || !SUPABASE_URL || !ANON) {
  console.error('Set E2E_EMAIL, E2E_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(1);
}
const ids = JSON.parse(fs.readFileSync('docids.json', 'utf8'));

(async () => {
  const launch = {};
  if (process.env.PLAYWRIGHT_PROXY) {
    launch.proxy = { server: process.env.HTTPS_PROXY };
    launch.args = ['--ssl-version-max=tls1.2'];
  }
  if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
  const browser = await chromium.launch(launch);
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE_URL}/en/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard**', { timeout: 45000 });
  const token = await page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k.includes('auth-token')) return JSON.parse(localStorage.getItem(k)).access_token;
    }
    return null;
  });
  if (!token) throw new Error('no access token');
  const out = {};
  for (const [fname, id] of Object.entries(ids)) {
    if (typeof id !== 'string') continue; // failed upload entry
    const r = await page.request.get(
      `${SUPABASE_URL}/rest/v1/fields?document_id=eq.${id}&select=field_name,field_type,position&order=sort_order`,
      { headers: { apikey: ANON, Authorization: `Bearer ${token}` } }
    );
    out[fname] = await r.json();
    console.log(fname, out[fname].length, 'fields');
  }
  fs.writeFileSync('detected-fields.json', JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FATAL', e.message.split('\n')[0]); process.exit(1); });
