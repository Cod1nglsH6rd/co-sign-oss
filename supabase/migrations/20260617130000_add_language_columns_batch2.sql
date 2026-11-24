-- Add per-language translation columns for the second batch of supported
-- languages: Portuguese (pt), Simplified Chinese/Mandarin (zh), Cantonese (yue),
-- Haitian Creole (ht), Burmese (my), Nepali (ne), French (fr).
--
-- Convention (see lib/fieldTranslations.js): for each language <code> there are
-- three columns on `fields`: field_name_<code>, explanation_<code>,
-- position_hint_<code>. The bare columns remain English.

BEGIN;

-- Portuguese
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_pt text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_pt text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_pt text;

-- Simplified Chinese (Mandarin)
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_zh text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_zh text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_zh text;

-- Cantonese (Traditional Chinese)
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_yue text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_yue text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_yue text;

-- Haitian Creole
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_ht text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_ht text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_ht text;

-- Burmese
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_my text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_my text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_my text;

-- Nepali
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_ne text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_ne text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_ne text;

-- French
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS field_name_fr text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_fr text;
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS position_hint_fr text;

-- Rebuild enterprise_duplicate_template_tx so template duplication copies every
-- translation column (the previous version only copied vi/es).
-- NOTE: the signature here mirrors the LIVE function (p_org_id before p_user_id,
-- and p_new_file_path / p_new_file_url) — the repo's earlier 20260417 migration
-- had drifted from production, and the API calls this RPC by these exact param
-- names (see pages/api/enterprise/templates/duplicate.js).
-- DROP first because an earlier migration may have created the function with
-- different parameter NAMES, which CREATE OR REPLACE cannot change.
DROP FUNCTION IF EXISTS public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.enterprise_duplicate_template_tx(
  p_template_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_new_file_name text,
  p_new_file_path text,
  p_new_file_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template RECORD;
  v_new_document_id uuid;
BEGIN
  SELECT * INTO v_template
  FROM public.documents
  WHERE id = p_template_id
    AND org_id = p_org_id
    AND is_template = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found or not accessible';
  END IF;

  INSERT INTO public.documents (
    user_id,
    org_id,
    file_name,
    storage_path,
    document_url,
    status,
    lifecycle_status,
    preferred_language,
    page_count,
    has_rect,
    metadata,
    phase1_data,
    is_multi_party,
    document_type
  )
  VALUES (
    p_user_id,
    p_org_id,
    p_new_file_name,
    p_new_file_path,
    p_new_file_url,
    'draft',
    'setup_required',
    v_template.preferred_language,
    v_template.page_count,
    v_template.has_rect,
    COALESCE(v_template.metadata, '{}'::jsonb),
    COALESCE(v_template.phase1_data, '{}'::jsonb) || jsonb_build_object('setupCompleted', false),
    v_template.is_multi_party,
    v_template.document_type
  )
  RETURNING id INTO v_new_document_id;

  INSERT INTO public.fields (
    document_id,
    field_name,
    field_type,
    field_name_vi,
    field_name_es,
    field_name_pt,
    field_name_zh,
    field_name_yue,
    field_name_ht,
    field_name_my,
    field_name_ne,
    field_name_fr,
    explanation,
    explanation_vi,
    explanation_es,
    explanation_pt,
    explanation_zh,
    explanation_yue,
    explanation_ht,
    explanation_my,
    explanation_ne,
    explanation_fr,
    position_hint,
    position_hint_vi,
    position_hint_es,
    position_hint_pt,
    position_hint_zh,
    position_hint_yue,
    position_hint_ht,
    position_hint_my,
    position_hint_ne,
    position_hint_fr,
    position,
    sort_order,
    field_value
  )
  SELECT
    v_new_document_id,
    f.field_name,
    f.field_type,
    f.field_name_vi,
    f.field_name_es,
    f.field_name_pt,
    f.field_name_zh,
    f.field_name_yue,
    f.field_name_ht,
    f.field_name_my,
    f.field_name_ne,
    f.field_name_fr,
    f.explanation,
    f.explanation_vi,
    f.explanation_es,
    f.explanation_pt,
    f.explanation_zh,
    f.explanation_yue,
    f.explanation_ht,
    f.explanation_my,
    f.explanation_ne,
    f.explanation_fr,
    f.position_hint,
    f.position_hint_vi,
    f.position_hint_es,
    f.position_hint_pt,
    f.position_hint_zh,
    f.position_hint_yue,
    f.position_hint_ht,
    f.position_hint_my,
    f.position_hint_ne,
    f.position_hint_fr,
    f.position,
    f.sort_order,
    f.field_value
  FROM public.fields f
  WHERE f.document_id = p_template_id
  ORDER BY f.sort_order ASC;

  RETURN jsonb_build_object(
    'documentId', v_new_document_id,
    'fileName', p_new_file_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) TO authenticated, service_role;

COMMIT;
