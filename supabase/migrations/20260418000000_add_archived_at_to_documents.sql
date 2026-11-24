-- Soft-delete/archive support for documents.
-- Adds archived_at timestamp and a partial index to keep active-list
-- queries (archived_at IS NULL) fast for the common dashboard scan.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS archived_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS documents_active_idx
  ON public.documents(org_id, user_id)
  WHERE archived_at IS NULL;
