/**
 * parseEnvExample(text) reads .env.example: `NAME=value` and commented
 * `# NAME=value` lines, each with the comment line directly above it, and the
 * names listed more than once. compareEnv(collected, example) compares the
 * collector's reads with that list: names read but not listed (missing),
 * listed but not read (stale), duplicates, unresolved reads passed through,
 * and names whose comment is not `# required|optional · <adapter> · <why>`.
 */

function load() {
  return require('../../scripts/envSync.js');
}

const EXAMPLE = [
  '# required · supabase · project URL for the browser and server clients',
  'NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co',
  '',
  '# required · anthropic · key for document analysis',
  'ANTHROPIC_API_KEY=your-key',
].join('\n');

const SOURCE = [
  'const url = process.env.NEXT_PUBLIC_SUPABASE_URL;',
  'const key = process.env.ANTHROPIC_API_KEY;',
].join('\n');

function compareSource(source, example) {
  const { collectEnvReads, parseEnvExample, compareEnv } = load();
  const collected = collectEnvReads([{ path: 'lib/a.js', text: source }]);
  return compareEnv(collected, parseEnvExample(example));
}

describe('parseEnvExample', () => {
  it('returns each name with the comment line directly above it', () => {
    const { parseEnvExample } = load();
    const parsed = parseEnvExample(EXAMPLE);
    expect(parsed.entries.map((e) => [e.name, e.comment])).toEqual([
      ['NEXT_PUBLIC_SUPABASE_URL', '# required · supabase · project URL for the browser and server clients'],
      ['ANTHROPIC_API_KEY', '# required · anthropic · key for document analysis'],
    ]);
    expect(parsed.duplicates).toEqual([]);
  });

  it('accepts a commented `# NAME=value` entry and keeps its own comment', () => {
    const { parseEnvExample } = load();
    const parsed = parseEnvExample(
      ['# optional · sentry · error reports; off when unset', '# SENTRY_DSN=https://example.invalid/1'].join('\n'),
    );
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].name).toBe('SENTRY_DSN');
    expect(parsed.entries[0].commented).toBe(true);
    expect(parsed.entries[0].comment).toBe('# optional · sentry · error reports; off when unset');
  });

  it('gives no comment when the line above is blank', () => {
    const { parseEnvExample } = load();
    const parsed = parseEnvExample(['# a heading', '', 'LONELY=1'].join('\n'));
    expect(parsed.entries[0].comment).toBeNull();
  });

  it('reports a name listed twice once in duplicates', () => {
    const { parseEnvExample } = load();
    const parsed = parseEnvExample(['A=1', 'B=2', '# A=3', 'A=4'].join('\n'));
    expect(parsed.duplicates).toEqual(['A']);
  });
});

describe('compareEnv', () => {
  it('reports nothing when reads and the example agree', () => {
    expect(compareSource(SOURCE, EXAMPLE)).toEqual({
      missing: [],
      stale: [],
      duplicates: [],
      unresolved: [],
      badComments: [],
    });
  });

  it('reports a new process.env.NEW_SETTING read as missing', () => {
    const result = compareSource(`${SOURCE}\nconst s = process.env.NEW_SETTING;`, EXAMPLE);
    expect(result.missing).toEqual(['NEW_SETTING']);
    expect(result.stale).toEqual([]);
  });

  it('reports a listed name no code reads any more as stale', () => {
    const result = compareSource('const url = process.env.NEXT_PUBLIC_SUPABASE_URL;', EXAMPLE);
    expect(result.stale).toEqual(['ANTHROPIC_API_KEY']);
    expect(result.missing).toEqual([]);
  });

  it('counts a commented entry as listed', () => {
    const example = `${EXAMPLE}\n\n# optional · sentry · error reports; off when unset\n# SENTRY_DSN=`;
    const result = compareSource(`${SOURCE}\nconst d = process.env.SENTRY_DSN;`, example);
    expect(result.missing).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.badComments).toEqual([]);
  });

  it('passes duplicates from the example through', () => {
    const example = `${EXAMPLE}\n# required · anthropic · key for document analysis\nANTHROPIC_API_KEY=again`;
    expect(compareSource(SOURCE, example).duplicates).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('passes unresolved reads from the collector through', () => {
    const result = compareSource(`${SOURCE}\nconst v = process.env[name];`, EXAMPLE);
    expect(result.unresolved).toEqual([{ file: 'lib/a.js', line: 3, expr: 'name' }]);
  });

  it('flags a comment whose adapter is not a known one', () => {
    const example = EXAMPLE.replace('· anthropic ·', '· openai ·');
    expect(compareSource(SOURCE, example).badComments).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('flags a comment with no explanation', () => {
    const example = EXAMPLE.replace('# required · anthropic · key for document analysis', '# required · anthropic');
    expect(compareSource(SOURCE, example).badComments).toEqual(['ANTHROPIC_API_KEY']);
  });

  it('flags a comment that is neither required nor optional, and a name with no comment', () => {
    const example = [
      '# maybe · stripe · secret key for charges',
      'STRIPE_SECRET_KEY=sk_test',
      '',
      'NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co',
    ].join('\n');
    const source = 'process.env.STRIPE_SECRET_KEY; process.env.NEXT_PUBLIC_SUPABASE_URL;';
    expect(compareSource(source, example).badComments).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'STRIPE_SECRET_KEY']);
  });

  it('accepts every listed adapter', () => {
    const adapters = ['supabase', 'anthropic', 'stripe', 'resend', 'upstash', 'sentry', 'vercel', 'none'];
    const example = adapters.map((a, i) => `# optional · ${a} · setting ${i}\nN${i}=x`).join('\n');
    const source = adapters.map((a, i) => `process.env.N${i};`).join('\n');
    expect(compareSource(source, example).badComments).toEqual([]);
  });
});
