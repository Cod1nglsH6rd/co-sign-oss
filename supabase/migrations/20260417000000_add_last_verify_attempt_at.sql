-- Adds missing column referenced by pages/api/sessions/[token]/verify.js
ALTER TABLE fill_sessions
  ADD COLUMN IF NOT EXISTS last_verify_attempt_at timestamptz;
