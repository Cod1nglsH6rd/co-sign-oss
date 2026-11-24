# Positioning regression suite

Ground-truth accuracy harness for field **detection + positioning**, built
during the 2026-07-30 audit rounds (PRs #45–#55). Synthetic fixtures are
generated with exact expected box coordinates (percent of page, y from top),
uploaded to a live instance, and the detected positions are scored against
the truth. Live scores at the time of writing: **198/207 in-slot (96%)**
across the AcroForm, text-layer, and vision paths.

## Requirements

- `pdf-lib` and `pdfjs-dist` (repo dependencies).
- `sharp` for the photo fixtures (installed alongside Next; `npm i -D sharp` if missing).
- `playwright` + a Chromium for the upload/pull runners (repo devDependency).
- `pypdf` (Python) only for the encrypted-PDF fixtures.

## Workflow

Run everything from this directory (fixtures are written to the CWD):

```bash
# 1. Generate fixtures + positioning-truth.json (order matters):
node gen-forms.js        # round 1: underscore + label:value forms (truth reset happens here)
node gen-acroform.js     # synthetic AcroForm (9 widgets)
node gen-photo.mjs       # clean "photographed form" base image
node gen-round3.mjs      # degraded photos, 3-page scan, comb fields, lease (+ i-9.pdf if present)
node gen-round4.mjs      # handwriting photo, dropdown/radio AcroForm, glyph checkboxes, landscape
python3 gen-encrypted.py # encrypted-PDF pair (needs pypdf)
node gen-round5.mjs      # mixed AcroForm/flat pages, empty table, photocopy

# 2. Upload to a running instance (uses a throwaway/test account;
#    COSIGN_BASE_URL, default http://localhost:3000, for both scripts below):
E2E_EMAIL=... E2E_PASSWORD=... node upload-fixtures.js
# → docids.json. Wait for OCR to complete (vision docs can take ~1 min each).

# 3. Pull detected positions:
E2E_EMAIL=... E2E_PASSWORD=... \
NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
node pull-fields.js
# → detected-fields.json

# 4. Score:
python3 score.py                 # everything with truth + detections
python3 score.py lease.pdf       # single file
```

Afterwards, delete the uploaded test documents (dashboard bulk-select, or
REST deletes against `documents` + storage using the same session token).

## Scoring rules

- A detection matches a truth entry by name (exact containment first, then
  token overlap — two passes so "Landlord Name" can't steal "Landlord
  Signature"). Hit = detected box **center** inside the truth rect ±3% x /
  ±1.8% y (±4/±3 for vision-path files).
- Files whose truth keys look like `w<N>_<name>` (real AcroForm docs whose
  field names differ from AI labels — e.g. the I-9) are scored by
  rect-nearest greedy matching with a 1.5% center tolerance instead.

## Optional real-form inputs

Drop these next to the scripts to widen coverage (downloads need a real
browser fetch — USCIS/IRS block plain curl):

- `fw2.pdf` — IRS W-2 (Quartz-flattened specimen; annotation-rect recovery). A local file kept outside the repo: put your own copy next to `gen-forms.js`, which loads it only if it is there.
- `i-9.pdf` — USCIS I-9 (hybrid XFA marker, 130 widgets; 2 are multi-widget)

## Known accepted limitations (documented in docs/DOCUMENT-TEST-SCENARIOS.md)

- Vision y-drift (~5%, one line low) on <1000px or handwriting-filled
  captures — capture-guidance mitigation, not a code fix.
- Multi-widget AcroForm fields render one overlay box; export fills all
  widget locations correctly.
- Dropdowns position exactly but fill as text (no native option list).
