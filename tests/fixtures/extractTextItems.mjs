// Test helper: reads PDF bytes on stdin, runs the app's own text-layer reader
// (extractTextItemsInProcess in lib/pdfjsTextItems.js) on them, and prints the
// result as JSON: {"items": [...]}, or {"error": "<message>"} when it throws.
//
// pdfjs-dist 5 ships only ES modules, which Jest's CommonJS runtime cannot
// import, so tests run this in a child Node process, as with extractPdfText.mjs.
// lib/pdfjsTextItems.js uses ES module syntax in a package with no "type"
// field; Node 20.19 and later load such a file as an ES module on their own
// (module syntax detection), so this helper needs Node 20.19 or later.

// pdfjs prints its warnings with console.log; keep stdout for the JSON alone.
console.log = (...args) => console.error(...args);

const { extractTextItemsInProcess } = await import('../../lib/pdfjsTextItems.js');

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

let result;
try {
  result = { items: await extractTextItemsInProcess(Buffer.concat(chunks)) };
} catch (err) {
  result = { error: String(err?.message || err) };
}
// Exit once written: after a PDF that fails to open, pdfjs's in-process worker
// can keep the event loop alive.
process.stdout.write(JSON.stringify(result), () => process.exit(0));
