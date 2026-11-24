ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS page_count integer;
