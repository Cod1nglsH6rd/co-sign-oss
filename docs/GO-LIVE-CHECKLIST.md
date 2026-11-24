# Cô Sign — Go-Live Checklist

> Final items to verify/complete before launching the enterprise portal to
> real customers. Grouped by blocker severity. Items marked **[verified]**
> were exercised end-to-end during the 2026-06-16 A–Z run-through (a real
> USCIS I-9, 128 detected fields, full upload → sign → completed → signed-PDF
> download). Items marked **[action]** require a human decision or a
> production config step before launch.

Last reviewed: 2026-06-16

---

## 1. Secrets & environment (blockers)

- [ ] **[action] Rotate every key that was shared in chat** — Supabase
  service-role key and Anthropic API key. Treat any key pasted into a
  conversation as compromised.
- [ ] **[action] Set production environment variables** (Vercel project):
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (server only — never `NEXT_PUBLIC_`)
  - `ANTHROPIC_API_KEY`
  - `NEXT_PUBLIC_APP_URL` = `https://app.example.com`, your production domain (fallback link origin; live
    links use the request origin per PRD §3.1)
  - `CRON_SECRET` (or `RETENTION_CRON_SECRET`) — **retention cron 503s without
    it** (PRD §8.1)
  - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — required for
    correct rate limiting across serverless instances (PRD §8.2); without it,
    limits are per-instance only
  - `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN` — error monitoring is inert until
    set (PRD §8.3)
  - `ADMIN_DASHBOARD_EMAILS` and `NEXT_PUBLIC_OWNER_EMAILS` — comma-separated
    owner allowlist (`lib/ownerEmails.js`). There is no built-in default.
    The API's owner list is `ADMIN_DASHBOARD_EMAILS` from env, then
    `NEXT_PUBLIC_OWNER_EMAILS` from env, then the `ADMIN_DASHBOARD_EMAILS`
    saved on the host by first-run setup (`.cosign/settings.json`), the first
    that names someone. Only when none of the three names anyone is nobody an
    owner and do `/api/admin/usage` and `/api/admin/users` answer 403 to
    everyone. The browser reads only env, `NEXT_PUBLIC_OWNER_EMAILS` then
    `NEXT_PUBLIC_ADMIN_DASHBOARD_EMAILS`, so `/enterprise/owner` stays closed
    while neither names someone, even with a saved list. Set both env
    variables to the same list.
- [ ] **[action] Confirm `NEXT_PUBLIC_ENABLE_DEV_LOGIN` is NOT set in
  production.** The `admin`/`eadmin` username shortcut is double-gated
  (`NODE_ENV==='development'` AND the flag), so it's already off in a prod
  build — but don't set the flag in prod.
- [ ] **[action] Remove or repurpose the shared test account**
  (`admin@example.com` / `Test123!`, or the `NEXT_PUBLIC_DEV_LOGIN_EMAIL`
  override; an older copy under the production domain may still exist in the
  live Supabase project). It uses a weak known password; keep it out of
  the owner allowlist variables.

## 2. Security (blockers)

- [x] **[verified] `documents` bucket is private.** Was public; flipped to
  private (migration `20260616120000`). Originals can hold PII (SSNs on an
  I-9). App uses signed URLs only — no `getPublicUrl` anywhere. Signed reads
  confirmed working post-change. `filled-documents` already private.
- [x] **[verified] RLS scoping.** Blanket-`true` policies replaced with
  owner+org scoping (migration `20260612120000`); anon key reads return `[]`.
- [x] **[verified] Identity verification gate.** Recipient must enter the
  email + last name on file before the document opens (PRD §3.2).
- [x] **[verified] Signed-PDF access is gated.** `/api/sessions/signed-pdf`
  mints a short-lived URL only for an authenticated active org member (§2.7).
- [ ] **[action] Run `get_advisors` (security + performance) on the Supabase
  project** and clear any high-severity findings.
- [ ] **[action] Confirm CSRF + rate-limit coverage in prod.** Double-submit
  CSRF is enforced on recipient writes; verify Upstash is wired so limits are
  global, not per-instance.

## 3. Functional workflow

- [x] **[verified] Full A–Z pipeline** on two complex real documents:
  - a **form** (USCIS I-9): 128 fields, 115 required, 9 signatures;
  - a **contract** (HUD Model Lease, 13 pages): 45 prose-style fields
    (dates/rent/term), 2 signatures, **two recipients**.
  Both: upload → AI detection → setup → signing link → identity verify →
  fill → sign → `completed` → staff signed-PDF download. All green.
- [x] **[verified] Per-recipient field curation** (§2.8) and
  **multi-recipient completion** (§2.4) — the lease completed across two
  recipients and the document correctly flipped to `completed`.
- [x] **[verified/fixed] Document-completion lifecycle.** A fully-signed
  document could previously remain `ready_to_send` (it would still appear as
  "needs sending" and be missing from the Completed tab). Fixed in
  `complete.js`; re-verified the document flips to `completed`.
- [x] **[verified/fixed] OCR model id.** Step 2/3 referenced the retired
  `claude-3-haiku-20240307` (404 on every call, surviving only via fallback);
  now `claude-haiku-4-5`.
- [ ] **[action] Sanity-check AI field detection on 2–3 of your own real
  forms.** Detection quality varies by document; the I-9 detected cleanly,
  but confirm with the form types you'll actually use.
