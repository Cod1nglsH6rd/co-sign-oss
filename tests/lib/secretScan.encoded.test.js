// Encoded runs: scanText decodes long base64 blobs and %-encoded runs and
// rescans what they hold. Every synthetic value is assembled at run time from
// short fragments and a seeded generator, then encoded here with Buffer and
// encodeURIComponent, so this file holds no secret-shaped literal.

function load() {
  return require('../../scripts/secretScan');
}

// No vowels but y and no x, so filler never spells a placeholder word.
const MIXED = 'BCDFGHJKMNPQRSTVWYZbcdfghjkmnpqrstvwyz23456789';
const UPPER = 'BCDFGHJKMNPQRSTVWYZ23456789';
const LO = 'bcdfghjkmnpqrstvwyz';
const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function makeRandom(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
  return {
    chars(n, set = MIXED) {
      let out = '';
      for (let i = 0; i < n; i += 1) out += set[next() % set.length];
      return out;
    },
    bytes(n) {
      const out = [];
      for (let i = 0; i < n; i += 1) out.push(next() >>> 24);
      return Buffer.from(out);
    },
  };
}

const rnd = makeRandom(1340);
const dash = '-';
const slashes = ':' + '/' + '/';
const b64 = (s) => Buffer.from(s).toString('base64');

const anthropicKey = 'sk' + dash + 'ant' + dash + 'api03' + dash + rnd.chars(40);
// 18 + 13 + 40 = 71 bytes, so its base64 is 96 characters ending in one '='.
const keyLine = 'ANTHROPIC_API_KEY=' + anthropicKey;
const password = rnd.chars(16);
const connection = 'postgres' + slashes + 'app_user:' + password + '@pg.' + rnd.chars(10, LO) + '.net:5432/main';
const awsKey = 'AK' + 'IA' + rnd.chars(16, UPPER);

const encodedKey = b64(keyLine);
const encodedConnection = encodeURIComponent(connection);

