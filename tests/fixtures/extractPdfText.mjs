// Test helper: reads PDF bytes on stdin, prints the text of every page as JSON.
//
// pdfjs-dist 5 ships only ES modules, which Jest's CommonJS runtime cannot
// import, so tests run this in a child Node process instead. The extraction is
// real pdfjs-dist (the legacy build, which is the one meant for Node), not a mock.
import { createRequire } from 'module';

// pdfjs-dist polyfills DOMMatrix from its optional @napi-rs/canvas dependency
// and throws at load time without it. Text extraction never renders, so when
// that optional package is not installed an empty stand-in is enough.
if (typeof globalThis.DOMMatrix === 'undefined') {
  try {
    createRequire(import.meta.url).resolve('@napi-rs/canvas');
  } catch {
    globalThis.DOMMatrix = class DOMMatrix {};
  }
}

const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const data = new Uint8Array(Buffer.concat(chunks));

const doc = await getDocument({ data, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i += 1) {
  const page = await doc.getPage(i);
  const content = await page.getTextContent();
  pages.push(content.items.map((item) => item.str || '').join(''));
}
await doc.destroy();
process.stdout.write(JSON.stringify(pages));
