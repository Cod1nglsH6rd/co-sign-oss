# Cô Sign — UX/UX & Improvement Notes

> Captured during a full re-test sweep (2026-06-16) across an AcroForm complex
> multi-page contract (TREC 1–4 Family Residential, 263 fields), a non-AcroForm
> complex multi-page contract (TREC Unimproved Land, 10 pages / ~200 fields),
> and the translated (vi/es) recipient workflow. Ordered roughly by leverage.
> "Observed" = seen directly this sweep; metrics are real.

---

## Recommended improvements (2026-06-17) — post 10-language expansion

After adding 7 languages (pt, fr, zh, yue, ht, my, ne → 10 total) and testing the
translation pipeline on AcroForm (W-2) and contract-style fields in every new
language. Tested directly this round: `next build` (114 static pages = 11 pages ×
10 locales), locale-JSON validity + key parity, the live Haiku translation step
for all 7 languages (6/6 fields each, correct scripts, position-hint English
preservation working), and the `fieldTranslations` accessors (correct column +
English fallback). Priority: **P0** = ship-blocker for the new languages, **P1**
= high leverage, **P2** = polish. Status tags added after the "Do all" pass on
2026-06-17: **[SHIPPED]**, or **[DEFERRED]** with the reason.

### UI / UX
- **[P0] [SHIPPED] Non-Latin web fonts.** `_document.js` now loads Noto Sans
  SC/TC/Myanmar/Devanagari (preconnect + `display=swap`) and `globals.css` adds them
  to the body `font-family` stack, so Chinese/Cantonese/Burmese/Nepali render
  instead of tofu.
- **[P1] [SHIPPED] Non-Latin MT quality.** Step-3b now routes non-Latin scripts
  (`zh`, `yue`, `my`, `ne`) to Sonnet first (Haiku fallback); Latin languages stay
  Haiku-first. Addresses the stray-English-token artifact.
- **[P1] [SHIPPED] `<html lang>` per locale** — `_document` derives it from the route
  locale via `getInitialProps`.
- **[P1] [SHIPPED] Language selector scale** — the nav language menu is now
  searchable + scrollable.
- **[P2] [DEFERRED] Locale-aware formatting** — prices are hardcoded USD strings in
  the locale files; no dynamic currency/date rendering exists to format yet, so a
  formatter would be dead code today. Revisit when dynamic amounts/dates appear.
- **[P2] [DEFERRED] Staff preview chrome** falls back to English for new languages on
  the document-detail preview. Field *content* is translated; only surrounding
  chrome falls back. Acceptable; low value to chase.

### Complex form / contract
- **[P1] [SHIPPED] XFA / dynamic + scanned forms.** `buildVisionPrompt` was defined
  but never called, so XFA (I-485/N-400) and scanned PDFs detected zero fields. The
  terminal "no fields" branch in `ocr.js` now renders each page via `pdf-to-image`
  and runs Claude vision (Sonnet) to detect fields/positions/translations. Additive
  (only fires at zero fields), capped at `OCR_VISION_DETECT_MAX_PAGES` (10).
- **[P1] [DEFERRED] Section grouping for long forms.** Real value, but it restructures
  the recipient fill list, which already carries collapse / Next-field / search /
  Required-only logic verified across the I-9, TREC contracts, and I-485. Too risky
  to redesign in a broad autonomous sweep — needs a dedicated, isolated change +
  re-test. Scoped follow-up.
- **[P1] [DEFERRED] Repeated / table rows.** Needs detection-model work and a product
  decision on how repeat groups are presented; not safe to infer automatically yet.
- **[P2] [DEFERRED] Conditional / skip logic** — large feature; needs a rules model
  and an authoring UI. Scoped follow-up.
- **[P2] [PARTIAL] Multi-party role assignment** — already exists (role question +
  `excludeFields` filtering + AI smart-default in `Phase1SetupModal`). Further
  surfacing (per-field role tags) is incremental and touches the verified setup
  flow; deferred.

### AcroForm vs non-AcroForm
- **[P1] [SHIPPED for scanned/XFA] Signature & checkbox detection** via the new
  vision path (it detects checkbox/signature field types). Flat docs that *do* have
  a text layer still use the text path — augmenting that is the deferred part.
