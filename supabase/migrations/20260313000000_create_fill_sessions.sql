-- =====================================================
-- Ensure handle_updated_at function exists
-- (defined in SUPABASE-SETUP.sql but not in a migration)
-- =====================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- Fill Sessions Table
-- Tracks each send-to-customer instance
-- =====================================================

CREATE TABLE IF NOT EXISTS public.fill_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Token-based access for anonymous customers
  token VARCHAR(64) NOT NULL UNIQUE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,

  -- Recipient info
  recipient_email VARCHAR(254),
  recipient_name VARCHAR(255),

  -- Session state
  -- pending | opened | in_progress | completed | expired | revoked
  status VARCHAR(50) DEFAULT 'pending',
  preferred_language VARCHAR(10) DEFAULT 'en',

  -- Configuration
  assigned_role VARCHAR(100),        -- e.g., 'tenant', 'employee', 'buyer'
  field_filter JSONB,                -- { ids: ["field-id-1", ...] } or null = all fields
  require_signature BOOLEAN DEFAULT FALSE,
  send_method VARCHAR(50) DEFAULT 'email',  -- email | embed | link
  embed_origin VARCHAR(255),         -- allowed CORS origin for iframe embeds

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  first_opened_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,

  -- Extensible metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_fill_sessions_document ON public.fill_sessions(document_id);
CREATE INDEX IF NOT EXISTS idx_fill_sessions_client ON public.fill_sessions(client_user_id);
CREATE INDEX IF NOT EXISTS idx_fill_sessions_token_hash ON public.fill_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_fill_sessions_status ON public.fill_sessions(status);

-- Row Level Security
ALTER TABLE public.fill_sessions ENABLE ROW LEVEL SECURITY;

-- Clients (authenticated) can manage their own sessions
CREATE POLICY "Clients can view own sessions"
  ON public.fill_sessions FOR SELECT
  USING (auth.uid() = client_user_id);

CREATE POLICY "Clients can create sessions"
  ON public.fill_sessions FOR INSERT
  WITH CHECK (auth.uid() = client_user_id);

CREATE POLICY "Clients can update own sessions"
  ON public.fill_sessions FOR UPDATE
  USING (auth.uid() = client_user_id);

CREATE POLICY "Clients can delete own sessions"
  ON public.fill_sessions FOR DELETE
  USING (auth.uid() = client_user_id);

-- Auto-update updated_at (reuses existing handle_updated_at function)
CREATE TRIGGER fill_sessions_updated_at
  BEFORE UPDATE ON public.fill_sessions
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();
