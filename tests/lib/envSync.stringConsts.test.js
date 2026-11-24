/**
 * stringConstants(text) lists a file's `const IDENT = 'LITERAL'` declarations
 * as a Map from identifier to string value. Declarations are found in the
 * masked code, so ones written inside comments, strings or template text are
 * not counted. let/var, non-literal values and consts declared twice with
 * different values are left out.
 */

function load() {
  return require('../../scripts/envSync.js');
}

function consts(text) {
  const { stringConstants } = load();
  expect(typeof stringConstants).toBe('function');
  return stringConstants(text);
}

function entries(text) {
  return [...consts(text).entries()];
}

describe('stringConstants', () => {
  it('returns a Map with the one entry of the ticket example', () => {
    const result = consts("const STRICT_SESSION_TOKEN_HASH_FLAG = 'COSIGN_SESSION_TOKEN_HASH_STRICT';");
    expect(result).toBeInstanceOf(Map);
    expect([...result.entries()]).toEqual([
      ['STRICT_SESSION_TOKEN_HASH_FLAG', 'COSIGN_SESSION_TOKEN_HASH_STRICT'],
    ]);
  });

  it('reads single, double and plain backtick quotes', () => {
    const text = [
      "const A = 'ONE';",
      'const B = "TWO"',
      'const C = `THREE`;',
      'export const D = "FOUR";',
    ].join('\n');
    expect(entries(text)).toEqual([
      ['A', 'ONE'],
      ['B', 'TWO'],
      ['C', 'THREE'],
      ['D', 'FOUR'],
    ]);
  });

  it('keeps the value exactly as written, including spaces and line breaks', () => {
    expect(entries("const MSG = 'has two  spaces';")).toEqual([['MSG', 'has two  spaces']]);
    expect(entries('const T = `LINE_ONE\nLINE_TWO`;')).toEqual([['T', 'LINE_ONE\nLINE_TWO']]);
  });

  it('reads a value holding an escaped quote as written, up to its real closing quote', () => {
    const text = [
      "const Q = 'it\\'s', R = \"a\\\"b\";",
      'const T = `x\\`y`;',
      "const AFTER = 'Z';",
    ].join('\n');
    expect(entries(text)).toEqual([
      ['Q', "it\\'s"],
      ['R', 'a\\"b'],
      ['T', 'x\\`y'],
      ['AFTER', 'Z'],
    ]);
  });

  it('reads a const that ends its line without a semicolon or closes a block', () => {
    const text = [
      'function f() {',
      "  const A = 'ONE'",
      "  const B = 'TWO' }",
      "const C = 'THREE'",
    ].join('\n');
    expect(entries(text)).toEqual([
      ['A', 'ONE'],
      ['B', 'TWO'],
      ['C', 'THREE'],
    ]);
  });

  it('ignores a declaration inside a line or block comment', () => {
    const text = [
      "// const IN_LINE = 'NO';",
      "/* const IN_BLOCK = 'NO'; */",
      "const REAL = 'YES';",
    ].join('\n');
    expect(entries(text)).toEqual([['REAL', 'YES']]);
  });

  it('ignores a declaration inside a string or template text', () => {
    const text = [
      'const s = "const IN_STRING = \'NO\'";',
      'const t = `const IN_TEMPLATE = \'NO\'`;',
    ].join('\n');
    expect(entries(text)).toEqual([
      ['s', "const IN_STRING = 'NO'"],
      ['t', "const IN_TEMPLATE = 'NO'"],
    ]);
  });

  it('leaves out let and var declarations', () => {
    const text = ["let L = 'NO';", "var V = 'NO';", "const K = 'YES';"].join('\n');
    expect(entries(text)).toEqual([['K', 'YES']]);
  });

  it('leaves out consts set to a call, a concatenation or a template with ${}', () => {
    const text = [
      "const CALL = String('NO');",
      "const CAT = 'A' + 'B';",
      "const SPLIT = 'A'",
      "  + 'B';",
      "const MEMBER = 'NO'.trim();",
      'const TPL = `PRE_${x}`;',
      'const NUM = 3;',
      "const OK = 'YES';",
    ].join('\n');
    expect(entries(text)).toEqual([['OK', 'YES']]);
  });

  it('leaves out consts set to an in or instanceof test on a literal', () => {
    const text = [
      "const IN = 'NO' in obj;",
      "const INST = 'NO' instanceof Object;",
      "const IN_SPLIT = 'NO'",
      '  in obj;',
      "const INST_SPLIT = 'NO'",
      '  instanceof Object;',
      "const OK = 'YES';",
    ].join('\n');
    expect(entries(text)).toEqual([['OK', 'YES']]);
  });

  it('reads past a template with nested templates to the next declarator', () => {
    const text = [
      "const T = `${a ? `x${b}` : 'y'}`, NEXT = 'N';",
      "const AFTER = 'Z';",
    ].join('\n');
    expect(entries(text)).toEqual([
      ['NEXT', 'N'],
      ['AFTER', 'Z'],
    ]);
  });

  it('reads every declarator of a comma-separated const', () => {
    const text = [
      "const A = 'ONE', B = \"TWO\",",
      '  C = `THREE`;',
      "const W = 612, H = 'HIGH', X = f(1, 2), Y = 'WHY';",
    ].join('\n');
    expect(entries(text)).toEqual([
      ['A', 'ONE'],
      ['B', 'TWO'],
      ['C', 'THREE'],
      ['H', 'HIGH'],
      ['Y', 'WHY'],
    ]);
  });

  it('drops a name whose second declaration hides behind a comma in the same const', () => {
    const text = ["const FLAG = 'A';", "function b() { const N = 1, FLAG = 'B'; }"].join('\n');
    expect(entries(text)).toEqual([]);
  });

  it('drops an identifier declared as a const twice with different values', () => {
    const text = [
      'function a() {',
      "  const FLAG = 'ONE';",
      '}',
      'function b() {',
      "  const FLAG = 'TWO';",
      '}',
      'function c() {',
      "  const FLAG = 'ONE';",
      '}',
    ].join('\n');
    expect(consts(text).has('FLAG')).toBe(false);
    expect(consts(text).size).toBe(0);
  });

  it('drops an identifier declared once with a literal and once with a non-literal', () => {
    const literalFirst = [
      'function a() {',
      "  const FLAG = 'A';",
      '}',
      'function b(cfg) {',
      '  const FLAG = cfg.name;',
      '}',
      "const OTHER = 'KEPT';",
    ].join('\n');
    expect(entries(literalFirst)).toEqual([['OTHER', 'KEPT']]);

    const literalLast = [
      'function b(cfg) {',
      '  const FLAG = cfg.name;',
      '}',
      'function a() {',
      "  const FLAG = 'A';",
      '}',
    ].join('\n');
    expect(entries(literalLast)).toEqual([]);
  });

  it('drops an identifier that a const destructuring also declares', () => {
    const text = [
      "const FLAG = 'A';",
      "const KEEP = 'K';",
      'function b(cfg) {',
      "  const { FLAG, other: RENAMED = 'd' } = cfg;",
      '  const [FIRST, ...REST] = list;',
      '}',
      "const RENAMED = 'R', FIRST = 'F', REST = 'S';",
    ].join('\n');
    expect(entries(text)).toEqual([['KEEP', 'K']]);
  });

  it('keeps an identifier declared as a const twice with the same value', () => {
    const text = [
      'function a() {',
      "  const FLAG = 'SAME';",
      '}',
      'function b() {',
      '  const FLAG = "SAME";',
      '}',
    ].join('\n');
    expect(entries(text)).toEqual([['FLAG', 'SAME']]);
  });

  it('returns an empty Map for text with no string constants', () => {
    const result = consts('module.exports = {};');
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });
});
