const fs = require('fs');
const path = require('path');

// Issue co-sign-209: Cô Sign takes no payments and is released as open source,
// so nothing of the old Stripe billing may come back. This file checks four
// things:
//   1. no stripe dependency in package.json or package-lock.json;
//   2. no import or require of the 'stripe' package anywhere outside
//      node_modules;
//   3. no source under pages/, lib/, hooks/ or components/ reads a billing
//      column (subscription_plan, subscription_status, doc_credits,
//      stripe_customer_id, stripe_subscription_id, billing_events,
//      organizations.plan);
//   4. no href or router push goes to /pricing or /billing.
// Each check also runs against small planted samples, so a check that finds
// nothing is known to be able to find something.

const ROOT = path.join(__dirname, '..', '..');
const SOURCE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;
// node_modules plus the git-ignored build, coverage and deploy output a local
// checkout may hold.
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'coverage', 'out', 'build', '.vercel']);

function walk(rel, files = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const child = rel ? path.posix.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.next.stale-')) walk(child, files);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      files.push(child);
    }
  }
  return files;
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Every line of `text` that matches one of `patterns`, as "file:line: text".
function hits(file, text, patterns) {
  const found = [];
  text.split('\n').forEach((line, i) => {
    if (patterns.some((p) => p.test(line))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 160)}`);
  });
  return found;
}

const APP_DIRS = ['pages', 'lib', 'hooks', 'components'];
function appSources() {
  return APP_DIRS.filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(d));
}

// ---------------------------------------------------------------------------
// 1. Dependencies
// ---------------------------------------------------------------------------

const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides'];
const isStripePackage = (name) => name === 'stripe' || name.startsWith('@stripe/');

function stripeInPackageJson(pkg) {
  return DEP_FIELDS.flatMap((field) => Object.keys(pkg[field] || {}).filter(isStripePackage).map((n) => `${field}.${n}`));
}

function stripeInLock(lock) {
  const found = [];
  for (const [key, entry] of Object.entries(lock.packages || {})) {
    const name = key.split('node_modules/').pop();
    if (key && isStripePackage(name)) found.push(`packages["${key}"]`);
    for (const field of DEP_FIELDS) {
      for (const dep of Object.keys((entry && entry[field]) || {})) {
        if (isStripePackage(dep)) found.push(`packages["${key}"].${field}.${dep}`);
      }
    }
  }
  for (const name of Object.keys(lock.dependencies || {})) {
    if (isStripePackage(name)) found.push(`dependencies.${name}`);
  }
  return found;
}

describe('1. no stripe dependency (issue co-sign-209)', () => {
  it('package.json lists no stripe package', () => {
    expect(stripeInPackageJson(JSON.parse(read('package.json')))).toEqual([]);
  });

  it('package-lock.json holds no stripe package and nothing depends on one', () => {
    expect(stripeInLock(JSON.parse(read('package-lock.json')))).toEqual([]);
  });

  it('the checks find a planted stripe dependency', () => {
    expect(stripeInPackageJson({ dependencies: { react: '1', stripe: '1' } })).toEqual(['dependencies.stripe']);
    expect(
      stripeInLock({
        packages: {
          '': { dependencies: { stripe: '^14' } },
          'node_modules/stripe': { version: '14.0.0' },
          'node_modules/x/node_modules/@stripe/stripe-js': { version: '1.0.0' },
        },
      }),
    ).toEqual([
      'packages[""].dependencies.stripe',
      'packages["node_modules/stripe"]',
      'packages["node_modules/x/node_modules/@stripe/stripe-js"]',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. Imports of the stripe package
// ---------------------------------------------------------------------------

// import x from 'stripe', import 'stripe', require('stripe'), import('stripe'),
// export ... from 'stripe', with subpaths and the @stripe/* packages. A path
// that only ends in stripe (such as '../lib/stripe') is not the package.
const STRIPE_IMPORT = [
  /(?:\bfrom|\bimport|\brequire\s*\(|\bimport\s*\()\s*['"`](?:stripe|@stripe\/[^'"`]+)(?:\/[^'"`]*)?['"`]/,
];

describe('2. no import or require of stripe outside node_modules (issue co-sign-209)', () => {
  it('no file in the tree imports or requires the stripe package', () => {
    // This file is left out: it holds planted import lines as test samples.
    const self = path.relative(ROOT, __filename).split(path.sep).join('/');
    const files = walk('').filter((f) => f !== self);
    expect(files).toEqual(expect.arrayContaining(['next.config.js', 'pages/api/health.js', 'scripts/envSync.js']));
    expect(files.filter((f) => f.startsWith('node_modules/') || f.includes('/node_modules/'))).toEqual([]);
    expect(files.flatMap((f) => hits(f, read(f), STRIPE_IMPORT))).toEqual([]);
  });

  it('the check finds each form of import and leaves look-alikes alone', () => {
    const planted = [
      "import Stripe from 'stripe';",
      'import "stripe";',
      "const Stripe = require('stripe');",
      "const s = require( 'stripe/lib/stripe' );",
      "const m = await import('stripe');",
      "export { default } from 'stripe';",
      "import { loadStripe } from '@stripe/stripe-js';",
    ];
    const harmless = [
      "import { getStripe } from '../lib/stripe';",
      "const x = require('./stripes');",
      "// slice the page into horizontal stripes",
      "const kind = 'stripe';",
    ];
    expect(hits('a.js', planted.join('\n'), STRIPE_IMPORT)).toHaveLength(planted.length);
    expect(hits('b.js', harmless.join('\n'), STRIPE_IMPORT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. Billing columns
// ---------------------------------------------------------------------------

const BILLING_COLUMNS = [
  /\bsubscription_plan\b/,
  /\bsubscription_status\b/,
  /\bdoc_credits\b/,
  /\bstripe_customer_id\b/,
  /\bstripe_subscription_id\b/,
  /\bbilling_events\b/,
  // organizations.plan: written out, or read off an org row (org.plan,
  // organization?.plan, orgs[0].plan).
  /\borganizations\.plan\b/,
  /\b(?:org|orgs|organization|organizations|orgRow|orgData)(?:\[\d+\])?\??\.plan\b/,
];

// A select on the organizations table that names the plan column. The
// statement may run over several lines, so this looks at the whole text.
const ORG_SELECT_PLAN = /\.from\(\s*['"`]organizations['"`]\s*\)[^;]*?\.select\(\s*['"`][^'"`]*\bplan\b[^'"`]*['"`]/g;

function billingReads(file, text) {
  const found = hits(file, text, BILLING_COLUMNS);
  for (const m of text.matchAll(ORG_SELECT_PLAN)) {
    const line = text.slice(0, m.index).split('\n').length;
    found.push(`${file}:${line}: organizations select names plan`);
  }
  return found;
}

describe('3. no app source reads a billing column (issue co-sign-209)', () => {
  it('pages/, lib/, hooks/ and components/ read none of the billing columns', () => {
    const files = appSources();
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap((f) => billingReads(f, read(f)))).toEqual([]);
  });

  it('the check finds each planted billing read', () => {
    const planted = [
      ".select('id, subscription_plan')",
      'if (org.subscription_status === "active") {}',
      'const left = row.doc_credits - 1;',
      "update({ stripe_customer_id: id })",
      "eq('stripe_subscription_id', sub)",
      "from('billing_events')",
      '// reads organizations.plan',
      'const tier = org?.plan;',
    ].join('\n');
    expect(billingReads('a.js', planted)).toHaveLength(8);
    const select = "await supabase\n  .from('organizations')\n  .select('id, plan, name')\n  .eq('id', orgId);";
    expect(billingReads('b.js', select)).toEqual(['b.js:2: organizations select names plan']);
  });

  it('the check leaves other uses of the word plan alone', () => {
    const harmless = [
      '<li>Custom onboarding plan for your organization</li>',
      "supabase.from('organizations').select('id, name').eq('id', orgId).single();",
      'const plan = buildPlan(fields);',
      "supabase.from('organizations').select('require_recipient_verification');",
    ].join('\n');
    expect(billingReads('c.js', harmless)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 4. Links and navigation to the removed pages
// ---------------------------------------------------------------------------

const QUOTE = '[\'"`]';
const TO_REMOVED = `${QUOTE}[^'"\`]*\\/(?:pricing|billing)(?:[/?#][^'"\`]*)?${QUOTE}`;
const REMOVED_PAGE_NAV = [
  // href="/pricing", href={`/${locale}/billing`}, { href: '/pricing' }
  new RegExp(`\\bhref\\s*[=:]\\s*\\{?\\s*${TO_REMOVED}`),
  // router.push('/pricing'), Router.replace(`/${locale}/billing`)
  new RegExp(`\\.(?:push|replace)\\(\\s*${TO_REMOVED}`),
  // router.push({ pathname: '/pricing' })
  new RegExp(`\\bpathname\\s*:\\s*${TO_REMOVED}`),
];

describe('4. no href or router push to /pricing or /billing (issue co-sign-209)', () => {
  it('pages/, lib/, hooks/ and components/ link or navigate to neither page', () => {
    expect(appSources().flatMap((f) => hits(f, read(f), REMOVED_PAGE_NAV))).toEqual([]);
  });

  it('the check finds each planted link or push', () => {
    const planted = [
      '<Link href="/pricing">Plans</Link>',
      '<a href={`/${locale}/billing`}>Billing</a>',
      "{ href: '/en/pricing?plan=pro', label: 'Upgrade' }",
      "router.push('/billing')",
      'router.replace(`/${locale}/pricing`)',
      "router.push({ pathname: '/[locale]/billing' })",
    ];
    expect(hits('a.js', planted.join('\n'), REMOVED_PAGE_NAV)).toHaveLength(planted.length);
  });

  it('the check leaves other paths alone', () => {
    const harmless = [
      '<Link href="/en/dashboard">Home</Link>',
      "router.push('/pricing-faq')",
      "fetch('/api/documents/1/billing-free')",
      "const label = 'Pricing';",
    ];
    expect(hits('b.js', harmless.join('\n'), REMOVED_PAGE_NAV)).toEqual([]);
  });
});
