// co-sign-428: the billing leftovers (the document-limit trigger, the Stripe
// event ledger, the organizations billing columns and the app_config gate
// rows) are removed by one migration. These tests pin that migration, check
// that the app source names none of the dropped objects, and that the health
// check and the schema check's EXPECTED list still line up.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const MIGRATION = '20261119100300_remove_billing_schema.sql';

// Hand-listed from 20260418000100, 20260620140000 and SUPABASE-SETUP.sql.
const DROPPED_COLUMNS = [
  'subscription_status',
  'subscription_plan',
  'subscription_current_period_end',
  'stripe_customer_id',
  'stripe_subscription_id',
  'doc_credits',
  'plan',
];
const DROPPED_CHECKS = [
  'organizations_subscription_status_check',
  'organizations_subscription_plan_check',
];
// Made by CREATE UNIQUE INDEX in 20260418000100, but a database may carry
// them as UNIQUE constraints instead, whose index cannot be dropped directly.
const DROPPED_UNIQUE_KEYS = [
  'organizations_stripe_customer_id_key',
  'organizations_stripe_subscription_id_key',
];
const DELETED_CONFIG_KEYS = ['doc_limits_enabled', 'free_doc_limit'];

function read(...parts) {
  const file = path.join(ROOT, ...parts);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

// The migration's statements: comments removed, whitespace collapsed,
// lower-cased, split on semicolons.
function statements() {
  return read('supabase', 'migrations', MIGRATION)
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean);
}

const ORGANIZATIONS_ALTER = /^alter table (if exists )?(only )?(public\.)?organizations\b/;

// Position of the first statement matching pattern, or -1.
function firstIndex(pattern) {
  return statements().findIndex((s) => pattern.test(s));
}

