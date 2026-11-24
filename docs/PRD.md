# Cô Sign — Product Requirements Document (PRD)

> **This document is the source of truth for product decisions.** When changing
> behavior, copy, or visual design, update the relevant section here in the same
> commit and reference the section (e.g. "PRD §3.2") in the commit message.

- **Status:** Living document
- **Current focus:** Enterprise portal (PRD §2–§6). Personal/consumer portal is
  out of scope until further notice.
- **Last updated:** 2026-11-17

---

## 1. Product overview

Cô Sign is an AI-assisted document completion and signing platform. A company
uploads a PDF, the system detects its form fields with AI (labels, types,
positions, and on-demand translation into any of 9 languages), staff position and curate
the fields once, and then send secure signing links to clients. Clients fill
and sign in the browser — with an AI assistant ("Cô") that explains any field
in plain language — and the company receives a completed, signed PDF.

**Differentiator:** built for organizations serving multilingual (especially
Vietnamese-speaking) clients. Every recipient-facing surface supports nine
languages — English, Tiếng Việt, Español, Português, Français, 中文（普通话）,
粵語, Kreyòl Ayisyen, and नेपाली — and the AI assistant answers in the
recipient's language. Language codes: `en`, `vi`, `es`, `pt`, `fr`, `zh`
(Mandarin/Simplified), `yue` (Cantonese/Traditional), `ht`, `ne`. (Burmese `my`
was trialed then removed — its token-heavy output reliably exceeded the 30s
per-call translation cap on large forms.)

**Cost to use:** every feature is free to use, for everyone. There are no
plans, tiers, usage limits or payments.

### 1.1 Roles

| Role | Portal | What they do |
|---|---|---|
| Staff / admin | `/enterprise/*` | Upload, set up, send, track documents |
| Owner | `/enterprise/owner` | Platform usage analytics (allowlisted emails) |
| Recipient (client) | `/{locale}/fill/[token]`, `/embed/[token]` | Verify identity, fill, sign — no account needed |

**Navigation (main path only).** `/` sends a fresh install to `/setup` and,
once setup is done, to the enterprise sign-in at `/enterprise/login`. After
sign-in everyone, owners included, lands on All Documents
(`/enterprise/documents`). The enterprise sidebar shows All Documents and Send
Links, plus Owner Usage for owners. Dashboard (`/enterprise/admin`),
Recipients and Templates are not in the sidebar but still open by URL.

---

## 2. Enterprise workflow (canonical)

The enterprise portal is organized around one pipeline. Every screen either
advances a document through it or reports on it:

```
UPLOAD  →  PREP (AI)  →  SET UP  →  SEND  →  TRACK  →  COMPLETED
 staff      automatic     staff      staff    automatic
```

| Stage | `lifecycle_status` | Where | What happens |
|---|---|---|---|
| Upload | `uploaded` | Documents → "New document" | PDF goes to storage; AI field detection starts automatically |
| Prep | `uploaded` + `processing_status=prepping` | (background) | Claude detects fields, types, translations, positions |
| Set up | `setup_required` | `/enterprise/setup?id=…` | Staff reviews/positions fields, confirms document type |
| Send | `ready_to_send` (and stays sendable through `sent`/`opened`/`completed`) | `/enterprise/send-links` | Staff creates a secure signing link per recipient |
| Track | `sent` → `opened` → `completed` | All Documents / Send links | Status updates live as recipients open, fill, sign |

**Flow rules (UX):**
- **§2.1** After setup is saved, the user is taken directly to the send step
  with the document preselected — never dumped back at a list to find their
  own next step.
- **§2.2** After a signing link is created, the link is displayed prominently
  with a one-click copy — the user must never have to hunt for it in a table.
  When mail is not set up, sending by email sends nothing: the session is not
  marked sent, `/api/sessions/create` answers `emailSent: false`,
  `mailOff: true` and the `shareUrl`, and the success panel says "No email was
  sent: mail is not set up. Copy this link and send it yourself." The link's
  fallback address (no request host) is the saved site address
  (`NEXT_PUBLIC_APP_URL`, env first).
- **§2.3** A document's row always shows exactly one primary action that
  matches its stage (Set up / Send / View links).
- **§2.4** Documents with completed setup remain sendable to additional
  recipients forever (multi-recipient is the norm, not the exception).
- **§2.5** Recipient fill cards are expanded by default — recipients fill
  top-to-bottom without clicking each card open. Setup cannot be saved while
  the AI label refresh is still running, so recipients never see generic
  "Field 2"-style labels.
- **§2.6** A step-by-step onboarding guide (Upload → Set up → Send → Track)
  opens automatically on a staff member's first visit and can be reopened any
  time from the profile menu ("Getting started guide").