- [x] **[verified/fixed] Multi-page field paging.** Fields on multi-page
  documents were all assigned to page 1, so they rendered on the wrong page.
  Fixed in `ocr.js` (page now derived from each field's pdf-lib widget /P
  ref). Validated on a complex real contract — an 11-page, 340-field TREC
  Farm & Ranch contract: **296 of 340 fields were being mis-paged** and the
  fix corrected them; the stored page distribution then matched ground truth
  exactly across all 11 pages, and filled values rendered on the correct
  pages (spot-checked pages 5 and 6 in the fill view). The non-AcroForm
  (text-layer) path was also checked and already pages correctly, so the fix
  is only needed for the AcroForm path.
- [x] **[verified/fixed] Text-layer detection timeout on dense non-AcroForm
  forms.** The text-layer path batched 3 pages per Anthropic call under a 30s
  cap, and one batch timing out aborted the *whole* document → **0 fields**.
  A complex 10-page non-AcroForm contract (TREC Unimproved Land) reproduced
  it. Fixed in `ocr.js`: smaller batches (2 pages, `OCR_TEXT_PAGES_PER_BATCH`),
  a 60s per-call cap (`OCR_TEXT_LAYER_TIMEOUT_MS`), and per-batch isolation
  with a page-by-page retry so one heavy page can't zero out the rest.
  Re-verified: that contract went from 0 → **198 fields across all 10 pages**,
  correctly paged, with page-9 fields rendering on page 9.
- [x] **[verified] `extract-form-fields` edge function source is in sync.**
  Fetched the deployed function (v20) and diffed it against
  `supabase/functions/extract-form-fields/index.ts`: **byte-identical** apart
  from trailing whitespace (the repo already carries the pdfjs label pass +
  position conversion). `deno.json` matches the deployed import map. Also
  aligned the legacy, unused `import_map.json` (it had a stale `@pdf-lib` alias
  and was missing `pdfjs-dist`) to match `deno.json` so a future
  `import_map.json`-based deploy can't drift. A repo redeploy will not regress
  production. (The multi-page fix intentionally lives in `ocr.js`.)
- [x] **[verified] Localized recipient pass (vi + es).** Verify gate, fill UI,
  translated field labels, and AI-generated field explanations all render in
  Tiếng Việt and Español (confirmed on the purchase agreement). Translations
  are generated lazily on first access in a new language, so the first vi/es
  open of a large document briefly shows the "almost ready" state while
  enrichment runs, then loads.
- [x] **[verified/fixed] Multi-party detection.** Was completely broken (a
  naive JSON.parse threw on the model's fenced JSON → every doc defaulted to
  single-party); now correctly detects `isMultiParty` + roles (buyer/seller).
- [x] **[verified/fixed] Large forms (>200 fields).** A 263-field contract
  previously couldn't be saved/submitted (server caps a single fill request at
  200 fields). The fill client now chunks saves; full submit verified.
- [ ] **[action] Remaining recipient i18n polish (non-blocking).** A few
  minor strings are still English on vi/es pages: the PDF viewer's "Loading
  document…" and "Page X of Y". The full-screen "not ready" title and the
  per-field "Expected: …" hints are now localized.

## 4. AI cost & limits

- [x] Chat uses `claude-haiku-4-5`; detection uses `claude-sonnet-4-5` once
  per document (PRD §4).
- [ ] **[action] Set an Anthropic spend limit / billing alert.** Detection on
  large forms is the main cost driver (the I-9 = 128 fields in one pass).
- [ ] **[action] Confirm chat rate limits are tuned** for expected recipient
  volume.

## 5. Branding / UX

- [x] **[verified] Two-palette brand.** Enterprise (marketing landing, login,
  console) = indigo; recipient/client = teal. Verified across all surfaces
  (PRD §5.3). No teal/indigo clashes; status colors unaffected.
- [x] **[verified] No emoji on enterprise surfaces** (PRD §5.1) — last stray
  (upload modal folder glyph) replaced with a Feather icon.
- [ ] **[action] Replace the dev logo if needed** and confirm favicon/OG tags
  for your production domain.

## 6. Operations

- [x] Retention cron scheduled daily 03:00 UTC (`vercel.json`, §8.1).
- [ ] **[action] Verify the cron actually runs in prod** (needs `CRON_SECRET`)
  and that each org's `retention_days` is set intentionally.
- [ ] **[action] Verify the OCR worker runs in prod.** Parked OCR jobs are
  resumed by the in-app OCR worker, which `instrumentation.js` starts at
  server boot (`lib/ocrWorkerBoot.js`); there is no OCR cron. Check that
  `OCR_WORKER` is not `off`, that the server logs show no "OCR worker not
  started" line, and that a dense document that parks reaches done.
- [ ] **[action] Decide on email delivery.** Resend is wired
  (`lib/email.js`) but unverified — links are currently copy/paste only
  (PRD §9). Either verify the Resend domain or keep copy/paste and set
  expectations.
- [ ] **[action] Backups / PITR** enabled on the Supabase project.

## 7. Known scope boundaries (not blockers)

- Personal/consumer portal is retired → redirects to enterprise (PRD §9).
- No payments are taken; every feature is free to use.
- Email auto-delivery of links is not active (copy/paste).

---

### Quick pre-launch smoke (do this on the prod URL right before announcing)

1. Log in at `/enterprise/login` with a real account.
2. Upload one real form → wait for "Set up" → save setup.
3. Create a signing link → open it in an incognito window.
4. Verify identity → fill → sign → submit.
5. Back in the console, download the signed PDF.
6. Confirm the link domain is your production domain (not localhost).