describe('secretScan encoded runs', () => {
  it('reports a base64-encoded key with its base kind on the line of the run', () => {
    const { scanText } = load();
    const text = ['# config', '', 'payload: "' + encodedKey + '"', ''].join('\n');
    const hits = scanText(text, 'lib/config.js');
    expect(hits.map(({ file, line, kind }) => ({ file, line, kind }))).toEqual([{ file: 'lib/config.js', line: 3, kind: 'anthropic' }]);
  });

  it.each([
    ['KEY=value', 'DATABASE_URL=' + encodedConnection],
    ['short key', 'u=' + encodedConnection],
    ['quoted value', 'DATABASE_URL="' + encodedConnection + '"'],
    ['single-quoted value', "DATABASE_URL='" + encodedConnection + "'"],
    ['query parameter', 'https://app.' + rnd.chars(8, LO) + '.io/go?db=' + encodedConnection + '&x=1'],
  ])('reports a URL-encoded connection string (%s) with its base kind on the line of the run', (_label, line) => {
    const { scanText } = load();
    const text = ['# config', line, ''].join('\n');
    const hits = scanText(text, '.env.local');
    expect(hits.map(({ file, line: n, kind }) => ({ file, line: n, kind }))).toEqual([{ file: '.env.local', line: 2, kind: 'connection-string' }]);
  });

  it('keeps an apostrophe, which encodeURIComponent leaves as it is, inside one %-encoded run', () => {
    const { scanText } = load();
    const org = rnd.chars(8, LO) + dash + rnd.chars(6, LO);
    const encoded = encodeURIComponent("SENTRY_ORG='" + org + "'");
    expect(encoded).toContain("'");
    expect(scanText('q=' + encoded, 'a.txt').map((h) => [h.line, h.kind])).toEqual([[1, 'sentry-id']]);
  });

  it('reports encoded runs on their own lines in one file', () => {
    const { scanText } = load();
    const text = ['a', 'x = ' + encodedKey, 'b', 'c', 'u=' + encodedConnection].join('\n');
    expect(scanText(text, 'a.txt').map((h) => [h.line, h.kind])).toEqual([
      [2, 'anthropic'],
      [5, 'connection-string'],
    ]);
  });

  it('decodes base64 runs of 40 characters but not shorter ones', () => {
    const { scanText } = load();
    // 30 bytes encode to exactly 40 characters; 27 bytes to 36.
    const forty = b64('AWS_ID = ' + awsKey + ' ');
    const short = b64('AWS_ID=' + awsKey);
    expect(forty).toHaveLength(40);
    expect(short).toHaveLength(36);
    expect(scanText('v: ' + forty, 'a.yml').map((h) => h.kind)).toEqual(['aws']);
    expect(scanText('v: ' + short, 'a.yml')).toEqual([]);
  });

  it.each(['sha512', 'sha384', 'sha1'])('skips a lockfile-style %s integrity hash', (algo) => {
    const { scanText } = load();
    // Even a hash whose bytes decode to a key is not rescanned.
    const crafted = '      "integrity": "' + algo + dash + encodedKey + '",';
    const real = '      "integrity": "' + algo + dash + rnd.bytes(64).toString('base64') + '",';
    expect(scanText(['{', crafted, real, '}'].join('\n'), 'package-lock.json')).toEqual([]);
    // The same run under another key does hit, so the empty result means something.
    expect(scanText('      "data": "' + encodedKey + '",', 'package-lock.json').map((h) => h.kind)).toEqual(['anthropic']);
  });

  it('gives no hit for random or plain-text base64 that holds no secret', () => {
    const { scanText } = load();
    const lines = [
      'blob: ' + rnd.bytes(48).toString('base64'),
      'blob: ' + rnd.bytes(120).toString('base64'),
      'note: ' + b64('this is only a plain sentence that holds nothing at all'),
    ];
    expect(scanText(lines.join('\n'), 'data.json')).toEqual([]);
  });

  describe('a base64 run that is not well formed is not decoded', () => {
    const unpadded = encodedKey.replace(/=+$/, '');
    // The last character of an unpadded 2-byte tail carries two unused bits,
    // which must be zero; the next letter of the alphabet sets one of them.
    const last = B64_ALPHABET.indexOf(unpadded[unpadded.length - 1]);
    const loose = [
      ['a lone trailing character', b64(keyLine + ' ') + 'Q'],
      ['padding that does not fit the length', encodedKey + '='],
      ['unused bits that are not zero', unpadded.slice(0, -1) + B64_ALPHABET[last + 1]],
    ];

    it.each(loose)('%s', (_label, run) => {
      const { scanText } = load();
      // Node's lenient decoder still reads the key out of each of these runs.
      expect(Buffer.from(run, 'base64').toString('utf8').startsWith(keyLine)).toBe(true);
      expect(scanText('blob: ' + run, 'a.txt')).toEqual([]);
    });

    it('while the same key without padding, or with a whole last group, does hit', () => {
      const { scanText } = load();
      expect(last % 4).toBe(0);
      expect(scanText('blob: ' + unpadded, 'a.txt').map((h) => h.kind)).toEqual(['anthropic']);
      expect(scanText('blob: ' + b64(keyLine + ' '), 'a.txt').map((h) => h.kind)).toEqual(['anthropic']);
    });
  });

  it.each([
    ['C0 controls and bytes that are not UTF-8', Buffer.from([0, 1, 2, 0xff, 0xfe, 7]), '%00%01%07'],
    ['a C1 control (NEL)', Buffer.from('\u0085'), '%C2%85'],
    ['a C1 control (CSI)', Buffer.from('\u009b'), '%C2%9B'],
    ['a bidi override', Buffer.from(String.fromCharCode(0x202e)), '%E2%80%AE'],
    ['a zero-width space', Buffer.from(String.fromCharCode(0x200b)), '%E2%80%8B'],
  ])('gives no hit when the decoded text holds %s', (_label, bytes, urlPrefix) => {
    const { scanText } = load();
    const binary = Buffer.concat([bytes, Buffer.from(keyLine)]).toString('base64');
    expect(scanText('blob: ' + binary, 'a.bin.txt')).toEqual([]);
    expect(scanText('u=' + urlPrefix + encodedConnection, 'a.txt')).toEqual([]);
    // Controls: the printable forms hit.
    expect(scanText('blob: ' + encodedKey, 'a.bin.txt').map((h) => h.kind)).toEqual(['anthropic']);
    expect(scanText('u=' + encodedConnection, 'a.txt').map((h) => h.kind)).toEqual(['connection-string']);
  });

  it.each([
    ['an invalid byte', '%FF-'],
    ['a lone continuation byte', '%80-'],
    ['a cut-off three-byte sequence', '%E2%82-'],
  ])('gives no hit for a %%-encoded run that is not valid UTF-8 (%s)', (_label, badPrefix) => {
    const { scanText } = load();
    // The rest of the run decodes to a connection string; the bad bytes make
    // the whole run undecodable, so it is not rescanned piece by piece.
    expect(scanText('u=' + badPrefix + encodedConnection, 'a.txt')).toEqual([]);
    // Control: the same run with a valid character in their place hits.
    expect(scanText('u=-' + encodedConnection, 'a.txt').map((h) => h.kind)).toEqual(['connection-string']);
  });

  it('puts neither the encoded nor the decoded text in a hit', () => {
    const { scanText } = load();
    const hits = scanText(['x = ' + encodedKey, 'u=' + encodedConnection].join('\n'), 'a.txt');
    expect(hits).toHaveLength(2);
    const serialised = JSON.stringify(hits);
    for (const s of [encodedKey, encodedKey.slice(-16), encodedConnection, encodedConnection.slice(-16), anthropicKey, keyLine, connection, password]) {
      expect(serialised).not.toContain(s);
    }
  });
});
