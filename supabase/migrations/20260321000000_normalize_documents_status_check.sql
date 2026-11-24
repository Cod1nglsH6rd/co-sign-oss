-- Normalize legacy documents.status check constraint so enterprise lifecycle
-- can use 'ready' without failing unrelated updates.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'documents'
      AND c.conname = 'documents_status_check'
  ) THEN
    ALTER TABLE public.documents DROP CONSTRAINT documents_status_check;
  END IF;
END $$;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_status_check
  CHECK (
    status IS NULL
    OR status IN ('uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error')
  );
