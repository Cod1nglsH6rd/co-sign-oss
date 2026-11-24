# Personal (non-enterprise) UI/UX makeover

Goal: make the personal surface feel modern and cohesive. Scope = `pages/[locale]/*`
(marketing, auth, recipient fill, document setup, settings/billing/archived) and the
shared components they use — **not** `pages/enterprise/*`.

Method: screenshotted the public journey (landing/login/pricing/beta, desktop + mobile)
and code-audited the authenticated pages + shared components.

## Findings (corrected after closer inspection)
- **Palette drift was the headline issue.** Three color systems coexisted — `brand`
  (teal, the intended brand), `primary` (blue), `accent` (fuchsia). Login, the
  archived spinner, and the nav's mobile buttons rendered in **blue**, while landing
  and pricing were **teal** — so the app looked like two products.
- **`ChatWidget`, `PaywallModal`, and `components/DocumentViewer` are dead code**
  (zero imports). Their hardcoded-Vietnamese copy and blue palette never reach users,
  and the $3.99/$7 paywall in `PaywallModal` is **not live**. Recommend deleting them
  in a cleanup pass.
- **The black "N" button** seen in dev screenshots is the **Next.js dev-mode
  indicator**, not an app element — it does not appear in production.
- **Snake game** is real but only on the document-setup page *during OCR* (contextual
  wait-delight, click-to-start) — left as-is.

## P0 — SHIPPED (palette unification)
Collapsed the live personal surface onto the single **teal `brand-*` + `slateish`**
system: `primary-*`→`brand-*`, `gray-*`→`slateish-*` across `login.js`, `billing.js`,
`documents/archived.js`, `pricing.js`, and `components/layout/Navigation.js` (mobile).
Result: login wordmark, the "Sign in" button (now solid high-contrast teal, not a
washed-out blue), focus rings, the archived spinner, and the nav mobile CTA all match
landing/pricing. The fill flow, document setup, and settings already used the brand
system and needed no change. `next build` green.

## Decisions deferred (need product input, not fabricated)
- **Pricing reconciliation** — the marketing page (`$0 / $19 / $49` subscription
  tiers) and the dead `PaywallModal` (`$3.99` one-time / `$7`/mo) disagree. Needs the
  real numbers before aligning.
- **Personal front door** — `/[locale]/dashboard` currently redirects to
  `/enterprise/...` (personal dashboard decommissioned, PRD §9), so a logged-in
  personal user bounces to the enterprise login. Either build a real personal
  dashboard or route personal users somewhere coherent — a product/IA call.

## P1 — landing redesign SHIPPED
Rewrote `pages/[locale]/index.js` with a modern structure, **reusing only existing
i18n keys** (no new translation work): richer hero (pulse badge, larger Fraunces
headline, two CTAs) with a **product-preview card** (window chrome + a guided form
field) and a **9-language showcase strip** (flags + native names from `lib/i18n`);
a real **feature grid** (icons) that replaces the old empty "Concept" section; a
**value-props** band that surfaces the previously-unused `concept.clarity/confidence/
momentum` keys; a more visual **how-it-works** with a connecting line; and a teal
**gradient beta CTA**. Verified desktop + mobile + a Vietnamese render (i18n intact);
`next build` green.

## P1 — shared shell + cleanup + signature SHIPPED
- **Dead-code removed.** Deleted `components/ChatWidget.js`, `components/PaywallModal.js`,
  and `components/DocumentViewer.js` (all zero-import). This removes the stale
  hardcoded-Vietnamese copy, the blue palette, and the non-live `$3.99/$7` paywall from
  the tree entirely.
- **Shared authenticated shell.** Added `components/layout/AppLayout.js` — one teal
  header (wordmark→home, Settings/Billing cross-nav, sign-out), `slateish-50`
  background, and configurable content width. Refactored `settings.js`, `billing.js`,
  and `documents/archived.js` onto it, deleting three hand-rolled headers and fixing the
  broken "Back to dashboard" link in the archived empty state (the personal dashboard is
  decommissioned — now points home). Icon-only nav links carry `aria-label`s for mobile.
