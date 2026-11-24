# Cô Sign — Security Audit & Hardening (2026-06-19)

A full-app security review (auth, authorization/IDOR, recipient token flow, input
validation, file upload, secrets, injection, headers, dependencies). Overall the
app is in good shape; the items below were found and the HIGH/MEDIUM ones fixed
in this pass.

The audit was made against the project's first hosted deployment. Where it says
something was applied or checked, it means there, at that time; an install of
your own gets the same fixes from the code and the migrations.

## Fixed in this pass

| ID | Severity | Finding | Fix |
|----|----------|---------|-----|
| H1 | HIGH | **Plaintext session tokens stored at rest.** `fill_sessions.token` was written alongside `token_hash`, so a DB read yielded usable signing links. No client/API actually reads the plaintext column (the share link is shown only from the in-memory create response). | Stopped writing plaintext (`sessions/create.js`); made strict-hash the **default** (`lib/sessionAuth.js`); migration `20260619160000` drops the NOT NULL constraint and **nulls existing plaintext tokens** (applied to the deployment this audit covered: 0 remained, all rows keep `token_hash`). Recipient validation is unchanged (hash lookup). |
| H2 | HIGH | **Vulnerable dependencies** — axios had many HIGH CVEs (SSRF, prototype pollution). | `npm audit fix` → axios 1.18.0; all 6 HIGH advisories cleared. |
| M1 | MEDIUM | **`/api/cron/retention`** checked the rate limit before the secret and compared secrets with `===`. | Authenticate (constant-time `timingSafeEqual`) **before** rate limiting. |
| M2 | MEDIUM | **`/api/beta`** (unauth, service-role) accepted arbitrary `locale`/`source`. | Zod `enum(locales)` for locale; `^[a-z0-9_-]{1,32}$` for source. |
| M3 | MEDIUM | **Verify endpoint** echoed `maskedEmail` on a *failed* attempt (leaks email domain to a token holder) and compared email/last-name with `===`. | Removed `maskedEmail` from the failure response (kept on success); constant-time compare. |

## Remaining / deferred (need a decision or larger change)

| ID | Severity | Finding | Plan |
|----|----------|---------|------|
| M4 | MEDIUM (partly fixed) | **CSP allowed `'unsafe-inline'` + `'unsafe-eval'`** in `script-src`. | **Done:** dropped `'unsafe-eval'` → `'wasm-unsafe-eval'` (allows react-pdf/pdfjs WebAssembly, blocks JS `eval`/`new Function`). Verified the PDF viewer still renders with **0 CSP violations**. `'unsafe-inline'` **kept**, by necessity: (a) Next.js **Pages Router** has no clean nonce path for its framework scripts, and (b) `style-src` needs it for **styled-jsx** (13 files). A full nonce migration is low-value here — the audit found **no XSS sinks** (no `dangerouslySetInnerHTML`/`eval` in app code) — and high-risk (could break hydration/PDF), so it's deferred unless a compliance requirement forces it. |
| ~~D1~~ | ~~MODERATE~~ | **FIXED — `next-intl` open redirect + prototype pollution, postcss XSS.** (Both next-intl advisories were on code paths this app doesn't use — its own `middleware.js` instead of `createMiddleware`/navigation, no `experimental.messages.precompile`.) | **Done:** upgraded `next-intl` 3 → **4.13** (verified: all 9 locales render, 0 i18n errors, build green — the app only uses `useTranslations` + `NextIntlClientProvider`, so the v4 breaking changes in the server/middleware APIs didn't apply); added an `overrides` to force `postcss` ≥ 8.5.15 (Next bundled a vulnerable 8.4.31). **Production deps: `npm audit --omit=dev` = 0 vulnerabilities.** (27 remaining are dev-only tooling — `@remotion/*`, jest, eslint — that never ships.) |
| ~~L4~~ | ~~LOW~~ | **FIXED — Embed vs headers.** Global `X-Frame-Options: DENY` + `frame-ancestors 'none'` blocked `/embed/[token]` from being framed at all. | **Done:** framing policy moved to `middleware.js` (next.config headers can't be overridden per-request). `/embed/[token]` now gets a **per-session** `frame-ancestors 'self' <embed_origin>` (looked up by `token_hash`), fail-closed to `'none'` on miss/error; every other page keeps `X-Frame-Options: DENY` + `frame-ancestors 'none'`. Verified at runtime (origin-pinned embed framable only by its origin; unknown token denied). |
| ~~L1~~ | ~~LOW~~ | **ADDRESSED — link with no recipient email had no identity gate.** | **Done (opt-in):** added an org toggle `organizations.require_recipient_verification` (default off). When on, `/api/sessions/create` rejects any session lacking a recipient email + last name (`recipient_verification_required`), forcing the verify gate. Toggle UI on the enterprise admin dashboard (admin-gated `/api/enterprise/org-settings`). Checked on the deployment this audit covered: toggle on → no-email link rejected; off → allowed. |
| L2 | LOW (ops) | In-memory rate-limit fallback is per-instance. | One instance needs nothing. With more than one instance, set Upstash (`UPSTASH_REDIS_REST_URL/TOKEN`) so they share one count. |

## Verified strong (no action needed)
- **Token generation:** `crypto.randomBytes(32)` → 256-bit.
- **SSRF guard:** `lib/documentFetch.js` blocks non-HTTP(S), embedded credentials, private/loopback/link-local IPs, and re-validates each redirect hop via DNS.
- **CSRF:** double-submit cookie, `timingSafeEqual`, `SameSite=Strict`, enforced on all recipient writes.
- **Authorization:** every authenticated endpoint scopes by `org_id`; recipient endpoints scope strictly to the token's session; `signed-pdf` is org-membership gated. No IDOR found.
- **Audit log:** append-only (trigger blocks UPDATE/DELETE; FK cascades dropped).
- **Headers:** HSTS (two-year max-age; no includeSubDomains or preload since 2026-11-21, so an install never pins its owner's other subdomains), nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors none.
- **No** `dangerouslySetInnerHTML` / `eval` / `child_process`; **no** secrets in client code or `NEXT_PUBLIC_` vars.
- **OCR resume:** parked OCR jobs are resumed by the in-app OCR worker, which calls `/api/ocr` on 127.0.0.1 with a per-process random token (`lib/internalAuth.js`: 32 random bytes, never read from the environment or logged). No public route or cron secret is needed for it; `CRON_SECRET` still lets a person trigger `/api/ocr` by hand.

## Settings these findings depend on
- `COSIGN_SESSION_TOKEN_HASH_STRICT` — defaults to strict (no plaintext fallback). Only set to `false` to temporarily support un-migrated legacy rows.
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` — only when more than one instance runs. Without them each instance keeps its own rate-limit count in memory, which is enough for one.
- `CRON_SECRET` (or `RETENTION_CRON_SECRET`) — only if you schedule retention. Nothing is deleted unless something calls `/api/cron/retention`; it answers 503 until one of the two is set, and 401 to a call that does not send it. See Retention in the README.
