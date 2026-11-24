# Reliable field positioning for scanned / XFA documents — research & solution

**Date:** 2026-06-17 · **Status:** solution found, validated, implemented behind a flag

## Problem
For documents with no AcroForm widgets and no text layer (scanned images, XFA/
dynamic forms), field **positions** must be inferred. The first cut asked a
vision model for coordinates; positions drifted and sometimes landed in empty
space. Goal: find a *reliable* way to get accurate positioning.

## Method
`fw2.pdf` (a local file kept outside the repo) is the AcroForm W-2 whose **exact widget rectangles are ground truth**.
We rasterize it to an image-only PDF (a true "scanned" doc), run each candidate
approach, and measure detected boxes against the 47 ground-truth rects:
- **center-inside**: detected box center falls inside a true cell
- **overlap (IoU>0.15)**: detected box overlaps the correct cell (usability bar —
  does the typed value land in the right place)
- **median center error** (% of page)

## What we tried (all measured against ground truth)

| Approach | Result | Verdict |
|---|---|---|
| Vision model returns coordinates (full page) | center error ~500% — it returned **pixels** one run, **percent** another | ❌ coordinate *units* are non-deterministic |
| + faint 5%/10% coordinate grid overlay + "read off the grid" | did **not** stabilize units/precision | ❌ |
| OCR-anchor + fixed offset below label | 24% in-cell | ❌ |
| OCR-anchor + ruled-cell (pixel line detection) | ~55% in-cell | ⚠️ limited by line-detection completeness |
| OCR-anchor + crop + vision fine-localize | ~70% (noisy, 2 calls/field) | ⚠️ vision still imprecise even on crops |
| Pure geometric grid reconstruction | only 13/47 cells fully bounded | ⚠️ hand-rolled CV not robust on faint/broken rules |
| **OCR-anchor + OCR-neighbor geometry** | **93% overlap, 69% center-inside, median 1.5% error** | ✅ **reliable** |
| Document form-parser (Document AI / Textract) | research: 90%+; not available here (no creds/source) | ✅ production max |

## The solution: OCR-anchored geometry
Vision models are reliable at **reading** a form (which fields exist, their
labels, types) but unreliable at emitting **coordinates**. OCR (Tesseract) gives
exact, stable word boxes. So:

1. Render the page (MuPDF `pdf-to-image`, already deployed).
2. **Tesseract** OCR → word boxes (pixel-precise; ~1.8s/page in-env).
3. **Vision model** → for each field: `field_name`, verbatim `label_text`,
   `field_type`, short `explanation` — **no coordinates**.
4. Locate each `label_text` in the OCR words → exact anchor box.
5. Derive the writable box from OCR neighbor geometry: bottom = next text row
   below in the label's column; right = next token to the right in that band.

Pure step 4–5 logic lives in `lib/ocrAnchor.js` (no heavy deps, fully unit
tested). Tesseract runs in `lib/ocrWords.js` (lazy import). Both are wired into
the vision branch of `pages/api/ocr.js`.

**Measured (scanned W-2, captured fixtures in `tests/fixtures/`):**
- 93% of placed boxes overlap the correct field cell (IoU>0.15)
- median center error ~1.5% of page (vs unusable vision coordinates)
- locked in by `tests/lib/ocrAnchor.test.js` (regression guard ≥85% overlap)

## Status & rollout
- Implemented behind `OCR_VISION_USE_OCR_ANCHOR=1` (default **off**). When off,
  the existing vision-grid path is used — no production behavior change.
- Why flag-gated: Tesseract in a serverless function adds cold-start cost (WASM +
  ~15MB language data fetched at runtime). `tesseract.js` is in
  `serverExternalPackages` so it isn't bundled. Enable + validate cold-start/cost
  on a real deploy before defaulting on.
- Even with OCR-anchor, positions are excellent **starting points**; the Phase-1
  manual pass remains for the occasional miss.

## If we want to go further (toward skip-the-setup accuracy)
A document **form-parser that returns field geometry** — Google Document AI
*Form Parser* or AWS Textract *AnalyzeDocument FORMS* — returns key/value pairs
with bounding boxes and benchmarks 90%+. That's the production-max path; it needs
GCP/AWS credentials and wiring (our `extract-docai` function doesn't expose word
boxes today). The OCR-anchor approach above is the best in-house solution and
uses the same principle (real geometry, not model coordinates).
