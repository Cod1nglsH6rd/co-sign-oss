-- =====================================================
-- Audit Log: make it genuinely append-only (immutable)
-- =====================================================
-- The marketing surface advertises an "append-only audit trail". The original
-- table allowed UPDATE/DELETE (service role bypasses RLS) and used
-- ON DELETE SET NULL foreign keys, so deleting a document/session would MUTATE
-- existing audit rows. Both are incompatible with an immutable log.
--
-- This migration:
--   1. Drops the FK constraints so deleting a document/session can never rewrite
--      an audit row (the UUIDs are retained verbatim as a historical record).
--   2. Adds a trigger that rejects UPDATE and DELETE on audit_log for everyone,
--      including the service role — inserts remain allowed.
--   3. Revokes UPDATE/DELETE table privileges from the API roles (defense in depth).
--
-- Note: the retention cron only deletes fill_sessions + storage objects, never
-- audit_log, so audit history survives document/session purges.

-- 1. Drop FK cascades that would mutate audit rows on parent deletion.
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_session_id_fkey;
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_document_id_fkey;

-- 2. Reject any UPDATE/DELETE (append-only), regardless of role.
CREATE OR REPLACE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_log_append_only ON public.audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();

-- 3. Defense in depth: API roles cannot even attempt UPDATE/DELETE.
REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;
