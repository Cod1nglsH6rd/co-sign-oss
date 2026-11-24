// Every synthetic key below is assembled at run time from short fragments and
// a seeded generator, so this file holds no key-shaped literal.

function load() {
  return require('../../scripts/secretScan');
}

// Seeded generator over an alphabet with no x/X, so random filler can never
// look like an "xxx" placeholder.
function makeRandom(seed) {
  let state = seed >>> 0;
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWYZabcdefghijkmnpqrstuvwyz0123456789';
  return function chars(n, set = alphabet) {
    let out = '';
    for (let i = 0; i < n; i += 1) {
      state = (state * 1664525 + 1013904223) >>> 0;
      out += set[state % set.length];
    }
    return out;
  };
}

const rnd = makeRandom(1320);
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWYZ0123456789';
const LOWER = 'abcdefghijkmnpqrstuvwyz';
const dash = '-';
const und = '_';
const slashes = ':' + '/' + '/';

const samples = [
  { kind: 'anthropic', value: 'sk' + dash + 'ant' + dash + 'api03' + dash + rnd(40) },
  { kind: 'openai', value: 'sk' + dash + 'proj' + dash + rnd(40) },
  { kind: 'openai', value: 'sk' + dash + rnd(48) },
  { kind: 'stripe', value: 'sk' + und + 'live' + und + rnd(24) },
  { kind: 'stripe', value: 'sk' + und + 'test' + und + rnd(24) },
  { kind: 'stripe', value: 'rk' + und + 'live' + und + rnd(24) },
  { kind: 'stripe', value: 'pk' + und + 'live' + und + rnd(24) },
  { kind: 'stripe', value: 'pk' + und + 'test' + und + rnd(24) },
  // Resend keys come as a single token after re_, or as re_<id>_<secret>.
  { kind: 'resend', value: 're' + und + rnd(32) },
  { kind: 'resend', value: 're' + und + rnd(32, LOWER) },
  { kind: 'resend', value: 're' + und + rnd(8) + und + rnd(24) },
  { kind: 'github', value: 'gh' + 'p' + und + rnd(36) },
  { kind: 'github', value: 'gh' + 's' + und + rnd(36) },
  { kind: 'github', value: 'github' + und + 'pat' + und + rnd(22) + und + rnd(59) },
  { kind: 'aws', value: 'AK' + 'IA' + rnd(16, UPPER) },
  { kind: 'aws', value: 'AS' + 'IA' + rnd(16, UPPER) },
  { kind: 'google', value: 'AI' + 'za' + rnd(35) },
  { kind: 'connection-string', value: 'postgres' + slashes + 'admin:' + rnd(16) + '@db.' + rnd(8) + '.internal:5432/app' },
  { kind: 'connection-string', value: 'postgresql' + slashes + 'admin:' + rnd(16) + '@db.' + rnd(8) + '.internal/app' },
  { kind: 'connection-string', value: 'mysql' + slashes + 'root:' + rnd(16) + '@' + rnd(8) + '.internal/app' },
  { kind: 'connection-string', value: 'mongodb' + slashes + 'svc:' + rnd(16) + '@' + rnd(8) + '.internal/app' },
  { kind: 'connection-string', value: 'mongodb+srv' + slashes + 'svc:' + rnd(16) + '@cluster0.' + rnd(8) + '.net/app' },
  { kind: 'connection-string', value: 'redis' + slashes + 'default:' + rnd(16) + '@' + rnd(8) + '.internal:6379' },
  { kind: 'stripe-id', value: 'price' + und + rnd(24) },
  { kind: 'stripe-id', value: 'prod' + und + rnd(14) },
  { kind: 'stripe-id', value: 'whsec' + und + rnd(32) },
  { kind: 'jwt', value: 'ey' + 'J' + rnd(30) + '.' + 'ey' + 'J' + rnd(60) + '.' + rnd(43) },
];

