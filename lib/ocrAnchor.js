/**
 * OCR-anchored field positioning.
 *
 * Why this exists: vision models are reliable at READING a form (what fields
 * exist, their labels and types) but unreliable at emitting COORDINATES — in
 * testing the coordinate *units* even flipped between percent and pixels run to
 * run, and precision drifted badly. OCR (e.g. Tesseract) gives exact, stable
 * word bounding boxes. So we let the vision model name each field + its printed
 * label text, locate that label in the OCR words to get an exact anchor, and
 * derive the writable box from the surrounding OCR geometry (the cell bounded by
 * the next text row below and the next token to the right). No model coordinates.
 *
 * Validated on a scanned 47-field W-2 (see tests/lib/ocrAnchor.test.js):
 *   ~93% of placed boxes overlap the true field cell (IoU>0.15), median center
 *   error ~1.5% of page — vs vision-estimated coordinates which were unusable.
 *
 * This module is pure (no OCR/model deps): it takes already-extracted OCR words
 * and vision fields and returns positioned fields. The OCR + vision calls live
 * in the caller (pages/api/ocr.js) so this stays trivially testable.
 */

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Find a label's bounding box in OCR words by best consecutive-token overlap.
 * @param {string} labelText
 * @param {Array<{text:string, bbox:{x0,y0,x1,y1}}>} words
 * @returns {{x0,y0,x1,y1}|null}
 */
function locateLabel(labelText, words) {
  const toks = String(labelText || '').toLowerCase().split(/\s+/).map(norm).filter(Boolean);
  if (!toks.length) return null;
  const wn = words.map((w) => ({ b: w.bbox || w.b, n: norm(w.text ?? w.t) }));
  let best = null;
  for (let i = 0; i < wn.length; i += 1) {
    let hits = 0;
    const used = [];
    for (let k = 0; k < toks.length && i + k < wn.length; k += 1) {
      const wnk = wn[i + k].n;
      if (wnk && (wnk.includes(toks[k]) || toks[k].includes(wnk))) { hits += 1; used.push(wn[i + k]); }
      else break;
    }
    if (hits > 0) {
      const score = hits / toks.length;
      if (!best || score > best.score) {
        best = {
          score,
          box: {
            x0: Math.min(...used.map((u) => u.b.x0)),
            y0: Math.min(...used.map((u) => u.b.y0)),
            x1: Math.max(...used.map((u) => u.b.x1)),
            y1: Math.max(...used.map((u) => u.b.y1)),
          },
        };
      }
    }
  }
  return best && best.score >= 0.5 ? best.box : null;
}

/**
 * Position vision-detected fields using OCR word geometry.
 * @param {Array<{field_name?:string, label_text:string, field_type?:string}>} fields
 * @param {Array<{text:string, bbox:{x0,y0,x1,y1}}>} words  OCR words (pixel coords)
 * @param {number} pageW  rendered page width in px (same space as word boxes)
 * @param {number} pageH  rendered page height in px
 * @param {object} [opts]
 * @returns {Array} fields with a `position` {page,x,y,width,height} in % (top-left origin), plus `_anchored:true`
 */
function anchorFieldsToOcr(fields, words, pageW, pageH, opts = {}) {
  const page = opts.page || 1;
  const maxBelowPx = opts.maxBelowPx || Math.round(pageH * 0.085); // how far down a cell can extend
  const maxRightPx = opts.maxRightPx || Math.round(pageW * 0.36);
  const out = [];
  for (const f of fields) {
    const L = locateLabel(f.label_text, words);
    if (!L) continue;
    // bottom edge = nearest OCR word row below the label that overlaps its column
    let bottom = null;
    for (const w of words) {
      const b = w.bbox || w.b;
      if (b.y0 > L.y1 + 5 && b.y0 - L.y1 < maxBelowPx) {
        const ox = Math.min(b.x1, L.x1) - Math.max(b.x0, L.x0);
        if (ox > 2 && (bottom == null || b.y0 < bottom)) bottom = b.y0;
      }
    }
    if (bottom == null) bottom = L.y1 + Math.round(pageH * 0.022);
    // right edge = nearest OCR word to the right within the writable band
    let right = null;
    for (const w of words) {
      const b = w.bbox || w.b;
      if (b.x0 > L.x1 + 15 && b.x0 - L.x1 < maxRightPx) {
        const oy = Math.min(b.y1, bottom) - Math.max(b.y0, L.y0);
        if (oy > 2 && (right == null || b.x0 < right)) right = b.x0;
      }
    }
    if (right == null) right = Math.min(L.x0 + Math.round(pageW * 0.21), pageW);

    const x0 = L.x0;
    const y0 = L.y1 + 3;
    const x1 = Math.max(right - 4, L.x1);
    const y1 = Math.max(bottom - 4, y0 + 10);
    if (x1 - x0 < 6 || y1 - y0 < 6) continue;
    out.push({
      ...f,
      position: {
        page,
        x: +(x0 / pageW * 100).toFixed(2),
        y: +(y0 / pageH * 100).toFixed(2),
        width: +((x1 - x0) / pageW * 100).toFixed(2),
        height: +((y1 - y0) / pageH * 100).toFixed(2),
        source: 'ocr-anchor',
      },
      _anchored: true,
    });
  }
  return out;
}

export { locateLabel, anchorFieldsToOcr, norm };
