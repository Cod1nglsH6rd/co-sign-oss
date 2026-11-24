/**
 * pdfjs-based text-layer extraction, run in the app's own (Node) process the
 * same way lib/pdfjsWidgets.js reads form widgets. Replaces the old call to a
 * Supabase edge function that was never in this repository.
 *
 * Returns one flat list of items, every page in order, each shaped:
 *
 *   { text, page, x, y, width, height }
 *
 *   text    the item's string. Read as `item.text` in matchFieldToLabel
 *           (lib/pdfTextExtraction.js: `if (item.text === '●' || ...)`) and as
 *           `t.text` in pages/api/ocr.js (`fullTextContent = textItems?.slice(0, 300).map(t => t.text)`).
 *   page    the page number, starting at 1. lib/pdfTextExtraction.js
 *           matchFieldToLabel: `textItems.filter(t => t.page === page)`;
 *           pages/api/ocr.js: `Math.max(...textItems.map(t => t.page || 1))`
 *           (the page count, so numbering starts at 1).
 *   x, y    the item's left edge and its baseline, in percent of the page
 *           width and height, measured from the TOP-left corner (the same
 *           origin and unit as field positions). lib/pdfTextExtraction.js
 *           formatTextForClaude: `at (x:${item.x.toFixed(1)}%, y:${item.y.toFixed(1)}%, ...`;
 *           lib/textLayerPositioning.js positionValueInBlank:
 *           `const baselineY = typeof item?.y === 'number' ? item.y : 0;`
 *           (the value box is placed 2% above that baseline).
 *   width,  the item's size in percent of the page width and height.
 *   height  lib/pdfTextExtraction.js formatTextForClaude:
 *           `w:${item.width.toFixed(1)}%, h:${item.height.toFixed(1)}%`;
 *           computeWritablePosition: `const lineHeight = label.height || 1.5;`.
 *
 * Items with no visible text (blank strings, marked-content markers) are left
 * out, so a scanned page with no text layer gives no items.
 */

function percent(value, whole) {
  return Math.round((value / whole) * 10000) / 100;
}

export async function extractTextItemsInProcess(pdfBuffer) {
  if (!pdfBuffer || !pdfBuffer.byteLength) {
    throw new Error('Cannot read the PDF text layer: no PDF data was given');
  }

  // pdfjs's Node build touches DOM globals during parsing; stub what's absent.
  if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class {};
  if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class {};
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = class {};
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Same worker preload as lib/pdfjsWidgets.js: ships the file in the
  // serverless bundle and pre-warms the module cache the fake worker uses.
  try { await import('pdfjs-dist/legacy/build/pdf.worker.mjs'); } catch { /* worker preload is best-effort */ }

  let doc;
  try {
    doc = await pdfjs.getDocument({
      data: new Uint8Array(pdfBuffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: true,
    }).promise;
  } catch (err) {
    throw new Error(`Cannot read the PDF text layer: the PDF could not be opened (${err?.message || err})`);
  }

  const items = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (typeof item?.str !== 'string' || !item.str.trim()) continue;
        const [, , , , tx, ty] = item.transform;
        items.push({
          text: item.str,
          page: p,
          x: percent(tx, vp.width),
          y: percent(vp.height - ty, vp.height),
          width: percent(item.width, vp.width),
          height: percent(item.height, vp.height),
        });
      }
    }
  } finally {
    try { await doc.destroy(); } catch { /* already closed */ }
  }
  return items;
}
