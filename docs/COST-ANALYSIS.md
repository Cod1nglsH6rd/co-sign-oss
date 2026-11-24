# Cô Sign — Cost Analysis (per-page AI + hosting)

_Last updated: 2026-06-18._

This is a bottoms-up cost model derived from the actual code paths in
`pages/api/ocr.js`, `lib/anthropic.js`, the chat endpoints, and the Supabase
edge functions. All dollar figures are **estimates** — real cost varies with
form density (fields/page), page count, and how chatty recipients are. Where a
number depends on an assumption, the assumption is stated inline.

---

## 1. TL;DR

| What | Estimated cost |
|---|---|
| Simple 1-page form (e.g. W-9), English | **~$0.04 / document** |
| Complex 6-page form (~100 fields), English | **~$0.21 / document** |
| Complex form **+ translation** (any language) | **~$0.26 / document** |
| Scanned / XFA doc via vision path (6–10 pages) | **~$0.21–$0.37 / document** |
| Each recipient chat message | **~$0.0045 / message** |
| **Blended "cost per page processed"** | **~$0.03–$0.05 / page** |
| Fixed hosting (production, low–moderate volume) | **~$45–$75 / month** |

**Rule of thumb for budgeting:** `~$0.03–$0.05 per page` for field detection,
plus `~$0.0008/field` for plain-English explanations and `~$0.0005/field` for a
translation, plus `~$0.005` per chat message. Fixed infra is `~$50/mo` until you
outgrow the Pro tiers.

---

## 2. Pricing assumptions (model rates)

The code calls two models (exact strings in `pages/api/ocr.js`):

| Model (code string) | Input $/1M tok | Output $/1M tok |
|---|---|---|
| `claude-sonnet-4-5` (Sonnet tier) | $3.00 | $15.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

**Token sizing assumptions:**
- A PDF page sent as a `document` block ≈ **~2,000 tokens** (Claude processes
  each page as extracted text + a rendered page image; dense pages run higher).
- A rendered page **image** for the vision path ≈ **~1,500 tokens** (images at
  `scale: 2` ≈ 1224×1584 px are auto-downscaled by the API to ~1.15 MP, i.e.
  ≈ pixels ÷ 750 tokens).
- Prompts/field-lists are small (hundreds of tokens to low thousands).

---

## 3. Per-operation cost map (the pipeline)

Model routing as implemented (primary → fallback):

| Step | File / function | Model | Image? | Scales with | Notes |
|---|---|---|---|---|---|
| **1. Context analysis** | `analyzeDocumentContext()` | Haiku | no | 1× / doc | Classify single-party vs multi-party. ~2.5K in / 0.5K out. |
| **2. Field labeling** | `runStep2FieldLabeling()` | Sonnet → Haiku | **yes (full PDF)** | `ceil(fields/40)` chunks | **Dominant cost.** The *entire PDF* is re-sent in **every** 40-field chunk. |
| **3a. Explanations** | `runStep3aExplanations()` | Haiku → Sonnet | no | `ceil(fields/10)` chunks | Plain-English "what is this / where to find it". |
| **3b. Translations** | `runStep3bTranslations()` | Haiku → Sonnet | no | `ceil(fields/10)` chunks | Haiku-first for **all** languages (Sonnet timed out on CJK). Only if target ≠ English. |
| **Vision detect** | vision-grid / OCR-anchor | Sonnet | **yes (1/page)** | up to `OCR_VISION_DETECT_MAX_PAGES` (10) | Only when no native AcroForm/text fields (scanned, XFA). |
| **Label backfill** | pre-setup backfill | Sonnet (img) / Haiku (text) | sometimes | up to 8 pages | Only in `pre_setup` mode when field names are opaque. |
| **Classify fields** | `api/enterprise/classify-fields` | Haiku | no | 1× / doc (cached) | Enterprise setup path only. ~$0.012. |
| **Chat** | `api/.../chat` → `chatWithCo()` | Haiku | no | **per message** | Unbounded; context summarizes up to 300 fields + history. |

**Zero-API-cost (local compute only):**
- `supabase/functions/extract-form-fields` — pdf-lib + pdfjs (AcroForm + text/positions).
- `supabase/functions/pdf-to-image` — MuPDF wasm rendering.
- `lib/ocrWords.js` — Tesseract OCR (wasm).
- `lib/pdfTextExtraction.js`, `lib/ocrAnchor.js` — pure-JS geometry.

