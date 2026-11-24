-- Cleanup legacy translation columns on `fields`.
-- Moves VI explanation data to explanation_vi, normalizes explanation → English,
-- drops the four legacy columns, and rebuilds enterprise_duplicate_template_tx.

BEGIN;

-- 1) For VI documents, preserve VI explanation text into explanation_vi.
UPDATE fields f
SET explanation_vi = f.explanation
FROM documents d
WHERE f.document_id = d.id
  AND d.preferred_language = 'vi'
  AND (f.explanation_vi IS NULL OR f.explanation_vi = '')
  AND f.explanation IS NOT NULL
  AND f.explanation <> '';

-- 2) For VI documents, set canonical English explanation from legacy explanation_en.
UPDATE fields f
SET explanation = COALESCE(NULLIF(f.explanation_en, ''), f.explanation)
FROM documents d
WHERE f.document_id = d.id
  AND d.preferred_language = 'vi';

-- 3) For EN documents where explanation differs from explanation_en (80 rows),
--    trust explanation_en as canonical English text.
UPDATE fields f
SET explanation = f.explanation_en
FROM documents d
WHERE f.document_id = d.id
  AND d.preferred_language = 'en'
  AND f.explanation IS DISTINCT FROM f.explanation_en
  AND f.explanation_en IS NOT NULL
  AND f.explanation_en <> '';

-- 4) Rebuild enterprise_duplicate_template_tx to use new columns.
-- Dropped first: the version from 20260322000100 names its parameters in
-- another order, and CREATE OR REPLACE cannot rename a parameter.
DROP FUNCTION IF EXISTS public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.enterprise_duplicate_template_tx(
  p_template_id uuid,
  p_user_id uuid,
  p_org_id uuid,
  p_new_file_name text,
  p_new_storage_path text,
  p_new_document_url text
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
    p_new_storage_path,
    p_new_document_url,
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
    explanation,
    explanation_vi,
    explanation_es,
    position_hint,
    position_hint_vi,
    position_hint_es,
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
    f.explanation,
    f.explanation_vi,
    f.explanation_es,
    f.position_hint,
    f.position_hint_vi,
    f.position_hint_es,
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

-- 5) Drop legacy columns.
ALTER TABLE public.fields DROP COLUMN IF EXISTS vietnamese_translation;
ALTER TABLE public.fields DROP COLUMN IF EXISTS spanish_translation;
ALTER TABLE public.fields DROP COLUMN IF EXISTS explanation_en;
ALTER TABLE public.fields DROP COLUMN IF EXISTS translation;

COMMIT;
