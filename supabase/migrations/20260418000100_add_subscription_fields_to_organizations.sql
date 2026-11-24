-- Add subscription/billing fields to organizations for future Stripe integration.
-- Scaffold only; no Stripe integration yet.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_current_period_end timestamptz NULL,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text NULL,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text NULL;

-- Backfill any NULL subscription status/plan to 'free' for consistency.
UPDATE public.organizations
SET subscription_status = 'free'
WHERE subscription_status IS NULL;

UPDATE public.organizations
SET subscription_plan = 'free'
WHERE subscription_plan IS NULL;

-- Enforce allowed values.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'organizations'
      AND c.conname = 'organizations_subscription_status_check'
  ) THEN
    ALTER TABLE public.organizations DROP CONSTRAINT organizations_subscription_status_check;
  END IF;
END $$;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_status_check
  CHECK (
    subscription_status IS NULL
    OR subscription_status IN ('free', 'active', 'past_due', 'canceled')
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'organizations'
      AND c.conname = 'organizations_subscription_plan_check'
  ) THEN
    ALTER TABLE public.organizations DROP CONSTRAINT organizations_subscription_plan_check;
  END IF;
END $$;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_subscription_plan_check
  CHECK (
    subscription_plan IS NULL
    OR subscription_plan IN ('free', 'pro', 'team')
  );

-- Helpful unique indexes for Stripe IDs (partial, since columns are nullable).
CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_id_key
  ON public.organizations(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_subscription_id_key
  ON public.organizations(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
