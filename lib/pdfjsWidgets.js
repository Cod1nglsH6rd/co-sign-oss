/**
 * pdfjs-based widget-annotation extraction — the Node-side fallback for PDFs
 * that defeat the edge extractor: permissions-encrypted documents (SSA SS-5),
 * malformed xrefs pdf-lib rejects, and widgets inside compressed object
 * streams the raw regex scan can't see. pdfjs parses all of these.
 *
 * Runs in the serverless runtime (Node), where pdfjs's lazy worker loading is
 * allowed — the Deno edge runtime forbids the dynamic import it needs.
 */

export async function extractWidgetAnnotations(fileBuffer) {
  // pdfjs's Node build touches DOM globals during parsing; stub what's absent.
  if (typeof globalThis.DOMMatrix === 'undefined') globalThis.DOMMatrix = class {};
  if (typeof globalThis.Path2D === 'undefined') globalThis.Path2D = class {};
  if (typeof globalThis.ImageData === 'undefined') globalThis.ImageData = class {};
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // The fake-worker setup dynamically imports pdf.worker.mjs at runtime;
  // Vercel's file tracing only bundles files reachable through literal
  // imports, so import it here — this both ships the file and pre-warms the
  // module cache the fake worker resolves from.
  try { await import('pdfjs-dist/legacy/build/pdf.worker.mjs'); } catch { /* worker preload is best-effort */ }
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fileBuffer),
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: true,
  }).promise;
  const fields = [];
  try {
    for (let p = 1; p <= doc.numPages; p += 1) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const annots = await page.getAnnotations();
      for (const a of annots) {
        if (!a?.fieldName || !a?.rect) continue;
        const [x0, y0, x1, y1] = a.rect;
        let type = 'text';
        if (a.fieldType === 'Btn') type = 'checkbox';
        else if (a.fieldType === 'Ch') type = 'select';
        else if (a.fieldType === 'Sig') type = 'signature';
        const x = Math.min(x0, x1);
        const y = Math.min(y0, y1);
        const w = Math.abs(x1 - x0);
        const h = Math.abs(y1 - y0);
        fields.push({
          name: a.alternativeText || a.fieldName,
          internalName: a.fieldName,
          label: a.alternativeText || null,
          textLabel: null,
          type,
          value: typeof a.fieldValue === 'string' ? a.fieldValue : null,
          page: p,
          position: {
            page: p,
            x: Math.round((x / vp.width) * 1000) / 10,
            y: Math.round(((vp.height - y - h) / vp.height) * 1000) / 10,
            width: Math.round((w / vp.width) * 1000) / 10,
            height: Math.round((h / vp.height) * 1000) / 10,
            source: 'annotation',
          },
        });
      }
    }
  } finally {
    try { await doc.destroy(); } catch { /* already closed */ }
  }
  return fields;
}