- **[P1] [DEFERRED] Non-AcroForm coordinate clustering** — modifies value placement in
  the verified text-layer path; conservative isolated change + re-test needed.
- **[P1] [DEFERRED] AcroForm radio/checkbox group semantics** — lives in the deployed
  `extract-form-fields` edge function; changing its output shape risks the verified
  flows and requires a redeploy + full re-test. Scoped follow-up.
- **[P2] [DEFERRED] Scanned/no-text A–Z** — the vision path is wired and unit-safe,
  but a full scanned-PDF run-through needs a scanned fixture; validate next sweep.
- **[P1] [SHIPPED] Detection regression fixtures** — `tests/lib/languages.test.js`
  guards the language wiring (locale parity, config completeness, accessor
  fallback). A field-count fixture set for real PDFs (W-2/I-9/I-485/W-9/TREC) is the
  remaining, deferred part (needs the PDFs committed + an edge-fn test harness).

> Why several P1s are deferred: they change the **verified detection/fill core**
> (the edge function, the recipient fill list, text-layer value placement) that's
> been validated end-to-end across many real documents over prior sessions, or are
> multi-week features needing product decisions. Ramming half-built versions through
> a broad autonomous pass would risk regressing working flows — they're each worth a
> focused, isolated change with its own re-test.

---

## High-complexity run-through (2026-06-17) — USCIS I-485, 523 fields / 24 pages
Pushed the workflow well past prior tests with the I-485 (a 24-page XFA/dynamic
AcroForm, **523 detected fields**). Everything functioned end-to-end; new
observations and improvement ideas (ordered by leverage):

