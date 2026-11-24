-- =====================================================
-- Document-limit enforcement + one-time-pack credits (org-centric)
-- =====================================================
-- Every user (personal or enterprise) has an organization (bootstrapped on first
-- login), and the entitlement layer already reads organizations.subscription_plan.
-- So billing/limits live on the org, not per-user. This:
--   1. adds organizations.doc_credits (one-time pack balance),
--   2. adds an app_config gate so enforcement stays OFF until billing is live,
--   3. installs a BEFORE INSERT trigger on documents that enforces the personal
--      tiers' caps and consumes Basic credits,
--   4. drops the unused user_billing table (superseded by the org model).
--
-- Personal tiers (free / basic / unlimited) get per-document caps; contracted org
-- plans (pro / team / enterprise) are exempt (negotiated volume).

-- 1. One-time-pack credit balance on the org.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS doc_credits integer NOT NULL DEFAULT 0;

-- Allow the personal tiers (basic/unlimited) as org subscription plans — the
-- existing check constraint only permitted free/pro/team.
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_subscription_plan_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_subscription_plan_check
  CHECK (subscription_plan IS NULL OR subscription_plan = ANY (ARRAY['free','basic','unlimited','pro','team','enterprise']));

-- 2. Config gate (locked down; only the trigger/service role read it).
CREATE TABLE IF NOT EXISTS public.app_config (
  key text PRIMARY KEY,
  value text
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;  -- no policies => clients can't read/write
INSERT INTO public.app_config (key, value) VALUES
  ('doc_limits_enabled', 'false'),
  ('free_doc_limit', '1')
ON CONFLICT (key) DO NOTHING;

-- 3. Enforcement trigger. SECURITY DEFINER so it can read config / org and
--    update credits regardless of the inserting role's RLS.
CREATE OR REPLACE FUNCTION public.enforce_document_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enabled boolean;
  v_plan text;
  v_credits integer;
  v_free_limit integer;
  v_count bigint;
BEGIN
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Gate: off until billing is live.
  SELECT (value = 'true') INTO v_enabled FROM public.app_config WHERE key = 'doc_limits_enabled';
  IF v_enabled IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT subscription_plan, doc_credits INTO v_plan, v_credits
  FROM public.organizations WHERE id = NEW.org_id;
  v_plan := COALESCE(v_plan, 'free');
  v_credits := COALESCE(v_credits, 0);

  -- Only the personal tiers are capped; contracted org plans are exempt.
  IF v_plan NOT IN ('free', 'basic', 'unlimited') THEN
    RETURN NEW;
  END IF;
  IF v_plan = 'unlimited' THEN
    RETURN NEW;
  END IF;

  -- Basic with credits: consume one and allow.
  IF v_plan = 'basic' AND v_credits > 0 THEN
    UPDATE public.organizations
    SET doc_credits = doc_credits - 1
    WHERE id = NEW.org_id;
    RETURN NEW;
  END IF;

  -- Free (or Basic out of credits): cap on the org's total documents.
  SELECT COALESCE((SELECT value::int FROM public.app_config WHERE key = 'free_doc_limit'), 1)
  INTO v_free_limit;
  SELECT count(*) INTO v_count FROM public.documents WHERE org_id = NEW.org_id;
  IF v_count >= v_free_limit THEN
    RAISE EXCEPTION 'doc_limit_reached'
      USING ERRCODE = 'check_violation', HINT = v_plan;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_document_limit ON public.documents;
CREATE TRIGGER enforce_document_limit
  BEFORE INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_document_limit();

-- 4. Retire the user_billing table (superseded by the org model). It was inert.
DROP TABLE IF EXISTS public.user_billing;
