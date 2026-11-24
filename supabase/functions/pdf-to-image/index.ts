/**
 * PDF to Image Edge Function
 *
 * Renders a single PDF page to a PNG (base64) for AI Vision processing.
 *
 * Implementation notes:
 * - Uses MuPDF (pure WebAssembly) instead of a DOM canvas. The Supabase edge
 *   runtime is Deno-based and has no `OffscreenCanvas`, which is why the prior
 *   pdfjs-dist + canvas approach failed to deploy.
 * - The ~10MB MuPDF wasm is NOT bundled with the function (the Management API
 *   deploy path does not support static sibling files, and MuPDF resolves its
 *   wasm via a runtime URL). Instead we fetch the wasm from a CDN once per
 *   worker and hand the bytes to MuPDF through its `$libmupdf_wasm_Module`
 *   hook (`wasmBinary`), then memoize the initialized module so only the first
 *   request on a cold worker pays the fetch + compile cost.
 *
 * Request:  { pdfBase64: string, pageNum?: number (1-indexed), scale?: number }
 * Response: { success: true, image: <base64 png>, pageNum, totalPages, width, height }
 */

import { decodeBase64, encodeBase64 } from "base64";

const WASM_URL = "https://cdn.jsdelivr.net/npm/mupdf@1.27.0/dist/mupdf-wasm.wasm";

// Memoized, initialized MuPDF module (shared across requests on a warm worker).
let mupdfPromise: Promise<typeof import("mupdf")> | null = null;

function loadMupdf(): Promise<typeof import("mupdf")> {
  if (!mupdfPromise) {
    mupdfPromise = (async () => {
      const res = await fetch(WASM_URL);
      if (!res.ok) throw new Error(`Failed to fetch MuPDF wasm: ${res.status}`);
      const wasmBinary = new Uint8Array(await res.arrayBuffer());
      // MuPDF reads its Module options off this global at import time; setting
      // wasmBinary makes it skip the import.meta.url fetch entirely.
      (globalThis as Record<string, unknown>).$libmupdf_wasm_Module = { wasmBinary };
      return await import("mupdf");
    })().catch((err) => {
      // Reset so a transient CDN failure doesn't poison every future request.
      mupdfPromise = null;
      throw err;
    });
  }
  return mupdfPromise;
}

Deno.serve(async (req) => {
  try {
    const { pdfBase64, pageNum = 1, scale = 2 } = await req.json();

    if (!pdfBase64) {
      return Response.json({ success: false, error: "No PDF provided" }, { status: 400 });
    }

    console.log("[pdf-to-image] Rendering page", pageNum, "scale", scale);

    const pdfBytes = decodeBase64(pdfBase64);
    const mupdf = await loadMupdf();

    const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
    let pixmap: InstanceType<typeof mupdf.Pixmap> | null = null;
    let page: ReturnType<typeof doc.loadPage> | null = null;
    try {
      const totalPages = doc.countPages();
      const idx = Math.min(Math.max(1, Number(pageNum) || 1), totalPages) - 1;
      const s = Math.min(Math.max(Number(scale) || 2, 0.5), 4);

      page = doc.loadPage(idx);
      // alpha=false renders onto a white background (better for OCR/vision).
      pixmap = page.toPixmap(mupdf.Matrix.scale(s, s), mupdf.ColorSpace.DeviceRGB, false);
      const png = pixmap.asPNG();
      const base64 = encodeBase64(png);

      console.log("[pdf-to-image] Done:", pixmap.getWidth(), "x", pixmap.getHeight(), "bytes", png.length);

      return Response.json({
        success: true,
        image: base64,
        pageNum: idx + 1,
        totalPages,
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
      });
    } finally {
      pixmap?.destroy();
      page?.destroy();
      doc.destroy();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log("[pdf-to-image] Error:", message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
});
