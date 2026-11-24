// Host, id and mailbox kinds of the secret scanner. Every synthetic value is
// assembled at run time from short fragments and a seeded generator, so this
// file holds no secret-shaped literal.

function load() {
  return require('../../scripts/secretScan');
}

// Alphabets with no vowels but y, and no x: random filler can never spell a
// placeholder word (your-, xxx, example, test-, change-me) or a context word
// (supabase, project, ref, db) on its own.
const LO = 'bcdfghjkmnpqrstvwyz';
const MIXED = 'BCDFGHJKMNPQRSTVWYZbcdfghjkmnpqrstvwyz23456789';
const DIGITS = '0123456789';
const HEX = '0123456789abcdef';

function makeRandom(seed) {
  let state = seed >>> 0;
  return function chars(n, set = MIXED) {
    let out = '';
    for (let i = 0; i < n; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out += set[state % set.length];
    }
    return out;
  };
}

const rnd = makeRandom(1330);
const und = '_';
const slashes = ':' + '/' + '/';
const https = 'https' + slashes;
const http = 'http' + slashes;
const supaCo = '.supa' + 'base.co';
const supaCom = '.supa' + 'base.com';

const ref = rnd(20, LO);
const bucket = rnd(12, LO) + '-uploads';
const dsnKey = rnd(32, HEX);
const appHost = rnd(10, LO) + '.vercel.app';
const mailUser = rnd(8, LO) + '.' + rnd(6, LO);

// Each case: one line, the kinds it must report in order, and the secret part
// that must never appear in a hit.
const cases = [
  { label: 'supabase-ref in a *.supabase.co host', kinds: ['supabase-ref'], secret: ref, line: 'NEXT_PUBLIC_SUPABASE_URL=' + https + ref + supaCo },
  { label: 'supabase-ref in a *.supabase.com host', kinds: ['supabase-ref'], secret: ref, line: 'host = "' + ref + supaCom + '"' },
  { label: 'supabase-ref in a postgres.<ref>@ user', kinds: ['supabase-ref'], secret: ref, line: 'connect as postgres.' + ref + '@pooler' },
  { label: 'supabase-ref after project-ref', kinds: ['supabase-ref'], secret: ref, line: 'project-ref: ' + ref },
  { label: 'supabase-ref after project_id', kinds: ['supabase-ref'], secret: ref, line: 'project_id = "' + ref + '"' },
  { label: 'supabase-ref on a line that mentions db', kinds: ['supabase-ref'], secret: ref, line: 'db ' + ref },
  { label: 'supabase-ref with the context after it', kinds: ['supabase-ref'], secret: ref, line: "const id = '" + ref + "' // the ref" },
  { label: 'sentry-dsn', kinds: ['sentry-dsn'], secret: dsnKey, line: 'SENTRY_DSN=' + https + dsnKey + '@o' + rnd(6, DIGITS) + '.ingest.us.sentry.io/' + rnd(7, DIGITS) },
  { label: 'sentry-token sntrys_', kinds: ['sentry-token'], secret: null, line: 'SENTRY_AUTH_TOKEN=' + 'sntry' + 's' + und + rnd(60) },
  { label: 'sentry-token sntryu_', kinds: ['sentry-token'], secret: null, line: 'SENTRY_AUTH_TOKEN=' + 'sntry' + 'u' + und + rnd(64) },
  { label: 'gcp-id project', kinds: ['gcp-id'], secret: null, line: 'GOOGLE_CLOUD_PROJECT=cosign-' + rnd(6, DIGITS) },
  { label: 'gcp-id org', kinds: ['gcp-id'], secret: null, line: 'gcp_org_id: ' + rnd(12, DIGITS) },
  { label: 'vercel-id prj_', kinds: ['vercel-id'], secret: null, line: 'VERCEL_PROJECT_ID=' + 'prj' + und + rnd(28) },
  { label: 'vercel-id team_', kinds: ['vercel-id'], secret: null, line: '"orgId": "' + 'team' + und + rnd(24) + '"' },
  { label: 'sentry-id org', kinds: ['sentry-id'], secret: null, line: 'SENTRY_ORG=' + rnd(10, LO) + '-labs' },
  { label: 'sentry-id project', kinds: ['sentry-id'], secret: null, line: 'sentry_project: ' + rnd(8, LO) + '-web' },
  { label: 'bucket-url gs://', kinds: ['bucket-url'], secret: bucket, line: 'BUCKET=' + 'gs' + slashes + bucket + '/contracts/a.pdf' },
  { label: 'bucket-url s3://', kinds: ['bucket-url'], secret: bucket, line: 'BUCKET=' + 's3' + slashes + bucket + '/a.pdf' },
  { label: 'bucket-url *.s3.amazonaws.com', kinds: ['bucket-url'], secret: bucket, line: 'url: ' + https + bucket + '.s3.amazonaws.com/a.pdf' },
  { label: 'bucket-url regional s3 host', kinds: ['bucket-url'], secret: bucket, line: 'url: ' + https + bucket + '.s3.eu-west-1.amazonaws.com/a.pdf' },
  { label: 'bucket-url supabase storage object', kinds: ['bucket-url', 'supabase-ref'], secret: ref, line: 'FILE=' + https + ref + supaCo + '/storage/v1/object/public/' + bucket + '/a.pdf' },
  { label: 'oauth-redirect after a redirect key', kinds: ['oauth-redirect'], secret: appHost, line: 'GOOGLE_REDIRECT_URI=' + https + appHost + '/api/auth/callback' },
  { label: 'oauth-redirect with a callback path', kinds: ['oauth-redirect'], secret: null, line: 'Authorized origin: ' + https + 'app.' + rnd(8, LO) + '.com/auth/v1/callback' },
  // Real hosts that only contain a placeholder word inside a label.
  { label: 'oauth-redirect on a your... host', kinds: ['oauth-redirect'], secret: null, line: 'REDIRECT_URL=' + https + 'your' + 'company.com/auth/callback' },
  { label: 'oauth-redirect on a domain-... host', kinds: ['oauth-redirect'], secret: null, line: 'REDIRECT_URL=' + https + 'domain' + '-driven.dev/auth/callback' },
  { label: 'personal-email gmail', kinds: ['personal-email'], secret: mailUser, line: 'owner: ' + mailUser + '@gmail.com' },
  { label: 'personal-email outlook', kinds: ['personal-email'], secret: mailUser, line: 'owner: ' + mailUser + '@outlook.com' },
  { label: 'personal-email hotmail', kinds: ['personal-email'], secret: mailUser, line: 'owner: ' + mailUser + '@hotmail.com' },
  { label: 'personal-email yahoo', kinds: ['personal-email'], secret: mailUser, line: 'owner: ' + mailUser + '@yahoo.com' },
  { label: 'personal-email icloud', kinds: ['personal-email'], secret: mailUser, line: 'owner: ' + mailUser + '@icloud.com' },
];

