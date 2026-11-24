-- =====================================================
-- Storage bucket for filled/completed PDFs
-- =====================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'filled-documents',
  'filled-documents',
  false,
  52428800,  -- 50MB limit
  array['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Clients can read filled documents for their own documents
CREATE POLICY "Clients can read filled documents"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'filled-documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.documents WHERE user_id::text = auth.uid()::text
    )
  );

-- Service role uploads filled PDFs (no user-facing upload policy needed)