describe(`migration ${MIGRATION}`, () => {
  it('exists in supabase/migrations', () => {
    expect(fs.existsSync(path.join(ROOT, 'supabase', 'migrations', MIGRATION))).toBe(true);
  });

  it('drops the enforce_document_limit trigger on documents', () => {
    expect(
      firstIndex(/^drop trigger if exists enforce_document_limit on (public\.)?documents\b/)
    ).toBeGreaterThanOrEqual(0);
  });

  it('drops the function public.enforce_document_limit()', () => {
    expect(
      firstIndex(/^drop function if exists public\.enforce_document_limit\s*\(\s*\)/)
    ).toBeGreaterThanOrEqual(0);
  });

  it('drops the table public.billing_events', () => {
    expect(firstIndex(/^drop table if exists public\.billing_events\b/)).toBeGreaterThanOrEqual(0);
  });

  it.each(DROPPED_COLUMNS)('drops the organizations column %s', (column) => {
    const pattern = new RegExp(`\\bdrop column if exists ${column}\\b`);
    expect(
      statements().some((s) => ORGANIZATIONS_ALTER.test(s) && pattern.test(s))
    ).toBe(true);
  });

  it.each(DROPPED_CHECKS)('drops the organizations check constraint %s', (name) => {
    const pattern = new RegExp(`\\bdrop constraint if exists ${name}\\b`);
    expect(
      statements().some((s) => ORGANIZATIONS_ALTER.test(s) && pattern.test(s))
    ).toBe(true);
  });

  it.each(DROPPED_UNIQUE_KEYS)(
    'drops the unique key %s as a constraint first, then as an index',
    (name) => {
      const asConstraint = statements().findIndex(
        (s) =>
          ORGANIZATIONS_ALTER.test(s) &&
          new RegExp(`\\bdrop constraint if exists ${name}\\b`).test(s)
      );
      const asIndex = firstIndex(new RegExp(`^drop index if exists (public\\.)?${name}\\b`));
      expect(asConstraint).toBeGreaterThanOrEqual(0);
      expect(asIndex).toBeGreaterThan(asConstraint);
    }
  );

  it('uses if exists on every drop', () => {
    const drops = statements().flatMap((s) =>
      [...s.matchAll(/\bdrop (trigger|function|table|column|constraint|index)\b(?! if exists)/g)].map(
        (m) => m[0]
      )
    );
    expect(statements().length).toBeGreaterThan(0);
    expect(drops).toEqual([]);
  });

  it('deletes the app_config rows doc_limits_enabled and free_doc_limit only', () => {
    const deletes = statements().filter((s) => /^delete from (public\.)?app_config\b/.test(s));
    expect(deletes).toHaveLength(1);
    const [statement] = deletes;
    expect(statement).toMatch(/\bwhere key in \(/);
    const keys = [...statement.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(keys).toEqual([...DELETED_CONFIG_KEYS].sort());
  });

  it('keeps the app_config table', () => {
    expect(statements().length).toBeGreaterThan(0);
    expect(
      statements().filter((s) => /\bapp_config\b/.test(s) && /^(drop|truncate|alter)\b/.test(s))
    ).toEqual([]);
  });
});

// Every dropped name as a pattern for app source. The distinctive names count
// wherever they appear. `plan` alone is an ordinary word ("the Pro plan", a
// local `const plan`), so the plan column counts in every form code uses to
// read or write a field: member access (`x.plan`, `x?.plan`), bracket access
// (`x['plan']`), a quoted column name (`.eq('plan', ...)`, `select('id, plan')`),
// an object key (`{ plan: ... }`) and destructuring or shorthand (`{ plan }`).
const DROPPED_NAME_PATTERNS = [
  /\benforce_document_limit\b/,
  /\bbilling_events\b/,
  ...DROPPED_COLUMNS.filter((c) => c !== 'plan').map((c) => new RegExp(`\\b${c}\\b`)),
  ...DROPPED_CHECKS.map((c) => new RegExp(`\\b${c}\\b`)),
  ...DROPPED_UNIQUE_KEYS.map((c) => new RegExp(`\\b${c}\\b`)),
  ...DELETED_CONFIG_KEYS.map((c) => new RegExp(`\\b${c}\\b`)),
  /\.\s*plan\b/,
  /\[\s*['"`]plan['"`]\s*\]/,
  /['"`]plan['"`]/,
  /\.select\(\s*['"`][^'"`]*\bplan\b/,
  /\bplan\s*:/,
  /\{[^{}]*\bplan\b[^{}]*\}/,
];

// Every file under dir (relative to root), whatever its extension.
function sourceFiles(dir, root = ROOT) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(rel, root) : [rel];
  });
}

function namedDroppedObjects(file, text) {
  return DROPPED_NAME_PATTERNS.filter((p) => p.test(text)).map((p) => `${file}: ${p}`);
}

describe('app source after the billing schema is removed', () => {
  it.each([
    "supabase.from('billing_events').insert({})",
    "select('id, doc_credits')",
    "organization['stripe_customer_id']",
    "await supabase.rpc('enforce_document_limit')",
    "const on = config.doc_limits_enabled;",
    'const p = org.plan;',
    'const p = organization?.plan;',
    'const { plan } = organization;',
    'const { id, plan: tier } = organization;',
    "const p = organization['plan'];",
    "const p = organization?.['plan'];",
    "supabase.from('organizations').select('id, plan')",
    "supabase.from('organizations').update({ plan: 'pro' })",
    "supabase.from('organizations').select('*').eq('plan', 'pro')",
  ])('the name check finds the planted reference %s', (text) => {
    expect(namedDroppedObjects('a.js', text).length).toBeGreaterThan(0);
  });

  it.each([
    'const plan = makePlan();',
    'await deps.encode(decoded, plan);',
    '// available on the Pro plan and above',
    "autoRetry: 'Nous réessaierons automatiquement en arrière-plan.',",
    'listener?.subscription?.unsubscribe();',
  ])('the name check leaves the ordinary text %s alone', (text) => {
    expect(namedDroppedObjects('a.js', text)).toEqual([]);
  });

  it('scans every file in a folder tree, not only .js files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'billing-scan-'));
    try {
      fs.mkdirSync(path.join(root, 'pages', 'nested'), { recursive: true });
      fs.writeFileSync(path.join(root, 'pages', 'nested', 'notes.md'), 'x');
      fs.writeFileSync(path.join(root, 'pages', 'page.tsx'), 'x');
      expect(sourceFiles('pages', root).sort()).toEqual(
        [path.join('pages', 'nested', 'notes.md'), path.join('pages', 'page.tsx')].sort()
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('no file in pages/, lib/, hooks/ or components/ names a dropped object', () => {
    const files = ['pages', 'lib', 'hooks', 'components'].flatMap((d) => sourceFiles(d));
    expect(files).toContain(path.join('pages', 'api', 'health.js'));
    expect(files.flatMap((f) => namedDroppedObjects(f, read(f)))).toEqual([]);
  });

  it('pages/api/health.js still reads app_config', () => {
    expect(read('pages', 'api', 'health.js')).toMatch(/\.from\(\s*['"`]app_config['"`]\s*\)/);
  });
});

describe('schema check EXPECTED after the billing schema is removed', () => {
  it('lists none of the dropped objects', () => {
    const { EXPECTED } = require('../../scripts/db/schemaCheck');
    expect(Object.keys(EXPECTED.tables)).not.toContain('billing_events');
    expect(EXPECTED.rpcs).not.toContain('enforce_document_limit');
    for (const column of DROPPED_COLUMNS) {
      expect(EXPECTED.tables.organizations).not.toContain(column);
    }
    expect(EXPECTED.tables.app_config).toBeDefined();
  });
});
