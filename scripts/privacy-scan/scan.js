/**
 * Privacy scanner text rules.
 *
 * scanText(text, opts) reports personal details as {line, rule, match}, with
 * 1-based line numbers. opts.hashes is a Set of lowercase hex SHA-256 hashes
 * of lowercase search terms, so the terms themselves never sit in the tree;
 * opts.terms is an optional list of plaintext terms (see termsFromEnv).
 *
 * Rules:
 *   hashed-term  a word, or two adjacent words split only by spaces, whose
 *                lowercase SHA-256 is in opts.hashes. Words may hold any
 *                letters, not only ASCII. A word is also checked piece by
 *                piece at its . _ ' - joins, so a hashed term inside
 *                Alice-Private's, www.private.example or alice-private.pdf
 *                is found
 *   email        an email address whose local part or exact domain hashes
 *                into opts.hashes
 *   phone        a North American phone number whose exchange is not 555
 *   term         a plaintext term, matched case-insensitively
 *
 * loadHashes(file) reads terms.json next to this file (or file) as a Set of
 * hashes, empty when it does not exist. scanTree(root, files, opts) uses
 * those hashes unless opts.hashes is given (opts.termsFile picks another
 * file), reads each relative path in files under root as UTF-8 and returns
 * {findings, errors}: findings are {path, line, rule},
 * and a path that is absolute, resolves outside root, or cannot be read is
 * never scanned but adds one {path, error} instead. formatResults turns that
 * into 'path:line rule', 'path: error: <reason>' and 'file: stale: rule'
 * lines, never printing the matched text. The phone rule is not applied to a
 * binary file (one holding a NUL byte), a minified vendor file (*.min.js,
 * *.min.mjs, such as the pdf.js workers) or a font; every other rule is.
 * checkKnownHits(findings, known) sets findings against
 * {file, rule, count} entries (loadKnownHits reads known-hits.json) and
 * returns {unlisted, stale}.
 *
 * main({root, files, termsFile, knownHitsFile, args, env, log}) is the CLI:
 * it scans files (default `git ls-files`) under root (default the repository
 * root) with the hashes from termsFile (default terms.json) and the terms
 * from env.PRIVATE_SCAN_TERMS (default process.env), leaves out the hits
 * knownHitsFile lists (default known-hits.json for the repository, none for
 * another root), prints each formatResults line through log (default
 * console.log), and returns 1 on any unlisted finding, error or stale known
 * hit, otherwise 0. args ['--root', dir] scans every file in dir instead.
 * Without terms.json (the public tree) it prints a note and still runs the
 * phone rule and PRIVATE_SCAN_TERMS; a missing default known-hits.json means
 * no known hits; a root that is not a git checkout of its own is walked.
 *
 * scanText is pure; only scanTree reads files, and only main touches env,
 * git or the console. Requiring this file has no side effects; the CLI runs
 * main only under require.main === module and sets process.exitCode.
 * Known limits are listed in README.md next to this file.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TERMS_FILE = path.join(__dirname, 'terms.json');
const KNOWN_HITS_FILE = path.join(__dirname, 'known-hits.json');

const sha256 = (s) => crypto.createHash('sha256').update(s.toLowerCase()).digest('hex');

// A word starts and ends with a letter or digit (any script) and may hold
// . _ ' - inside, so 'alice-private' and 'private.example' are one word each.
const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}._'-]*[\p{L}\p{N}\p{M}])?/gu;
// The letter-and-digit pieces of a word, between its . _ ' - joins.
const PIECE = /[\p{L}\p{N}\p{M}]+/gu;
// Local part, then a domain of two or more dot-separated labels.
const EMAIL = /([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
// Optional +1, area code (bare or in brackets), exchange, line number. The
// number may not follow a digit or + (with or without one separator) nor be
// followed by a digit (likewise), so no 3-3-4 run is cut out of an
// international or longer number such as +44 408 321 4567 or 408-321-4567-89.
// It may not touch a letter or _ either, so a digit run inside a hex hash or
// other token (deadbeef4083214567cafe) is not a phone number.
const PHONE =
  /(?<![\d+][-.\s]?)(?<![\p{L}\p{N}_])(?:\+?1[-.\s]?)?(?:\([2-9]\d\d\)|[2-9]\d\d)[-.\s]?([2-9]\d\d)[-.\s]?\d{4}(?![-.\s]?\d)(?![\p{L}_])/gu;

// Minified vendor files (the pdf.js workers) and fonts, where digit runs are
// code or glyph data, not phone numbers.
const VENDOR = /\.min\.(?:js|mjs|cjs|css)$|\.(?:ttf|otf|woff2?|eot)$/i;

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Comma-separated PRIVATE_SCAN_TERMS, trimmed, empty entries dropped.
function termsFromEnv(env) {
  return String((env && env.PRIVATE_SCAN_TERMS) || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// Every run of whole pieces in a word, as {text, first, last}: for
// "Alice-Private's" that is Alice, Alice-Private, Alice-Private's, Private,
// Private's and s.
function runs(word) {
  const pieces = [...word.matchAll(PIECE)].map((m) => [m.index, m.index + m[0].length]);
  const out = [];
  pieces.forEach(([start], i) => {
    for (let j = i; j < pieces.length; j++) {
      out.push({ text: word.slice(start, pieces[j][1]), first: i === 0, last: j === pieces.length - 1 });
    }
  });
  return out;
}

function hashedTerms(lineText, hashes) {
  const words = [...lineText.matchAll(WORD)].map((m) => ({
    start: m.index,
    end: m.index + m[0].length,
    runs: runs(m[0]),
  }));
  const hits = [];
  words.forEach((word, i) => {
    word.runs.forEach((r) => {
      if (hashes.has(sha256(r.text))) hits.push(r.text);
    });
    const next = words[i + 1];
    // A pair is the end of one word and the start of the next, with only
    // spaces between them.
    if (!next || !/^\s+$/.test(lineText.slice(word.end, next.start))) return;
    word.runs.filter((a) => a.last).forEach((a) => {
      next.runs.filter((b) => b.first).forEach((b) => {
        const pair = a.text + ' ' + b.text;
        if (hashes.has(sha256(pair))) hits.push(pair);
      });
    });
  });
  return hits;
}

function emailHits(lineText, hashes) {
  const hits = [];
  for (const m of lineText.matchAll(EMAIL)) {
    if (hashes.has(sha256(m[1])) || hashes.has(sha256(m[2]))) hits.push(m[0]);
  }
  return hits;
}

function phoneHits(lineText) {
  const hits = [];
  for (const m of lineText.matchAll(PHONE)) {
    if (m[1] !== '555') hits.push(m[0]);
  }
  return hits;
}

function termHits(lineText, terms) {
  const hits = [];
  for (const term of terms) {
    for (const m of lineText.matchAll(new RegExp(escapeRegExp(term), 'gi'))) hits.push(m[0]);
  }
  return hits;
}

function scanText(text, opts = {}) {
  const hashes = opts.hashes || new Set();
  const terms = (opts.terms || []).filter(Boolean);
  const findings = [];
  String(text)
    .split(/\r?\n/)
    .forEach((lineText, i) => {
      const line = i + 1;
      const add = (rule) => (match) => findings.push({ line, rule, match });
      hashedTerms(lineText, hashes).forEach(add('hashed-term'));
      emailHits(lineText, hashes).forEach(add('email'));
      phoneHits(lineText).forEach(add('phone'));
      termHits(lineText, terms).forEach(add('term'));
    });
  return findings;
}

// The reason a path may not be read, or null when it stays inside root.
function pathError(root, file) {
  if (path.isAbsolute(file)) return 'absolute path';
  const rel = path.relative(path.resolve(root), path.resolve(root, file));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return 'outside root';
  return null;
}

// The hashes in a terms file (default terms.json next to this file), a JSON
// list of lowercase hex SHA-256 hashes, as a Set; empty when the file does
// not exist.
function loadHashes(file = TERMS_FILE) {
  if (!fs.existsSync(file)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).map((h) => String(h).toLowerCase()));
}

// The known hits, a JSON list of {file, rule, count} (default known-hits.json
// next to this file).
function loadKnownHits(file = KNOWN_HITS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Findings set against known hits: every finding of a path and rule with no
// entry, or with more findings than the entry's count, is unlisted; an entry
// whose path and rule have no finding is stale.
function checkKnownHits(findings, known) {
  const groups = new Map();
  for (const f of findings) {
    const key = f.path + '\0' + f.rule;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const unlisted = [];
  for (const hits of groups.values()) {
    const entry = known.find((e) => e.file === hits[0].path && e.rule === hits[0].rule);
    if (!entry || hits.length > entry.count) unlisted.push(...hits);
  }
  const stale = known.filter((e) => !groups.has(e.file + '\0' + e.rule));
  return { unlisted, stale };
}

function scanTree(root, files, opts = {}) {
  const findings = [];
  const errors = [];
  opts = { ...opts, hashes: opts.hashes || loadHashes(opts.termsFile) };
  for (const file of files) {
    const error = pathError(root, file);
    if (error) {
      errors.push({ path: file, error });
      continue;
    }
    let buf;
    try {
      buf = fs.readFileSync(path.resolve(root, file));
    } catch (err) {
      errors.push({ path: file, error: err.code || 'unreadable' });
      continue;
    }
    // Binary and minified vendor files skip the phone rule only.
    const skipPhone = buf.includes(0) || VENDOR.test(file);
    scanText(buf.toString('utf8'), opts).forEach(({ line, rule }) => {
      if (!(skipPhone && rule === 'phone')) findings.push({ path: file, line, rule });
    });
  }
  return { findings, errors };
}

// 'path:line rule' per finding, then 'path: error: <reason>' per error, then
// 'file: stale: rule' per stale known hit.
function formatResults({ findings = [], errors = [], stale = [] }) {
  return [
    ...findings.map((f) => `${f.path}:${f.line} ${f.rule}`),
    ...errors.map((e) => `${e.path}: error: ${e.error}`),
    ...stale.map((e) => `${e.file}: stale: ${e.rule}`),
  ];
}

// Every file under dir, relative to it with / separators, leaving out folders
// named in skip (default only .git). Symbolic links are not followed.
function walkFiles(dir, rel = '', skip = ['.git']) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? rel + '/' + entry.name : entry.name;
    if (skip.includes(entry.name)) continue;
    if (entry.isDirectory()) out.push(...walkFiles(dir, p, skip));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Folders the scan of a folder that is not a git checkout leaves out.
const NOT_SOURCE = ['.git', 'node_modules', '.next', 'coverage'];

// True when dir is the top of a git checkout of its own. A folder inside
// some other checkout (a built public tree under a home folder kept in git)
// is not, so it is never scanned as that checkout's few tracked files.
function isOwnCheckout(dir) {
  try {
    const top = require('child_process')
      .execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    return fs.realpathSync(top) === fs.realpathSync(dir);
  } catch (err) {
    return false;
  }
}

// Scan files (default: `git ls-files` in root) under root (default: the
// repository root) with the hashes in termsFile (default terms.json) and the
// terms in env.PRIVATE_SCAN_TERMS, leave out the hits knownHitsFile lists
// (default known-hits.json when scanning the repository, none for another
// root), print each result line through log, and return 1 on any unlisted
// finding, error or stale known hit, else 0. args '--root <dir>' scans every
// file in dir instead.
//
// The public tree has neither terms.json nor known-hits.json (both stay in
// the private repository). Without the terms file a note line says so and
// the phone rule and PRIVATE_SCAN_TERMS still run; a missing default
// known-hits.json means no known hits. A root that is not a git checkout of
// its own (a tree built by the publish script, before its first commit) is
// scanned file by file, leaving out .git, node_modules, .next and coverage,
// after a note line. Notes never change the exit code.
function main({ root, files, termsFile, knownHitsFile, args = [], env = process.env, log = console.log } = {}) {
  const at = args.indexOf('--root');
  const argRoot = at >= 0 ? args[at + 1] : undefined;
  if (at >= 0 && !argRoot) {
    log('--root: error: missing folder');
    return 1;
  }
  const dir = argRoot ? path.resolve(argRoot) : root || path.resolve(__dirname, '..', '..');
  const terms = termsFile || TERMS_FILE;
  if (!fs.existsSync(terms)) {
    log(`${path.basename(terms)}: note: not found, so no hashed term or email is checked; the phone rule and PRIVATE_SCAN_TERMS still are`);
  }
  let list = files;
  if (!list && argRoot) list = walkFiles(dir);
  if (!list && !isOwnCheckout(dir)) {
    const shown = path.relative(process.cwd(), dir) || '.';
    log(`${shown}: note: not a git checkout, so every file under it is scanned except ${NOT_SOURCE.join(', ')}`);
    list = walkFiles(dir, '', NOT_SOURCE);
  }
  if (!list) {
    list = require('child_process')
      .execFileSync('git', ['ls-files', '-z'], { cwd: dir, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean);
  }
  const result = scanTree(dir, list, { termsFile, terms: termsFromEnv(env) });
  const knownFile = knownHitsFile || (root || argRoot ? null : KNOWN_HITS_FILE);
  const known = knownFile && (knownHitsFile || fs.existsSync(knownFile)) ? loadKnownHits(knownFile) : [];
  const { unlisted, stale } = checkKnownHits(result.findings, known);
  formatResults({ findings: unlisted, errors: result.errors, stale }).forEach((line) => log(line));
  return unlisted.length || result.errors.length || stale.length ? 1 : 0;
}

module.exports = {
  scanText,
  termsFromEnv,
  loadHashes,
  loadKnownHits,
  checkKnownHits,
  scanTree,
  formatResults,
  main,
};

if (require.main === module) {
  process.exitCode = main({ args: process.argv.slice(2) });
}
