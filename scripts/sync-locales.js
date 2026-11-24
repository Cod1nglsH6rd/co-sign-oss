#!/usr/bin/env node
/**
 * Sync locale bundles: locales/ is the single source of truth; public/locales/
 * is a generated copy that the document viewer fetches at runtime (client-side
 * `fetch('/locales/<code>.json')`). Keeping a hand-maintained second copy let
 * them drift (e.g. stale chat-consent copy shipped to the viewer), so this runs
 * automatically on `predev`/`prebuild`. Do not edit public/locales/ by hand.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'locales');
const outDir = path.join(root, 'public', 'locales');

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.json'));
let copied = 0;
let changed = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const dstPath = path.join(outDir, f);
  const prev = fs.existsSync(dstPath) ? fs.readFileSync(dstPath, 'utf8') : null;
  if (prev !== src) {
    fs.writeFileSync(dstPath, src);
    changed += 1;
  }
  copied += 1;
}

// --check mode: exit non-zero if anything was out of sync (for CI).
if (process.argv.includes('--check') && changed > 0) {
  console.error(`[sync-locales] ${changed} file(s) were out of sync (run "npm run sync:locales").`);
  process.exit(1);
}
console.log(`[sync-locales] ${copied} locale(s) synced to public/locales (${changed} updated).`);