These cost only Supabase edge-function invocations + bandwidth, not API tokens.

---

## 4. Worked per-document scenarios

Unit prices: Sonnet in/out = $3 / $15 per M; Haiku in/out = $1 / $5 per M.

### A. Simple 1-page AcroForm (20 fields), English
| Step | Calc | Cost |
|---|---|---|
| 1. Context | 2.5K in + 0.5K out (Haiku) | $0.005 |
| 2. Labeling | 1 chunk, 1-page PDF (~2K) + list/prompt + ~1.2K out (Sonnet) | $0.028 |
| 3a. Explanations | 2 chunks (Haiku) | $0.007 |
| 3b. Translation | English → skip | $0.000 |
| **Total** | | **~$0.04** |

### B. Complex 6-page AcroForm (100 fields), English
| Step | Calc | Cost |
|---|---|---|
| 1. Context | Haiku | $0.005 |
| 2. Labeling | **3 chunks × (6-page PDF ~12K in + out)** (Sonnet) | **$0.174** |
| 3a. Explanations | 10 chunks (Haiku) | $0.033 |
| **Total** | | **~$0.21** |

### C. Same as B, translated (Spanish / Chinese / any)
B + Step 3b (10 chunks, Haiku ≈ $0.043) = **~$0.26**. Language doesn't change
the price — everything translates on Haiku.

### D. Scanned / XFA doc, no native fields (vision path), 6 pages
| Step | Calc | Cost |
|---|---|---|
| 1. Context | Haiku | $0.005 |
| Vision detect | 6 pages × ~$0.029 (Sonnet, 1 image/page) | $0.175 |
| 3a. Explanations | Haiku | $0.033 |
| **Total (6 pp)** | | **~$0.21** |
| **Total (10 pp cap)** | 10 × $0.029 + … | **~$0.33** |
| **+ translation** | + $0.043 | **+$0.04** |

**Takeaway:** Step 2's full-PDF-per-chunk re-send is what makes big AcroForms
cost as much as the vision path. See §7 for the fix.

---

## 5. Per-page and per-message figures

- **AcroForm path:** not strictly linear (Step 2 re-sends the whole PDF per
  40-field chunk), but works out to **~$0.03–$0.05 per page** for typical
  multi-page forms; a 1-pager is ~$0.04 flat.
- **Vision path:** **~$0.029 per page** (one Sonnet vision call/page).
- **Per field:** ~$0.0008 (explanation) + ~$0.0005 (translation).
- **Per chat message:** **~$0.0045** (Haiku, ~2K in / ~0.5K out). A 10-message
  recipient session ≈ **$0.045**.

---

## 6. Hosting / infrastructure (monthly)

| Service | Role | Free tier | Paid tier | Notes |
|---|---|---|---|---|
| **Vercel** | Next.js host, serverless API (OCR, chat), cron | Hobby $0 (non-commercial) | **Pro $20/mo** | Commercial use needs Pro. OCR functions are long-running (multiple ≤30s Anthropic calls) — watch function GB-hrs. |
| **Supabase** | Postgres, Auth, Storage (PDFs), edge functions | Free (500MB DB / 1GB storage) | **Pro $25/mo** | Storing PDFs → use Pro (100GB storage, daily backups, 2M edge invocations). |
| **Upstash Redis** | Distributed rate limiting | 10K cmds/day = $0 | ~$0.20/100K | `lib/rateLimit.js` falls back to in-memory if unset. |
| **Sentry** | Error monitoring | 5K errors/mo = $0 | $26/mo (Team) | Inert unless DSN set. |
| **Resend** | Signing-link email | 3K/mo = $0 | $20/mo | Wired but unverified; links are copy/paste today. |
| **Domain** | — | — | ~$1/mo | ~$12/yr. |

**Fixed baseline (production, low–moderate volume):** Vercel Pro $20 +
Supabase Pro $25 + domain $1, with Upstash/Sentry/Resend on free tiers ≈
**~$46/mo**, realistically **$45–$75/mo** as you turn on monitoring/email.

---

## 7. Total cost of service at volume

Using a blended **$0.26/doc** for complex translated docs (incl. ~3 chat
messages/doc) + fixed infra:

