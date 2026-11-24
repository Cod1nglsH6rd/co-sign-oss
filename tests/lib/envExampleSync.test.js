/**
 * Whole-repo env sync: every setting the repository's code reads from
 * process.env is listed in .env.example once, with exactly one
 * `# required|optional · <adapter> · <why>` line directly above it, and
 * nothing is listed that the code no longer reads. Settings only scripts/
 * reads say `script only: <path>`; settings the platform sets are listed,
 * commented out, and say so; values are blank or placeholders. Each problem
 * names the file and line.
 *
 * The README's "Configure environment variables" step only shows settings
 * that .env.example lists.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const EXTENSION = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;
// The ticket's skips, plus the git-ignored build and coverage output a local
// checkout may hold.
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'tests', 'coverage', 'out', 'build', '.vercel']);
const SKIP_FILES = new Set(['jest.setup.js']);
// Only a file whose text holds this can hold a read; the rest (such as the
// minified pdf.js workers in public/) are not handed to the checker.
const MAY_READ = /process\s*\.\s*env/;

// Settings the platform or the shell sets: listed, commented out, saying so.
const PLATFORM = ['NODE_ENV', 'NEXT_RUNTIME', 'VERCEL_PROJECT_PRODUCTION_URL', 'HTTPS_PROXY'];

// Computed reads the checker cannot name. Each entry allows one read.
const ALLOWED_UNRESOLVED = [];

function load() {
  return require('../../scripts/envSync.js');
}

// Every source file in the repository, as repo-relative paths.
function walk(rel, files) {
  const abs = path.join(ROOT, rel);
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const child = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.next.stale-')) walk(child, files);
    } else if (entry.isFile() && EXTENSION.test(entry.name) && !SKIP_FILES.has(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

function sourceFiles(paths) {
  return paths
    .map((p) => ({ path: p, text: fs.readFileSync(path.join(ROOT, p), 'utf8') }))
    .filter((f) => MAY_READ.test(f.text));
}

// The value after `=` on an entry line, without quotes.
function valueOf(raw) {
  return raw.slice(raw.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
}

const PLACEHOLDER = [
  /^$/,
  /^your-[a-z0-9-]+-here$/i,
  /^https?:\/\/(?:localhost|127\.0\.0\.1|(?:[a-z0-9-]+\.)*example\.com)(?::\d+)?(?:\/\S*)?$/i,
  /^[^\s@]+@(?:[a-z0-9-]+\.)*example\.com$/i,
];

const ENTRY_LINE = /^\s*#?\s*[A-Za-z_][A-Za-z0-9_]*\s*=/;

// One line per problem, each naming where it is.
function envProblems(files, exampleText) {
  const { collectEnvReads, parseEnvExample, compareEnv } = load();
  const collected = collectEnvReads(files);
  const example = parseEnvExample(exampleText);
  const result = compareEnv(collected, example);
  const lines = exampleText.split(/\r?\n/);
  const linesOf = (name) => example.entries.filter((e) => e.name === name).map((e) => `.env.example:${e.line}`);
  const readers = (name) => collected.reads.filter((r) => r.name === name);
  const problems = [];
  for (const name of result.missing) {
    problems.push(`missing ${name} read at ${readers(name).map((r) => `${r.file}:${r.line}`).join(', ')}`);
  }
  for (const name of result.stale) problems.push(`stale ${name} at ${linesOf(name).join(', ')}`);
  for (const name of result.duplicates) problems.push(`duplicate ${name} at ${linesOf(name).join(', ')}`);
  for (const name of result.badComments) problems.push(`bad comment for ${name} at ${linesOf(name).join(', ')}`);
  const allowed = ALLOWED_UNRESOLVED.map((a) => ({ ...a }));
  for (const u of result.unresolved) {
    const i = allowed.findIndex((a) => a.file === u.file && a.expr === u.expr);
    if (i !== -1) allowed.splice(i, 1);
    else problems.push(`unresolved process.env[${u.expr}] at ${u.file}:${u.line}`);
  }
  for (const entry of example.entries) {
    const at = `.env.example:${entry.line}`;
    const comment = entry.comment || '';
    const twoAbove = entry.line > 2 ? lines[entry.line - 3].trim() : '';
    if (entry.comment && twoAbove.startsWith('#') && !ENTRY_LINE.test(twoAbove)) {
      problems.push(`more than one comment line above ${entry.name} at ${at}`);
    }
    const files = [...new Set(readers(entry.name).map((r) => r.file))];
    const scriptOnly = files.length > 0 && files.every((f) => f.startsWith('scripts/'));
    const said = /script only:(.*)$/.exec(comment);
    if (scriptOnly) {
      const named = said ? (said[1].match(/scripts\/[\w./-]*/g) || []).map((p) => p.replace(/\.$/, '')) : [];
      const covers = (f) => named.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p));
      const unnamed = files.filter((f) => !covers(f));
      if (unnamed.length) problems.push(`script only ${entry.name} at ${at} does not name ${unnamed.join(', ')}`);
    } else if (said) {
      const elsewhere = readers(entry.name).find((r) => !r.file.startsWith('scripts/'));
      if (elsewhere) problems.push(`${entry.name} at ${at} says script only but is read at ${elsewhere.file}:${elsewhere.line}`);
    }
    if (PLATFORM.includes(entry.name) && (!entry.commented || !comment.includes('set by the platform'))) {
      problems.push(`platform setting ${entry.name} at ${at} is not commented out as set by the platform`);
    }
    const value = valueOf(lines[entry.line - 1]);
    if (!PLACEHOLDER.some((p) => p.test(value))) problems.push(`real-looking value for ${entry.name} at ${at}`);
  }
  return problems;
}

