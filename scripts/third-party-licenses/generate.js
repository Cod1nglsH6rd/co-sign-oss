/**
 * Licence-list generator: reads package-lock.json, groups packages by
 * licence and flags the ones whose licence may not fit an MIT project.
 *
 * collect(lockJson, {installedRoot}) returns [{name, version, license, dev}]
 * for every package in the lockfile except the root; dev is true only when
 * the lockfile marks the package dev: true. The same name@version installed at
 * several paths is one entry. When the lock entry has no licence and
 * installedRoot is given, the licence is read from installedRoot/<lock path>/
 * package.json if that file exists with the same version; platform binaries
 * (entries with os or cpu) are never read, so the output is the same on every
 * machine. Otherwise license is null.
 *
 * edgeImports(rootDir, confirmed) returns [{fn, name, version, license,
 * proof, confirmed, confirmAt}] for every import in
 * supabase/functions/<fn>/deno.json that names a package and version (npm:,
 * esm.sh, deno.land/std). license comes from rootDir/node_modules/<name>/
 * package.json when that is the same name@version (proof is that path), else
 * from confirmed['name@version'] ({license, source, checked}; defaults to
 * edge-confirmed.json next to this script; confirmed is {source, checked}).
 * Otherwise license is null and confirmAt is the package's repository from an
 * installed copy of another version, or its registry page.
 *
 * render(entries, reviewed, assets, edge) returns Markdown: a note under the
 * title saying whether any GPL or AGPL package (LGPL does not count) is
 * present (with edge imports: in the Node application, plus any edge package
 * proven GPL or AGPL and the edge packages still to confirm), a Runtime
 * and a Dev-only section, each with a heading per licence listing
 * name@version wrapped to about 800 characters per line, then a Flagged
 * section. reviewed maps a
 * package name (or name@version) to the reason it was accepted; a flagged
 * package without one shows NOT REVIEWED. A last 'Bundled assets' section
 * renders assets ({assets: [{path, license, source}], notes: [...]}), the
 * files under public/ with their source and licence; it defaults to
 * assets.json next to this script. With edge imports, an 'Edge functions'
 * section comes after Flagged.
 *
 * generate(rootDir) is the whole file for a checkout: the real lockfile read
 * against its node_modules, reviewed.json, assets.json and the edge imports.
 *
 * check(entries, reviewed) returns {output, code}: the NOT REVIEWED packages
 * and exit code 1 when there are any.
 *
 * Usage: node scripts/third-party-licenses/generate.js [--check]
 * Without --check the Markdown goes to stdout. Reviewed reasons are read from
 * reviewed.json next to this script when that file exists.
 */

const FLAG_PATTERN = /GPL|SSPL|FSL|BUSL|CC-BY|MPL|Python-2\.0|UNLICENSED/i;
// GPL or AGPL as a whole word; LGPL does not match.
const GPL_PATTERN = /\bA?GPL\b/i;
const NOT_REVIEWED = 'NOT REVIEWED';
const NO_LICENCE = 'No licence';
// Wide enough that the list for the current lockfile stays under 300 lines.
const WIDTH = 800;

const fs = require('fs');
const nodePath = require('path');

