-- =====================================================
-- Audit Log Table
-- Tracks all actions for compliance & debugging
-- =====================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What happened
  action VARCHAR(50) NOT NULL,       -- created, sent, opened, filled, signed, submitted, completed, exported, revoked
  entity_type VARCHAR(50) NOT NULL,  -- fill_session, document, field
  entity_id UUID,

  -- Who did it
  actor_type VARCHAR(50) NOT NULL,   -- client, customer, system
  actor_id UUID,                     -- user_id for clients, NULL for anonymous customers

  -- Context
  session_id UUID REFERENCES public.fill_sessions(id) ON DELETE SET NULL,
  document_id UUID REFERENCES public.documents(id) ON DELETE SET NULL,

  -- Details
  details JSONB DEFAULT '{}'::jsonb,
  ip_address INET,
  user_agent TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_log_session ON public.audit_log(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_document ON public.audit_log(document_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON public.audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action);

-- Row Level Security
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Clients can view logs for their documents
CREATE POLICY "Clients view own document logs"
  ON public.audit_log FOR SELECT
  USING (
    document_id IN (
      SELECT id FROM public.documents WHERE user_id::text = auth.uid()::text
    )
  );

-- Insert allowed for service role (API layer)
CREATE POLICY "Service can insert logs"
  ON public.audit_log FOR INSERT
  WITH CHECK (TRUE);
