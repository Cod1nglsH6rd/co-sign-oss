-- =====================================================
-- Remove the billing leftovers from the schema
-- =====================================================
-- Cô Sign takes no payments, and no app code reads any of these objects. This
-- drops the document-limit trigger and its function, the Stripe event ledger,
-- and the organizations billing columns with their check constraints and
-- unique keys, then deletes the two app_config rows that gated the limit.
-- The app_config table itself stays: /api/health reads it.
-- Every drop uses IF EXISTS, so this runs on databases that never had them.

-- 1. Document-limit trigger and its function.
DROP TRIGGER IF EXISTS enforce_document_limit ON public.documents;
DROP FUNCTION IF EXISTS public.enforce_document_limit();

-- 2. Stripe webhook event ledger.
DROP TABLE IF EXISTS public.billing_events;

-- 3. Organizations billing columns, their check constraints and unique keys.
-- 20260418000100 made the Stripe keys as unique indexes, but a database may
-- hold them as UNIQUE constraints, whose index cannot be dropped on its own.
-- So drop them as constraints first; the index drops then remove whatever is
-- left, or do nothing.
ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_subscription_status_check,
  DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check,
  DROP CONSTRAINT IF EXISTS organizations_stripe_customer_id_key,
  DROP CONSTRAINT IF EXISTS organizations_stripe_subscription_id_key;

DROP INDEX IF EXISTS public.organizations_stripe_customer_id_key;
DROP INDEX IF EXISTS public.organizations_stripe_subscription_id_key;

ALTER TABLE public.organizations
  DROP COLUMN IF EXISTS subscription_status,
  DROP COLUMN IF EXISTS subscription_plan,
  DROP COLUMN IF EXISTS subscription_current_period_end,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id,
  DROP COLUMN IF EXISTS doc_credits,
  DROP COLUMN IF EXISTS plan;

-- 4. The document-limit gate rows (the table stays).
DELETE FROM public.app_config WHERE key IN ('doc_limits_enabled', 'free_doc_limit');
