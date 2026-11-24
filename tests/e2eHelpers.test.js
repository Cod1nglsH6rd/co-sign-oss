import crypto from 'crypto';
import { PDFDocument, StandardFonts, decodePDFRawStream, PDFArray } from 'pdf-lib';

// Issue co-sign-415: the end-to-end helpers in tests/e2e/helpers.js, tested
// offline. Every fetch is a stand-in function; every PDF is made in memory.

function load() {
  return require('./e2e/helpers.js');
}

const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The text a page draws with Tj, from its decoded content streams.
function pageText(doc) {
  const contents = doc.getPage(0).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => doc.context.lookup(ref)) : [contents];
  const source = streams.map((s) => Buffer.from(decodePDFRawStream(s).decode()).toString('latin1')).join('\n');
  const parts = [];
  for (const m of source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) parts.push(Buffer.from(m[1], 'hex').toString('latin1'));
  for (const m of source.matchAll(/\(([^)]*)\)\s*Tj/g)) parts.push(m[1]);
  return parts.join('\n');
}

// A signed copy: the original with a name written on it.
async function signedCopy(original) {
  const doc = await PDFDocument.load(original);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.getPage(0).drawText('Ada Lovelace', { x: 200, y: 700, size: 12, font });
  return doc.save();
}

describe('makeFormPdf', () => {
  it('makes a one-page PDF labelled Full name and Signature', async () => {
    const bytes = await load().makeFormPdf();
    expect(Buffer.from(bytes.slice(0, 5)).toString('latin1')).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const text = pageText(doc);
    expect(text).toContain('Full name');
    expect(text).toContain('Signature');
  });
});

describe('readSetupCode', () => {
  const code = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

  it('finds the setup code in the app log', () => {
    const output = [
      'app-1  | starting',
      `app-1  | [setupLock] Setup code: ${code} (saved in /app/.cosign/setup-code)`,
      'app-1  | ready',
    ].join('\n');
    expect(load().readSetupCode(output)).toBe(code);
  });

  it('returns null when the log has no setup code', () => {
    expect(load().readSetupCode('app-1  | ready\n')).toBeNull();
    expect(load().readSetupCode('')).toBeNull();
  });
});

describe('waitForHealth', () => {
  it('keeps asking until the address answers ok', async () => {
    const answers = [
      () => Promise.reject(new Error('ECONNREFUSED')),
      () => Promise.resolve({ ok: false, status: 503 }),
      () => Promise.resolve({ ok: true, status: 200 }),
    ];
    const calls = [];
    const fetchFn = (url) => {
      calls.push(url);
      return answers[calls.length - 1]();
    };
    const res = await load().waitForHealth('http://localhost:3000/api/health', fetchFn, {
      timeoutMs: 5000,
      intervalMs: 1,
    });
    expect(res.ok).toBe(true);
    expect(calls).toEqual([
      'http://localhost:3000/api/health',
      'http://localhost:3000/api/health',
      'http://localhost:3000/api/health',
    ]);
  });

  it('rejects once the time is up', async () => {
    let calls = 0;
    const fetchFn = () => {
      calls += 1;
      return Promise.resolve({ ok: false, status: 503 });
    };
    await expect(
      load().waitForHealth('http://localhost:3000/api/health', fetchFn, { timeoutMs: 50, intervalMs: 5 })
    ).rejects.toThrow(/localhost:3000\/api\/health/);
    expect(calls).toBeGreaterThan(1);
  });
});

describe('randomPassword', () => {
  it('gives a long, different string each time', () => {
    const { randomPassword } = load();
    const a = randomPassword();
    const b = randomPassword();
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

describe('checkSignedPdf', () => {
  let original;
  let signed;

  beforeAll(async () => {
    original = await load().makeFormPdf();
    signed = await signedCopy(original);
  });

  it('finds no problem in a good signed copy', async () => {
    const problems = await load().checkSignedPdf(signed, { sha256: sha(signed), bytes: signed.length, original });
    expect(problems).toEqual([]);
  });

  it('says when the bytes are not a PDF', async () => {
    const bytes = Buffer.from('<html>not found</html>');
    const problems = await load().checkSignedPdf(bytes, { sha256: sha(bytes), bytes: bytes.length, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/not a PDF/i);
  });

  it('says when a PDF will not load', async () => {
    const bytes = Buffer.from('%PDF-1.7\nthis body is cut off');
    const problems = await load().checkSignedPdf(bytes, { sha256: sha(bytes), bytes: bytes.length, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/load/i);
  });

  it('says when the fingerprint is wrong', async () => {
    const problems = await load().checkSignedPdf(signed, { sha256: sha(original), bytes: signed.length, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/fingerprint/i);
  });

  it('says when the size is wrong', async () => {
    const problems = await load().checkSignedPdf(signed, { sha256: sha(signed), bytes: signed.length + 1, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/size/i);
  });

  it('says when the page count differs from the original', async () => {
    const doc = await PDFDocument.load(signed);
    doc.addPage();
    const twoPages = await doc.save();
    const problems = await load().checkSignedPdf(twoPages, { sha256: sha(twoPages), bytes: twoPages.length, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/page/i);
  });

  it('says when the signed PDF is identical to the original', async () => {
    const problems = await load().checkSignedPdf(original, { sha256: sha(original), bytes: original.length, original });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/identical/i);
  });

  it('lists every problem at once', async () => {
    const problems = await load().checkSignedPdf(original, { sha256: sha(signed), bytes: signed.length, original });
    expect(problems).toHaveLength(3);
  });
});
