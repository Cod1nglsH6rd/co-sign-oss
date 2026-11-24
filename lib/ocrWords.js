/**
 * Tesseract OCR word extraction for the OCR-anchored positioning path.
 *
 * Kept separate from lib/ocrAnchor.js (pure geometry) so tesseract.js is only
 * imported at runtime when the OCR-anchor path is actually used. The worker is
 * cached across invocations on a warm serverless instance.
 */

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng');
    })().catch((err) => { workerPromise = null; throw err; });
  }
  return workerPromise;
}

/**
 * Run OCR on a rendered page image and return word boxes in pixel coordinates.
 * @param {Buffer|Uint8Array} pngBuffer  PNG of the rendered page
 * @returns {Promise<Array<{text:string, bbox:{x0:number,y0:number,x1:number,y1:number}}>>}
 */
export async function ocrWords(pngBuffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(pngBuffer, {}, { blocks: true });
  const words = [];
  const push = (w) => { if (w && w.text && w.bbox) words.push({ text: w.text, bbox: w.bbox }); };
  if (Array.isArray(data.words) && data.words.length) {
    data.words.forEach(push);
  } else {
    // Walk blocks → paragraphs → lines → words.
    const visit = (nodes) => {
      if (!Array.isArray(nodes)) return;
      for (const n of nodes) {
        if (n.words) visit(n.words);
        else if (n.lines) visit(n.lines);
        else if (n.paragraphs) visit(n.paragraphs);
        else if (n.blocks) visit(n.blocks);
        else push(n);
      }
    };
    visit(data.blocks);
  }
  return words;
}

export default ocrWords;