**Held up well at scale (keep):**
- Multi-page paging correct across pages 3–24 — even though pdf-lib can't parse
  this XFA form (my widget→page correction skipped gracefully and the edge
  function's own page assignment carried it).
- AI enable-first classifier: **487/523 in ~5s** — correctly recognized an
  applicant-filled form keeps most fields (didn't over-trim).
- Collapse-by-default fill scales: 1 of 487 cards expanded; 24-page PDF +
  487 fields rendered for the recipient in ~13s.

**New improvement opportunities:**
1. **[high] [DONE] Field search/filter in setup and fill.** Added a search box
   (shown when >15 fields) to the setup field list and the recipient fill
   Fields tab; it filters rows/cards by label (preserving setup positioning
   index) and clears back to all. Verified: setup "f1_0"→9, "c1_1"→7 of 23;
   fill "field"→11 of 23, no-match→0, clear→23. Section grouping (by page)
   remains a future nicety.
2. **[DONE] Detection progress on the documents list.** Prepping/finalizing
   rows now show an animated indeterminate progress bar beneath the stage
   message ("Analyzing…"/"Mapping fields…"/"Finalizing…") with a tooltip that
   large docs can take a few minutes — so staff see motion, not a static
   spinner. (Indeterminate by design; detection has no reliable total to show
   a true %.)
3. **[DONE] Fill navigation for many required fields.** The Fields tab now has
   a "Required only" filter toggle and a "Next required field" jump (shown with
   the search box at >15 fields). Verified the controls render and function
   (en/vi/es localized).
4. **[med] [DONE] Label de-duplication.** `prettifyLabel` now collapses
   consecutive duplicate words (case-insensitive), so "Account Number Number"
   → "Account Number" and "Date Date Date" → "Date". Conservative: only
   adjacent identical words, so distinct phrases ("Given Name First Name") and
   meaningful tokens ("1099 Form") are preserved. Display-only; raw kept.
   (Garbled non-repeat labels like "Print First Present US" are unchanged —
   those would need detection-side relabeling.)
5. **[DONE] Setup→ready latency at scale.** Added a "still preparing…" note on
   the send screen when the selected document's `processing_status` is
   `finalizing`, so staff know an early recipient may briefly see the
   "preparing" screen. (The underlying enrichment latency — ~57s on 523
   fields — is unchanged; routing already happens before it finishes.)
6. **[DONE/verified] XFA/dynamic forms.** Confirmed these actually work: the
   I-485 (XFA, 523 fields) paged correctly across pages 3–24 via the edge
   function even though pdf-lib can't parse it; the widget→page correction
   skips gracefully and now logs a clear "XFA/dynamic — using extractor pages"
   diagnostic. No flatten needed.

**Label quality (partial — conservative win shipped):** `prettifyLabel` now
humanizes *technical* field names with a clear semantic segment
("topmostSubform[0].Page1[0].BusinessName[0]" → "Business Name",
"SignatureOfEmployee" → "Signature Of Employee", "employee_last_name" →
"Employee Last Name") while leaving opaque codes ("f1_01", "c1_1") and normal
labels untouched.

**[DONE] Opaque-field labeling backfill (2026-06-17).** Root cause confirmed on
the W-9 (all 23 fields `topmostSubform…f1_01`, `textLabel: null`, AI relabel
skipped because the edge fn sets `label=name`). Fixed with a labeling backfill
in ocr.js (PRD §4.4): for pages with technical/unlabeled fields it reads the
human label nearest each box — preferring a rendered image (Claude vision) and
**falling back to the page's extracted text+positions (Haiku)** when no
renderer exists. Verified: W-9 → **23/23 real labels** ("Name of
entity/individual", "City, state, and ZIP code", "Account number(s)", …).

**[DONE] `pdf-to-image` deployed (2026-06-17).** Rewrote the edge function to
render with **MuPDF (pure wasm)** instead of `OffscreenCanvas` (unsupported in
the Supabase edge runtime, which is why it never deployed). The ~10MB wasm is
fetched from jsDelivr once per worker and passed to MuPDF via
`$libmupdf_wasm_Module.wasmBinary` (keeps the bundle under the 20MB limit;
static sibling files aren't supported on the API deploy path), then memoized.
Tested on a W-2 and a 10-page contract: correct page render, valid PNG, cold
≈ 2.3s / warm ≈ 0.7s, out-of-range page clamps to the last page. The vision
label-backfill branch is now live; the text+positions path remains the
fallback for transient render failures.

---

## Implementation status (2026-06-16, waves 1–2)
Implemented + re-verified this session:
- **#2 Setup save** — "Save Positions" → disabled "Finalizing field labels…"
  state while labels refresh, then a **single click** saves (verified: doc →
  `ready_to_send` on one click; the prior friction was 7 clicks).
- **#3 Fill scaling** — large docs (>30 fields) collapse to **1 open card** +
  collapsed headers + "Next field" control (verified: 263 cards, 1 expanded).
- **#5 Viewer i18n** — "Loading document…"/"Page X of Y" localized via a
  `labels` prop (code + build verified; runtime vi check blocked by the
  finalizing screen on a fresh 263-field translation).
- **#6 Field-label tidy-up** — conservative, display-only (whitespace, stray
  bullets, trailing colon); no semantic stripping; raw kept for chat/tooltips.
- **#9 Dashboard overflow** — `min-width:0` on `.ent-main`; verified
  scrollWidth == clientWidth (no clipping).
- **#10 Onboarding** — auto-open scoped to the Documents page (in context);
  already persists once-per-user.

Found already-implemented (notes were overstated):
- **#4 Translation timing** — vi/es enrichment already kicks off in the
  background at **link creation** (`sessions/create.js`), not at first open.
  The "Sắp xong / Almost ready" wait is just enrichment latency for big docs
  when a recipient opens before it finishes — inherent, not a timing bug.
- **#11 Detection progress** — the documents list already renders the live
  processing message ("Mapping fields…", "Finalizing…") under the
  prepping/finalizing badge.

Implemented in wave 3 (this session):
- **#1 Setup enable-first** — DONE. Setup now shows per-field enable toggles,
  bulk enable/disable, a live "X of Y enabled" count, and the enabled set
  flows to the recipient (`phase1_data.includedFieldIds` →
  `field_filter`). Verified end-to-end: 23 fields → enable 3 → recipient sees
  3. (Full drag-canvas removal not done — positioning is still available; the
  high-value "select what matters" decision is now front-and-center.)
- **#7 Add a missed field in setup** — DONE. "Add field" surfaced in setup
  (was only in the non-minimal/personal path); new fields persist via the
  setup save's custom-field insert and are enabled by default.

Smart default (follow-up to #1):
- **Setup pre-selection** — DONE, now AI-backed. On documents above ~25
  fields, setup pre-enables a *suggested* recipient set instead of all:
  - A new endpoint `/api/enterprise/classify-fields` asks Claude Haiku which
    fields the recipient personally fills (name/signature/date/party info)
    vs. office/staff/internal/pre-filled, returns the recipient set, and
    caches it on `phase1_data.recipientFillableIds` (no token re-spend).
  - The setup modal seeds the enable-first default from it (shown as
    "N of M enabled · suggested"); a local keyword heuristic is used as an
    immediate/fallback default, and it falls back to all if the AI fails or
    returns too few. Staff review + one-click Enable all remain the safety net.
  - Verified end-to-end: I-9 → 50 of 128 classified recipient-fillable,
    cached on the 2nd call, applied in setup as "50 of 128 · suggested".

#8 status — DONE:
- **#8 Non-AcroForm value positioning** — FIXED. Root cause was horizontal:
  text-layer ('text-match') fields were positioned at the label's x, so values
  rendered on top of the label ("XXXXFull Name") instead of in the blank.
  The OCR text-layer path now finds the blank — the underscore run (or the
  position just after the label) — and converts that character offset into an
  x% using the text item's measured width, and anchors y ~2% above the
  baseline so the value sits on the line. Verified: a 3-page flat doc now
  renders "Buyer Full Name: __XXXX____" with the value in the blank, on the
  line (x correctly shifts with label length). Source-gated to text-match, so
  AcroForm (exact widget rects) is untouched.
  - Also validated on a REAL 10-page non-AcroForm contract (TREC Unimproved,
    187 fields): values land in the form blanks within the body (party names
    before "(Seller)"/"(Buyer)", Addition/City/County, etc.) — a clear
    improvement over rendering on the label. Honest limits: 48 of the 187
    fields fall to the unchanged `ai-estimated` path (no label match → not
    blank-positioned), and on blanks that aren't underscore runs (boxes,
    bare lines, label-only) placement is approximate ("just after the label").
    Precise per-field alignment on arbitrary real forms remains best-effort.
  - **Follow-up shipped:** the `ai-estimated` fallback (fields the AI couldn't
    label-match) now snaps to the nearest underscore-run on the page when one
    is within ~2.5% of the AI's approximate y, instead of dropping the value
    at the left margin. Verified on the real TREC contract: 31 of 32
    ai-estimated fields now land in a blank (was: all at the left margin);
    values render in the form body, not the margin. Minor residual stacking
    (~6 paired two-column fields share a blank) — no worse than before and at
    the correct location. Non-underscore blank styles (boxes/lines) are still
    best-effort.

## Additional notes from the re-test (2026-06-16)
- **Detection recall variance recurred (#7 reinforced):** the 10-page
  non-AcroForm contract detected 188 fields and **page 6 came back with 0
  fields** (other runs: 198/204, page 6 had 1–2). Text-layer recall is
  non-deterministic; an "add a field" affordance + a low-recall-page flag
  would let staff recover misses. This is now the most concrete reliability
  gap on non-AcroForm docs.
- **Big-doc translation latency is the main recipient wait:** a recipient who
  opens a vi/es link to a 263-field doc within ~1–2 min of its creation sees
  "Sắp xong" while enrichment finishes. Options: a progress bar with ETA on
  that screen, or pre-warming translations for the languages an org actually
  uses.
- **Collapse-by-default is a big win:** the 263-field fill went from 263
  expanded cards to 1 + compact headers; this alone makes large contracts
  usable on the recipient side.

## What's working well (keep)
- Enterprise indigo vs. recipient teal reads clearly as two distinct surfaces.
- The staff **dashboard** is genuinely strong: stat cards, quick actions,
  completion chart, language breakdown, recent activity.
- **Field curation** (§2.8), copyable signing-link success panel, and the
  staff **signed-PDF download** are all clean.
- Recipient **identity-verification gate** and the **AI field explanations**
  (plain-language, in the recipient's language) are a real differentiator.
- Multi-page field paging now correct on both AcroForm and non-AcroForm.

---

## 1. Setup: move from "position everything" to "select what's needed" (highest leverage)
**Observed:** the AcroForm contract detected **263 fields** (Farm & Ranch: 340).
Setup asks staff to engage with all of them, and saving took **7 clicks**
(see #2). The recipient then sees **263 expanded field cards**.

**Recommendation (per product discussion):** flip setup from a drag-everything
canvas to an **enable-first** model — staff toggle which fields are in-scope
(AI pre-enables the obvious recipient fields: names, dates, signatures, party
info; pre-disables boilerplate/duplicate widgets), positions auto-apply, and
staff only adjust fields the AI flags as low-confidence. For AcroForm docs the
positions are already exact (straight from the PDF), so dragging is mostly
busywork; the high-value human decision is *which* fields matter and *who*
fills them. This also unifies setup with the send-time curation (§2.8), which
today defaults to "all" and sits as an afterthought. Net effect: setup becomes
"confirm ~15 fields" instead of "wrangle 263," and the recipient fill shrinks
proportionally. *(Deferred per owner; tracked here.)*

## 2. Setup save is silently blocked during label refresh
**Observed:** "Save Positions" is enabled but no-ops while the post-detection
label refresh runs; it took **7 clicks** before it took. The guard exists for a
good reason (don't ship generic "Field 2" labels, PRD §2.5) but the UX is a
silent nag. **Fix:** disable the button with an explicit "Finalizing field
labels…" state + spinner, and auto-enable (or auto-save) when ready.

## 3. Recipient fill doesn't scale to large field counts
**Observed:** 263 expanded cards = a very long scroll. **Fix options:**
collapse cards by default on large docs, group by document section, and add a
prominent "next required field" jump. (Largely solved if #1 ships, since fewer
fields are enabled.)

## 4. Localization: lazy translation makes the first vi/es open wait
**Observed:** first Vietnamese open of the 263-field contract showed
"Sắp xong / Almost ready" while translations generated (30–60s on big docs).
The verify gate + UI + field labels localize correctly once ready. **Fix:**
pre-generate vi/es translations during setup enrichment (not lazily on first
recipient open), or show clearer progress + a realistic ETA on the wait screen.

## 5. Remaining untranslated fragments on localized pages
**Observed earlier / still open:** the PDF viewer chrome ("Loading document…",
"Page X of Y") stays English on `/vi` and `/es` pages. The not-ready title and
field-constraint hints were already localized. **Fix:** localize the viewer
chrome strings.

## 6. Field-label quality varies
**Observed:** some detected labels are raw/verbose (I-9:
"3 A lawful permanent resident Enter USCIS or ANumber"). **Fix:** a light
post-processing/cleanup pass for display labels (the AI already produces
explanations; it can also produce a concise label).

## 7. Detection recall varies run-to-run on non-AcroForm docs
**Observed:** the same 10-page non-AcroForm contract detected 198 fields one
run and 204 another, and page 6 got 2 fields one run / 0 another — AI
non-determinism on text-layer detection. Paging of detected fields is correct;
the gap is recall. **Fix:** let staff add a missed field during setup, and/or a
confidence/verification pass that flags sparse pages.

## 8. Non-AcroForm value positioning is slightly high
**Observed:** on the text-layer path, filled values render a few pixels above
the blank line (the position is estimated from the label). On the right page,
roughly the right spot — cosmetic. **Fix:** nudge the y-offset for text-layer
fields, or snap to the nearest underscore run.

## 9. Dashboard overflows horizontally at ~1440px
**Observed:** the rightmost stat card ("Avg Cycle Time"), the "New Document"
quick action, and the "Language Breakdown" percentage are clipped at the right
edge. **Fix:** make the stat/quick-action grids wrap/scale responsively.

## 10. Onboarding modal context + repeat
**Observed:** the owner account lands on **Owner Usage** (analytics) with the
"get documents filled in four steps" onboarding over it — a slight mismatch
(owner vs. staff landing). Also confirm the guide is truly **once per user**
(persisted), not re-popping. **Fix:** route staff to Documents post-login (keep
owners on Owner Usage), and gate the auto-open on a persisted "seen" flag.

## 11. Large-document detection latency has no progress signal on the list
**Observed:** 263/340-field detection takes minutes; the documents list shows a
"prepping" badge but no progress/ETA. **Fix:** surface a progress indicator
(stages: prepping → mapping fields → finalizing) on the document row.

---

### Operational follow-ups (already in GO-LIVE-CHECKLIST.md)
- Re-sync the `extract-form-fields` edge-function source with the deployed
  version.
- Rotate keys / set prod env vars before launch.
