# Cô Sign — Security & Compliance Roadmap

> What was advertised vs. what's actually in place, and the concrete path to
> make each claim true. The enterprise landing page (`pages/enterprise/index.js`)
> no longer has a "Security & Compliance" section or makes any compliance
> claim: Cô Sign is a self-hosted MIT project, and each operator makes their
> own claims. Kept as a record and a starting point for operators.

## Why this matters

Customer **document content (PII, potentially PHI) flows through three data
processors**: Supabase (storage/DB), Vercel (hosting/compute), and **Anthropic**
(OCR + chat). Every compliance story (HIPAA, SOC 2, GDPR) therefore depends on a
BAA/DPA with *all three*, not just our own controls. The Anthropic data-flow is
the linchpin. Parked OCR jobs are resumed by the in-app OCR worker inside the
app server (`lib/ocrWorkerBoot.js`), so their content reaches the same
processors and no extra service.

## Status snapshot (2026-06-19)

| Claim | Status | Notes |
|---|---|---|
| AES-256 at rest + TLS in transit | ✅ Live | Supabase (AES-256 at rest) + TLS 1.2/1.3 via Vercel/Supabase. |
| Append-only audit log | ✅ Live | `audit_log` table + trigger blocking UPDATE/DELETE (migration `20260619140000`). Covers the signing lifecycle (create/send/open/fill/sign/complete/export). |
| Role-based access / RLS | ✅ Live | RLS on documents/fields/chat/audit_log. |
| Configurable retention + deletion | ✅ Live | `/api/cron/retention` per-org; data deletion on request. |
| SSO / SAML 2.0 | 🟡 Scaffolded | `signInWithSSO` path wired behind `NEXT_PUBLIC_SSO_ENABLED`; needs Supabase Pro + an IdP connection. |
| HIPAA (BAA) | 🔴 Roadmap | Requires BAAs with Supabase + Vercel + Anthropic, plus our own policies. |
| GDPR | 🟡 Partial | Sign vendor DPAs + publish ours/subprocessor list (easy). EU residency = architectural. |
| SOC 2 Type II | 🔴 Roadmap | Organizational program; 3–12 mo observation window. |
| MFA, on-premise | ❌ Removed from copy | Not implemented / not feasible for a hosted product. |

## Per-claim implementation path

### SSO / SAML 2.0 — buildable now
- Supabase Auth is a native **SAML 2.0 Service Provider** on **Pro and above**
  (Okta, Azure AD, Google Workspace, any SAML IdP; multi-tenant via the CLI).
- **Done:** `handleSSO` → `supabase.auth.signInWithSSO({ domain })` on the
  enterprise login, feature-flagged by `NEXT_PUBLIC_SSO_ENABLED`.
- **To go live:** upgrade Supabase to Pro; register the customer's IdP
  connection + domain via the Supabase CLI; set `NEXT_PUBLIC_SSO_ENABLED=true`.
- Docs: https://supabase.com/docs/guides/auth/enterprise-sso/auth-sso-saml

### HIPAA — sign three BAAs (weeks, not months)
- **Vercel:** BAA self-serve on Pro teams; covers global infra.
  https://vercel.com/changelog/hipaa-baas-are-now-available-to-pro-teams
- **Supabase:** BAA on the **Team plan + HIPAA add-on** (shared responsibility).
  https://supabase.com/docs/guides/security/hipaa-compliance
- **Anthropic:** BAA available; Messages API is an eligible service. **Catch:**
  HIPAA "Covered Models" require **30-day retention and are incompatible with
  zero-data-retention** — sign the BAA *and* accept 30-day retention.
  https://privacy.claude.com/en/articles/8114513
- Plus our own: risk assessment, access policies, breach process.

### GDPR — DPA easy, residency architectural
- **DPA:** sign Supabase's (https://supabase.com/downloads/docs/Supabase+DPA+250314.pdf),
  Vercel's, and Anthropic's; publish our own DPA + a subprocessor list.
- **EU residency:** a single Supabase project is one region. To offer it as an
  *option* we'd provision a separate EU project (`eu-central-1`) for EU
  customers (real multi-region work). Note: Supabase is a US C-corp → Schrems II
  / CLOUD Act sovereignty caveats remain even in Frankfurt.

### SOC 2 Type II — real, slow, costs money
- Adopt a compliance platform (**Vanta/Drata**, ~$10–15k/yr at our size) + an
  auditor. **Type II needs a 3–12 month observation window.** First-year all-in
  typically **$30–65k**, ~100–200 internal hours.
- Supabase and Vercel are already SOC 2 Type II *as our subprocessors* — helps
  the eventual audit, but is **not** Cô Sign being certified.
- https://www.vanta.com/collection/soc-2/soc-2-audit-cost

## Sequencing
1. **Now (code/config):** append-only audit log ✅; honest marketing copy ✅;
   SSO scaffolding ✅.
2. **Near-term (low cost):** Vercel + Supabase + Anthropic BAAs; vendor DPAs +
   our DPA/subprocessor list; provision/confirm region; enable Supabase SAML and
   flip `NEXT_PUBLIC_SSO_ENABLED`. → unlocks honest "HIPAA", "SSO/SAML", "GDPR (DPA)".
3. **Medium-term (budget + time):** start SOC 2 Type II clock with Vanta/Drata;
   settle the Anthropic 30-day-retention-vs-ZDR posture (can't have HIPAA covered
   models *and* ZDR).

## Follow-ups not yet addressed
- Broaden audit-log coverage to staff actions (upload, setup edits, link revoke).
- The "Integrations & API" section (REST API / Webhooks / Analytics Export) is
  framed as **"available on request for Enterprise"** with a "Talk to our team
  about access" CTA → `#demo`, rather than self-serve. Build per signed deal.
