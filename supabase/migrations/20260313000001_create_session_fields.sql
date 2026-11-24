-- =====================================================
-- Session Fields Table
-- Per-session field values (customer's filled data)
-- Each fill session gets its own copy of field values
-- =====================================================

CREATE TABLE IF NOT EXISTS public.session_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relationships
  session_id UUID NOT NULL REFERENCES public.fill_sessions(id) ON DELETE CASCADE,
  field_id BIGINT NOT NULL,  -- References fields table

  -- Filled data
  field_value TEXT,
  signature_data_url TEXT,       -- Base64 PNG for signature fields
  signature_timestamp TIMESTAMPTZ,

  -- Tracking
  filled_at TIMESTAMPTZ,
  last_modified_at TIMESTAMPTZ DEFAULT NOW(),

  -- One value per field per session
  UNIQUE(session_id, field_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_fields_session ON public.session_fields(session_id);
CREATE INDEX IF NOT EXISTS idx_session_fields_field ON public.session_fields(field_id);

-- Row Level Security
ALTER TABLE public.session_fields ENABLE ROW LEVEL SECURITY;

-- Accessed via service role key only (API validates token manually)
-- This allows the API to read/write on behalf of anonymous customers
CREATE POLICY "Service role full access"
  ON public.session_fields FOR ALL
  USING (TRUE)
  WITH CHECK (TRUE);
