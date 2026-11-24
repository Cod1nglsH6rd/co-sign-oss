-- Add processing/lifecycle status columns to documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS lifecycle_status text DEFAULT 'uploaded';

-- Backfill processing_status + lifecycle_status from existing fields
UPDATE public.documents
SET
  processing_status = CASE
    WHEN status = 'processing' THEN 'prepping'
    WHEN COALESCE(metadata->>'post_setup', 'false') = 'true' THEN 'finalizing'
    ELSE 'idle'
  END,
  lifecycle_status = CASE
    WHEN status = 'ready' AND COALESCE((phase1_data->>'setupCompleted')::boolean, false) = false THEN 'setup_required'
    WHEN status = 'ready' AND COALESCE((phase1_data->>'setupCompleted')::boolean, false) = true THEN 'ready_to_send'
    WHEN status = 'completed' THEN 'completed'
    ELSE 'uploaded'
  END;
