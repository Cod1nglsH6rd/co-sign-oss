import fs from 'fs';
import path from 'path';

// Issue co-sign-259: the every-minute Vercel OCR cron and its route are gone.
// Parked OCR jobs are resumed by the in-process OCR worker (started from
// instrumentation.js), so the docs and the OCR comments must say so.

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (text) => text.replace(/\s+/g, ' ');

// README.md plus every Markdown file under docs/, except docs/decisions/.
function docFiles() {
  const out = ['README.md'];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel !== 'docs/decisions') walk(rel);
      } else if (entry.name.endsWith('.md')) {
        out.push(rel);
      }
    }
  };
  walk('docs');
  return out;
}

// The comment text of a JS file: // comments and /* */ blocks.
function comments(text) {
  return (text.match(/\/\*[\s\S]*?\*\/|(?<![:'"`\\])\/\/[^\n]*/g) || []).join('\n');
}

describe('every-minute OCR cron removed (issue co-sign-259)', () => {
  it('vercel.json has no process-ocr cron', () => {
    const crons = JSON.parse(read('vercel.json')).crons || [];
    expect(crons.filter((c) => /process-ocr/.test(c.path))).toEqual([]);
  });

  it('the route file pages/api/cron/process-ocr.js is gone', () => {
    expect(fs.existsSync(path.join(ROOT, 'pages/api/cron/process-ocr.js'))).toBe(false);
  });

  it('no README or docs/ file outside docs/decisions mentions api/cron/process-ocr', () => {
    const hits = docFiles().filter((f) => read(f).includes('api/cron/process-ocr'));
    expect(hits).toEqual([]);
  });

  it('no README or docs/ line describes an every-minute cron', () => {
    const hits = [];
    for (const f of docFiles()) {
      read(f).split('\n').forEach((line, i) => {
        if (/cron/i.test(line) && /every[- ]minute|per-minute/i.test(line)) hits.push(`${f}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it.each([
    'README.md',
    'docs/PRD.md',
    'docs/GO-LIVE-CHECKLIST.md',
    'docs/SECURITY-AUDIT.md',
    'docs/COMPLIANCE-ROADMAP.md',
  ])('%s says parked OCR jobs are resumed by the in-app OCR worker', (file) => {
    expect(flat(read(file))).toMatch(/parked OCR jobs are resumed by the in-app OCR worker/i);
  });

  it.each(['lib/ocrResume.js', 'pages/api/ocr.js'])(
    '%s comments name the in-process OCR worker',
    (file) => {
      expect(flat(comments(read(file)))).toMatch(/in-process OCR worker/i);
    },
  );

  it.each(['lib/ocrResume.js', 'pages/api/ocr.js'])(
    '%s comments mention cron only as the manual cron-secret trigger',
    (file) => {
      const left = comments(read(file))
        .replace(/cron[- ]secret/gi, '')
        .replace(/cronStaleCutoffISO|isCronAuthorized|cronAuth\w*/g, '');
      const lines = left.split('\n').filter((l) => /cron/i.test(l));
      expect(lines).toEqual([]);
    },
  );
});
