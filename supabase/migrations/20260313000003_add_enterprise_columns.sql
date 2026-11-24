-- =====================================================
-- Add enterprise columns to documents table
-- Supports multi-party workflows and session tracking
-- =====================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  is_multi_party BOOLEAN DEFAULT FALSE;

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  document_type VARCHAR(100) DEFAULT 'unknown';

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  detected_roles JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS
  completion_count INTEGER DEFAULT 0;
