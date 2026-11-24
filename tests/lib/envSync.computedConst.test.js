/**
 * collectEnvReads resolves process.env[IDENT] when IDENT is a same-file
 * string constant (`const IDENT = 'NAME'`): it becomes a read of NAME at the
 * line of the process.env read. Anything else in the brackets stays
 * unresolved with its expression text.
 */

function load() {
  return require('../../scripts/envSync.js');
}

describe('collectEnvReads with same-file string constants', () => {
  it('resolves a sessionAuth-shaped constant to a read at the read line, not the declaration', () => {
    const { collectEnvReads } = load();
    const text = [
      "import { createHash } from 'crypto';",
      '',
      "const STRICT_SESSION_TOKEN_HASH_FLAG = 'COSIGN_SESSION_TOKEN_HASH_STRICT';",
      '',
      'function isStrict() {',
      "  return String(process.env[STRICT_SESSION_TOKEN_HASH_FLAG] ?? 'true').toLowerCase() !== 'false';",
      '}',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/sessionAuth.js', text }]);
    expect(result.reads).toEqual([
      { name: 'COSIGN_SESSION_TOKEN_HASH_STRICT', file: 'lib/sessionAuth.js', line: 6 },
    ]);
    expect(result.unresolved).toEqual([]);
  });

  it('keeps imported, let and non-literal identifiers unresolved with their expr', () => {
    const { collectEnvReads } = load();
    const text = [
      "import { IMPORTED_FLAG } from './flags';",
      "let LET_FLAG = 'LET_NAME';",
      "const BUILT_FLAG = 'PRE' + '_FIX';",
      'const a = process.env[IMPORTED_FLAG];',
      'const b = process.env[LET_FLAG];',
      'const c = process.env[BUILT_FLAG];',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/f.js', text }]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([
      { file: 'lib/f.js', line: 4, expr: 'IMPORTED_FLAG' },
      { file: 'lib/f.js', line: 5, expr: 'LET_FLAG' },
      { file: 'lib/f.js', line: 6, expr: 'BUILT_FLAG' },
    ]);
  });

  it('keeps a member expression such as cfg.priceEnv unresolved even when cfg is a constant', () => {
    const { collectEnvReads } = load();
    const text = [
      "const priceEnv = 'NOT_THIS';",
      'function price(cfg) {',
      '  return process.env[cfg.priceEnv] || null;',
      '}',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/stripe.js', text }]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/stripe.js', line: 3, expr: 'cfg.priceEnv' }]);
  });

  it('does not use a constant declared in another file', () => {
    const { collectEnvReads } = load();
    const result = collectEnvReads([
      { path: 'lib/flags.js', text: "const SHARED_FLAG = 'SHARED_NAME';" },
      { path: 'lib/use.js', text: 'const v = process.env[SHARED_FLAG];' },
    ]);
    expect(result.reads).toEqual([]);
    expect(result.unresolved).toEqual([{ file: 'lib/use.js', line: 1, expr: 'SHARED_FLAG' }]);
  });

  it('does not count a write through a constant as a read', () => {
    const { collectEnvReads } = load();
    const text = [
      "const FLAG = 'WRITTEN_NAME';",
      "process.env[FLAG] = 'x';",
      'const after = process.env[FLAG];',
    ].join('\n');
    const result = collectEnvReads([{ path: 'lib/w.js', text }]);
    expect(result.reads).toEqual([{ name: 'WRITTEN_NAME', file: 'lib/w.js', line: 3 }]);
    expect(result.unresolved).toEqual([]);
  });
});