describe('secretScan core', () => {
  it('exports scanText and a kinds registry of {kind, test} entries', () => {
    const { scanText, kinds } = load();
    expect(typeof scanText).toBe('function');
    expect(Array.isArray(kinds)).toBe(true);
    const names = kinds.map((k) => k.kind);
    for (const s of samples) expect(names).toContain(s.kind);
    for (const k of kinds) {
      expect(typeof k.kind).toBe('string');
      expect(k.test).toBeDefined();
    }
  });

  it.each(samples.map((s) => [s.kind, s]))('reports a %s secret with its kind and line number', (_name, s) => {
    const { scanText } = load();
    const text = ['// header', '', 'const config = {', `  value: "${s.value}",`, '};'].join('\n');
    const hits = scanText(text, 'lib/config.js');
    expect(hits).toEqual([{ file: 'lib/config.js', line: 4, kind: s.kind }]);
  });

  it('reports a single-token resend key in an env line', () => {
    const { scanText } = load();
    const key = 're' + und + rnd(36);
    const hits = scanText(['# mail', 'RESEND_API_KEY=' + key].join('\n'), '.env.local');
    expect(hits).toEqual([{ file: '.env.local', line: 2, kind: 'resend' }]);
  });

  it('reports a lowercase-only single-token resend key', () => {
    const { scanText } = load();
    const key = 're' + und + rnd(28, LOWER);
    const hits = scanText(['# mail', '', 'RESEND_API_KEY="' + key + '"'].join('\n'), '.env.local');
    expect(hits).toEqual([{ file: '.env.local', line: 3, kind: 'resend' }]);
  });

  it('does not report a re_ code identifier as a resend key', () => {
    const { scanText } = load();
    const ident = 're' + und + 'render' + und + 'when' + und + 'props' + und + 'change';
    expect(scanText('function ' + ident + '() {}', 'lib/a.js')).toEqual([]);
  });

  it('does not report a key-shaped value glued to the end of a longer word', () => {
    const { scanText } = load();
    // Same boundary for every direct key kind, aws included.
    for (const s of samples.filter((x) => x.kind !== 'connection-string')) {
      expect(scanText('id' + und + s.value, 'lib/a.js')).toEqual([]);
      expect(scanText('id' + s.value, 'lib/a.js')).toEqual([]);
    }
  });

  it('reports every kind in one file on the right lines', () => {
    const { scanText } = load();
    const text = samples.map((s, i) => `KEY_${i}=${s.value}`).join('\n');
    const hits = scanText(text, '.env.local');
    expect(hits).toEqual(samples.map((s, i) => ({ file: '.env.local', line: i + 1, kind: s.kind })));
  });

  it('never puts any of the matched text in a hit', () => {
    const { scanText } = load();
    const text = samples.map((s) => `x = '${s.value}'`).join('\n');
    const hits = scanText(text, 'a.js');
    expect(hits).toHaveLength(samples.length);
    const serialised = JSON.stringify(hits);
    for (const s of samples) {
      expect(serialised).not.toContain(s.value);
      // nor any long piece of it
      expect(serialised).not.toContain(s.value.slice(-12));
    }
    for (const h of hits) expect(Object.keys(h).sort()).toEqual(['file', 'kind', 'line']);
  });

  describe('placeholders never hit', () => {
    const ant = 'sk' + dash + 'ant' + dash;
    const live = 'sk' + und + 'live' + und;

    // Each line here is matched by its kind's own detector, so an empty result
    // can only come from the shared placeholder filter.
    const filtered = [
      ['your-…', 'anthropic', ant + 'your' + dash + 'anthropic-api-key-here-1234'],
      ['xxx', 'stripe', live + 'xxx' + 'xxxxxxxxxxxxxxxxxxxxx'],
      ['XXXX', 'aws', 'AK' + 'IA' + 'XXXX' + 'XXXXXXXXXXXX'],
      ['xxx in a resend key', 'resend', 're' + und + 'xxx' + 'xxxxxxxxxxxxxxxxxxxxxxxx1'],
      ['placeholder', 'anthropic', ant + 'placeholder' + dash + 'value-for-the-docs'],
      ['example', 'connection-string', 'postgres' + slashes + 'user:' + 'secret' + '@db.example.com:5432/app'],
      ['example in a key', 'github', 'gh' + 'p' + und + 'example' + 'ABCDEFGHJKLMNPQRSTUVWYZabcdefghi'],
      ['test-…', 'anthropic', ant + 'test' + dash + 'abcdefghijkmnpqrstuvwyz0123'],
      ['change-me', 'connection-string', 'redis' + slashes + 'default:' + 'change' + dash + 'me' + '@cache.internal:6379'],
      ['truncated ...', 'anthropic', ant + 'api03' + dash + 'abcdefghijkmnpqrstuvwyz' + '...'],
      ['truncated … (ellipsis)', 'stripe-id', 'whsec' + und + 'abcdefghijkmnpqrstuvwyz0123' + '…'],
      ['empty password value', 'connection-string', 'DATABASE_URL=' + 'postgres' + slashes + 'admin:' + '@db.internal/app'],
      ['empty user and password', 'connection-string', 'REDIS_URL=' + 'redis' + slashes + ':' + '@cache.internal:6379'],
      ['.env.example KEY=your-key-here (anthropic)', 'anthropic', 'ANTHROPIC_API_KEY=' + ant + 'your' + dash + 'key' + dash + 'here' + dash + '0123456789'],
      ['.env.example KEY=your-key-here (openai)', 'openai', 'OPENAI_API_KEY=' + 'sk' + dash + 'your' + dash + 'openai' + dash + 'key-goes-here'],
      ['README-style truncated key', 'anthropic', 'Set `' + ant + 'api03' + dash + 'abcdefghijkmnpqrstuvwyz' + '...` in your environment.'],
    ];

    it.each(filtered)('%s (%s)', (_label, kind, line) => {
      const { scanText, kinds } = load();
      const entry = kinds.find((k) => k.kind === kind);
      expect(new RegExp(entry.test.source, entry.test.flags).test(line)).toBe(true);
      expect(scanText(['# notes', line, ''].join('\n'), 'README.md')).toEqual([]);
    });

    // Lines no detector can match at all. Each is paired with the same line
    // holding a real key, which does hit, so the empty result means something.
    const real = samples[0].value;
    const stripeReal = samples[3].value;
    const controls = [
      ['empty value', 'ANTHROPIC_API_KEY=', 'ANTHROPIC_API_KEY=' + real],
      ['empty quoted value', 'ANTHROPIC_API_KEY=""', 'ANTHROPIC_API_KEY="' + real + '"'],
      ['.env.example KEY=', 'STRIPE_SECRET_KEY=', 'STRIPE_SECRET_KEY=' + stripeReal],
      ['.env.example KEY=your-key-here', 'STRIPE_SECRET_KEY=' + 'your' + dash + 'key' + dash + 'here', 'STRIPE_SECRET_KEY=' + stripeReal],
      ['README-style sk-ant-...', 'Set `' + ant + '...` in your environment.', 'Set `' + real + '` in your environment.'],
    ];

    it.each(controls)('%s', (_label, line, realLine) => {
      const { scanText } = load();
      expect(scanText(['# notes', line, ''].join('\n'), 'README.md')).toEqual([]);
      expect(scanText(['# notes', realLine, ''].join('\n'), 'README.md')).toHaveLength(1);
    });

    it('exports a shared isPlaceholder filter', () => {
      const { isPlaceholder } = load();
      expect(typeof isPlaceholder).toBe('function');
      expect(isPlaceholder('')).toBe(true);
      expect(isPlaceholder('""')).toBe(true);
      expect(isPlaceholder('your' + dash + 'key' + dash + 'here')).toBe(true);
      expect(isPlaceholder(ant + '...')).toBe(true);
      expect(isPlaceholder('change' + dash + 'me')).toBe(true);
      expect(isPlaceholder(ant + 'your' + dash + 'key' + dash + 'here')).toBe(true);
      expect(isPlaceholder(samples[0].value)).toBe(false);
    });
  });
});