- **§2.7** Completed sessions expose a "Signed PDF" download on the Send Links
  tracking table. The filled PDF lives in the private `filled-documents`
  bucket; `/api/sessions/signed-pdf` mints a short-lived signed URL after
  verifying the caller is an active org member. Each signed PDF carries only
  its own signer's answers and signature: one document can be sent separately
  to unrelated people, and nothing stored marks which sessions belong to one
  signing, so answers are never combined between sessions (combining
  co-signers' answers needs a signing group and is not built, see issue #411).
  On completion the session metadata also records the signed PDF's SHA-256
  fingerprint and size (`filled_pdf_sha256`, `filled_pdf_bytes`), and
  `/api/sessions/signed-pdf` answers `{ url, sha256, bytes }` for the asked-for
  session's own PDF, never another session's (sha256 and bytes are null for a
  PDF saved before they were recorded).
- **§2.8** Field curation (enable-first). Setup is "select what's needed":
  every detected field has an enable toggle (default all on), with bulk
  enable/disable, a live "X of Y enabled" count, and an "Add field" control
  for anything detection missed. The enabled set is saved as
  `phase1_data.includedFieldIds` (empty = all). When a signing link is
  created, the recipient's `field_filter.ids` defaults to that enabled set
  (per-recipient picker, seeded from setup, can narrow further); the fill API
  hides the rest. So staff curate once at setup and recipients only see the
  fields that matter — verified end-to-end (23 → 3 fields at setup → recipient
  sees 3).
- **§2.9** Org switching. A staff member who belongs to multiple
  organizations can switch the active org from the sidebar; the choice
  persists per user. `useAuth` exposes `memberships` and `switchOrg`, and
  `orgId` reflects the active selection.

---

## 3. Signing links

- **§3.1 URL origin.** Share links are built from the **request origin**
  (`x-forwarded-host` / `host` headers) of the API call that creates them, so
  links always carry the domain the staff member is actually using
  (e.g. `https://app.example.com/...`). `NEXT_PUBLIC_APP_URL` is only a fallback
  when no request context exists (e.g. emails sent from background jobs).
  Localhost must never appear in a link unless the app is genuinely being
  used on localhost.
- **§3.2 Security.** Links are unguessable tokens with expiry (default 30
  days). When the recipient's email + last name are on file, identity
  verification is required before the document opens. All recipient writes are
  CSRF-protected (double-submit cookie).
- **§3.3 Languages.** Each link carries a preferred language (one of
  `en`, `vi`, `es`, `pt`, `fr`, `zh`, `yue`, `ht`, `ne`) that controls the
  recipient UI and the AI assistant's replies. The canonical list lives in
  `lib/i18n.js` (`locales`, `localeNames`, `localeFlags`); the field-translation
  layer reads it from `SUPPORTED_LANGUAGES` in `lib/fieldTranslations.js`. Adding
  a language = add the code to those lists, add three `fields` columns
  (`field_name_<code>`, `explanation_<code>`, `position_hint_<code>`), add a
  `getLanguageConfig` name in `pages/api/ocr.js`, and add `locales/<code>.json`
  (+ `public/locales/<code>.json`). Per-field translations are AI-generated on
  demand; the static UI strings live in the locale JSON files.

---

## 4. AI

| Use | Model | Rationale |
|---|---|---|
| Field detection / OCR (vision) | `claude-sonnet-4-5-20250929` | Accuracy-critical, runs once per document |
| "Chat with Cô" assistant | `claude-haiku-4-5` | High-volume, short conversational answers about form fields; quality requirement is modest, cost matters (≈$1/M input vs $5/M for Sonnet, $25/M for Opus) |

- **§4.1** Chat is grounded on the document's detected fields pulled from the
  database (`lib/chatContext.js`) — no vector store, no OpenAI dependency.
- **§4.2** Chat replies are capped (max_tokens 1024) and answer in the
  recipient's language.
- **§4.3** The platform has a single AI provider (Anthropic). Introducing a
  second provider requires a decision recorded here.

### §4.4 Field detection & labeling architecture (so we don't re-litigate what exists)

Detection runs in `pages/api/ocr.js` (`mode: pre_setup` on upload, `post_setup`
after setup). It picks a **path** based on what the PDF offers, then labels and
positions each field. This is all already implemented — the notes below are the
canonical description.

**Detection paths (in priority):**
1. **Native / HYBRID (AcroForm)** — `extractFormFields` edge function returns
   the embedded form widgets with their rectangles. ocr.js uses the rects for
   positions and only AI-labels fields whose names are generic. Used when the
   PDF has form widgets (most gov/legal forms, incl. XFA like the I-485/W-9).
2. **Text-layer** — when there are no widgets but a text layer exists, fields
   are detected from the text (read in-process with pdfjs by
   `lib/pdfjsTextItems.js`) and matched to label text.
3. **Vision (fallback, wired 2026-06-17)** — when there are no AcroForm widgets
   AND no text layer (scanned image PDFs, or XFA/dynamic forms pdf-lib can't
   parse), the terminal "no fields" branch renders each page via the
   `pdf-to-image` edge function (MuPDF) and runs Claude vision (`buildVisionPrompt`,
   Sonnet) to detect fields, positions, and inline translations. Only fires when
   the other paths return zero fields (additive — can't regress working docs);
   capped at `OCR_VISION_DETECT_MAX_PAGES` (default 10). Note: `buildVisionPrompt`
   existed but was never called before this date, so such docs previously
   detected zero fields. Also covers checkbox/signature detection on scanned docs.
   **Accuracy of vision positions:** detection + labels + types are reliable, but
   coordinates are an estimate. To tighten them, `buildGriddedImage` overlays a
   faint 5%/10% coordinate grid (with 0–100 axis labels) on each page before the
   vision call and the prompt tells the model to read coordinates off the grid and
   to **omit fields with no visible blank/box/line** (so it stops inventing boxes
   in empty space). Tested on a scanned W-2: tighter alignment on value cells and
   no empty-space boxes vs the ungridded run. Positions are still a *starting
   point* — vision docs go through the Phase-1 manual positioning pass, which can
   also add the occasional borderless open field the strict prompt skips.

   **Vision-positioning accuracy — RESOLVED via OCR-anchoring** (full
   investigation + measurements in `docs/POSITIONING-RESEARCH.md`). Key result:
   vision models are unreliable at *coordinates* (the units even flipped between
   percent and pixels run-to-run), so the reliable approach derives positions
   from **OCR geometry**, not the model:
   - **[SHIPPED] OCR-anchored geometry** (`lib/ocrAnchor.js` + `lib/ocrWords.js`,
     wired in the vision branch behind `OCR_VISION_USE_OCR_ANCHOR=1`): vision
     names each field + its verbatim `label_text` + type (no coords); Tesseract
     gives exact word boxes; the writable box is derived from the label anchor +
     OCR neighbor geometry. **Measured 93% of boxes overlap the true cell, median
     ~1.5% error** on a scanned W-2 (locked by `tests/lib/ocrAnchor.test.js`).
     Flag-gated/default-off until serverless Tesseract cold-start/cost is
     validated on a real deploy; `tesseract.js` is in `serverExternalPackages`.
   - **[SHIPPED earlier] Grid overlay + whitespace rejection + open-field
     recovery** (`buildGriddedImage` + strict prompt) — the vision-grid path,
     still the default fallback when the OCR-anchor flag is off.
   - **[Optional cheaper rungs, not needed given OCR-anchor]** tiling for dense
     pages (~4 vision calls/page); two-pass crop refine (1 call/field).
   - **[Production max] Form-parser with native geometry** — Google Document AI
     *Form Parser* or AWS Textract *FORMS* return key/value bounding boxes (90%+),
     the only path toward mostly *skipping* the manual setup pass. Needs GCP/AWS
     creds + wiring (`extract-docai` doesn't expose word boxes today). Same
     principle as OCR-anchor (real geometry, not model coordinates).

**Field label sources (priority order):**
1. `/TU` tooltip (the PDF's own human label) — best when present.
2. **Position-matched text label** — the `extract-form-fields` edge function
   "Method 4" extracts the text layer (pdfjs) and assigns each field the text
   found **above/left** of its box (`field.textLabel`). This is the
   "OCR the labels, match them to the boxes" mechanism for weirdly-named fields.
3. **AI relabeling** — ocr.js HYBRID path sends fields whose name is
   `isGenericFieldLabel(...)` through a Claude labeling pass.
4. **Readable fallback** — `toReadableFieldName` → "Field N".
5. **Display tidy** — `lib/fieldTranslations.prettifyLabel` (whitespace,
   bullets, de-dup, and `humanizeTechnicalName` for semantic technical names
   like `…BusinessName[0]` → "Business Name").

**Position sources:** AcroForm fields use widget rects; their **page** is
re-derived from each widget's `/P` ref in ocr.js (`resolveFieldPagesFromPdf`),
falling back to the extractor's page when pdf-lib can't parse the PDF (XFA).
Text-layer values are placed **in the blank** (underscore run / right of the
label) via `positionValueInBlank`, not on the label.

**Opaque-named fields — vision/text label backfill (built 2026-06-17).** When a
widget's name is technical with no good `/TU` (e.g. `topmostSubform…f1_01`) AND
Method 4's position match misses, ocr.js runs a labeling backfill (pre_setup,
`mode==='pre_setup'`): for each page that has unlabeled technical fields, it
prefers a rendered page image (Claude vision via `pdf-to-image`) and **falls
back to the page's extracted text-with-positions** (Claude Haiku) when
rendering fails. It asks for the human label nearest each field box and
writes it to `field_name`. Gated to fields flagged by `isGenericFieldLabel` /
`isTechnicalFieldName`, capped at `OCR_VISION_LABEL_MAX_PAGES` (default 8),
best-effort. Verified on the W-9: 23/23 opaque fields → real labels ("Name of
entity/individual", "City, state, and ZIP code", "Account number(s)", …).

`pdf-to-image` is **deployed** (`supabase/functions/pdf-to-image`, since
2026-06-17). It renders a page to PNG with **MuPDF (pure WebAssembly)** rather
than a DOM canvas — the Supabase edge runtime has no `OffscreenCanvas`, which
is why the earlier pdfjs-dist + canvas version could not run. The ~10MB MuPDF
wasm is **not bundled** (the Management-API deploy path has no static-file
support and MuPDF resolves its wasm via a runtime URL); instead the function
fetches the wasm from jsDelivr once per worker and hands the bytes to MuPDF via
its `$libmupdf_wasm_Module.wasmBinary` hook, then memoizes the initialized
module. Cold start ≈ 2.3s (wasm fetch + compile, mostly I/O), warm ≈ 0.7s/page;
`verify_jwt` is on (the OCR caller sends the anon bearer). Request:
`{ pdfBase64, pageNum, scale }` → `{ success, image (base64 PNG), totalPages,
width, height }`. The text-position fallback above remains for transient
render failures and for pages MuPDF can't rasterize.

---


## 5. Enterprise UI standards

- **§5.1 Iconography.** Feather icons (`react-icons/fi`) only. **No emoji**
  in navigation, buttons, badges, stat cards, or table content. Emoji read as
  unfinished/consumer-grade in an enterprise product.
- **§5.2 Copy.** Sentence case ("Setup required", not "⚠ Setup Required").
  Recipient-facing noun is **"signing link"**; internal route/table names may
  keep `send-links`. Buttons are verbs ("Send", "Set up", "Copy link").
- **§5.3 Design system.** Defined in `components/enterprise/EnterpriseLayout.js`:
  Plus Jakarta Sans, soft shadows, rounded corners, `ent-*` utility classes.
  New enterprise UI must use these classes rather than ad-hoc styles where one
  exists.
  - **Surface accent (two-palette brand).** The enterprise console reads in
    **indigo**; the recipient/personal and marketing surfaces keep the
    original **teal**. This is a deliberate signal so staff always know
    they're on the admin side. Mechanism: the Tailwind `brand-*` palette
    resolves to CSS variables (`--brand-50…900`). `styles/globals.css` defines
    the teal defaults on `:root`; `EnterpriseLayout` — which only mounts on
    enterprise pages — overrides those variables with the indigo ramp, so
    every `brand-*` utility and every `ent-*` class on an enterprise page
    shifts to indigo automatically (including shared components like
    `Phase1SetupModal`, which render indigo on `/enterprise/setup` but teal on
    the retired personal route). The public enterprise **marketing** landing
    (`/enterprise`) and the **login gateway** also carry indigo so the entire
    enterprise journey — from first marketing touch through the authenticated
    console — is one coherent surface, visually separate from the teal
    client/recipient experience. Status colors (amber / green / red / neutral)
    are unaffected by the accent.
- **§5.4 Status badges.** One badge per document/session, colored by stage:
  amber = needs staff action, teal/blue = in flight, green = done,
  grey = neutral.
- **§5.5 Homepage.** The marketing header links to Enterprise and Sign in;
  the footer contains only honest links (no placeholder socials, no
  mislabeled pages) and is laid out in stacked columns.

---

## 6. Test environment

- Test account: `admin@example.com` / `Test123!` (the email can be overridden
  with `NEXT_PUBLIC_DEV_LOGIN_EMAIL`, read in `lib/devLogin.js`) — works on both portals;
  enterprise dev-login shortcut `admin` maps to it. It is an owner only if
  the owner list names it: `ADMIN_DASHBOARD_EMAILS` from env, then
  `NEXT_PUBLIC_OWNER_EMAILS` from env, then (on the server) the
  `ADMIN_DASHBOARD_EMAILS` saved on the host by first-run setup, the first that
  names someone; there is no built-in allowlist. `npm run seed:dev` provisions it
  (org "Enterprise Test").
- `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` enables the username shortcut in dev.

---

## 7. Decision log

| Date | Decision | Where |
|---|---|---|
| 2026-06-10 | Chat moved from OpenAI (gpt-4o + embeddings RAG) to Anthropic; embeddings retrieval replaced with DB-grounded field context | §4, §4.1 |
| 2026-06-11 | `beta_signups` RLS enabled; service-role-only writes | migration `20260611000000` |
| 2026-06-11 | Documents stay sendable after first send (`ready_to_send`→`sent`→`opened`→`completed` all sendable) | §2.4 |
| 2026-06-12 | Share links derive from request origin, not env var | §3.1 |
| 2026-06-12 | Chat model set to `claude-haiku-4-5` (cost) | §4 |
| 2026-06-12 | Enterprise UI: emoji replaced with Feather icons; copy standardized | §5.1, §5.2 |
| 2026-06-12 | Setup completion routes to send step with document preselected; link creation shows copyable success panel | §2.1, §2.2 |
| 2026-06-12 | `/api/sessions/create` accepts `null` for blank optional fields — creating a link without a recipient email previously failed with 400 | §3 |
| 2026-06-12 | Fill cards expanded by default; setup save blocked during label refresh; onboarding guide added; homepage header/footer cleaned up | §2.5, §2.6, §5.5 |
| 2026-06-15 | RLS hardened: blanket-`true` policies on documents/fields/chat_history replaced with owner+org scoping (closed anon-key data exposure) | migration `20260612120000`, §7 |
| 2026-06-15 | Staff can download the signed PDF of completed sessions | §2.7 |
| 2026-06-15 | Retention cron scheduled (`vercel.json`); in-memory rate-limit fallback; Sentry wired (DSN-gated) | §8.1–§8.3 |
| 2026-06-15 | Per-recipient field curation in the send form | §2.8 |
| 2026-06-15 | Org switcher for multi-membership users | §2.9 |
| 2026-06-15 | Personal `/[locale]/dashboard` retired → redirects to enterprise; homepage "Sign in" points to enterprise login | §9 |
| 2026-06-16 | Two-palette brand: entire enterprise surface (marketing landing, login, authenticated console) shifted teal→indigo; recipient/client stays teal. Tailwind `brand-*` now resolves to CSS vars; EnterpriseLayout overrides them with indigo on console pages | §5.3 |
| 2026-06-16 | `documents` storage bucket made private (was public; held PII originals). App uses signed URLs only | migration `20260616120000`, §8.4 |
| 2026-06-16 | Full A–Z run-through verified on a real USCIS I-9 (128 fields, fill+9 signatures → completed → signed-PDF download); go-live checklist added | §8.5, `docs/GO-LIVE-CHECKLIST.md` |
| 2026-06-16 | Second A–Z run on a real HUD Model Lease contract (13 pages, 45 fields, multi-recipient). Surfaced + fixed two bugs below | `pages/api/ocr.js`, `pages/api/sessions/[token]/complete.js` |
| 2026-06-16 | Bug fix: OCR step 2/3 used retired model `claude-3-haiku-20240307` (404, ran on fallback). Now `claude-haiku-4-5` (PRD §4) | `pages/api/ocr.js` |
| 2026-06-16 | Bug fix: a fully-signed document could stay `ready_to_send` (re-query-then-`.every()` skipped the lifecycle update on an empty read). Now a direct non-completed-session count drives the `completed`/`opened` transition | `pages/api/sessions/[token]/complete.js` |
| 2026-06-16 | Third A–Z run on a real multi-party contract (TREC residential purchase agreement, 263 fields, buyer/seller). Verified vi + es recipient localization end-to-end. Fixed three more bugs below | `pages/api/ocr.js`, `pages/[locale]/fill/[token].js` |
| 2026-06-16 | Bug fix: multi-party detection was fully broken — the context analyzer did a naive `JSON.parse` that threw on `claude-haiku-4-5`'s ```json fences, so every document defaulted to single-party. Now strips fences / extracts the first JSON object; correctly detects `isMultiParty` + roles (e.g. buyer/seller) | `pages/api/ocr.js` |
| 2026-06-16 | Bug fix: documents with >200 fields could not be filled or submitted — the client sent all field values in one PUT, tripping the server's `MAX_FIELDS_PER_REQUEST=200` (HTTP 400). The fill client now chunks saves (≤150/request) | `pages/[locale]/fill/[token].js` |
| 2026-06-16 | i18n: recipient "not ready" panel and per-field constraint hints ("Expected: …") were hardcoded English on vi/es pages; now localized | `pages/[locale]/fill/[token].js` |
| 2026-06-16 | Bug fix: multi-page field paging. The form-field extractor collapsed every field onto page 1 on multi-page documents, so fields rendered on the wrong page. OCR now re-derives each field's page from its pdf-lib widget /P ref and overrides page + position.page. Verified on the I-9: pages now `{1,3,4}` instead of all `1`, and filled values render on their correct pages | `pages/api/ocr.js` |
| 2026-06-16 | NOTE: the deployed `extract-form-fields` Supabase edge function (v20) is ahead of the repo source (it has a pdfjs label pass + position conversion the repo lacks). The page fix was placed in `ocr.js` to avoid regressing prod by deploying the stale repo function. Repo edge-function source should be re-synced with prod (tracked in go-live checklist) | §8, `GO-LIVE-CHECKLIST.md` |
| 2026-06-16 | Verified the multi-page paging fix is AcroForm-specific: the non-AcroForm text-layer path already assigns pages correctly (3-page flat doc → fields on pages 1/2/3 in data + fill view). Validated the AcroForm fix on an 11-page/340-field contract (296 fields re-paged, distribution matched ground truth, pages 5/6 confirmed) | `GO-LIVE-CHECKLIST.md` |
| 2026-06-16 | Bug fix: text-layer detection on dense non-AcroForm docs timed out (3 pages/call, 30s) and one batch failure zeroed the whole document. Now 2 pages/call, 60s cap, per-batch isolation + page-by-page retry. A 10-page non-AcroForm contract went 0 → 198 fields, correctly paged | `pages/api/ocr.js` |
| 2026-06-16 | UX wave: setup-save "Finalizing field labels…" state (no more multi-click), large-doc fill collapses to 1 card + "Next field", viewer chrome localized, conservative label tidy-up, dashboard overflow fixed (`min-width:0`), onboarding scoped to Documents | `Phase1SetupModal.js`, `[token].js`, `PdfViewer.js`, `fieldTranslations.js`, `EnterpriseLayout.js`, `OnboardingGuide.js` |
| 2026-06-16 | Enable-first setup (§2.8): setup now has per-field enable toggles + bulk + count + Add field; the enabled set saves to `phase1_data.includedFieldIds` and now flows to the recipient's `field_filter` by default (create-time fallback + send picker seeded from setup). Verified end-to-end: 23 fields → enable 3 at setup → recipient sees 3 | `Phase1SetupModal.js`, `sessions/create.js`, `send-links.js` |
| 2026-06-16 | AI smart-default for enable-first: `/api/enterprise/classify-fields` (Haiku) classifies which fields the recipient fills, cached on `phase1_data.recipientFillableIds`; setup seeds the enabled default from it ("N of M · suggested") with a keyword heuristic fallback. Verified: I-9 → 50/128 suggested, cached | `pages/api/enterprise/classify-fields.js`, `setup.js`, `Phase1SetupModal.js` |
| 2026-06-16 | Bug fix (#8): non-AcroForm (text-layer) values rendered on the label instead of in the blank. OCR now positions the value at the underscore run / just after the label (via the text item's measured width) and on the baseline. Verified on a flat doc. AcroForm untouched | `pages/api/ocr.js` |
| 2026-06-17 | UX wave 2: field search/filter in setup + fill (>15 fields), recipient "required only" filter + "next required" jump, documents-list detection progress bar, send-screen "still preparing" note, label de-dup + technical-name humanizer | `Phase1SetupModal.js`, `[token].js`, `documents.js`, `send-links.js`, `EnterpriseLayout.js`, `fieldTranslations.js` |
| 2026-06-17 | Documented the field detection & labeling architecture in §4.4 (paths, label sources incl. Method 4 position-matching + AI relabeling, position sources) so what-exists isn't re-litigated | §4.4 |
| 2026-06-17 | Opaque-name labeling fixed: ocr.js label backfill labels technical AcroForm/XFA fields (image via pdf-to-image when available, else text+positions via Haiku). Verified W-9 → 23/23 real labels | `pages/api/ocr.js`, §4.4 |
| 2026-06-17 | `pdf-to-image` deployed: rewrote it to render with MuPDF (pure wasm) instead of `OffscreenCanvas` (unsupported in the edge runtime, which is why it never deployed). Wasm fetched from jsDelivr per worker + passed via `$libmupdf_wasm_Module.wasmBinary` (keeps bundle < 20MB; static files aren't supported on the API deploy path) and memoized. Tested on W-2 (1 pg) + 10-pg contract: correct page render, valid PNG, cold ≈ 2.3s / warm ≈ 0.7s, out-of-range page clamps. Activates the vision label-backfill branch | `supabase/functions/pdf-to-image/{index.ts,deno.json}`, `pages/api/ocr.js`, §4.4 |
| 2026-06-17 | Resolved the `extract-form-fields` drift note (2026-06-16): fetched deployed v20 and diffed it against the repo source — **byte-identical** except trailing whitespace (repo already has the pdfjs label pass + position conversion; an earlier commit had synced it). `deno.json` matches; aligned the unused legacy `import_map.json` to match it. A repo redeploy will not regress prod | `supabase/functions/extract-form-fields/import_map.json`, `GO-LIVE-CHECKLIST.md` |
| 2026-06-17 | Added 7 languages (pt, fr, zh/Mandarin, yue/Cantonese, ht, my, ne) → 10 total. Migration `20260617130000` adds 21 `fields` columns + rebuilds `enterprise_duplicate_template_tx` to copy them (had to match the live signature `p_org_id,p_user_id,p_new_file_path,p_new_file_url` — the repo migration 20260417 was stale). Generalized ocr.js to persist any language via `buildTranslationColumns`/`pickTranslationColumns` (was hardcoded vi/es) and made the Step-3b prompt language-neutral. Extended `lib/i18n.js`, `fieldTranslations.js`, `getStaticPaths` (11 pages), middleware, fill/embed/admin/send-links/setup-modal pickers, session create+language validation. Full UI translations generated for all 7 in `locales/` and `public/locales/` (key parity with en). `next build` green | `pages/api/ocr.js`, `lib/i18n.js`, `lib/fieldTranslations.js`, `locales/*`, `public/locales/*`, migration `20260617130000` |
| 2026-06-17 | i18n polish (PR #12): load Noto Sans SC/TC/Myanmar/Devanagari so CJK/Burmese/Nepali render instead of tofu (`_document.js` + `globals.css` stack); derive `<html lang>` from the route locale; route non-Latin scripts (zh/yue/my/ne) to Sonnet first in Step-3b (Haiku fallback) to avoid stray-English-token artifacts; searchable/scrollable nav language menu | `pages/_document.js`, `styles/globals.css`, `pages/api/ocr.js`, `components/layout/Navigation.js` |
| 2026-06-17 | Wired the §4.4 Vision detection fallback (PR #12): `buildVisionPrompt` was dead code, so XFA/scanned PDFs detected 0 fields. Now the no-fields branch renders pages via `pdf-to-image` and runs Sonnet vision. Added `tests/lib/languages.test.js` (locale parity + accessor fallback). Verified: full `jest` (56) + `next build` (114 static pages) green; live translation step exercised for all 7 new languages on AcroForm (W-2) + contract fields. NOT yet done: a live enterprise A–Z run in a new language, and a real XFA/scanned doc run | `pages/api/ocr.js`, `tests/lib/languages.test.js`, §4.4 |
| 2026-06-17 | Recommendation backlog with shipped/deferred status recorded; deferred items (section grouping, repeated rows, conditional logic, AcroForm radio grouping, non-AcroForm coordinate clustering) left as isolated follow-ups to avoid regressing the verified detection/fill core | `docs/UX-IMPROVEMENTS.md` |
| 2026-06-17 | Enterprise testing of the new languages: verified Cantonese (`yue`) end-to-end on a live 375-field HUD-1 — session create (201), post-setup enrichment 80/80 fields with name+explanation (authentic Cantonese), DB persistence, and `/yue/fill` renders `html lang="yue"`. Recipient page also confirmed for Burmese before removal (`html lang="my"`, Burmese chrome) | live test, `pages/api/ocr.js` |
| 2026-06-17 | **Removed Burmese (`my`)** → 9 languages. Testing showed Burmese output is token-heavy and reliably exceeded the 30s per-call translation cap on large forms (every chunk timed out). Reverted the non-Latin→Sonnet-first routing too (it caused the same timeouts; Haiku handles all kept scripts well and fast). Removed `my` from i18n/fieldTranslations/pickers/getStaticPaths/validation, deleted `locales/my.json` + `public/locales/my.json`, dropped the 3 `my` columns and rebuilt `enterprise_duplicate_template_tx` (migration `20260617140000`), dropped the Myanmar web font | `lib/i18n.js`, `lib/fieldTranslations.js`, `pages/**`, `_document.js`, `globals.css`, migration `20260617140000` |
| 2026-06-17 | Vision positioning accuracy: added `buildGriddedImage` — overlays a faint 5%/10% coordinate grid (0–100 axis labels) on each rendered page before the vision call; the prompt reads coordinates off the grid, ignores the grid lines, and omits fields with no visible blank (prompt-level whitespace rejection, since no image lib is available in the runtime to decode pixels). Re-tested the scanned W-2 through the real OCR endpoint: tighter box alignment + no empty-space boxes vs ungridded. `next build` green | `pages/api/ocr.js`, §4.4 |
| 2026-06-17 | Recorded the vision-positioning accuracy roadmap in §4.4 (5 rungs: grid+whitespace SHIPPED; recover borderless open fields; tiling for dense pages; two-pass refine; OCR-anchor via Document AI as the only path toward skip-the-setup accuracy) so the next steps and their cost tradeoffs aren't re-derived | §4.4 |
| 2026-06-17 | **Reliable positioning solved (OCR-anchoring).** Investigation (`docs/POSITIONING-RESEARCH.md`) measured every approach against the W-2 AcroForm ground truth: vision *coordinates* are non-deterministic (units flip %↔px) — unusable; pixel line-detection ~55%; crop+vision ~70%; **OCR-anchored geometry = 93% boxes overlap the true cell, median ~1.5% error.** Built `lib/ocrAnchor.js` (pure, unit-tested) + `lib/ocrWords.js` (Tesseract, lazy) and wired into the vision branch behind `OCR_VISION_USE_OCR_ANCHOR=1` (default off; `tesseract.js` external). Fixtures + `tests/lib/ocrAnchor.test.js` lock the result. Production-max remains a form-parser (Document AI Form Parser / Textract). `next build` + `jest` (59) green | `lib/ocrAnchor.js`, `lib/ocrWords.js`, `pages/api/ocr.js`, `tests/lib/ocrAnchor.test.js`, `tests/fixtures/*`, `next.config.js`, `docs/POSITIONING-RESEARCH.md`, §4.4 |
| 2026-06-17 | Personal-side UI/UX makeover, **P0 shipped: palette unification.** Audited the non-enterprise surface (screenshots + code). Collapsed live pages onto the single teal `brand-*` + `slateish` system (`primary-*`→`brand-*`, `gray-*`→`slateish-*`) in `login.js`, `billing.js`, `documents/archived.js`, `pricing.js`, nav mobile — fixes the blue-vs-teal split (esp. login wordmark/button). Findings: `ChatWidget`/`PaywallModal`/`components/DocumentViewer` are dead code (recommend deleting); the "N" overlay is the Next.js dev indicator (not an app element); pricing reconciliation + the `/dashboard`→enterprise redirect are product decisions, left for input. Plan + backlog in `docs/PERSONAL-UI-MAKEOVER.md`. `next build` green | `pages/[locale]/{login,billing,pricing,documents/archived}.js`, `components/layout/Navigation.js`, `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-18 | Personal makeover, **P1 shipped: landing redesign + shared shell + dead-code cleanup + signature polish.** Rewrote `pages/[locale]/index.js` reusing only existing i18n keys (modern hero + product-preview card, 9-language strip, feature grid, value-props surfacing unused `concept.*` keys, visual how-it-works, gradient beta CTA). Added `components/layout/AppLayout.js` (one teal header/background/width) and moved `settings.js`/`billing.js`/`documents/archived.js` onto it, deleting three hand-rolled headers and fixing the broken "Back to dashboard" link (dashboard decommissioned → points home). Deleted the zero-import dead components `ChatWidget`/`PaywallModal`/`DocumentViewer` (removes stale Vietnamese copy, blue palette, non-live `$3.99/$7` paywall from the tree). Polished `SignatureCanvas.js` (slateish/brand palette, 520×160 pad, "sign here" baseline, aria-labels). `next build` + `next lint` green | `pages/[locale]/index.js`, `components/layout/AppLayout.js`, `pages/[locale]/{settings,billing,documents/archived}.js`, `components/SignatureCanvas.js`, `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-18 | **Personal dashboard rebuilt (reverses §9 retirement).** Replaced the `/[locale]/dashboard` enterprise-redirect with a real, fully-localized personal dashboard (all 9 locales' existing `dashboard.*` keys): drag-drop + click upload with a target-language picker (`lib/i18n` flags/names), search, All/Recent/Completed filters, multi-select bulk delete, archived link, skeleton loaders, and localized empty states — on the shared `<AppLayout>` teal shell, reusing `DocumentCard` + `useAuth`/`useDocuments`. Single uploads route to the doc detail page (where OCR auto-triggers). Added a "Documents" nav item to `AppLayout`; archived empty-state now links back to the dashboard. Login already targets `/[locale]/dashboard`, so the flow is coherent end-to-end. `next build` + `next lint` green | `pages/[locale]/dashboard.js`, `components/layout/AppLayout.js`, `pages/[locale]/documents/archived.js`, §9 |
| 2026-06-18 | **Cost analysis documented** (`docs/COST-ANALYSIS.md`). Bottoms-up per-page AI model from the real code paths: ~$0.04/simple form, ~$0.21 complex (English), ~$0.26 translated, ~$0.03–0.05 per page processed, ~$0.0045/chat message; fixed hosting ~$45–75/mo (Vercel Pro + Supabase Pro + extras). Identified Step 2's full-PDF-per-chunk re-send as the dominant cost driver and ranked fixes (prompt-cache the `document` block first). Includes volume tables (100/1k/10k docs) and margin framing vs a $19 plan | `docs/COST-ANALYSIS.md` |
| 2026-06-18 | **Step 2 PDF prompt-caching shipped** (cost rec #1). Added `cache_control: {type:'ephemeral'}` to the Step 2 `document` block in `runStep2FieldLabeling()`, **gated on `chunks > 1`** (a single-chunk doc would pay the write premium with no read). Cache hits surface in the existing `usage` log. **Validated against the live API**: 10-page contract wrote 22,932 tokens on chunk 1 → read them on chunk 2 = **30.9% cheaper** (rises past 50% at 3+ chunks); the single-chunk case measured **−19.9%**, confirming the gate. `jest` (59) + `next build` green | `pages/api/ocr.js`, `docs/COST-ANALYSIS.md` |
| 2026-06-18 | **A–Z workflow tested live** (headless Chromium + production build against prod Supabase). Public landing/pricing/login render; **login as the seed user now lands on the rebuilt `/en/dashboard`** (fixes the old enterprise bounce) showing 3 real documents; Settings/Billing/Archived render authed; mobile dashboard responsive. Note: headless browser needed `ignoreHTTPSErrors` because the sandbox's TLS-intercepting proxy isn't trusted by Chromium's CA store (REST/curl work fine — not an app issue) | live e2e |
| 2026-06-18 | **A–Z complex-doc test, 3 types** (upload→OCR→fill→export, live). Core flow works: 49-field rental AcroForm → 49/49 humanized labels + export ✓; flattened W-2 (vision) → 47 fields + export ✓; 10-page contract (text-layer) → 40 fields but forced into manual "drag fields" Setup modal. Findings (in `docs/PERSONAL-UI-MAKEOVER.md`): (1) viewer "No Fields" badge mislabels vision/hybrid methods despite fields existing; (2) personal `mode:'full'` skips technical-name humanization so the W-2 shows `f2_01[0]`; (3) non-AcroForm docs push enterprise-grade manual positioning onto personal users; (4) Setup modal offers only 2 of 9 languages. Test data cleaned up | `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-18 | **Full regression sweep + free-plan gate verified; badge-persist fix.** Ran jest (59/59 after updating a stale `sessions-chat` arg assertion) + build green + a 15-point journey sweep (dashboard en/zh, upload, OCR detection, fill/persist/export, recipient Spanish content). **Free-plan entitlement gate verified end-to-end:** 1st language included, 2nd → 402 upcharge, repeat → already, org plan restored. Fixed a cosmetic issue found in the sweep: the extraction-method badge wasn't re-shown on reload (the method isn't a column) — now persisted in `phase1_data.extractionMethod` and hydrated on load (verified "Native Form" survives reload) | `pages/api/ocr.js`, `pages/[locale]/documents/[id].js`, `tests/api/sessions-chat.test.js` |
| 2026-06-18 | **Metered translation — personal + enterprise UI shipped (feature complete, verified).** Personal: dashboard upload defaults to English-only; document page shows a "Read this form in another language?" prompt that calls the gated endpoint and switches the viewer (verified en→es full switch). Enterprise: `send-links` translates the doc into the recipient's language (gated) BEFORE creating the link, so the recipient sees translated field content — verified send-in-Spanish → recipient `/es/fill/[token]` shows Spanish chrome + field labels/explanations, which also **closes the earlier "recipient sees English field content" gap**. 402 gate shows an upgrade message; real charge pending Stripe. New i18n: `dashboard.languageEnglishOnly`, `viewer.translatePrompt*` | `pages/[locale]/dashboard.js`, `pages/[locale]/documents/[id].js`, `pages/enterprise/send-links.js`, `locales/*` |
| 2026-06-18 | **Metered language translation — core mechanic shipped (verified).** Product model: English is free/auto at OCR; each *additional* language is a billable unit (per-document; plan sets the included count — free 1 / pro 2 / team 3). Added `lib/languageEntitlement.js` (pure gate: english/already/included/upcharge) and `POST /api/documents/[id]/translate` — owner-authenticated, entitlement-gated, isolated from the OCR pipeline (serves personal + enterprise docs without the post_setup gate; recipients never trigger paid work). It translates existing fields into one language (Haiku, chunked, input-order merge) and caches into the `_<code>` columns. Verified live: es + zh write correct aligned columns; repeat = `already`; gate unit-tested. Fixed a CJK JSON-break (model emitted unescaped inner `"` → instruct single-quotes + lenient object-recovery parser). Billing not wired (Stripe parked) — gate returns 402 `language_upcharge`. UI wiring (personal upload/open prompts, enterprise send gate) is the next layer | `lib/languageEntitlement.js`, `pages/api/documents/[id]/translate.js` |
| 2026-06-18 | **Embed `/embed/[token]` localized in all 9 languages (verified).** Same bug as the fill page — `EMBED_COPY` only had en/vi/es, so the embeddable signing page fell back to English for 6 languages. Added pt/fr/zh/yue/ht/ne; verified embed verify gate (zh) and embed fill (fr) render localized with no English leak. **Open finding (HIGH, not fixed):** recipient field *content* (labels/explanations) is only generated in the doc's OCR-time language, so a recipient assigned a different language sees localized chrome but English field text; `/sessions/[token]/language` switches the session language but doesn't re-translate fields. Needs on-demand per-session field translation (cost decision) | `pages/embed/[token].js`, `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-18 | **Recipient `/fill/[token]` flow tested + localized; locales single-sourced.** Single-source: `scripts/sync-locales.js` syncs `locales/`→`public/locales/` on predev/prebuild (prevents viewer-bundle drift). Recipient flow verified end-to-end (session create 201 → fill → submit → "Document Submitted"; verify gate: wrong creds fail, correct pass). **Bug fixed:** the fill/verify page's inline `UI_COPY` only had en/vi/es, so 6 languages (pt/fr/zh/yue/ht/ne) fell back to English for the entire recipient signing experience (~95 strings) — added all 6, verified zh/fr/ne localize with no English leak. Commits e728498 + this | `scripts/sync-locales.js`, `package.json`, `pages/[locale]/fill/[token].js` |
| 2026-06-18 | **Functional-testing round: 3 bugs fixed + core flow verified.** (1) **Chat replied in Vietnamese for all users** — `CO_SYSTEM_PROMPT` hardcoded Vietnamese, `/api/chat` didn't parse/forward `language`; now language-aware (verified en→English, zh→Chinese). (2) **`public/locales/` drifted stale vs `locales/`** (viewer fetches public at runtime → stale consent copy "Ask Co for Help", missing landing keys) → resynced 9 locales. (3) **Hardcoded Vietnamese line in consent modal** → removed. (4) PdfViewer legacy gray/blue palette → slateish/brand. Verified end-to-end: fill → "1 of N completed"/"Done" → persists across reload → Export downloads filled PDF; JPG photo → vision; Nepali (Devanagari) labels aligned; chat consent→reply; dashboard search. Commits 4d7ec2b/dc2cf06 | `lib/anthropic.js`, `pages/api/chat.js`, `pages/api/sessions/[token]/chat.js`, `pages/[locale]/documents/[id].js`, `public/locales/*`, `components/PdfViewer.js` |
| 2026-06-18 | **Setup-modal i18n complete + dense-image tiling (verified).** Localized the whole Phase1 setup modal (field-type dropdown → `setup.fieldTypes.*`, role-question step, "What we'll do", Field-name/Search placeholders, Add/Cancel) — full scan shows no remaining hardcoded English. Added **vision tiling fallback**: when a full-page pass finds 0 fields (dense page times out), slice into horizontal stripes (`OCR_VISION_TILE_ROWS`=4, 8% overlap), vision each, remap Y, dedupe. `parseJsonArray` now salvages complete objects from malformed/truncated arrays. Verified: a 47-field W-2 **photo** (zh) recovered **39 fields** (was "No Fields Detected") with correct Chinese labels → setup modal. Commits 1d38fac/08f7b87 | `pages/api/ocr.js`, `components/Phase1SetupModal.js`, `locales/*`, `public/locales/*` |
| 2026-06-18 | **Round-2 i18n + image-upload fixes (verified).** Continued testing fixed: viewer extraction badge + sidebar count + "Analyzing/No Fields" empty states + login toast + setup-modal "What we'll do" now localized (added `viewer.extractionMethod.vision/ready`, `viewer.remaining`). Verified Spanish W-2 alignment (fix generalizes beyond zh). **Image/photo uploads now detect fields** — the dashboard accepts `image/*` but all detection paths were PDF-gated (a form photo gave "No Fields Detected"); vision detection now runs on image uploads via sharp→PNG. Verified a 10-field intake-form photo (zh) → 10 aligned Chinese labels → setup modal. Known limit: a 47-field W-2 *image* can exceed the vision cap (raised 90s→120s); PDF path handles dense forms natively. Commits d7ed144/a0b1d29/d6cc98b | `pages/api/ocr.js`, `pages/[locale]/documents/[id].js`, `components/Phase1SetupModal.js`, `pages/[locale]/login.js`, `locales/*`, `public/locales/*` |
| 2026-06-18 | **Chinese label/translation fixes shipped + verified.** Fixed the zh-test issues: (1) Step 3a/3b now merge by **input order** not the model's echoed `position_index` (the model preserves order but renumbers on dense forms → mis-merge) + re-run Step 3a/3b after the vision backfill humanizes names → W-2 Chinese labels/explanations now align perfectly with fields; (2) Step 3a/3b are per-chunk resilient (one chunk timeout no longer wipes all translations) → descriptive AcroForm now shows aligned Chinese; (3) dashboard UI localized (nav, Archived, status badges, date-fns timestamps) across 9 locales. Re-tested live with new docs (descriptive AcroForm, technical W-2, non-acro contract) — all aligned. Remaining low/cosmetic: viewer extraction badge + sidebar count + login toast still English. Commits ebac8c0/a1ec687/96ad0e2 | `pages/api/ocr.js`, `components/layout/AppLayout.js`, `components/dashboard/DocumentCard.js`, `pages/[locale]/dashboard.js`, `locales/*`, `public/locales/*` |
| 2026-06-18 | **Chinese (zh) A–Z test.** Logged in at `/zh`, uploaded with Chinese target (AcroForm + W-2). CJK renders cleanly (Noto Sans SC) and chrome localizes well, but found: (1) **W-2 Chinese field labels misaligned** — vision-backfill English labels are correct/in-order but Step 3b zh labels are shuffled ("税务年度/tax year" on the SSN field); root cause = Step 3a/3b mis-index on dense technical forms (chunked), made visible by the fix-#2 English backfill; (2) AcroForm zh labels not populated (shows English); (3) UI leaks: AppLayout nav, dashboard "Archived" button, DocumentCard status badges, relative timestamps, toasts stay English. Recommended fix: humanize labels first, then explain+translate from them (single source of truth). Details in `docs/PERSONAL-UI-MAKEOVER.md`. Test data cleaned up | `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-18 | **Fixed findings #1 + #2 (verified live).** (1) Viewer extraction badge now maps the method values `/api/ocr` actually emits (hybrid/native-no-rect/text-layer-hybrid/vision/vision-ocr-anchor/post-setup/none) instead of three it never emits — no more false "No Fields". (2) Enabled the vision label-backfill in `full` (personal) mode, not just `pre_setup`, so technical AcroForm/XFA names get humanized for personal users. Re-tested: AcroForm + W-2 badges read "Form fields"; W-2 labels now read "Employee's social security number" etc. (46/47). Known follow-up: in `full` mode explanations (Step 3a) run before the backfill, so an explanation can describe the pre-humanized name. Findings #3 (manual-positioning gate) deferred as an architecture/product call; #4 was a non-bug (modal toggle is your-language↔English by design) | `pages/[locale]/documents/[id].js`, `pages/api/ocr.js`, `docs/PERSONAL-UI-MAKEOVER.md` |
| 2026-06-19 | **Personal nav fixes.** Two dead/wrong links in the public header (`components/layout/Navigation.js`, used by the landing + beta pages): (1) the **"Login"** button (desktop + mobile) pointed at `/enterprise/login` — now routes to the personal `/${locale}/login` (which redirects to `/${locale}/dashboard` on success); (2) the **"Features"** link pointed at `/${locale}#concept`, but no element has that id — the landing's feature section is `id="features"`, so it scrolled nowhere. Both desktop and mobile menu entries corrected | `components/layout/Navigation.js` |
| 2026-06-19 | **Link/nav audit (static + live crawl) — no further live bugs.** Wrote a static link auditor (harvests every `href`/`router.push`, resolves template literals, checks anchor ids + route existence + personal→enterprise mislinks) and a Playwright crawl. Personal surface: 18/18 (all public + authed pages load 200, none wrongly bounce to `/enterprise`, every in-page anchor resolves, nav Login → personal `/login`, Features → real `#features`, seed login → `/dashboard`, no JS errors). Enterprise landing: 7/7 (all `#demo/#features/#security/#pricing` anchors resolve, Login → `/enterprise/login`). **Deleted dead `components/layout/Footer.js`** — imported nowhere (live footer is inline in `index.js`) and carried stale broken links (`#pricing`, `/about`, `/contact` — none exist); removing it follows the earlier dead-code cleanup | `components/layout/Footer.js` (deleted), audit scripts |
| 2026-06-19 | **Pricing/onboarding language copy fixed (stale 2-language text).** The pricing page hard-coded the Free tier as "English + Vietnamese + Spanish" and enterprise onboarding said fields translate "into Vietnamese and Spanish" — both predated the 9-language expansion + metered model. Updated to reflect reality: **interface in all 9 languages (free)**; per-document *field-content* translation follows the entitlement (`lib/languageEntitlement.js`): Free = English + 1, Pro = English + 2, Team = English + 3 (per doc). Decision confirmed with owner: keep Free at English + 1 | `pages/[locale]/pricing.js`, `components/enterprise/OnboardingGuide.js`, PRD §1 |
| 2026-06-19 | **Personal pricing restructured — volume-only (owner decision).** Personal demand is episodic and consumers are rarely multilingual, so personal plans differentiate on **document count only**, not language. New tiers: **Free** (1 document, to try) · **Basic** ($9 *one-time*, 3 documents — a credit pack, no subscription, fits one-off needs) · **Unlimited** ($19/mo, fair-use cap). Every personal plan = "works in your language" (English + the user's 1 language), no per-doc language metering. The metered multi-language ladder (1/2/3 per doc) is now **enterprise-only**, where one doc serves many recipients — surfaced via an "See Enterprise" panel on the pricing page. `lib/languageEntitlement.js` encodes the split (free/basic/unlimited→1; pro→2; team/enterprise→3). Billing/enforcement still parked (Stripe) — copy + entitlement only | `pages/[locale]/pricing.js`, `lib/languageEntitlement.js`, PRD |
| 2026-06-19 | **Chat cost guard: bound history resend.** `chatWithCo` resent the *entire* transcript every turn (on top of the doc context it already resends), so input tokens grew linearly with conversation length. Now trims to the last `CHAT_MAX_HISTORY_TURNS` (default 16) turns — bounds per-message cost regardless of conversation length, invisible to users (recent context is what matters for form help). Rate limiting (velocity) + `max_tokens:1024` (output) were already in place. A per-session hard message cap remains an optional follow-up (needs a frontend "limit reached" UX) | `lib/anthropic.js`, PRD §4 |
| 2026-06-19 | **Security/compliance claims audited + made honest; append-only audit log; SSO scaffolding.** The enterprise "Security & Compliance" section advertised SOC 2 Type II, HIPAA BAA, GDPR residency, SSO/SAML, MFA, and on-premise — none implemented; only AES-256/TLS, RBAC/RLS, and (partial) audit logging were real. Researched the path to each (Supabase HIPAA BAA on Team+add-on & SOC 2 Type II; Vercel BAA self-serve on Pro; **Anthropic BAA requires 30-day retention, incompatible with ZDR** — the linchpin since doc content flows to Claude; Supabase native SAML SSO on Pro+; Vanta/Drata SOC 2 ~$30–65k + 3–12mo). Actions: (1) reworded the section to truthful-today + "Roadmap" labels, removed MFA/on-premise/false badges; (2) made `audit_log` genuinely append-only (trigger blocks UPDATE/DELETE for all roles incl. service; dropped FK cascades that mutated rows — migration `20260619140000`, **not yet applied to prod**); (3) scaffolded Supabase `signInWithSSO` on enterprise login behind `NEXT_PUBLIC_SSO_ENABLED`. Full plan in `docs/COMPLIANCE-ROADMAP.md` | `pages/enterprise/index.js`, `pages/enterprise/login.js`, `supabase/migrations/20260619140000_audit_log_append_only.sql`, `docs/COMPLIANCE-ROADMAP.md` |
| 2026-06-19 | **Append-only migration applied to prod + integrations kept as "on request".** Applied `audit_log_append_only` to the co-sign DB on the live Supabase project: FK cascades dropped (0 remain), append-only trigger active, 350 existing rows preserved; verified a live DELETE is rejected (`audit_log is append-only; DELETE is not permitted`). Kept the Integrations & API section (SSO/REST API/Webhooks/Analytics Export) but reframed it as **"available on request for Enterprise"** with a "Talk to our team about access" CTA → `#demo`, so nothing reads as self-serve | `pages/enterprise/index.js`, prod migration |
| 2026-06-19 | **Full security audit + hardening pass.** Two-agent + manual audit of auth, IDOR, recipient token flow, validation, file upload, secrets, injection, headers, deps. App posture is solid (256-bit tokens, CSRF double-submit, org-scoped authz w/ no IDOR found, real SSRF guard in `documentFetch.js`, strong headers, append-only audit log). **Fixed:** (H1) stopped storing plaintext session tokens — `create.js` writes only `token_hash`, strict-hash now the default in `sessionAuth.js`, migration `20260619160000` drops NOT NULL + nulls existing plaintext (**applied to prod**, 0 remain, recipient validation unaffected); (H2) `npm audit fix` → axios 1.18.0, all 6 HIGH advisories cleared; (M1) cron retention authenticates (constant-time) before rate-limiting; (M2) `/api/beta` validates locale/source; (M3) verify endpoint drops `maskedEmail` from failure responses + constant-time email/name compare. **Deferred (documented):** CSP `unsafe-inline/eval` → nonce; `next-intl`/postcss moderate (needs major bump); embed vs global frame-ancestors. Full report in `docs/SECURITY-AUDIT.md`. `jest` 60/60 | `pages/api/sessions/create.js`, `lib/sessionAuth.js`, `pages/api/cron/retention.js`, `pages/api/beta.js`, `pages/api/sessions/[token]/verify.js`, `supabase/migrations/20260619160000_*`, `docs/SECURITY-AUDIT.md` |
| 2026-06-19 | **Embed framing fixed (security audit L4).** Global `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` blocked the `/embed/[token]` widget from being iframed at all. Moved page framing policy into `middleware.js` (next.config headers can't be overridden per-request, and `getServerSideProps` can't either — both confirmed). `/embed/[token]` now gets a **per-session** `frame-ancestors 'self' <embed_origin>` — the token is SHA-256'd (Edge Web Crypto, matching `hashToken`) and looked up in `fill_sessions`; **fail-closed to `'none'`** on miss/error. Every other page keeps `X-Frame-Options: DENY` + `frame-ancestors 'none'`. CSP extracted to `lib/csp.js` (shared by next.config + middleware). Verified at runtime on a prod build: origin-pinned embed framable only by its origin, unknown token denied, normal pages denied. `next build` + `jest` 60/60 green | `middleware.js`, `next.config.js`, `lib/csp.js`, `pages/embed/[token].js`, `docs/SECURITY-AUDIT.md` |
| 2026-06-20 | **CSP script-src hardened (audit M4, partial).** Dropped `'unsafe-eval'` → `'wasm-unsafe-eval'` in `lib/csp.js`: still allows the WebAssembly react-pdf/pdfjs compiles client-side, but blocks arbitrary JS `eval()`/`new Function()` (a classic XSS-escalation vector). Verified on a prod build that the PDF viewer still renders (1 canvas, react-pdf Document+Page, **0 CSP/eval/wasm console violations**) by loading an authed document page. `'unsafe-inline'` kept by necessity — Next.js **Pages Router** has no clean nonce path for framework scripts, and `style-src` needs it for **styled-jsx** (13 files). Full nonce migration deferred: low value (no XSS sinks exist) + high risk (hydration/PDF). `jest` 60/60 | `lib/csp.js`, `docs/SECURITY-AUDIT.md` |
| 2026-06-20 | **Dependency vulns cleared — `npm audit --omit=dev` = 0 (audit D1).** Upgraded **`next-intl` 3 → 4.13** and forced **`postcss` ≥ 8.5.15** via `overrides` (Next bundled a vulnerable 8.4.31). The two next-intl advisories (open redirect, prototype pollution) were already unreachable here — the app uses its own `middleware.js` (not `createMiddleware`/navigation) and no `experimental.messages.precompile` — but the v4 bump removes them entirely. The app's minimal next-intl surface (`useTranslations` + `NextIntlClientProvider` only) meant v4's breaking changes (server/middleware APIs) didn't apply. **Verified:** all 9 locales render with 0 i18n errors, `/zh/pricing` (uses `t()`) renders, CSS bundle intact, `next build` + `jest` 60/60 green. 27 dev-only tooling vulns remain (`@remotion/*`, jest, eslint) — never ship to prod, out of scope | `package.json` (next-intl 4, postcss override), `package-lock.json`, `docs/SECURITY-AUDIT.md` |
| 2026-06-20 | **Stripe billing scaffolded (inert-until-keyed).** Built the full integration, gated on env so nothing breaks until configured: `lib/stripe.js` (plan catalog + pure helpers), `POST /api/billing/checkout` (bearer-auth Checkout Session), `POST /api/billing/webhook` (signature-verified; updates plan/credits on `checkout.session.completed` + `customer.subscription.updated/deleted`), `POST /api/billing/portal` (manage subscription). Personal plans + one-time-pack credits live in a new **`user_billing`** table (migration `20260620120000`, **applied to prod**, RLS read-own); org plans reuse the existing `organizations.stripe_*` columns. Wired the pricing CTAs → checkout and the billing page → portal (+ personal plan/credits display). **Verified:** without keys every endpoint fails safe (webhook/checkout/portal → 503 `billing_not_configured`, no-auth → 401); `jest` 66/66 (6 new Stripe tests), `next build` green. Activation steps + the still-to-wire bits (doc-limit enforcement, language-upcharge→checkout, credit consumption) documented in `docs/BILLING.md` | `lib/stripe.js`, `pages/api/billing/*`, `pages/[locale]/{pricing,billing}.js`, `supabase/migrations/20260620120000_user_billing.sql`, `tests/lib/stripe.test.js`, `docs/BILLING.md` |
| 2026-06-20 | **Document-limit enforcement + credit consumption + billing consolidated onto the org.** Discovered every user (personal included) has a bootstrapped org and the entitlement layer already reads `organizations.subscription_plan` — so the Stripe scaffold's per-user `user_billing` table was the wrong model. **Consolidated billing onto the org**: dropped `user_billing`, added `organizations.doc_credits`, extended the `subscription_plan` check to allow `basic`/`unlimited`; rewired checkout/webhook/billing-page to read/write the buyer's org (via `requireOrgMembership`). **Enforcement (#1) + credit consumption (#2):** a `BEFORE INSERT` trigger on `documents` (`enforce_document_limit`, migration `20260620140000`, **applied to prod**) caps the personal tiers and decrements Basic credits atomically — bypass-proof since uploads insert client-side. **Gated OFF** via `app_config.doc_limits_enabled='false'` (flip to `true` after billing is live) so no existing user is blocked. Free cap = total org docs `< free_doc_limit`(1) (deleting frees a slot, archiving doesn't); `unlimited`/`pro`/`team`/`enterprise` exempt. Client cleans up the orphaned upload on `doc_limit_reached` and routes to `/pricing` (new localized `dashboard.limitReached` in all 9 locales). **Verified every branch live against the DB** (free 1-then-blocked, basic consumes 2 credits then blocks, unlimited/team allowed) with all test data rolled back; gate confirmed off. `jest` 66/66, build green | `supabase/migrations/20260620140000_*`, `pages/api/billing/{checkout,webhook}.js`, `pages/[locale]/{billing,dashboard}.js`, `hooks/useDocuments.js`, `locales/*`, `docs/BILLING.md` |
| 2026-06-20 | **Recipient-verification policy toggle (audit L1).** A `sendMethod:'link'` session with no recipient email skipped the identity-verification gate — anyone with the URL could fill/sign. Added an **opt-in org toggle** `organizations.require_recipient_verification` (migration `20260620160000`, applied; default **off** to preserve quick-link sharing). When on, `/api/sessions/create` rejects any session missing a recipient email + last name (`400 recipient_verification_required`), which forces the verify gate. Admin-gated `GET/POST /api/enterprise/org-settings` + a "Require recipient verification" card on the enterprise admin dashboard control it. **Verified live:** toggle on → no-email link rejected (before any insert, no test data); off → allowed; setting persists. `jest` 66/66 (added the `organizations` query to the sessions-create mock), build green | `pages/api/sessions/create.js`, `pages/api/enterprise/org-settings.js`, `pages/enterprise/admin.js`, `supabase/migrations/20260620160000_require_recipient_verification.sql`, `docs/SECURITY-AUDIT.md` |
| 2026-06-21 | **OCR timeout/stuck-doc fixes.** Diagnosed live: dense PDFs (e.g. HUD-1) exceeded the `/api/ocr` 60s `maxDuration`, so Vercel killed the function mid-run and the doc was stuck in `processing`/`prepping` forever; only simple docs finished. **(1)** Raised `maxDuration` 60 → **300** (Vercel Pro ceiling; needs Pro to take effect). **(2)** Detail page now surfaces a recoverable **"Analysis didn't finish — Retry"** state on OCR failure/timeout instead of an endless spinner (`ocrFailed` + `retryOcr`; new localized `viewer.analysisIncompleteTitle/Description` + `viewer.retryAnalysis` in all 9 locales). **(3)** Batch uploads now **auto-process every doc** — the dashboard fires `/api/ocr` for the extras in the background (fire-and-forget, survives navigation) and opens the first, rather than leaving the rest unprocessed until opened. Long-term proper fix (background/queued OCR off the request path) noted as a follow-up. `jest` 66/66, build green | `pages/api/ocr.js`, `pages/[locale]/documents/[id].js`, `pages/[locale]/dashboard.js`, `locales/*` |
| 2026-06-22 | **Resumable background OCR (dense docs no longer get stuck).** A dense text-layer doc (e.g. a flattened HUD-1, `has_rect=false`, ~hundreds of fields) couldn't finish detection+enrichment within one Vercel invocation, so it died mid-run and stuck in `prepping`. The OCR handler now runs under a **soft wall-clock budget** (`OCR_SOFT_BUDGET_MS`, default 180s < the 300s ceiling): when exceeded it **parks progress into `phase1_data.ocr`** (no migration — jsonb) and returns 202 instead of being killed. A new Vercel cron route (`CRON_SECRET`-authed via `lib/cronAuth`; removed 2026-11-17, see below) adopts any job idle past a stale window and re-invokes `/api/ocr` (cron-auth bypass resolves the org from the doc) to **resume from the checkpoint**. Resumable across all three text-layer phases — detect (per page-batch), Step 3a/3b enrich (chunked at the call site; `runStep3a/3b` re-stamp `position_index` so the merge stays aligned), and label backfill (recomputes remaining pages). A `lease` guards against two workers double-driving (which would double-bill Claude); an `attempts` cap (`OCR_MAX_ATTEMPTS`, default 8) stops runaway. **Happy-path-neutral:** normal docs finish in the first call, never cross the budget, and write **no** `ocr` state, so the cron never selects them. Enabled by default (`OCR_RESUMABLE_ENABLED`, set `false` to disable). New `lib/ocrResume.js` + `lib/cronAuth.js` with unit tests. **Requires Vercel Pro** (frequent cron + 300s `maxDuration`). `jest` 98/98, build green | `pages/api/ocr.js`, the OCR cron route (removed), `lib/ocrResume.js`, `lib/cronAuth.js`, `vercel.json`, `tests/lib/{ocrResume,cronAuth}.test.js` |
| 2026-06-22 | **Resumable-OCR hardening (live test on the stuck HUD-1 surfaced three bugs).** A real end-to-end run on Vercel Pro exposed gaps the unit tests couldn't: **(1)** the cron's self-call resolved `base` to the deployment-protected `*.vercel.app` host and 401'd — fixed by setting `NEXT_PUBLIC_APP_URL` (config) **and** making the cron prefer `VERCEL_PROJECT_PRODUCTION_URL` over the request host (code), so it targets the public production domain. **(2)** A 313 KB HUD-1 whose AcroForm/text layer is pathologically slow to parse spent ~213s in **prep** (extraction/context) — *before* any budget-guarded loop — so `/api/ocr` hit the 300s hard limit (`504`) and was killed **without ever checkpointing**, and the cron, which **awaited** the call, 504'd too. Now: prep outputs (`textItems`/`nativeFields`/`documentContext`) are **persisted once** and a **post-prep budget checkpoint** parks the job so the resume **skips the slow extraction**; the cron is **fire-and-forget** (short grace, no longer blocks → can't time out). **(3)** The attempts cap only incremented on a checkpoint, so a run that 504s before checkpointing looped forever, burning model calls. Added a **cron-owned `dispatches` counter** (`dispatchesExceeded`, default 8) that bounds retries even when the worker never checkpoints, marking the doc `error` instead of looping. Lesson reinforced: resumability must guard *every* phase incl. prep, and the orchestrator must never block on the worker. `jest` 99/99, build green | `pages/api/ocr.js`, the OCR cron route (removed), `lib/ocrResume.js`, `tests/lib/ocrResume.test.js` |
| 2026-06-22 | **Unify OCR enrichment so the hybrid (AcroForm) path is budget-guarded too.** The re-test of the HUD-1 reached `processing_step:3` ("Adding explanations") then 504'd — i.e. prep AND detection completed fine; it died in **enrichment**. Root cause: that doc takes the **hybrid path** (`extract-form-fields` returns `hasRect=true`; the edge functions are sub-second, ~300–400ms — extraction was never the bottleneck), and the hybrid path ran **Step 3a/3b inline on all fields at once** (`runStep3aExplanations` → ~one Claude call per 10 fields ≈ 38 calls for ~375 fields) with **no budget checkpoint** — only the text-layer path's enrichment (5c) was guarded. Fix: removed the hybrid path's inline Step 3a/3b; it now just merges Step 2 labels and routes through the **single 5c enrichment block**, whose gate widened to `text-layer-hybrid || hybrid`. 5c is already chunked + budget-checkpointed + resume-aware, so dense hybrid forms now park mid-enrichment and resume instead of 504ing. Behaviourally equivalent for hybrid docs that already finished in time (same `runStep3a/3b`). `jest` 99/99, build green. Residual: Step 2 labeling and the vision path are still uninstrumented (bounded by the cron dispatch cap); a follow-up if they ever dominate | `pages/api/ocr.js` |
| 2026-06-22 | **Field list now in document reading order (checkboxes no longer dumped last).** On the HUD-1, the AcroForm extractor returns 363 text fields first then appends 12 checkbox/annotation widgets, so `sort_order` (= extraction order) put every checkbox at the bottom of the list — even the "Loan Type" boxes at the top of page 1. Now the final field list is sorted by **reading order (page → y → x)** before `sort_order` is assigned (fields without a position sort last, stably). Contained change at the persist step; doesn't affect positions or enrichment. **Known, not fixed here:** checkbox *labels* (incl. Yes/No) are AI-assigned by Step 2 vision and can be mis-associated on dense stacked checkbox groups (e.g. a box labeled "No" sitting on the "Yes" widget) — positions are reliable AcroForm rects, but the option labels are a model-accuracy limitation; the deterministic fix is to preserve AcroForm radio-group export values in the `extract-form-fields` edge function (follow-up) | `pages/api/ocr.js` |
| 2026-06-22 | **Viewer: live field box + sidebar↔box color matching.** When filling a doc, expanding a field in the sidebar now (a) **jumps the PDF to that field's page** and draws a **color-matched box** at its position showing the **live value** as you type (empty fields show a faint hint so you can see where they are), and (b) each sidebar field card carries a **colored accent/dot** that matches its box, so you can tell which sidebar entry maps to which spot on the page. Color is assigned by field index via `lib/fieldColors.js` (shared so sidebar + viewer agree). Additive props on `PdfViewer` (`highlightFieldIds`, `focusField`); other callers unaffected. `jest` 120/120, build green | `components/PdfViewer.js`, `pages/[locale]/documents/[id].js`, `lib/fieldColors.js`, `tests/lib/fieldColors.test.js` |
| 2026-06-22 | **Make both Yes AND No checkboxes selectable (radio option re-typing).** Follow-up: the loan-terms "No" boxes were coming through as `text` fields (one side of each Yes/No radio pair is mis-typed by the AcroForm extractor), so only "Yes" was tickable. Now any field whose position matches a real pdf-lib checkbox/radio widget is **re-typed to `checkbox`**, and radio options are **paired under one question base** (longest stripped name in the group) and labeled from the export value — so each question shows a selectable "… - No" and "… - Yes". Standalone checkboxes are re-typed but not relabeled (generic on-value). Persists `phase1_data.ocrCheckboxDebug` (widget structure) for inspection. New `displayOption`/`stripOptionToken` helpers + tests. `jest` 116/116, build green | `pages/api/ocr.js`, `lib/checkboxWidgets.js`, `tests/lib/checkboxWidgets.test.js` |
| 2026-06-22 | **Deterministic checkbox/radio option labeling (fixes "clicking No checks Yes").** Step 2 vision guessed which stacked checkbox was Yes vs No and got it wrong — the box *labeled* "No" sat on the "Yes" widget. The `extract-form-fields` edge function captures checkbox positions but discards each widget's **export value** (`/AP /N` "on"-state). Added `extractCheckboxWidgetExports(fileBuffer)` in ocr.js (pdf-lib `widget.getOnValue()` — authoritative, **no edge-function change** → lower blast radius) + pure `lib/checkboxWidgets.js`. At persist time each checkbox field is matched to its widget by position and its Yes/No token is **conservatively corrected** to the PDF's export value — only for **radio-group kids** (a standalone checkbox's on-value is a generic "Yes", never touched) with a clear Yes/No that *contradicts* the AI name. Logs raw export values for diagnosis. `tests/lib/checkboxWidgets.test.js` (11 cases). `jest` 110/110, build green | `pages/api/ocr.js`, `lib/checkboxWidgets.js`, `tests/lib/checkboxWidgets.test.js` |
| 2026-06-22 | **Parallelize OCR Claude calls (Step 2 labeling + Step 3a/3b enrichment).** Live timing on the 375-field HUD-1 showed ~9 min of compute spread over 3 slices was dominated by **sequential** Claude calls — Step 2 ran ~10 PDF-bearing chunks back-to-back and Step 3a ran ~38 chunks one at a time. Added a `mapWithConcurrency(items, limit, fn)` helper and ran all three loops with bounded concurrency (`OCR_STEP3_CONCURRENCY` default 6, `OCR_STEP2_CONCURRENCY` default 5). Step 2 keeps the PDF prompt-cache warm by running the **first chunk alone** (cache write) then the rest concurrently (cache reads). 5c enrichment slice size raised 10→120 so each resumable slice parallelizes ~12 chunks. All loops preserve per-chunk `position_index` re-stamping, so merge alignment is unchanged. Goal: a dense form finishes in **one ~2–3 min invocation** instead of 3 cron-spaced slices (~24 min wall-clock). `jest` 99/99, build green | `pages/api/ocr.js` |
| 2026-06-22 | **OCR text-layer positioning fix (two-column collision).** On non-AcroForm (text-layer) docs the matcher used `textItems.find()` — the first text item containing a label — with no consumption, so on **two-column forms** (e.g. a "Listing" left column and "Selling" right column that print the **same** label text like `Phone:` on one row) every same-labeled field collapsed onto the **same** coordinate (a completed 67-field PropertySale sheet rendered ~22 fields stacked on ~45 distinct positions). Extracted the matching logic into `lib/textLayerPositioning.js` (`positionValueInBlank` + new `matchFieldsToTextItems`) and made it **consume each text item once** via a `usedItems` set: candidates are scored `dy*100 + x`, so the nearest row wins and the small x term then routes column 1 vs column 2 in reading order; a same-labeled second field is forced onto a different occurrence. Fallbacks (nearest unused underscore run → AI coord) also respect consumption. New `tests/lib/textLayerPositioning.test.js` (8 cases incl. the two-column no-collision assertion + single-column no-regression). `jest` 74/74, build green | `pages/api/ocr.js`, `lib/textLayerPositioning.js`, `tests/lib/textLayerPositioning.test.js` |
| 2026-11-17 | **OCR cron removed.** Parked OCR jobs are resumed by the in-app OCR worker (§8.6), started at boot by `instrumentation.js`; the Vercel OCR cron entry and its route are gone. The daily retention cron stays. `CRON_SECRET` is kept for manual calls to `/api/ocr` | `vercel.json`, `instrumentation.js`, `lib/ocrResume.js`, `pages/api/ocr.js`, `tests/lib/ocrCronRemoved.test.js` |

---

## 8. Operations & production requirements

- **§8.1 Retention cron.** `/api/cron/retention` enforces each org's
  `retention_days` (deletes expired documents/sessions/PDFs). Scheduled daily
  at 03:00 UTC via `vercel.json`. Accepts Vercel Cron's
  `Authorization: Bearer <CRON_SECRET>` or a manual `x-cron-secret` /
  `RETENTION_CRON_SECRET`. Set `CRON_SECRET` (or `RETENTION_CRON_SECRET`) in
  production or the job 503s.
- **§8.2 Rate limiting.** Public recipient endpoints (verify/fill/sign/chat)
  and auth endpoints are rate-limited. Upstash Redis (distributed) is used
  when `UPSTASH_REDIS_REST_URL`/`TOKEN` are set; otherwise an in-memory
  per-instance fallback applies (`lib/rateLimit.js`). Configure Upstash in
  production for correctness across serverless instances.
- **§8.3 Error monitoring.** Sentry is wired (`sentry.*.config.js`,
  `instrumentation.js`) and inert unless `SENTRY_DSN` (server) /
  `NEXT_PUBLIC_SENTRY_DSN` (client) are set. The build plugin only engages
  when a DSN is present, so CI/dev are unaffected.
- **§8.4 Storage privacy.** Both storage buckets are **private**. Originals
  (`documents`) can contain client PII, so the bucket is private (migration
  `20260616120000`) and every read mints a short-lived signed URL — the app
  never uses `getPublicUrl`. `filled-documents` (signed PDFs) is private and
  read only via `/api/sessions/signed-pdf` after org-member auth.
- **§8.5 Go-live.** `docs/GO-LIVE-CHECKLIST.md` enumerates the remaining
  pre-launch actions (rotate keys, set prod env vars, Anthropic spend alerts, email
  decision). Keep it current as items are closed.
- **§8.6 OCR resume.** Parked OCR jobs are resumed by the in-app OCR worker:
  `instrumentation.js` starts it at server boot (`lib/ocrWorkerBoot.js`), and
  every `OCR_WORKER_INTERVAL_MS` (default 30 s) it re-invokes `/api/ocr` on
  127.0.0.1 with a per-process token. `OCR_WORKER=off` turns it off. There is
  no OCR cron; `CRON_SECRET` still lets a person call `/api/ocr` by hand.
- **§8.7 Adapters off by default.** `lib/adapters.js` (`adapterStatus(env)`)
  is the one place that says which outside services are on; with an empty
  env all are off, and a blank value counts as not set. `supabaseCloud` is on
  when the Supabase URL is a `*.supabase.co` host (off: local or self-hosted
  Supabase); `sentry` when `SENTRY_DSN` is set (off: server logs only);
  `resend` when `EMAIL_PROVIDER=resend` and `RESEND_API_KEY` are both set
  (off: `lib/email.js` sends no mail and logs one stdout line with the subject
  and the recipient's domain, never the address or body); `upstash` when both
  `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set (off:
  in-memory rate limits, §8.2); `vercel` when `VERCEL` is set (off: a plain
  `next start` host). `/api/health` returns this as `adapters`; its `ok`
  needs only Supabase configured and the database answering, not cron.

## 9. Out of scope (for now)

- ~~Personal/consumer portal UX (login, dashboard, pricing/billing funnel).~~
  **Reversed 2026-06-18:** the personal portal is back in scope. The personal
  dashboard (`/[locale]/dashboard`) is a real page again — upload (drag-drop +
  target-language picker), search, filters, bulk actions, archived — built on
  the shared `<AppLayout>` teal shell. Login routes personal users there.
- Payments: no payments are taken; there are no plans, tiers or usage limits,
  and every feature is free to use (§1)
- Email delivery of signing links (Resend wired but unverified; links are
  copy/paste for now)