const ALL_KINDS = [
  'supabase-ref',
  'sentry-dsn',
  'sentry-token',
  'gcp-id',
  'vercel-id',
  'sentry-id',
  'bucket-url',
  'oauth-redirect',
  'personal-email',
];

describe('secretScan host, id and mailbox kinds', () => {
  it('registers every new kind', () => {
    const { kinds } = load();
    const names = kinds.map((k) => k.kind);
    for (const k of ALL_KINDS) expect(names).toContain(k);
  });

  it.each(cases.map((c) => [c.label, c]))('reports %s with its kind and line', (_label, c) => {
    const { scanText } = load();
    const text = ['# config', '', c.line, ''].join('\n');
    expect(scanText(text, 'lib/config.js')).toEqual(c.kinds.map((kind) => ({ file: 'lib/config.js', line: 3, kind })));
  });

  it('reports every case in one file on the right lines', () => {
    const { scanText } = load();
    const text = cases.map((c) => c.line).join('\n');
    const expected = [];
    cases.forEach((c, i) => c.kinds.forEach((kind) => expected.push({ file: '.env.local', line: i + 1, kind })));
    expect(scanText(text, '.env.local')).toEqual(expected);
  });

  it('never puts any of the matched text in a hit', () => {
    const { scanText } = load();
    const hits = scanText(cases.map((c) => c.line).join('\n'), 'a.js');
    expect(hits.length).toBeGreaterThanOrEqual(cases.length);
    const serialised = JSON.stringify(hits);
    for (const c of cases) {
      if (c.secret) expect(serialised).not.toContain(c.secret);
      expect(serialised).not.toContain(c.line.slice(-12));
    }
    for (const h of hits) expect(Object.keys(h).sort()).toEqual(['file', 'kind', 'line']);
  });

  // A minified bundle can be one line of a million characters. A detector
  // that rescans the whole line at every position would never finish on it.
  it('scans a 400,000-character line of words and URLs in under two seconds', () => {
    const { scanText } = load();
    const parts = [];
    for (let i = 0; i < 10000; i += 1) parts.push(rnd(20, LO), https + rnd(6, LO) + '.' + rnd(3, LO) + '/' + rnd(4, LO));
    const line = parts.join(' ');
    expect(line.length).toBeGreaterThan(400000);
    const started = Date.now();
    scanText(line, 'public/bundle.min.js');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  // Each placeholder or wildcard line is paired with the same line holding a
  // real value, which does hit, so the empty result means something.
  const realSupa = 'SUPABASE_URL=' + https + ref + supaCo;
  const realRedirect = 'REDIRECT_URL=' + https + appHost + '/auth/callback';
  const redirectTo = (host) => 'REDIRECT_URL=' + https + host + '/auth/callback';
  const storage = (host) => 'FILE=' + https + host + '/storage/v1/object/public/avatars/a.png';
  const dsn = (key, scheme = https) => 'SENTRY_DSN=' + scheme + key + '@o0.ingest.sentry.io/0';
  const xs = (n) => 'x'.repeat(n);

  const placeholders = [
    ['*.supabase.co wildcard', 'supabase-ref', 'SUPABASE_URL=' + https + '*' + supaCo, realSupa],
    ['<project-ref> host', 'supabase-ref', 'SUPABASE_URL=' + https + '<project-ref>' + supaCo, realSupa],
    ['your-project.supabase.co', 'supabase-ref', 'SUPABASE_URL=' + https + 'your-project' + supaCo, realSupa],
    ['postgres.<project-ref>@', 'supabase-ref', 'connect as postgres.<project-ref>@pooler', 'connect as postgres.' + ref + '@pooler'],
    ['20-char ref with no supabase context', 'supabase-ref', 'slug: ' + ref, 'project: ' + ref],
    ['20-char ref next to reproject (project inside a word)', 'supabase-ref', 'reproject ' + ref, 'project ' + ref],
    ['20-char ref next to prefix and mongodb (ref, db inside a word)', 'supabase-ref', 'prefix mongodbs ' + ref, 'prefix db ' + ref],
    ['20-char ref next to subsupabased (supabase inside a word)', 'supabase-ref', 'subsupabased ' + ref, 'supabase ' + ref],
    ['storage URL on your-project', 'bucket-url', storage('your-project' + supaCo), storage(ref + supaCo)],
    ['example.com redirect', 'oauth-redirect', redirectTo('example.com'), realRedirect],
    ['app.example.com redirect', 'oauth-redirect', redirectTo('app.example.com'), realRedirect],
    ['localhost redirect', 'oauth-redirect', redirectTo('localhost:3000'), realRedirect],
    ['127.0.0.1 redirect', 'oauth-redirect', redirectTo('127.0.0.1:3000'), realRedirect],
    ['your-domain redirect', 'oauth-redirect', redirectTo('your-domain.com'), realRedirect],
    ['yourdomain redirect', 'oauth-redirect', redirectTo('yourdomain.com'), realRedirect],
    ['<your-app> redirect', 'oauth-redirect', redirectTo('<your-app>'), realRedirect],
    ['gs://your-bucket', 'bucket-url', 'BUCKET=' + 'gs' + slashes + 'your-bucket', 'BUCKET=' + 'gs' + slashes + bucket],
    ['s3://example-bucket', 'bucket-url', 'BUCKET=' + 's3' + slashes + 'example-bucket', 'BUCKET=' + 's3' + slashes + bucket],
    ['*.s3.amazonaws.com wildcard', 'bucket-url', 'url: ' + https + '*.s3.amazonaws.com/a.pdf', 'url: ' + https + bucket + '.s3.amazonaws.com/a.pdf'],
    ['<key> DSN', 'sentry-dsn', dsn('<key>'), dsn(dsnKey)],
    ['examplePublicKey DSN', 'sentry-dsn', dsn('example' + 'PublicKey'), dsn(dsnKey)],
    ['http:// (not https://) DSN', 'sentry-dsn', dsn(dsnKey, http), dsn(dsnKey)],
    ['xxx sentry token', 'sentry-token', 'SENTRY_AUTH_TOKEN=' + 'sntry' + 's' + und + xs(32), 'SENTRY_AUTH_TOKEN=' + 'sntry' + 's' + und + rnd(40)],
    ['your-org sentry org', 'sentry-id', 'SENTRY_ORG=your-org', 'SENTRY_ORG=' + rnd(9, LO)],
    ['your-project-id gcp project', 'gcp-id', 'GOOGLE_CLOUD_PROJECT=your-project-id', 'GOOGLE_CLOUD_PROJECT=cosign-' + rnd(6, DIGITS)],
    ['xxx vercel project', 'vercel-id', 'VERCEL_PROJECT_ID=' + 'prj' + und + xs(28), 'VERCEL_PROJECT_ID=' + 'prj' + und + rnd(28)],
    ['example@gmail.com', 'personal-email', 'contact: ' + 'example' + '@gmail.com', 'contact: ' + mailUser + '@gmail.com'],
  ];

  it.each(placeholders)('%s gives no %s hit', (_label, kind, line, realLine) => {
    const { scanText } = load();
    expect(scanText(['# notes', line, ''].join('\n'), 'README.md')).toEqual([]);
    expect(scanText(['# notes', realLine, ''].join('\n'), 'README.md').map((h) => h.kind)).toContain(kind);
  });
});
