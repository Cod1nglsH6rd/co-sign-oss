-- Objects the hosted database has and the app uses, but no migration made:
-- fill_sessions.verification_attempts (pages/api/sessions/[token]/verify.js
-- counts failed codes in it) and increment_completion_count(uuid)
-- (pages/api/sessions/[token]/complete.js calls it). The function body is the
-- one in SUPABASE-SETUP.sql. Every statement can run twice.

BEGIN;

ALTER TABLE public.fill_sessions
  ADD COLUMN IF NOT EXISTS verification_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.increment_completion_count(doc_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
begin
  update public.documents
  set completion_count = coalesce(completion_count, 0) + 1
  where id = doc_id;
end;
$$;

-- A new function is executable by PUBLIC by default; only the service role
-- (complete.js runs server-side) keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.increment_completion_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_completion_count(uuid) TO service_role;

COMMIT;
