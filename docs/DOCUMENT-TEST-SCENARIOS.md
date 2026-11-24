# Document Test Scenarios — Detection & Positioning Catalog

**Purpose:** enumerate the document shapes Cô Sign's personal users will actually upload, mapped to the pipeline path each should take and its verification status. Status reflects the live ground-truth suite runs of 2026-07-30 — rounds 1–2 (PRs #45–#47), round 3 (PR #49: real I-9, degraded photos, multi-page scan, combs, lease), and round 4 (PRs #51–#52: handwriting, dropdown/radio AcroForm, glyph checkboxes, encrypted PDFs, landscape). ✅ verified live with scored positions · ⚠️ partially verified / qualitative only · ❌ not yet tested.

Pipeline paths: **A** = AcroForm/annotation rects (hybrid) · **T** = text-layer matching (`text-match`/`text-layer`) · **V** = vision on rendered/uploaded images · **M** = manual fields / Phase-1 placement.

---

## 1. By source format

| # | Scenario | Path | Status | Notes |
|---|---|---|---|---|
| 1.1 | Native AcroForm PDF (text fields + checkboxes) | A | ✅ 9/9 | Synthetic widget form; rects exact (Δy 0.0%) |
| 1.2 | AcroForm with radio groups / Yes-No pairs | A | ✅ 3/3 | PR #51: radio groups expand to one checkbox per option widget, named from export value or the printed text right of the box |
| 1.3 | AcroForm with dropdowns (choice fields) | A | ✅ 1/1 | Widget rect exact; field lands as `text` type (native option list not carried through) |
| 1.4 | Flat PDF with text layer (digitally authored) | T | ✅ 12/12 | Underscore + label:value fixtures |
| 1.5 | Flat PDF, re-saved/printed copy of a form (e.g. Quartz re-save) | T | ✅ | fw2.pdf (a local sample kept outside the repo): 47 fields recovered via annotation rects; re-verified after the extractor rework (PRs #57–#58) |
| 1.5b | Permissions-encrypted / pdf-lib-hostile PDF with widgets (SSA SS-5 class) | A | ✅ 63/63 | Was a hard ZERO-field failure. Fixed by the pdfjs widget fallback (PRs #57–#58): edge extractor survives encryption/malformed xrefs, and Node-side pdfjs recovers widget annotations when it comes up empty |
| 1.6 | Scanned PDF (image-only, no text layer) | V | ✅ 18/18 | 3-page scanned PDF, per-page render + vision; all pages scored |
| 1.7 | Photographed form (PNG/JPEG upload) | V | ✅ 6/6 | Synthetic clean photo; see §4 for degraded variants |
| 1.8 | XFA/dynamic form | A / V | ⚠️ | I-9 (hybrid XFA marker) takes the AcroForm rect path: 51/52 widget-exact. N-400 turned out to be plain AcroForm (440 widgets, no XFA). A *pure* dynamic-XFA specimen remains untested — increasingly rare in the wild |
| 1.9 | Password-protected / encrypted PDF | — | ✅ | Owner-password-only PDFs process normally (8/8 scored). User-password PDFs fail with an actionable `encrypted_pdf` error (PR #51) instead of completing empty |
| 1.10 | Mixed: AcroForm on some pages, flat on others | A+T | ✅ 7/7 | Confirmed live as a gap (page-2 blanks invisible), fixed by flat-page augmentation (PR #54): widget-less pages get deterministic text-blank detection |
| 1.11 | Multi-widget AcroForm field (one field, two page locations) | A | ⚠️ | I-9 has 2 (e.g. "Document Title 1"): overlay box renders at the first widget only; export sets the field value so **both** locations fill correctly |

## 2. By layout pattern (text-layer path)

| # | Scenario | Status | Notes |
|---|---|---|---|
| 2.1 | Inline underscore blanks (`Name: ______`) | ✅ | 4/4 rows |
| 2.2 | Separate underscore item on the same line | ✅ | Unit-tested (same-line snap accepts `____` runs) |
| 2.3 | Label:value, right-aligned printed values (invoices/statements) | ✅ | 3/3 after PR #45 |
| 2.4 | Label **above** value (header-style blocks) | ✅ | 1/1 after PR #47, order-independent |
| 2.5 | Two-column rows (`City: ___  State: ___`) | ✅ | 2/2 |
| 2.6 | Duplicate labels across columns (Listing/Selling "Phone:") | ✅ | Unit-tested (one-item-per-field claiming) |
| 2.7 | Signature + date row at page bottom | ✅ | 2/2 |
| 2.8 | Table with header row + empty data rows | ✅ 4/4 | One sensibly-named field per column (Expense Date/Description/Category/Amount), positioned at the top of the first empty row, all in-column |
| 2.9 | Boxed/comb fields (one character per cell, e.g. SSN combs) | ✅ 4/4 | Label-fills-item anchoring (PR #49) places the box at the comb group's start; one box spans the group (no per-cell splitting) |
| 2.10 | Section header + free-text area below ("Notes:", "Describe…") | ⚠️ | CASE-2 block logic exists in `computeWritablePosition`; unscored |
| 2.11 | Checkbox lists drawn as ☐/[ ] glyphs in text | ✅ 6/6 | PRs #51–#52: checkbox fields bind to their option word and anchor on the glyph (merged or separate items) or a left offset for drawn-graphics boxes |
| 2.12 | Dense multi-page form (100+ fields, e.g. HUD-1, TREC contracts) | ⚠️ | Resume/parking verified (PR #37); positional accuracy on dense pages unscored |
| 2.13 | Landscape-orientation pages | ✅ 5/5 | % coordinates hold exactly on 792×612 |
| 2.14 | Right-to-left or vertical scripts in the form itself | ❌ | Out of current market scope; would exercise normalizers |

## 3. By real-world category (personal-tier users)

| # | Category | Examples | Likely path | Status |
|---|---|---|---|---|
| 3.1 | Tax forms | W-2, W-4, W-9, 1099-NEC, 1040 | A or 1.5 | ✅ Real IRS W-4 19/19 (p1), 1040 199/199, 1099-NEC 140/140 (all copies), W-9 23/23, W-8BEN 23/23 — all widget-exact. W-2 exercised throughout |
| 3.2 | Immigration | I-9, I-765, I-485/N-400, G-1145 | A / V | ✅ Real I-9: 51/52 page-1 widget-exact (128 fields). Real G-1145 (pdf-lib-hostile): 6/6 widget-exact via the pdfjs fallback. N-400 is plain AcroForm (not XFA as assumed) |
| 3.3 | Housing | Lease agreements, rental applications, HUD-1 | T | ✅ 2-page lease template 11/11 (inline blanks, sentence-wrap party names, signature block); HUD-1 historically processed (375-field resume case) |
| 3.4 | Contracts | Service contracts, NDAs, sales agreements | T | ⚠️ SampleContract-Shuttle.pdf (a local sample kept outside the repo): 37 fields incl. 4 signatures, all positioned; not ground-truth scored |
| 3.5 | Medical | Intake forms, insurance claims, consent forms | T / V | ✅ Real CMS-1500 sample (image grid + thin prose text layer): was a hard ZERO-field failure — text-layer path found nothing and completed. Fixed by zero-field vision escalation (PR #60): 141 fields, 47 on the claim page, boxes in-cell on overlay review |
| 3.6 | School | Enrollment, permission slips, FAFSA worksheets | T / V | ✅ Real 2025-26 FAFSA paper form: 453/453 widget-exact across 14 fillable pages — the program's largest single-document score, exercising the full park/resume labeling pipeline |
| 3.7 | DMV / ID | License applications, title transfers | A / V | ✅ Real FL HSMV 82040 title/registration: 222/223 widget-exact across 2 dense pages; 7 of 8 same-name checkbox pairs auto-expanded |
| 3.8 | Benefits | SS-5, SNAP, Medicaid, unemployment | A / V | ✅ Real SSA SS-5: 63/63 widget-exact on the application page after the pdfjs fallback (was a zero-field failure). Photographed paper copies covered by §4 |
| 3.9 | Banking / finance | Account opening, direct-deposit, loan apps | A | ✅ Real IRS W-9 (the standard KYC/onboarding form): 23/23 widget-exact |
| 3.10 | Employment | Job applications, onboarding packets | T | ✅ Real DOL WH-380-E (FMLA certification, 4pp): 60/60 unique-name widgets exact (17 same-name duplicates are the known display limitation). OPM SF-15: 45/45 |
| 3.11 | Filled documents (already completed, uploaded for understanding/translation) | T | ✅ | The label:value fixtures and HandyTran invoice are exactly this |

## 4. By capture quality (vision path)

| # | Scenario | Status | Notes |
|---|---|---|---|
| 4.1 | Clean, straight-on photo | ✅ | 6/6 |
| 4.2 | Skewed/rotated photo (5–15°) | ✅ 6/6 | 7° rotation; vision tracked the rotated slots (mean &#124;dy&#124; 0.5%) |
| 4.3 | Low resolution / small text (<1000px wide) | ⚠️ 1/6 | 700px capture: labels + types all correct but y drifts ~5% down — boxes land one line low. Recommend ≥1000px captures in upload guidance |
| 4.4 | Shadowed/uneven lighting phone photo | ✅ 6/6 | Gradient shadow + dimming + JPEG q78; mean &#124;dy&#124; 1.3% |
| 4.5 | Form with existing handwriting | ⚠️ 3/6 | Labels/types all correct — answers are NOT mistaken for labels (the free-text answer is even picked up as its own field). Same lower-half y-drift as 4.3: boxes land ~1 line low toward the page bottom |
| 4.6 | Multi-page scan in one PDF | ✅ 18/18 | Same fixture as 1.6; all 3 pages scored, no parking needed |
| 4.7 | Photocopied-of-photocopy artifacts | ✅ 6/6 | Contrast crush + speckle noise + toner streak + edge shadow + 1.2° skew + q62 JPEG — no degradation in detection or positions |

## 5. Cross-cutting behaviors already verified live

- Values preserved across re-analysis (F-4) — verified three times, including on re-scored fixtures.
- Vision jobs park/resume instead of stranding (F-5) — design + unit level.
- Batch multi-file upload, per-file failures, type rejection.
- Bilingual field labels + Vietnamese export fonts; date formats on export.
- Signature draw → export; manual field creation at zero detections.

## 6. Round-3 results (2026-07-30, PR #49)

Scored corpus: real I-9, 7°-skewed / shadowed / 700px photos, 3-page scanned PDF, comb form, 2-page lease. **97/103 in-slot** after two fixes shipped in PR #49 (comb label-fills-item anchoring; sentence-wrap blank snapping). The 6 remaining misses are all accounted for: 5 = low-res y-drift (4.3, model estimation on small captures), 1 = multi-widget I-9 field (1.11, overlay-only — export fills both locations).

## 7. Round-4 results (2026-07-30, PRs #51–#52)

Scored corpus: handwriting-filled photo, dropdown/radio/checkbox AcroForm, glyph-checkbox form, landscape form, owner- and user-password encrypted PDFs. **30/33 in-slot** after three fixes (radio-option expansion, glyph-checkbox option binding, encrypted-PDF hard failure). The 3 misses are the handwriting photo's lower-half y-drift (4.5 — same vision-estimation pattern as 4.3; detection semantics fully correct).

## 8. Round-5 results (2026-07-30, PR #54)

Scored corpus: mixed AcroForm/flat 2-page claim form, header table with empty grid rows, photocopy-degraded photo. **19/19 in-slot** after one fix: the mixed-page gap was real (page-2 blanks completely invisible, 3/7) and is closed by flat-page augmentation — widget-less pages of hybrid docs now get deterministic labeled-underscore detection (no extra AI calls), with types inferred from label keywords. Tables and photocopies needed no changes.

## 9. Real-form sweep (2026-07-30, PRs #56–#58)

Real downloaded government forms scored against their own widget rects: IRS **W-4** 19/19 (page 1, 48 fields total), SSA **SS-5** 63/63 (application page), USCIS **G-1145** 6/6 — **88/88 widget-exact**. The SS-5 exposed the sweep's one hard bug: permissions-encrypted PDFs with widgets in compressed object streams produced ZERO fields (edge pdf-lib load refused the encryption). Fixed by hardening the edge extractor and adding a Node-side pdfjs widget fallback (PRs #57–#58). The regression harness (generators, runners, scorer, truth snapshot) now lives in `scripts/positioning-suite/` (PR #56).

**Tranche 1 (2026-08-02, PR #60):** five more real forms covering the unverified category rows. AcroForm scoring vs their own widget rects: IRS **1040** 199/199, IRS **W-9** 23/23, OPM **SF-15** 45/45, FL **HSMV 82040** 222/223, DOL **WH-380-E** 60/60 unique names — **549/567 raw (96.8%)**, with every miss accounted for by the documented same-name multi-widget display limitation (Yes/No checkbox pairs sharing one field name; export unaffected). The **CMS-1500** claim-form sample was the tranche's hard bug: an image-grid form whose thin prose text layer passed the text-layer gate, detected nothing, and completed with zero fields. Fixed by single-shot vision escalation when the text-layer path yields no fields (PR #60) — re-run produced 141 fields with in-cell boxes on overlay review.

**Tranche 2 (2026-08-02):** IRS **1099-NEC** 140/140 (all copies), IRS **W-8BEN** 23/23, and the 2025-26 **FAFSA** paper form **453/453 across 14 fillable pages** — **616/616 (100%)**, no fixes needed. The FAFSA is the program's largest single-document score and a full workout of the chunked labeling/enrichment park-resume pipeline. USCIS (I-765) and SSA (SSA-827) downloads remain bot-blocked at the source (Akamai), as are NY/TX DMV and eforms.state.gov (DS-11) — those specimens need a manual download to test.

## 10. Remaining unverified scenarios

1. **RTL/vertical scripts** (2.14) — out of current market scope.
2. **Pure dynamic-XFA specimen** (1.8) — increasingly rare; hybrid-XFA (I-9) verified via AcroForm path.
3. **Category sweeps** (3.5–3.7, 3.9–3.10): medical intake, school enrollment, DMV comb forms, banking, employment packets — re-exercise already-verified paths on real layouts.

Known accepted limitations: vision y-drift on low-res/handwritten captures (~5%, mitigate with ≥1000px capture guidance); multi-widget AcroForm fields show one overlay box (export fills all locations); dropdowns fill as text rather than a native option list.

The generator + scorer (`gen-forms.js`, `gen-acroform.js`, `gen-round3.mjs`, `gen-round4.mjs`, `score-positions.py` / `score-round3.py`, `positioning-truth.json`) produce exact expected boxes for synthetic fixtures; round 3 added rect-nearest scoring for AcroForm documents whose field names differ from AI labels.
