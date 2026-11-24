-- =====================================================
-- Billing webhook idempotency ledger + security-advisor hygiene
-- =====================================================

-- 1. Stripe event ledger: the webhook records each event id before processing;
--    a duplicate delivery conflicts on the PK and is skipped (the credit grant
--    is a read-modify-write and would otherwise double-apply). RLS enabled with
--    no policies: only the service role (which bypasses RLS) touches it.
CREATE TABLE IF NOT EXISTS public.billing_events (
  id text PRIMARY KEY,               -- Stripe event id (evt_...)
  event_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

-- 2. Pin search_path on flagged functions (advisor: function_search_path_mutable).
ALTER FUNCTION public.handle_updated_at() SET search_path = public;
ALTER FUNCTION public.increment_completion_count(uuid) SET search_path = public;
ALTER FUNCTION public.prevent_audit_log_mutation() SET search_path = public;
ALTER FUNCTION public.enforce_document_limit() SET search_path = public;
ALTER FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) SET search_path = public;
ALTER FUNCTION public.enterprise_finalize_setup_tx(uuid, uuid, uuid, text, jsonb, jsonb) SET search_path = public;

-- 3. Client roles must not execute the SECURITY DEFINER RPCs (advisors:
--    anon/authenticated_security_definer_function_executable). Every caller in
--    the app is a server-side API route using the service role, which keeps
--    EXECUTE explicitly. enforce_document_limit is a trigger function — trigger
--    firing is unaffected by these grants.
REVOKE EXECUTE ON FUNCTION public.enforce_document_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enterprise_finalize_setup_tx(uuid, uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_completion_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_document_limit() TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.enterprise_finalize_setup_tx(uuid, uuid, uuid, text, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_completion_count(uuid) TO service_role;

-- 4. Covering indexes for flagged foreign keys (advisor: unindexed_foreign_keys).
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON public.documents(created_by);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user_id ON public.org_memberships(user_id);

-- 5. Redundant permissive policy: the service role bypasses RLS entirely, so a
--    USING(true) "Service role full access" ALL-policy only widens exposure
--    (advisor: rls_policy_always_true).
DROP POLICY IF EXISTS "Service role full access" ON public.session_fields;
