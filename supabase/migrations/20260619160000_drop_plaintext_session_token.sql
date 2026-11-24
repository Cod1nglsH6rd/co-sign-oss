-- =====================================================
-- Stop persisting plaintext session tokens (security hardening)
-- =====================================================
-- Recipients are validated by hashing their token and matching `token_hash`.
-- The plaintext `token` was also being stored, which means a read of
-- `fill_sessions` (breach, backup, leaked logs) yields usable signing links —
-- defeating the point of hashing. No client or API reads the plaintext column
-- (the share link is only shown from the in-memory creation response), so we
-- stop writing it and null out existing values.
--
-- 1. Allow NULL (the column was NOT NULL) so inserts can omit the plaintext token.
ALTER TABLE public.fill_sessions ALTER COLUMN token DROP NOT NULL;

-- 2. Null out existing plaintext tokens. Safe: every row already has token_hash,
--    which is what recipient validation uses.
UPDATE public.fill_sessions SET token = NULL WHERE token IS NOT NULL AND token_hash IS NOT NULL;
