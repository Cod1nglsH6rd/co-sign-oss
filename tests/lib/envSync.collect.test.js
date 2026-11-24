/**
 * collectEnvReads(files) finds the env vars source files read from
 * process.env, with file and line, and returns reads it cannot name yet
 * (process.env[someVar]) as unresolved instead of dropping them. Text inside
 * comments and string literals is not code, and writes and deletes are not
 * reads.
 */

function load() {
  return require('../../scripts/envSync.js');
}

function names(result) {
  return result.reads.map((r) => r.name).sort();
}

describe('collectEnvReads', () => {
  it('finds dot, single-quoted and double-quoted bracket reads with file and line', () => {
    const { collectEnvReads } = load();
    const text = [
      'const a = process.env.ALPHA;',
      "const b = process.env['BETA'];",
      'const c = process.env["GAMMA"];',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/a.js', text }]);
    expect(result.reads).toEqual([
      { name: 'ALPHA', file: 'lib/a.js', line: 1 },
      { name: 'BETA', file: 'lib/a.js', line: 2 },
      { name: 'GAMMA', file: 'lib/a.js', line: 3 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('yields each key of a destructuring from process.env, renamed or not', () => {
    const { collectEnvReads } = load();
    const text = 'const x = 1;\nconst { A, B: b } = process.env;\n';
    const result = collectEnvReads([{ path: 'lib/d.js', text }]);
    expect(result.reads).toEqual([
      { name: 'A', file: 'lib/d.js', line: 2 },
      { name: 'B', file: 'lib/d.js', line: 2 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('reads a multi-line destructuring past comments and string defaults holding commas', () => {
    const { collectEnvReads } = load();
    const text = [
      'const {',
      '  A, // note, with a comma',
      "  B = 'x, y',",
      '  C: c, /* D, */',
      "  'E': e,",
      '} = process.env;',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/m.js', text }]);
    expect(result.reads).toEqual([
      { name: 'A', file: 'lib/m.js', line: 2 },
      { name: 'B', file: 'lib/m.js', line: 3 },
      { name: 'C', file: 'lib/m.js', line: 4 },
      { name: 'E', file: 'lib/m.js', line: 5 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('finds NEXT_PUBLIC_ reads in a client-style file like server reads', () => {
    const { collectEnvReads } = load();
    const client = [
      "'use client';",
      'export default function Banner() {',
      '  return <a href={process.env.NEXT_PUBLIC_SITE_URL}>home</a>;',
      '}',
    ].join('\n');
    const server = 'const k = process.env.SERVER_KEY;';
    const result = collectEnvReads([
      { path: 'components/Banner.js', text: client },
      { path: 'pages/api/x.js', text: server },
    ]);
    expect(result.reads).toEqual([
      { name: 'NEXT_PUBLIC_SITE_URL', file: 'components/Banner.js', line: 3 },
      { name: 'SERVER_KEY', file: 'pages/api/x.js', line: 1 },
    ]);
  });

  it('does not count assignments or deletes as reads', () => {
    const { collectEnvReads } = load();
    const text = [
      "process.env.X = 'a';",
      "process.env['Y'] = 'b';",
      'process.env["Z"]= "c";',
      'delete process.env.W;',
      "if (process.env.KEPT === 'a') {}",
    ].join('\n');
    const result = collectEnvReads([{ path: 'tests/setup.js', text }]);
    expect(names(result)).toEqual(['KEPT']);
    expect(result.unresolved).toEqual([]);
  });

  it('does not count compound assignments, increments or parenthesised deletes as reads', () => {
    const { collectEnvReads } = load();
    const text = [
      "process.env.A += 'x';",
      'process.env.B ??= "y";',
      'process.env.C++;',
      '--process.env.D;',
      'delete (process.env.E);',
      "delete process.env['F'];",
      'const ok = process.env.G == 1;',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/w.js', text }]);
    expect(names(result)).toEqual(['G']);
    expect(result.unresolved).toEqual([]);
  });

  it('ignores process.env text inside comments and string literals', () => {
    const { collectEnvReads } = load();
    const text = [
      '// set process.env.LINE_COMMENT first',
      '/* process.env.BLOCK_COMMENT',
      '   and process.env[blockVar] */',
      "const s = 'process.env.SINGLE';",
      'const d = "process.env.DOUBLE";',
      'const t = `process.env.TEMPLATE ${process.env.IN_TEMPLATE}`;',
      'const r = /process.env.REGEX/;',
      'const real = process.env.REAL;',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/c.js', text }]);
    expect(result.reads).toEqual([
      { name: 'IN_TEMPLATE', file: 'lib/c.js', line: 6 },
      { name: 'REAL', file: 'lib/c.js', line: 8 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('returns process.env[someVar] as unresolved with file and line, never dropped', () => {
    const { collectEnvReads } = load();
    const text = "const name = 'K';\n\nconst v = process.env[someVar];\nconst ok = process.env.OK;";
    const result = collectEnvReads([{ path: 'lib/u.js', text }]);
    expect(result.unresolved).toEqual([{ file: 'lib/u.js', line: 3, expr: 'someVar' }]);
    expect(result.reads).toEqual([{ name: 'OK', file: 'lib/u.js', line: 4 }]);
  });
});