| Volume / month | Variable (API) | + Fixed infra | **Total** | **All-in / doc** |
|---|---|---|---|---|
| 100 complex docs | ~$26 | $50 | **~$76** | ~$0.76 |
| 1,000 complex docs | ~$260 | $60 | **~$320** | ~$0.32 |
| 10,000 complex docs | ~$2,600 | ~$150 (overages) | **~$2,750** | ~$0.28 |
| 1,000 **simple** docs | ~$40 | $50 | **~$90** | ~$0.09 |

At a **$19/mo** personal plan, a subscriber is gross-margin-positive unless
they process **>~70 complex docs/mo** or chat very heavily. The cost tail is:
(1) big multi-page AcroForms (Step 2), (2) unbounded chat, (3) scanned docs
(vision).

---

## 8. Cost-reduction recommendations (ranked)

1. **Prompt-cache the Step 2 PDF (`cache_control`). ✅ SHIPPED 2026-06-18.**
   The full PDF used to be re-sent in every 40-field chunk; it now carries
   `cache_control: {type:'ephemeral'}` on the `document` block whenever there's
   more than one chunk (gated on `chunks > 1` — see the measured downside
   below). The PDF is billed once as a cache write (~1.25× input) then read at
   ~0.1× input on subsequent chunks.

   **Measured against the live API** (2026-06-18, `claude-sonnet-4-5`):
   | Doc | Cached tokens | Cold 2-chunk savings |
   |---|---|---|
   | 10-page contract | 22,932 (write → read confirmed) | **30.9%** |
   | 1-page form (warm cache, both read) | 1,901 | **54.6%** |
   | **1-chunk doc (gate off)** | — | **−19.9% (costs MORE)** ← why the gate |

   Savings rise with chunk count (≈31% at 2 chunks → >50% at 3+). The cache
   also survives across re-processing within the 5-min TTL. Cache hits/writes
   are visible in the per-call `usage` log
   (`cache_read_input_tokens` / `cache_creation_input_tokens`).
2. **Don't re-send the whole PDF per chunk.** Alternatively, send the PDF once
   per document (single call when fields fit) or slice by the pages a chunk's
   fields actually live on.
3. **Cap vision pages — not image scale.** Measured via `count_tokens`
   (2026-06-18): a Letter page bills **648 / 1,429 / 1,506 tokens at scale
   1.0 / 1.5 / 2.0**. Scale 2 is already at the API's ~1.15 MP resize cap, so
   dropping to 1.5 saves only **~5% (~$0.0002/page)**, and scale 1.0 (~57% off
   image tokens) is too low-res for checkboxes/fine print. Image input is also
   the *small* part of a vision call — the **output** (~1,500 tok @ $15/M ≈
   $0.022/page) dominates, so shrinking the image barely moves the bill. **The
   real lever is fewer pages:** lowering `OCR_VISION_DETECT_MAX_PAGES`
   (default 10) drops whole Sonnet calls linearly (10→5 ≈ halves the worst-case
   ~$0.29 vision cost). Risk: forms with fields past the cap (trailing
   signature pages) lose them — so cap by document type, not globally.
4. **Evaluate a dedicated form parser** (Google Document AI / AWS Textract) for
   the vision path — this is a **quality/determinism play, not a cost cut**.
   Form parsing is roughly cost-neutral-to-pricier vs Sonnet vision (~$0.029/pg
   measured): Document AI Form Parser ≈ $0.03/pg, Textract Forms ≈ $0.05/pg;
   only plain OCR (no field structure) is cheap (~$0.0015/pg). The value is
   **deterministic field positions** (solves the vision non-determinism that
   OCR-anchoring works around — see PRD §4.4), at the cost of a new vendor +
   PII/DPA review. Worth it only if scanned/XFA accuracy is an actual pain
   point.
5. **Haiku-first Step 2 for simple docs** via `OCR_STEP2_PRIMARY_MODEL=claude-haiku-4-5`
   (3× cheaper in/out) with a Sonnet fallback for low-confidence results.
6. **Bound chat** — cap messages/session or trim context (already summarizes
   300 fields); each message is cheap but unbounded.

---

## 9. Caveats

- Output token counts are assumed (typical), not measured — actual `usage` is
  logged per call (`[OCR][anthropic]`), so a production sample over a week of
  real documents will tighten every number here.
- Sonnet 4.5 pricing is assumed at the Sonnet-tier $3/$15; confirm against the
  current rate card.
- Retries/fallbacks (Step 2 primary→fallback, text-batch page-by-page retries)
  can multiply a step's calls in the worst case; the figures above assume the
  happy path.