function licenceOf(pkg) {
  const l = pkg.license;
  if (typeof l === 'string' && l.trim()) return l.trim();
  if (l && typeof l.type === 'string' && l.type.trim()) return l.type.trim();
  // The old "licenses": [{type}] form, as in some installed package.json files.
  if (Array.isArray(pkg.licenses)) {
    const types = pkg.licenses.map((x) => (typeof x === 'string' ? x : x && x.type)).filter(Boolean);
    if (types.length) return types.length === 1 ? types[0] : `(${types.join(' OR ')})`;
  }
  return null;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function installedLicence(installedRoot, lockPath, pkg) {
  if (!installedRoot || pkg.os || pkg.cpu) return null;
  const installed = readJson(nodePath.join(installedRoot, lockPath, 'package.json'));
  if (!installed || installed.version !== pkg.version) return null;
  return licenceOf(installed);
}

function collect(lockJson, options = {}) {
  const packages = (lockJson && lockJson.packages) || {};
  const byId = new Map();
  for (const [path, pkg] of Object.entries(packages)) {
    if (path === '') continue;
    const name = pkg.name || path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const license = licenceOf(pkg) || installedLicence(options.installedRoot, path, pkg);
    const entry = { name, version: pkg.version || '', license, dev: pkg.dev === true };
    const id = `${entry.name}@${entry.version}`;
    const seen = byId.get(id);
    if (!seen) byId.set(id, entry);
    else if (!entry.dev) seen.dev = false;
  }
  return [...byId.values()];
}

function isFlagged(entry) {
  return !entry.license || FLAG_PATTERN.test(entry.license);
}

function reasonFor(entry, reviewed) {
  const map = reviewed || {};
  return map[`${entry.name}@${entry.version}`] || map[entry.name] || NOT_REVIEWED;
}

function wrap(items) {
  const lines = [];
  let line = '';
  for (const item of items) {
    if (line && line.length + 1 + item.length > WIDTH) {
      lines.push(line);
      line = item;
    } else {
      line = line ? `${line} ${item}` : item;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function renderSection(title, entries) {
  const out = [`## ${title}`, ''];
  const groups = new Map();
  for (const e of entries) {
    const key = e.license || NO_LICENCE;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(`${e.name}@${e.version}`);
  }
  if (groups.size === 0) out.push('None.', '');
  for (const key of [...groups.keys()].sort()) {
    out.push(`### ${key}`, '', ...wrap(groups.get(key).sort()), '');
  }
  return out;
}

function listAnd(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function gplNote(entries, edge = []) {
  const gpl = entries.filter((e) => e.license && GPL_PATTERN.test(e.license));
  if (!edge.length) {
    if (gpl.length === 0) return 'No GPL or AGPL package is present.';
    return `GPL or AGPL packages present: ${gpl.map((e) => `${e.name}@${e.version} (${e.license})`).join(', ')}.`;
  }
  const parts = [
    gpl.length === 0
      ? 'The Node application (package-lock.json) has no GPL or AGPL package.'
      : `GPL or AGPL packages in the Node application: ${gpl.map((e) => `${e.name}@${e.version} (${e.license})`).join(', ')}.`,
  ];
  for (const e of edge.filter((x) => x.license && GPL_PATTERN.test(x.license))) {
    const family = /\bAGPL\b/i.test(e.license) ? 'AGPL' : 'GPL';
    parts.push(
      `The optional edge function ${e.fn} imports ${e.name}@${e.version}, which is ${e.license}, so anyone who deploys that function takes on the ${family}'s terms for it.`
    );
  }
  const open = edge.filter((x) => !x.license).map((x) => `${x.name}@${x.version} (${x.fn})`);
  if (open.length) {
    parts.push(
      `The optional edge functions are listed under Edge functions; the licence${open.length > 1 ? 's' : ''} of ${listAnd(open)} ${open.length > 1 ? 'are' : 'is'} still to be confirmed there.`
    );
  } else {
    parts.push('Every edge-function import is listed under Edge functions.');
  }
  return parts.join(' ');
}

function loadAssets() {
  const assetsPath = nodePath.join(__dirname, 'assets.json');
  return fs.existsSync(assetsPath) ? JSON.parse(fs.readFileSync(assetsPath, 'utf8')) : null;
}

// An import specifier from a deno.json to {name, version, registry}, or null.
function parseSpecifier(spec) {
  if (typeof spec !== 'string') return null;
  const pkg = (s) => {
    const m = /^((?:@[^/@]+\/)?[^/@]+)@([^/?#]+)/.exec(s);
    return m ? { name: m[1], version: m[2], registry: 'npm' } : null;
  };
  if (spec.startsWith('npm:')) return pkg(spec.slice(4));
  const esm = /^https:\/\/esm\.sh\/(.+)$/.exec(spec);
  if (esm) return pkg(esm[1]);
  const std = /^https:\/\/deno\.land\/std@([^/]+)\//.exec(spec);
  if (std) return { name: 'Deno std', version: std[1], registry: 'deno-std' };
  return null;
}

function repositoryOf(pkg) {
  const r = pkg && pkg.repository;
  const url = typeof r === 'string' ? r : r && r.url;
  if (!url) return null;
  return url.replace(/^git\+/, '').replace(/\.git$/, '');
}

function loadConfirmed() {
  return readJson(nodePath.join(__dirname, 'edge-confirmed.json')) || {};
}

function edgeImports(rootDir, confirmed = loadConfirmed()) {
  const fnDir = nodePath.join(rootDir, 'supabase', 'functions');
  if (!fs.existsSync(fnDir)) return [];
  const out = [];
  for (const fn of fs.readdirSync(fnDir).sort()) {
    const deno = readJson(nodePath.join(fnDir, fn, 'deno.json'));
    if (!deno || !deno.imports) continue;
    for (const spec of Object.values(deno.imports)) {
      const p = parseSpecifier(spec);
      if (!p) continue;
      const entry = { fn, name: p.name, version: p.version, license: null };
      const proofRel = `node_modules/${p.name}/package.json`;
      const installed = p.registry === 'npm' ? readJson(nodePath.join(rootDir, proofRel)) : null;
      // Only an entry for this exact name@version counts, so a version bump
      // in deno.json asks for a new check instead of keeping the old answer.
      const known = (confirmed || {})[`${p.name}@${p.version}`];
      if (installed && installed.version === p.version && licenceOf(installed)) {
        entry.license = licenceOf(installed);
        entry.proof = proofRel;
      } else if (known && known.license && known.source && known.checked) {
        entry.license = known.license;
        entry.confirmed = { source: known.source, checked: known.checked };
      } else if (p.registry === 'npm') {
        entry.confirmAt = repositoryOf(installed) || `https://www.npmjs.com/package/${p.name}/v/${p.version}`;
      } else {
        entry.confirmAt = `https://deno.land/std@${p.version}`;
      }
      out.push(entry);
    }
  }
  return out.sort((a, b) => a.fn.localeCompare(b.fn) || a.name.localeCompare(b.name));
}

function renderEdge(edge) {
  const out = ['## Edge functions', ''];
  out.push(
    'Packages imported by the optional Supabase edge functions (supabase/functions/*/deno.json). They are not in package-lock.json and are fetched by Deno when a function is deployed. A licence is stated where the Node application installs the same version, or where scripts/third-party-licenses/edge-confirmed.json records it for that exact version with its source and the date it was checked.',
    ''
  );
  for (const e of edge) {
    const id = `${e.name}@${e.version} (${e.fn})`;
    if (e.license && e.proof) out.push(`- ${id}: ${e.license}, from ${e.proof}`);
    else if (e.license && e.confirmed) out.push(`- ${id}: ${e.license}, confirmed at ${e.confirmed.source} on ${e.confirmed.checked}`);
    else out.push(`- ${id}: licence to confirm at ${e.confirmAt}`);
  }
  out.push('');
  return out;
}

function renderAssets(assets) {
  const out = ['## Bundled assets', ''];
  for (const note of assets.notes || []) out.push(note, '');
  const list = assets.assets || [];
  if (list.length === 0) out.push('None.');
  for (const a of list) out.push(`- ${a.path} (${a.license}): ${a.source}`);
  out.push('');
  return out;
}

function render(entries, reviewed, assets = loadAssets(), edge = []) {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const out = ['# Third-party licences', '', gplNote(sorted, edge || []), ''];
  out.push(...renderSection('Runtime', sorted.filter((e) => !e.dev)));
  out.push(...renderSection('Dev-only', sorted.filter((e) => e.dev)));
  out.push('## Flagged', '');
  const flagged = sorted.filter(isFlagged);
  if (flagged.length === 0) out.push('None.');
  for (const e of flagged) {
    out.push(`- ${e.name}@${e.version} (${e.license || NO_LICENCE}): ${reasonFor(e, reviewed)}`);
  }
  out.push('');
  if (edge && edge.length) out.push(...renderEdge(edge));
  if (assets) out.push(...renderAssets(assets));
  return out.join('\n');
}

function check(entries, reviewed) {
  const missing = entries
    .filter((e) => isFlagged(e) && reasonFor(e, reviewed) === NOT_REVIEWED)
    .map((e) => `${e.name}@${e.version} (${e.license || NO_LICENCE}): ${NOT_REVIEWED}`)
    .sort();
  return { output: missing.join('\n'), code: missing.length ? 1 : 0 };
}

function realInputs(rootDir) {
  const lockJson = JSON.parse(fs.readFileSync(nodePath.join(rootDir, 'package-lock.json'), 'utf8'));
  const reviewedPath = nodePath.join(__dirname, 'reviewed.json');
  const reviewed = fs.existsSync(reviewedPath) ? JSON.parse(fs.readFileSync(reviewedPath, 'utf8')) : {};
  return { entries: collect(lockJson, { installedRoot: rootDir }), reviewed };
}

function generate(rootDir = nodePath.join(__dirname, '..', '..')) {
  const { entries, reviewed } = realInputs(rootDir);
  return render(entries, reviewed, loadAssets(), edgeImports(rootDir));
}

module.exports = { collect, render, check, edgeImports, parseSpecifier, generate };

if (require.main === module) {
  const rootDir = nodePath.join(__dirname, '..', '..');
  if (process.argv.includes('--check')) {
    const { entries, reviewed } = realInputs(rootDir);
    const result = check(entries, reviewed);
    if (result.output) console.log(result.output);
    process.exit(result.code);
  }
  process.stdout.write(generate(rootDir));
}
