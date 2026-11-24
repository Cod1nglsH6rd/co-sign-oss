/**
 * collectEnvReads resolves process.env[v] when v is the loop variable of
 * `for (const v of ARR)` or the first parameter of an `ARR.forEach` callback,
 * and ARR is a same-file `const ARR = [...]` of string literals only: one
 * read per element, at the line of the process.env read. Anything else stays
 * unresolved with its expression text.
 */

function load() {
  return require('../../scripts/envSync.js');
}

describe('collectEnvReads with a loop over a same-file string array', () => {
  it('resolves a seed-dev-shaped for...of loop to one read per element', () => {
    const { collectEnvReads } = load();
    const text = [
      "require('dotenv').config({ path: '.env.local' });",
      '',
      'const required = [',
      "  'NEXT_PUBLIC_SUPABASE_URL',",
      "  'SUPABASE_SERVICE_ROLE_KEY',",
      '];',
      '',
      'for (const key of required) {',
      '  if (!process.env[key]) {',
      '    console.error(`Missing env var: ${key}`);',
      '    process.exit(1);',
      '  }',
      '}',
    ].join('\n');
    const result = collectEnvReads([{ path: 'scripts/seed-dev.js', text }]);
    expect(result.reads).toEqual([
      { name: 'NEXT_PUBLIC_SUPABASE_URL', file: 'scripts/seed-dev.js', line: 9 },
      { name: 'SUPABASE_SERVICE_ROLE_KEY', file: 'scripts/seed-dev.js', line: 9 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('resolves the first parameter of an arrow forEach callback', () => {
    const { collectEnvReads } = load();
    const text = [
      'const NAMES = ["ALPHA_KEY", "BETA_KEY"];',
      'NAMES.forEach((name) => {',
      '  if (!process.env[name]) throw new Error(name);',
      '});',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/a.js', text }]);
    expect(result.reads).toEqual([
      { name: 'ALPHA_KEY', file: 'lib/a.js', line: 3 },
      { name: 'BETA_KEY', file: 'lib/a.js', line: 3 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('resolves the first parameter of a function forEach callback', () => {
    const { collectEnvReads } = load();
    const text = [
      "const KEYS = ['GAMMA_KEY', 'DELTA_KEY'];",
      'KEYS.forEach(function (k, i) {',
      '  console.log(i);',
      '  return process.env[k];',
      '});',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/b.js', text }]);
    expect(result.reads).toEqual([
      { name: 'GAMMA_KEY', file: 'lib/b.js', line: 4 },
      { name: 'DELTA_KEY', file: 'lib/b.js', line: 4 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps an array with a non-literal element unresolved', () => {
    const { collectEnvReads } = load();
    const text = [
      "const PREFIX = 'APP';",
      "const MIXED = ['ONE_KEY', PREFIX + '_TWO'];",
      'for (const key of MIXED) {',
      '  process.env[key];',
      '}',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/c.js', text }]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/c.js', line: 4, expr: 'key' }]);
  });

  it('keeps a same-named variable read outside the loop unresolved', () => {
    const { collectEnvReads } = load();
    const text = [
      "const required = ['IN_LOOP_KEY'];",
      'for (const key of required) {',
      '  console.log(key);',
      '}',
      'function later(key) {',
      '  return process.env[key];',
      '}',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/d.js', text }]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/d.js', line: 6, expr: 'key' }]);
  });

  it('keeps a loop over an array from another file unresolved', () => {
    const { collectEnvReads } = load();
    const result = collectEnvReads([
      { path: 'lib/list.js', text: "const SHARED = ['SHARED_KEY'];" },
      { path: 'lib/use.js', text: 'for (const key of SHARED) { process.env[key]; }' },
    ]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/use.js', line: 1, expr: 'key' }]);
  });

  it('keeps a read of a different identifier inside the loop unresolved', () => {
    const { collectEnvReads } = load();
    const text = [
      "const required = ['LOOP_KEY'];",
      'required.forEach((key) => {',
      '  process.env[other];',
      '});',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/e.js', text }]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/e.js', line: 3, expr: 'other' }]);
  });
});
