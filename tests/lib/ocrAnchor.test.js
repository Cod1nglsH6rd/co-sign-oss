import fs from 'fs';
import path from 'path';
import { anchorFieldsToOcr, locateLabel } from '../../lib/ocrAnchor';

const fx = (n) => JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures', n), 'utf8'));

// Real captures from a scanned (image-only) W-2 run:
//  - w2-words: Tesseract OCR word boxes (pixel coords) for the rendered page
//  - w2-vlm-fields: Claude vision output (field_name + verbatim label_text + type), NO coordinates
//  - w2-ground-truth: the exact AcroForm widget rectangles (%), i.e. the true field positions
const { W, H, words } = fx('w2-words.json');
const fields = fx('w2-vlm-fields.json');
const gt = fx('w2-ground-truth.json');

const iou = (a, b) => {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.w), y1 = Math.min(a.y + a.height, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  if (i <= 0) return 0;
  return i / (a.width * a.height + b.w * b.h - i);
};
const center = (b) => ({ x: b.x + (b.w ?? b.width) / 2, y: b.y + (b.h ?? b.height) / 2 });

describe('OCR-anchored positioning', () => {
  const placed = anchorFieldsToOcr(fields, words, W, H);
  const positions = placed.map((p) => p.position);

  it('locates a known label in the OCR words', () => {
    const box = locateLabel('Wages, tips, other compensation', words);
    expect(box).not.toBeNull();
    expect(box.x1).toBeGreaterThan(box.x0);
  });

  it('positions most detected fields', () => {
    // The fixture vision output has 39 fields; labels should resolve for the bulk.
    expect(placed.length).toBeGreaterThanOrEqual(25);
  });

  it('places >=85% of boxes overlapping the true field cell (vs unusable vision coords)', () => {
    const overlap = positions.filter((d) => gt.some((g) => iou(d, g) > 0.15)).length;
    const rate = overlap / positions.length;
    // measured ~0.93 on this capture; guard against regression below 0.85
    expect(rate).toBeGreaterThanOrEqual(0.85);
  });

  it('keeps median center error small (deterministic geometry, not model coords)', () => {
    const errs = positions.map((d) => {
      const c = center(d);
      let best = Infinity;
      for (const g of gt) { const gc = center(g); best = Math.min(best, Math.hypot(c.x - gc.x, c.y - gc.y)); }
      return best;
    }).sort((a, b) => a - b);
    const median = errs[Math.floor(errs.length / 2)];
    expect(median).toBeLessThan(2.5); // % of page; ~1.5 measured
  });

  it('emits percentage coordinates in range, tagged ocr-anchor', () => {
    for (const p of positions) {
      expect(p.source).toBe('ocr-anchor');
      for (const k of ['x', 'y', 'width', 'height']) {
        expect(p[k]).toBeGreaterThanOrEqual(0);
        expect(p[k]).toBeLessThanOrEqual(100);
      }
    }
  });
});