- **Signature canvas polish.** `components/SignatureCanvas.js` moved to the
  `slateish/brand` palette and a larger `520×160` pad with a visible "sign here"
  baseline affordance and an `aria-label`.
- `next build` + `next lint` green (no new warnings).

## P1 backlog (remaining)
- Recipient fill flow: responsive stacking on mobile, signature undo, AI typing
  indicator, clearer autosave/"saved" state.
- Consistent loading/empty/skeleton states with locale-correct copy.
- Localize the live chat/copy paths.

## A–Z complex-doc flow test (2026-06-18)
Live test, logged in as a real user against prod Supabase + Anthropic. Uploaded
3 complex types via the dashboard → `/documents/[id]` → OCR → fill → export.

| Doc type | Path | Fields | Labels | Positioning | Export |
|---|---|---|---|---|---|
| 49-field rental AcroForm | hybrid/native | **49/49** | humanized ✓ | auto (rect-backed) | ✓ |
| 10-page shuttle contract | text-layer | 40 | — | **forced manual drag setup** ⚠ | blocked by setup |
| flattened W-2 | vision | 47 | **raw `f2_01[0]`** ⚠ | auto | ✓ |

**The core flow works** (upload → detect → render → fill UI → export PDF) for
AcroForm and vision docs; detection counts are good. Findings/recommendations:

1. **"No Fields" badge is wrong — FIXED 2026-06-18 (commit f341e09).** The
   viewer badge only mapped `native-form`/`text-layer`/`text-layer-disabled`,
   none of which `/api/ocr` emits, so it showed **"No Fields"** on all 3 docs
   despite 47–49 fields. Now maps the real values (hybrid, native-no-rect,
   text-layer-hybrid, vision, vision-ocr-anchor, post-setup, none) and defaults
   unknown methods to "Ready". Verified: AcroForm + W-2 now show "Form fields".
