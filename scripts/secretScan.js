/**
 * Secret scanner core.
 *
 * scanText(text, path) reports secret-shaped strings as {file, line, kind}.
 * A hit never carries the matched text, so a report can be printed or stored
 * without leaking the secret it found.
 *
 * kinds is the registry of detectors: each entry is {kind, test} where test
 * is a RegExp matched against one line at a time. Push new entries to extend.
 * When a test has a first capture group, that group is the secret part (a
 * connection string's password) and is run through isPlaceholder too.
 *
 * Base64 runs of 40 or more characters and %-encoded runs are decoded and the
 * decoded text is scanned with every kind; such a hit is reported on the line
 * of the encoded run and also carries encoding: 'base64' or 'url'. npm
 * sha512-/sha384-/sha1- integrity hashes, runs that are not well-formed base64
 * or valid UTF-8, and decoded text that is not printable are skipped.
 *
 * checkTree() scans files against secret-scan-baseline.json, the temporary
 * list of known hits. `node scripts/secretScan.js` scans every file git tracks
 * and prints each hit the list does not cover as file:line:kind, and each list
 * entry with no hit left as file:-:kind (never a value), and exits 1 when there
 * is any. In a folder that is not a git checkout of its own (a tree built by
 * the publish script) it scans every file there instead, leaving out .git,
 * node_modules, .next and coverage.
 */

// Not preceded by a key character, so a prefix inside a longer word never hits.
const B = '(?<![A-Za-z0-9_-])';
// Not followed by a key character, for kinds with a fixed or closed shape.
const E = '(?![A-Za-z0-9_-])';

// Case-insensitive source for one lowercase word, for use inside a larger pattern.
const ci = (word) => word.replace(/[a-z]/g, (c) => '[' + c + c.toUpperCase() + ']');
// A word not glued to other letters (project is not reproject, db is not mongodb).
const word = (w) => '(?<![A-Za-z])' + ci(w) + '(?![A-Za-z])';
// How far a context word may sit from the value it marks. Bounded, so a
// minified line of a million characters is not rescanned at every position.
const NEAR = '[^\\n]{0,200}';

// Words on a line that make a 20-letter lowercase token a Supabase project ref.
const SUPA_CONTEXT = [word('supabase'), word('project'), word('ref'), word('db'), word('postgres') + '\\.'].join('|');
const REDIRECT_WORD = ci('redirect') + '|' + ci('callback');
// Host labels that stand in for a real host in docs and local setups. A label
// must equal one of these whole, so yourcompany.com or domain-driven.dev still hit.
const PLACEHOLDER_LABEL =
  '(?:' + ['localhost', 'example', 'placeholder', 'domain', 'your-?domain', 'my-?domain'].map(ci).join('|') +
  '|' + ci('your') + '[-_][A-Za-z0-9-]*)(?![A-Za-z0-9-])';
// Not a placeholder host: no placeholder label, and not a loopback or any-address IP.
const REAL_HOST = '(?!(?:[A-Za-z0-9-]+\\.)*' + PLACEHOLDER_LABEL + '|(?:127\\.0\\.0\\.1|0\\.0\\.0\\.0)(?![0-9]))';
const MAILBOX_DOMAINS = ['gmail', 'googlemail', 'outlook', 'hotmail', 'yahoo', 'icloud'];
// The rest of an org/project key, then = or :, then the value as the first group.
const ID_KEY = '[A-Za-z_-]*(?:' + ci('project') + '|' + ci('org') + ')[A-Za-z_-]*["\']?\\s*[:=]\\s*["\'`]?';
// The value ends there and is not the start of an expression (process.env.X, f(), a[0]).
const ID_END = E + '(?![.(\\[])';

