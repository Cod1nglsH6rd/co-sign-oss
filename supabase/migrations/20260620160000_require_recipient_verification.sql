-- =====================================================
-- L1: org policy to require recipient identity verification
-- =====================================================
-- A signing-link session with no recipient email skips the identity-verification
-- gate, so anyone with the URL can fill/sign it. This adds an org-level toggle:
-- when ON, sessions/create requires a recipient email + last name on every link,
-- which forces the verify gate. Default OFF (preserves quick-link sharing).

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS require_recipient_verification boolean NOT NULL DEFAULT false;
