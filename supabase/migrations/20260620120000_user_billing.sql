-- =====================================================
-- Personal billing: per-user plan + one-time-pack credits
-- =====================================================
-- Organizations already carry Stripe columns (stripe_customer_id,
-- subscription_*). Personal users had no billing home, so plan/credits for the
-- Free / Basic / Unlimited personal tiers live here, keyed by the Supabase auth
-- uid (matches documents.user_id, which is text).
--
-- Writes happen only via the service role (checkout + webhook). Users may read
-- their own row (so the billing page can show plan + remaining credits).

CREATE TABLE IF NOT EXISTS public.user_billing (
  user_id text PRIMARY KEY,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text NOT NULL DEFAULT 'free',           -- free | basic | unlimited
  doc_credits integer NOT NULL DEFAULT 0,      -- remaining one-time-pack documents (Basic)
  subscription_status text,
  subscription_current_period_end timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_billing_customer ON public.user_billing(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_user_billing_subscription ON public.user_billing(stripe_subscription_id);

ALTER TABLE public.user_billing ENABLE ROW LEVEL SECURITY;

-- A user can read only their own billing row.
DROP POLICY IF EXISTS "user reads own billing" ON public.user_billing;
CREATE POLICY "user reads own billing"
  ON public.user_billing FOR SELECT
  USING (auth.uid()::text = user_id);

-- No INSERT/UPDATE/DELETE policies: only the service role (which bypasses RLS)
-- mutates this table, from the checkout + webhook endpoints.
