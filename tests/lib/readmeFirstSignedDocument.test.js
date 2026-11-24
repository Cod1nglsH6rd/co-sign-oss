/**
 * README for a stranger (co-sign-419): right after the Overview comes
 * '### Your first signed document', a numbered walk-through from a clone to a
 * downloaded signed PDF, then '### Run the end-to-end test' with the commands
 * from T18 and a warning that OCR_PROVIDER=stub is for tests only. Status and
 * the project-manager details come after both.
 *
 * Release review T1a (2026-11-21): the README is for strangers. Status still
 * comes after both sections, and says what the project is (not a hosted
 * product; self-host with Docker; MIT) instead of who works on it; the README
 * names no automation, runner hardware or config file of the original owner's;
 * a "Known limits" section says what the app cannot do yet, word for word.
 */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');

function lines() {
  return fs.readFileSync(path.join(root, 'README.md'), 'utf8').split('\n');
}

// Collapse line breaks and runs of spaces so wrapping does not matter.
function flat(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// The '### ' headings in order.
function headings() {
  return lines().filter((l) => /^### /.test(l));
}

// Body of the first '### ' section whose heading starts with `prefix`.
function section(prefix) {
  const all = lines();
  const start = all.findIndex((l) => l.startsWith(prefix));
  expect(start).toBeGreaterThan(-1);
  const rest = all.slice(start + 1);
  const next = rest.findIndex((l) => /^#{1,3} /.test(l));
  return (next === -1 ? rest : rest.slice(0, next)).join('\n');
}

// The numbered steps of a section, each flattened into one string.
function steps(body) {
  const out = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\d+\.\s+(.*)$/);
    if (m) out.push(m[1]);
    else if (out.length && /^\s+\S/.test(line)) out[out.length - 1] += ` ${line}`;
  }
  return out.map(flat);
}

describe("README: 'Your first signed document' and 'Run the end-to-end test'", () => {
  test('come right after the Overview, before Status', () => {
    const order = headings();
    const overview = order.findIndex((h) => h.startsWith('### Overview'));
    expect(overview).toBeGreaterThan(-1);
    expect(order[overview + 1]).toMatch(/^### Your first signed document/);
    expect(order[overview + 2]).toMatch(/^### Run the end-to-end test/);
    const status = order.findIndex((h) => h.startsWith('### Status'));
    expect(status).toBeGreaterThan(overview + 2);
  });

  // Was: the project-manager details (a line naming the private builder) come
  // after both sections. The project details are now the Status section's.
  test('the project details (Status) come after both sections and say what the project is', () => {
    const all = lines();
    const e2e = all.findIndex((l) => l.startsWith('### Run the end-to-end test'));
    const status = all.findIndex((l) => /^### Status\s*$/.test(l));
    expect(e2e).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(e2e);
    const body = flat(section('### Status'));
    expect(body).toMatch(/not a hosted product/i);
    expect(body).toMatch(/self-host/i);
    expect(body).toContain('docker compose up');
    expect(body).toMatch(/\bMIT\b/);
  });

  // The words of the original owner's own setup are checked by a test that
  // stays in the private repository; this one checks what any reader can see.
  test('names no pull request or issue number', () => {
    const text = lines().join('\n');
    // #68-style pull request or issue numbers (anchors such as #known-limits are fine).
    expect(text.match(/(^|[\s(])#\d+\b/gm)).toBeNull();
    expect(text).not.toMatch(/Last merged/i);
  });

  describe('Your first signed document, step by step in order', () => {
    const get = () => steps(section('### Your first signed document'));

    test('has six numbered steps', () => {
      expect(get()).toHaveLength(6);
    });

    test('1: clone and docker compose up', () => {
      const step = get()[0];
      expect(step).toMatch(/git clone/);
      expect(step).toContain('docker compose up');
    });

    test('2: open localhost:3000 and get the setup code', () => {
      const step = get()[1];
      expect(step).toContain('http://localhost:3000');
      expect(step).toMatch(/setup code/i);
      expect(step).toContain('docker compose logs app');
    });

    test('3: the setup screen, No mail, and fields by hand without an AI key', () => {
      const step = get()[2];
      expect(step).toContain('No mail');
      expect(step).toMatch(/without an? (AI|Anthropic)[^.]*key/i);
      expect(step).toMatch(/by hand/i);
    });

    test('4: sign in, upload a PDF or a JPEG/PNG photo, check or place the fields', () => {
      const step = get()[3];
      expect(step).toMatch(/sign in/i);
      expect(step).toContain('/enterprise/login');
      expect(step).toMatch(/upload/i);
      expect(step).toContain('PDF');
      expect(step).toMatch(/JPEG/);
      expect(step).toMatch(/PNG/);
      expect(step).toMatch(/photo/i);
      expect(step).toMatch(/check/i);
      expect(step).toMatch(/place/i);
      expect(step).toMatch(/fields/i);
    });

    test('5: Send Links, copy the link, private window, verify, sign and submit', () => {
      const step = get()[4];
      expect(step).toContain('Send Links');
      expect(step).toMatch(/copy/i);
      expect(step).toMatch(/private window/i);
      expect(step).toMatch(/email/i);
      expect(step).toMatch(/last name/i);
      expect(step).toMatch(/\bsign\b/i);
      expect(step).toMatch(/submit/i);
    });

    test('6: download the signed PDF from Send Links', () => {
      const step = get()[5];
      expect(step).toMatch(/download/i);
      expect(step).toMatch(/signed PDF/i);
      expect(step).toContain('Send Links');
    });
  });

  describe('Run the end-to-end test', () => {
    test('gives the T18 commands in order', () => {
      const body = section('### Run the end-to-end test');
      const compose = 'docker compose -f docker-compose.yml -f tests/e2e/compose.e2e.yml';
      const commands = [
        `${compose} up -d --build`,
        'npx playwright install chromium',
        'node tests/e2e/mainFlow.e2e.js',
        `${compose} down -v`,
      ];
      const at = commands.map((c) => body.indexOf(c));
      for (const i of at) expect(i).toBeGreaterThan(-1);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    test('warns that OCR_PROVIDER=stub is for tests only', () => {
      const body = flat(section('### Run the end-to-end test'));
      expect(body).toContain('OCR_PROVIDER=stub');
      expect(body).toMatch(/tests only|only for tests/i);
    });
  });

  describe('Known limits', () => {
    const get = () => flat(section('### Known limits'));

    test('says, word for word, that each signing link is its own signing', () => {
      expect(get()).toContain(
        "Each signing link is its own signing: the signed PDF from a link holds only that signer's answers and " +
          'signature, even when you send the same document to several people. Cô Sign has no signing group yet, so ' +
          'it cannot produce one PDF with every signer on it, and it has no signing order. Send each signer their ' +
          'own link and keep each signed PDF.'
      );
    });

    test('says, word for word, that the Docker stack has no live updates', () => {
      expect(get()).toContain(
        "The Docker stack has no Supabase Realtime service, so the Documents, Send Links, Recipients and Admin pages " +
          "don't update when a link is opened or a document is signed; reload the page to see it. While a document " +
          'is being prepared, the Documents page still refreshes every 4 seconds. On Supabase cloud, live updates ' +
          'also need Realtime turned on for the `documents` and `fill_sessions` tables, which the repository\'s SQL ' +
          "doesn't do."
      );
    });

    test('says retention runs only where something calls /api/cron/retention', () => {
      expect(get()).toMatch(/[Rr]etention runs only where something calls `\/api\/cron\/retention`/);
    });

    test('says reading fields from scanned PDFs uses edge functions the Docker stack does not run', () => {
      expect(get()).toMatch(/scanned PDFs? uses? Supabase edge functions[^.]*the Docker stack does not run/);
    });
  });
});