function readExample() {
  return fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
}

describe('.env.example matches the code', () => {
  let paths;
  let files;

  beforeAll(() => {
    paths = walk('', []);
    files = sourceFiles(paths);
  });

  it('walks the whole repository but not node_modules, tests/ or jest.setup.js', () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        'pages/api/ocr.js',
        'components/PdfViewer.js',
        'hooks/useAuth.js',
        'scripts/seed-dev.js',
        'scripts/positioning-suite/pull-fields.js',
        'middleware.js',
        'next.config.js',
        'instrumentation.js',
        'sentry.client.config.js',
        'sentry.edge.config.js',
        'sentry.server.config.js',
        'tailwind.config.js',
        'supabase/functions/pdf-to-image/index.ts',
      ]),
    );
    expect(paths.filter((p) => /(^|\/)(node_modules|\.next|\.git|tests)\/|(^|\/)jest\.setup\.js$/.test(p))).toEqual([]);
  });

  it('lists every setting read, once, well annotated, with a placeholder value, and nothing stale', () => {
    expect(envProblems(files, readExample())).toEqual([]);
  }, 30000);

  it('lists the four platform settings, commented out', () => {
    const { parseEnvExample } = load();
    const entries = parseEnvExample(readExample()).entries;
    for (const name of PLATFORM) {
      expect(entries.filter((e) => e.name === name).map((e) => ({ name: e.name, commented: e.commented }))).toEqual([
        { name, commented: true },
      ]);
    }
  });

  it('fails when a new process.env read in lib/ has no .env.example line', () => {
    const added = [...files, { path: 'lib/newSetting.js', text: 'const x = 1;\nconst s = process.env.COSIGN_NEW_SETTING;\n' }];
    expect(envProblems(added, readExample())).toContain('missing COSIGN_NEW_SETTING read at lib/newSetting.js:2');
  }, 30000);

  it('fails on a computed read other than the two allowed in lib/stripe.js', () => {
    const added = [...files, { path: 'lib/other.js', text: 'const v = process.env[cfg.priceEnv];\n' }];
    expect(envProblems(added, readExample())).toEqual(['unresolved process.env[cfg.priceEnv] at lib/other.js:1']);
  }, 30000);

  it('names the .env.example line of a stale, duplicate or badly commented entry', () => {
    const example = [
      '# optional · none · a setting nothing reads',
      'OLD_SETTING=',
      '# no format here',
      'COSIGN_NEW_SETTING=',
      '# optional · none · listed again',
      'COSIGN_NEW_SETTING=',
    ].join('\n');
    const only = [{ path: 'lib/newSetting.js', text: 'process.env.COSIGN_NEW_SETTING;\n' }];
    expect(envProblems(only, example)).toEqual([
      'stale OLD_SETTING at .env.example:2',
      'duplicate COSIGN_NEW_SETTING at .env.example:4, .env.example:6',
      'bad comment for COSIGN_NEW_SETTING at .env.example:4, .env.example:6',
    ]);
  });

  it('wants exactly one comment line above each setting', () => {
    const code = [{ path: 'lib/a.js', text: 'process.env.ONE;\nprocess.env.TWO;\n' }];
    const example = [
      '# optional · none · fine',
      'ONE=',
      '',
      '# optional · none · a second line',
      '# optional · none · two lines above one setting',
      'TWO=',
    ].join('\n');
    expect(envProblems(code, example)).toEqual(['more than one comment line above TWO at .env.example:6']);
  });

  it('wants script-only settings to name the script, and no app setting to say script only', () => {
    const code = [
      { path: 'scripts/a.js', text: 'process.env.ONE;\nprocess.env.TWO;\n' },
      { path: 'scripts/suite/b.js', text: 'process.env.TWO;\nprocess.env.THREE;\n' },
      { path: 'lib/c.js', text: 'process.env.FOUR;\n' },
    ];
    const example = [
      '# optional · none · script only: scripts/a.js; fine',
      'ONE=',
      '# optional · none · script only: scripts/a.js; misses the suite',
      'TWO=',
      '# optional · none · a script setting that does not say so',
      'THREE=',
      '# optional · none · script only: scripts/a.js; but lib reads it',
      'FOUR=',
    ].join('\n');
    expect(envProblems(code, example)).toEqual([
      'script only TWO at .env.example:4 does not name scripts/suite/b.js',
      'script only THREE at .env.example:6 does not name scripts/suite/b.js',
      'FOUR at .env.example:8 says script only but is read at lib/c.js:1',
    ]);
  });

  it('accepts a folder after script only for every script under it', () => {
    const code = [{ path: 'scripts/suite/b.js', text: 'process.env.TWO;\n' }, { path: 'scripts/suite/c.js', text: 'process.env.TWO;\n' }];
    const example = '# optional · none · script only: scripts/suite/; both\nTWO=\n';
    expect(envProblems(code, example)).toEqual([]);
  });

  it('wants platform settings commented out and saying set by the platform', () => {
    const code = [{ path: 'lib/a.js', text: 'process.env.NODE_ENV;\nprocess.env.NEXT_RUNTIME;\nprocess.env.VERCEL_PROJECT_PRODUCTION_URL;\n' }];
    const example = [
      '# optional · none · set by the platform: fine',
      '# NODE_ENV=',
      '# optional · none · set by the platform: but not commented out',
      'NEXT_RUNTIME=',
      '# optional · vercel · commented out but does not say who sets it',
      '# VERCEL_PROJECT_PRODUCTION_URL=',
    ].join('\n');
    expect(envProblems(code, example)).toEqual([
      'platform setting NEXT_RUNTIME at .env.example:4 is not commented out as set by the platform',
      'platform setting VERCEL_PROJECT_PRODUCTION_URL at .env.example:6 is not commented out as set by the platform',
    ]);
  });

  it('wants blank or placeholder values, never real-looking ones', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
    const code = [{ path: 'lib/a.js', text: names.map((n) => `process.env.${n};`).join('\n') }];
    const values = ['', 'your-api-key-here', 'http://localhost:3000', 'https://app.example.com/x', 'ops@example.com', 'https://real.example.org', 'abc123'];
    const example = names.map((n, i) => `# optional · none · value ${i}\n${n}=${values[i]}`).join('\n');
    expect(envProblems(code, example)).toEqual([
      'real-looking value for F at .env.example:12',
      'real-looking value for G at .env.example:14',
    ]);
  });
});

describe("README's environment step", () => {
  function envStep() {
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const start = readme.indexOf('**Configure environment variables**');
    expect(start).not.toBe(-1);
    const end = readme.indexOf('\n4. **', start);
    return readme.slice(start, end === -1 ? undefined : end);
  }

  it('shows only settings that .env.example lists', () => {
    const { parseEnvExample } = load();
    const listed = new Set(parseEnvExample(readExample()).entries.map((e) => e.name));
    const block = /```env\n([\s\S]*?)```/.exec(envStep());
    expect(block).not.toBeNull();
    const shown = [...block[1].matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    expect(shown).toContain('ANTHROPIC_API_KEY');
    expect(shown.filter((name) => !listed.has(name))).toEqual([]);
  });

  it('no longer shows Google Cloud or STRIPE_PRICE_ID_* settings', () => {
    const step = envStep();
    expect(step.match(/Google Cloud|GOOGLE_[A-Z_]*|STRIPE_PRICE_ID_[A-Z_]*/g)).toBeNull();
  });

  it('no longer says ANTHROPIC_API_KEY is missing from .env.example', () => {
    expect(envStep()).not.toMatch(/not in `\.env\.example`/);
  });
});