2. **Technical labels leak in personal mode — FIXED 2026-06-18 (commit
   f341e09).** Personal OCR runs `mode:'full'`; the vision label-backfill that
   humanizes technical AcroForm/XFA names was gated to `pre_setup` only, so the
   W-2 showed `f2_01[0]`. Enabled the backfill for `full` too (capped,
   best-effort, only fires on technical/generic names). Verified: the W-2 now
   reads "Employee's social security number", "Employer identification number
   (EIN)", etc. (46/47 humanized).
   - **Follow-up (secondary):** in `full` mode the backfill runs *after* Step 3a
     explanations, so an explanation can describe the pre-humanized name (the
     SSN field's explanation said "your legal first name"). Enterprise avoids
     this via its pre_setup→post_setup split. A safe fix is to re-run Step 3a
     for fields the backfill renamed (in `full` only), or humanize before
     explaining — left as a follow-up to avoid destabilizing the proven
     image-based backfill / shared Step 2.
3. **Non-AcroForm docs force a "drag 40 fields" Setup modal (HIGH friction).**
   Text-layer/vision docs without rect-backed positions push enterprise-grade
   manual positioning onto personal users. Auto-place from detected positions
   (OCR-anchoring already exists behind a flag) and make adjust optional, or let
   the sidebar-fill + export work without pixel-perfect overlay positions.
4. **Setup modal language toggle offers only English/Tiếng Việt (MEDIUM)** —
   app supports 9 locales; use the full set.
5. **Label misses (LOW):** even in the good AcroForm, `ssn` stayed lowercase
   (should be "Social Security Number").
6. **Hardcoded English (LOW):** "No Fields Detected", "Analyzing Document",
   SignatureCanvas "Clear"/"Signature saved", "Field N" prefix — not i18n'd.
7. **No progress granularity (LOW):** processing overlay rotates messages but
   never shows step N/4 though the backend tracks it.

Positives: detection works across all 3 paths; explanations are genuinely
helpful and translated; split-view (PDF + field sidebar) is clean; export works;
dashboard upload→doc routing is smooth; mobile responsive.

## Chinese (zh) localization test (2026-06-18)
Logged in at `/zh/...`, uploaded with Chinese as the target language; AcroForm
+ W-2. CJK renders cleanly (Noto Sans SC, no tofu) and the dashboard/viewer
chrome localizes well ("你的文档", "上传新文档", "表格字段", "导出文档"). But:

1. **W-2: Chinese field labels are MISALIGNED to the fields (HIGH, correctness).**
   The vision-backfill English labels are correct & in W-2 box order (SSN, EIN,
   Employer address, Control number, First name, Last name), but the Step 3b
   **Chinese** labels are shuffled — Field 1 shows "税务年度" (tax year) though it's
   the SSN box; "社会安全号码" (SSN) lands on Field 3. Same root cause as the earlier
   English mismatch ("first name" explanation on the SSN field): **Step 3a/3b
   mis-index on dense technical forms** (chunked by 10 over 47 fields), while the
   position-based vision backfill is reliable. Enabling the English backfill in
   `full` mode (fix #2) made this visible by putting a *correct* English label
   next to the *wrong* Chinese one. Fix: make humanized labels the single source
   of truth — humanize first, then explain+translate from those — so label,
   explanation, and translation all agree (also fixes the secondary follow-up
   under finding #2).
2. **AcroForm: field labels NOT translated to Chinese (HIGH).** Descriptive-named
   AcroForm fields (e.g. `applicant_first_name`) display the English label
   ("Applicant First Name") with no Chinese — the zh label column is empty, so
   coverage of Step 3b is inconsistent vs the W-2.
3. **UI localization leaks (MEDIUM).** With Chinese chrome otherwise correct,
   these stay English: the `AppLayout` nav ("Documents/Settings/Billing"), the
   dashboard **"Archived"** filter (sibling filters 全部/最近/已完成 are translated),
   `DocumentCard` status badges ("Uploaded"/"Processed"), relative timestamps
   ("6 days ago" — `date-fns` needs a locale), toasts ("Welcome back!"), and the
   sidebar "0 of 45 completed / 45 remaining" (header status is Chinese → mixed).

Net for zh: chrome localization + CJK rendering are solid; the real problems are
(a) translated field labels misaligned on technical forms and (b) inconsistent
translation coverage — both in the shared OCR label pipeline, not the personal
UI shell.

### Fixes shipped + verified (2026-06-18, commits ebac8c0 / a1ec687 / 96ad0e2)
Re-tested live with **new** docs (descriptive AcroForm job application,
technical W-2, non-AcroForm contract), all in Chinese:
- **Misalignment (#1) FIXED.** Two root causes addressed: (a) Step 3a/3b now
  merge by **input order** instead of the model's echoed `position_index` (the
  model preserves order but renumbers indices on dense forms, which shuffled the
  merge); (b) after the vision backfill humanizes technical names, Step 3a/3b are
  **re-run** on the humanized names. The W-2 now reads `a 员工社会安全号码 / a
  Employee's social security number`, `b 雇主识别号码（EIN）`, … — every Chinese
  label, English sub-label, and explanation agree.
- **Translation coverage (#2) FIXED.** Step 3a/3b are now per-chunk resilient
  (a single chunk timeout falls back to English for that chunk only instead of
  discarding all results). The descriptive AcroForm now shows aligned Chinese
  labels (完整法定姓名/full_legal_name, 城市/city, 州/state, 邮政编码/zip_code).
- **Dashboard UI leaks (#3) FIXED.** Verified Chinese: nav 文档/设置/账单/退出登录,
  已归档 (Archived), status badges 已处理/已上传, timestamps "4 分钟前"/"大约 21 小时前"
  (date-fns locale). No English Documents/Settings/Billing/Uploaded/Processed/ago.
### Round 2 — viewer leaks + image path (commits d7ed144 / a0b1d29 / d6cc98b)
Continued testing surfaced more, now fixed/known:
- **Viewer string leaks FIXED.** The extraction-method badge, the sidebar
  "X of N completed / N remaining", the login "Welcome back!" toast, and the
  "Analyzing Document" / "No Fields Detected" empty states all now use i18n
  keys (added `viewer.extractionMethod.vision/ready`, `viewer.remaining`). The
  setup modal's "What we'll do" header now uses `setup.whatWellDo`.
- **Spanish generalization verified.** Re-ran the W-2 in Spanish — labels align
  ("Número de seguro social del empleado" / Employee's SSN, …); the fix isn't
  Chinese-specific.
- **Image/photo uploads now detect fields (BUG FIXED).** The dashboard accepts
  `image/*`, but every detection path was PDF-gated, so a form photo/scan gave
  "No Fields Detected". Vision detection now runs for image uploads (normalized
  to PNG via sharp, fed straight to the detector). Verified: a 10-field intake
  form photo (zh) detects 10 aligned Chinese labels (全名, 出生日期, 家庭住址, …)
  then routes to the setup modal (image fields lack rect positions, as expected).
- **Known limit:** a *very dense* form as an image (47-field W-2 photo) can
  exceed the vision per-call cap (raised 90s→120s); the PDF path handles such
  forms natively. Tiling dense images is a future rung (PRD §4.4).
### Round 3 — setup-modal i18n + dense-image tiling (commits 1d38fac / 08f7b87)
- **Setup modal fully localized.** Field-type dropdown
  (Text/Date/Email/…/Address → `setup.fieldTypes.*`), the role-question step,
  "What we'll do", the "Field name"/"Search fields" placeholders, and the
  Add/Cancel buttons all now use i18n keys (added across 9 locales + mirror).
  A full scan of `Phase1SetupModal.js` shows no remaining hardcoded English.
- **Dense scanned/photo forms now work (tiling).** When a full-page vision pass
  finds nothing (dense page times out), the page is sliced into horizontal
  stripes (`OCR_VISION_TILE_ROWS`, default 4, 8% overlap), each run through
  vision, then Y-remapped to full-page coords and deduped. Verified: a 47-field
  **W-2 photo** (zh) — which previously gave "No Fields Detected" — now recovers
  **39 fields** with correct Chinese labels (员工社会安全号码, 控制编号, …) → setup
  modal. `parseJsonArray` is also now lenient (salvages complete `{...}` objects
  from a malformed/truncated array) so a single bad tile response isn't lost.
- **Net:** image/photo uploads work for normal forms (single call) and dense
  forms (tiling fallback); the only forms that may still need the PDF are
  extreme cases beyond ~4 dense stripes.

### Round 4 — functional testing (commits 4d7ec2b / dc2cf06 / + this)
Drove the real end-to-end flows (fill/persist/export, chat, dashboard) across
en/zh/ne and PDF/JPG. Bugs found and fixed:
- **Chat replied in Vietnamese for everyone (HIGH).** `CO_SYSTEM_PROMPT`
  hardcoded "Always respond in Vietnamese"; `/api/chat` didn't even parse
  `language` and neither chat endpoint passed it to `chatWithCo`. Now the system
  prompt is language-aware and both endpoints forward the locale. Verified:
  en → English reply, zh → Chinese reply (was Vietnamese).
- **`public/locales/` drifted stale vs `locales/` (HIGH).** The viewer fetches
  translations at runtime from `public/locales/`, which had diverged — e.g. the
  chat consent modal showed old "Ask Co for Help" copy, and the landing/concept
  keys were missing. Resynced all 9. (Risk: these two copies can re-diverge —
  a single source / build step would prevent it. Backlog.)
- **Hardcoded Vietnamese line in the consent modal (MED).** "Thông tin của bạn
  luôn được bảo mật." rendered for non-Vietnamese users — removed (redundant
  with the localized description).
- **PdfViewer legacy palette (LOW).** Toolbar used `gray-*` + a `ring-blue-400`
  focus ring + blue spinner → converted to `slateish/brand`.

Confirmed working (no bug): fill → "1 of N completed" + "Done" badge → value
persists across reload → Export downloads the filled PDF; JPG photo upload →
vision detects fields; Nepali labels correct + aligned (पूरा नाम/Full Name,
सदस्यता प्रकार/Membership Type, …); chat end-to-end (consent → reply); dashboard
search.

### Round 5 — locale single-sourcing + recipient `/fill/[token]` flow
- **Single-source locales SHIPPED.** `scripts/sync-locales.js` copies `locales/`
  → `public/locales/` on `predev`/`prebuild` (+ `sync:locales` / `--check`), so
  the viewer's runtime bundle can no longer drift from the app's.
- **Recipient signing flow tested end-to-end** (session create → open link →
  fill → submit). Works: 201 create, lands on fill, fields fill, **"Document
  Submitted"**. Verify/identity gate works (wrong email+lastName fails, correct
  passes → fill).
- **BUG — recipient page only localized in 3 of 9 languages (HIGH). FIXED.** The
  fill/verify page uses an inline `UI_COPY` dict that only had en/vi/es; the
  other 6 (pt, fr, zh, yue, ht, ne) **fell back to English** — a Chinese/French/
  Nepali recipient got an all-English signing page (~95 strings: verify gate,
  buttons, field chrome, errors). Added all 6. Verified zh/fr/ne render
  localized (e.g. 验证你的访问权限 / Vérifiez votre accès / तपाईंको पहुँच प्रमाणित),
  no English leak.
- Minor (left as-is): the email input's `name@email.com` placeholder is a
  universal email-format example, not localized.

### Round 6 — embed `/embed/[token]` flow
- **BUG — embed page only localized in 3 of 9 languages (HIGH). FIXED.** The
  embeddable signing page has its own `EMBED_COPY` dict that, like the fill page,
  only had en/vi/es; pt/fr/zh/yue/ht/ne fell back to English. Added all 6.
  Verified: embed verify gate renders in Chinese, embed fill renders in French,
  no English chrome leak.
- **Finding — recipient field CONTENT not translated per session (HIGH, not yet
  fixed).** Chrome localizes to the session language, but field *labels &
  explanations* only exist in the language the document was OCR-processed in
  (Step 3b at OCR time). A recipient assigned French on an English-processed doc
  sees French chrome but **English field labels/explanations**. The
  `/api/sessions/[token]/language` endpoint accepts all 9 languages but only
  updates `preferred_language` — it does not (re)translate fields. Proper fix =
  on-demand field translation when a session's language lacks translations
  (adds per-session API cost) — a deliberate decision, flagged for product.
- Minor: `language.js` header comment says `'en' | 'vi' | 'es'` but
  `SUPPORTED_LANGUAGES` is all 9 — stale comment.

### Round 7 — metered translation: personal flow (verified)
Built on the core (`lib/languageEntitlement.js` + `/api/documents/[id]/translate`):
- **Upload defaults to English-only.** The dashboard language picker no longer
  auto-translates to the page locale; default is English (no translation),
  picking a language is the optional 1-included translation.
- **"Read this form in another language?" prompt** on the document page when the
  doc is English-only — pick a language → calls the gated translate endpoint →
  fields refetch and the whole viewer switches to that language. Skip/dismiss
  keeps English. Verified end-to-end: English upload → prompt → pick Spanish →
  viewer + field labels + explanations all switch to aligned Spanish (Nombre
  completo / Correo electrónico / …). Upcharge (402) shows an inline message.
- New i18n: `dashboard.languageEnglishOnly`, `viewer.translatePrompt*` (9 locales).

### Round 8 — metered translation: enterprise send gate (verified) — FEATURE COMPLETE
`send-links` now translates the document into the recipient's language (via the
entitlement-gated endpoint) **before** creating the link, so the recipient sees
translated content, not English. A blocked language (402) shows an upgrade
message and the link isn't created. Verified end-to-end: send in Spanish →
fields translated (included) → session created → recipient `/es/fill/[token]`
shows fully-Spanish chrome **and** field labels/explanations (Nombre completo,
Correo electrónico, …). This also **closes the earlier "recipient sees English
field content" gap.**

Feature status: core (entitlement + endpoint) ✓, personal (English-only default
+ open prompt) ✓, enterprise (send gate) ✓.

Update (co-sign-203): the plan gate is gone. `lib/languageEntitlement.js` was
deleted; the translate endpoint no longer reads the org's plan and never answers
402, so an owner can add any number of supported languages to a document. The
two 402 messages above were removed from the document page and `send-links`.

## P2 backlog (depth & delight)
- Add `framer-motion` for subtle section reveals / press feedback / modal transitions.
- Accessibility pass: aria-labels on icon buttons, visible focus rings, text+icon
  status (not color-only), Escape-to-close menus, keyboard nav.
- Footer real URLs (no `#` placeholders); optional dark mode (cheap via the CSS-var
  brand system).