const kinds = [
  { kind: 'anthropic', test: new RegExp(B + 'sk-ant-[A-Za-z0-9_-]{20,}') },
  { kind: 'openai', test: new RegExp(B + 'sk-(?!ant-)(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}') },
  { kind: 'stripe', test: new RegExp(B + '(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}') },
  // re_<token> or re_<id>_<secret>; short snake_case segments (re_render_when) stay out.
  { kind: 'resend', test: new RegExp(B + 're_(?:[A-Za-z0-9]{20,}|[A-Za-z0-9]{6,}_[A-Za-z0-9]{16,})' + E) },
  { kind: 'github', test: new RegExp(B + '(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})') },
  { kind: 'aws', test: new RegExp(B + '(?:AKIA|ASIA)[A-Z0-9]{16}' + E) },
  { kind: 'google', test: new RegExp(B + 'AIza[A-Za-z0-9_-]{35}' + E) },
  {
    kind: 'connection-string',
    // scheme://user[:password]@host, with some user info before the @.
    test: /(?<![A-Za-z0-9+])(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/(?=[^\s'"`/@]+@)[^\s'"`/:@]*(?::([^\s'"`/@]*))?@[^\s'"`/:?#]+/,
  },
  { kind: 'stripe-id', test: new RegExp(B + '(?:(?:price|prod)_[A-Za-z0-9]{14,}|whsec_[A-Za-z0-9]{24,})') },
  { kind: 'jwt', test: new RegExp(B + 'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}') },
  {
    kind: 'supabase-ref',
    // A 20-letter lowercase ref with a Supabase hint (host, postgres.<ref>,
    // project-ref, project_id, ref, db) near it on the line. The cheap
    // lookahead goes first so the context search only runs at a 20-letter token.
    // A token followed by = is a name being assigned (pdf.js glyph table
    // entries such as e.<glyphname>=2416), not a value.
    test: new RegExp(
      B + '(?=[a-z]{20}' + E + '(?!\\s*=))(?:(?<=(?:' + SUPA_CONTEXT + ')' + NEAR + ')[a-z]{20}' + E +
        '|[a-z]{20}' + E + '(?=' + NEAR + '(?:' + SUPA_CONTEXT + ')))'
    ),
  },
  // https only: an http:// DSN is not the documented form.
  { kind: 'sentry-dsn', test: new RegExp(B + 'https://([A-Za-z0-9]{16,})@[A-Za-z0-9.-]*ingest[A-Za-z0-9.-]*\\.sentry\\.io/[0-9]+') },
  { kind: 'sentry-token', test: new RegExp(B + 'sntry[su]_[A-Za-z0-9_+/=-]{20,}') },
  {
    kind: 'gcp-id',
    test: new RegExp('(?:' + ci('gcp') + '|' + ci('gcloud') + '|' + ci('google') + '[_-]?' + ci('cloud') + ')' + ID_KEY + '([a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{6,})' + ID_END),
  },
  { kind: 'vercel-id', test: new RegExp('(?=(?:prj|team)_)(?<=[:=]\\s*["\'`]?)(?:prj|team)_[A-Za-z0-9]{16,}' + E) },
  { kind: 'sentry-id', test: new RegExp(ci('sentry') + ID_KEY + '([A-Za-z0-9][A-Za-z0-9_-]+)' + ID_END) },
  {
    kind: 'bucket-url',
    // gs:// or s3:// bucket, <bucket>.s3[.region].amazonaws.com, or a Supabase storage object URL.
    test: new RegExp(
      '(?:(?<![A-Za-z0-9+.-])(?:gs|s3)://[a-z0-9][a-z0-9._-]{2,62}' +
        '|' + B + '[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\\.s3(?:[.-][a-z0-9-]+)?\\.amazonaws\\.com' +
        '|https?://[a-z]{20}\\.supabase\\.(?:co|com)/storage/v1/(?:object|render|s3)/)'
    ),
  },
  {
    kind: 'oauth-redirect',
    // A URL after a redirect/callback word, or whose path ends in one; the host
    // is the first group and must not be a placeholder host. The cheap
    // lookahead goes first so the word search only runs where a URL starts.
    test: new RegExp(
      '(?=https?://)(?:(?<=(?:' + REDIRECT_WORD + ')' + NEAR + ')|(?=https?://[^\\s\'"`]*(?:' + REDIRECT_WORD + ')))https?://' +
        REAL_HOST +
        '([A-Za-z0-9][A-Za-z0-9-]*(?:\\.[A-Za-z0-9-]+)+)'
    ),
  },
  {
    kind: 'personal-email',
    test: new RegExp(B + '[A-Za-z0-9._%+-]{0,63}[A-Za-z0-9]@(?:' + MAILBOX_DOMAINS.map(ci).join('|') + ')\\.[a-z]{2,3}(?:\\.[a-z]{2})?' + E),
  },
];

const PLACEHOLDER_WORDS = ['your-', 'your_', 'xxx', 'placeholder', 'example', 'test-', 'change-me', 'changeme', '...', '…'];

/**
 * True when a value is a stand-in rather than a real secret: empty, or
 * containing a docs/.env.example word (your-…, xxx, placeholder, example,
 * test-…, change-me) or a truncation mark.
 */
function isPlaceholder(value) {
  const v = String(value == null ? '' : value).trim().replace(/^['"`]+|['"`]+$/g, '');
  if (!v) return true;
  const lower = v.toLowerCase();
  return PLACEHOLDER_WORDS.some((w) => lower.includes(w));
}

// A whole base64 run of at least 40 characters, not an npm sha512-/sha384-/sha1-
// integrity hash. The first lookbehind means only the start of a run is tried.
const BASE64_RUN = /(?<![A-Za-z0-9+/])(?<!sha(?:512|384|1)-)[A-Za-z0-9+/]{40,}={0,2}/g;
// A whole run of the characters encodeURIComponent leaves or writes (unreserved
// characters, the apostrophe and %XX), so a KEY=, u= or ?q= before it is not
// part of the run. Matched greedily from the left, so each match is a whole run.
const URL_RUN = /(?:[A-Za-z0-9_.!~*'()-]|%[0-9A-Fa-f]{2})+/g;
const URL_ESCAPE = /%[0-9A-Fa-f]{2}/;
// Any Unicode control, format, surrogate, private-use or unassigned character
// (C0, DEL, C1, zero-width and bidi marks included) other than tab and line
// breaks, or the replacement mark left by bytes that are not UTF-8.
const NOT_PRINTABLE = /(?![\t\n\r])[\p{C}\u{fffd}]/u;

// The run decoded, or null when it is not well-formed base64. Node's decoder
// ignores a lone trailing character, padding that does not fit and nonzero
// unused bits, so the run must be exactly what its bytes encode to. Padding
// may be left off.
function decodeBase64(run) {
  const body = run.replace(/=+$/, '');
  if (body.length !== run.length && run.length % 4 !== 0) return null;
  const bytes = Buffer.from(body, 'base64');
  if (bytes.toString('base64').replace(/=+$/, '') !== body) return null;
  return bytes.toString('utf8');
}

// The whole run decoded, or null when any %XX sequence is not valid UTF-8.
function decodeUrl(run) {
  try {
    return decodeURIComponent(run);
  } catch (e) {
    return null;
  }
}

// Every kind matched on one line, as {at, kind}.
function matchLine(lineText) {
  const found = [];
  for (const { kind, test } of kinds) {
    const re = new RegExp(test.source, test.flags.includes('g') ? test.flags : test.flags + 'g');
    for (const m of lineText.matchAll(re)) {
      const end = m.index + m[0].length;
      // Include what follows, so a value cut off with "..." counts as truncated.
      if (isPlaceholder(m[0] + lineText.slice(end, end + 3))) continue;
      if (m[1] !== undefined && isPlaceholder(m[1])) continue;
      found.push({ at: m.index, kind });
    }
  }
  return found;
}

// Kinds found in the decoded form of each encoded run on a line, at the run's
// position. A run that does not decode, or decodes to text that is not
// printable, is not scanned.
function matchEncoded(lineText) {
  const found = [];
  const decoders = [['base64', BASE64_RUN, decodeBase64]];
  if (lineText.includes('%')) decoders.push(['url', URL_RUN, decodeUrl]);
  for (const [encoding, re, decode] of decoders) {
    for (const m of lineText.matchAll(re)) {
      if (encoding === 'url' && !URL_ESCAPE.test(m[0])) continue;
      const decoded = decode(m[0]);
      if (decoded === null || NOT_PRINTABLE.test(decoded)) continue;
      for (const part of decoded.split(/\r?\n/)) {
        for (const f of matchLine(part)) found.push({ at: m.index, kind: f.kind, encoding });
      }
    }
  }
  return found;
}

function scanText(text, path) {
  if (typeof text !== 'string' || !text) return [];
  const hits = [];
  text.split(/\r?\n/).forEach((lineText, i) => {
    const found = matchLine(lineText).concat(matchEncoded(lineText));
    found.sort((a, b) => a.at - b.at);
    for (const f of found) {
      const hit = { file: path, line: i + 1, kind: f.kind };
      if (f.encoding) hit.encoding = f.encoding;
      hits.push(hit);
    }
  });
  return hits;
}

// Paths, relative to the repository root, that scanFiles never reads. They are
// harness-owned: the private repository's automation writes them (its config,
// decision records and plans), so a hit there is not the project's to remove.
// None of them is in the published tree, where these entries match nothing.
// An entry ending in / covers everything under that folder; any other entry
// is one exact file.
const EXCLUDED = ['.dev-manager.yml', 'docs/decisions/', 'docs/plans/'];

// This repository's root (scripts/..). A path is also matched against the
// working directory, where a caller usually runs from.
const REPO_ROOT = require('path').resolve(__dirname, '..');

// True when p, relative or absolute and in any spelling (./, .., //, \), names
// an EXCLUDED path under the repository root or the working directory.
function isExcluded(p) {
  const path = require('path');
  const full = path.resolve(String(p));
  return [REPO_ROOT, process.cwd()].some((root) => {
    const rel = path.relative(root, full).replace(/\\/g, '/');
    if (!rel || rel.startsWith('../') || rel === '..' || path.isAbsolute(rel)) return false;
    return EXCLUDED.some((e) => (e.endsWith('/') ? rel.startsWith(e) : rel === e));
  });
}

/**
 * Scans each path and returns all hits, with file as the path given. Skips
 * EXCLUDED paths and binary files (any file with a NUL byte). readFile(path)
 * returns the file's bytes; it defaults to reading the disk.
 */
function scanFiles(paths, readFile) {
  const read = readFile || require('fs').readFileSync;
  const hits = [];
  for (const p of paths || []) {
    if (isExcluded(p)) continue;
    const buf = read(p);
    if (buf.includes(0)) continue;
    hits.push(...scanText(buf.toString('utf8'), p));
  }
  return hits;
}

// Today's known hits as {file, kind, count}, with no values. A temporary list:
// an entry goes once its hits are removed, and a new hit is never added to it.
const BASELINE = require('path').join(__dirname, 'secret-scan-baseline.json');

function loadBaseline() {
  return JSON.parse(require('fs').readFileSync(BASELINE, 'utf8'));
}

// Folders a tree that is not a git checkout is walked without.
const NOT_SOURCE = ['.git', 'node_modules', '.next', 'coverage'];

// True when dir is the top of a git checkout of its own, not a folder inside
// some other checkout (whose git would list none of dir's files).
function isOwnCheckout(dir) {
  const fs = require('fs');
  try {
    const top = require('child_process')
      .execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
    return fs.realpathSync(top) === fs.realpathSync(dir);
  } catch (e) {
    return false;
  }
}

// Every file under dir, relative to it with / separators, without the
// NOT_SOURCE folders. Symbolic links are not followed.
function walkFiles(dir, rel = '') {
  const fs = require('fs');
  const path = require('path');
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const p = rel ? rel + '/' + entry.name : entry.name;
    if (NOT_SOURCE.includes(entry.name)) continue;
    if (entry.isDirectory()) out.push(...walkFiles(dir, p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

// Every file git tracks, relative to the repository root. When the root is
// not a git checkout of its own (a tree built by scripts/publish before its
// first commit), every file under it instead, without NOT_SOURCE. Used by the
// CLI only.
function trackedFiles() {
  if (!isOwnCheckout(REPO_ROOT)) return walkFiles(REPO_ROOT);
  const out = require('child_process').execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * Scans paths (relative to the repository root; default: every tracked file)
 * against baseline (default: secret-scan-baseline.json). Returns
 * {unlisted, stale}: unlisted holds every hit of a file and kind that has no
 * entry or more hits than its count, and stale the entries with no hit left.
 */
function checkTree({ paths, baseline, readFile } = {}) {
  const path = require('path');
  const list = baseline || loadBaseline();
  const read = readFile || ((p) => require('fs').readFileSync(path.resolve(REPO_ROOT, p)));
  const groups = new Map();
  for (const hit of scanFiles(paths || trackedFiles(), read)) {
    const key = hit.file + '\0' + hit.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ file: hit.file, line: hit.line, kind: hit.kind });
  }
  const unlisted = [];
  for (const hits of groups.values()) {
    const entry = list.find((e) => e.file === hits[0].file && e.kind === hits[0].kind);
    if (!entry || hits.length > entry.count) unlisted.push(...hits);
  }
  const stale = list.filter((e) => !groups.has(e.file + '\0' + e.kind));
  return { unlisted, stale };
}

// One line per problem as file:line:kind, never the value. A stale entry has
// no line, so it reads file:-:kind.
function formatProblems({ unlisted, stale }) {
  return unlisted.map((h) => h.file + ':' + h.line + ':' + h.kind).concat(stale.map((e) => e.file + ':-:' + e.kind));
}

// CLI mode: prints each problem and returns 1 when there is any, else 0.
function main({ log = console.log, ...options } = {}) {
  const lines = formatProblems(checkTree(options));
  lines.forEach((line) => log(line));
  return lines.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main();

module.exports = { scanText, scanFiles, kinds, isPlaceholder, EXCLUDED, loadBaseline, trackedFiles, checkTree, formatProblems, main };
