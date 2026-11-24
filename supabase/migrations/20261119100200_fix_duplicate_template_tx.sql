-- Rebuild enterprise_duplicate_template_tx on today's columns. The version from
-- 20260617140000 filtered on documents.is_template and inserted storage_path,
-- document_url and status 'draft': those columns do not exist and
-- documents_status_check does not allow 'draft', so every duplication failed.
-- Parameters are the ones pages/api/enterprise/templates/duplicate.js passes.

BEGIN;

DROP FUNCTION IF EXISTS public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text);

CREATE FUNCTION public.enterprise_duplicate_template_tx(
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
  v_template public.documents%ROWTYPE;
  v_new_document_id uuid;
BEGIN
  SELECT * INTO v_template
  FROM public.documents
  WHERE id = p_template_id
    AND org_id = p_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  IF COALESCE((v_template.phase1_data->>'setupCompleted')::boolean, false) = false THEN
    RAISE EXCEPTION 'template_not_ready';
  END IF;

  INSERT INTO public.documents (
    org_id, user_id, created_by, file_name, file_path, file_url, file_size, file_type,
    status, processing_status, lifecycle_status, preferred_language, page_count,
    has_rect, metadata, phase1_data, is_multi_party, document_type
  )
  VALUES (
    p_org_id, p_user_id::text, p_user_id, p_new_file_name, p_new_file_path, p_new_file_url,
    v_template.file_size, v_template.file_type,
    'uploaded', 'idle', 'setup_required', v_template.preferred_language, v_template.page_count,
    v_template.has_rect, COALESCE(v_template.metadata, '{}'::jsonb),
    COALESCE(v_template.phase1_data, '{}'::jsonb) || jsonb_build_object('setupCompleted', false),
    v_template.is_multi_party, v_template.document_type
  )
  RETURNING id INTO v_new_document_id;

  INSERT INTO public.fields (
    document_id, field_name, field_type,
    field_name_vi, field_name_es, field_name_pt, field_name_zh, field_name_yue,
    field_name_ht, field_name_ne, field_name_fr,
    explanation, explanation_vi, explanation_es, explanation_pt, explanation_zh,
    explanation_yue, explanation_ht, explanation_ne, explanation_fr,
    position_hint, position_hint_vi, position_hint_es, position_hint_pt,
    position_hint_zh, position_hint_yue, position_hint_ht, position_hint_ne,
    position_hint_fr,
    position, sort_order, field_value
  )
  SELECT
    v_new_document_id, f.field_name, f.field_type,
    f.field_name_vi, f.field_name_es, f.field_name_pt, f.field_name_zh, f.field_name_yue,
    f.field_name_ht, f.field_name_ne, f.field_name_fr,
    f.explanation, f.explanation_vi, f.explanation_es, f.explanation_pt, f.explanation_zh,
    f.explanation_yue, f.explanation_ht, f.explanation_ne, f.explanation_fr,
    f.position_hint, f.position_hint_vi, f.position_hint_es, f.position_hint_pt,
    f.position_hint_zh, f.position_hint_yue, f.position_hint_ht, f.position_hint_ne,
    f.position_hint_fr,
    f.position, f.sort_order, f.field_value
  FROM public.fields f
  WHERE f.document_id = p_template_id
  ORDER BY f.sort_order ASC;

  RETURN jsonb_build_object('documentId', v_new_document_id, 'fileName', p_new_file_name);
END;
$$;

-- A new function is executable by PUBLIC by default; only the service role
-- (every caller is a server-side API route) keeps EXECUTE.
REVOKE EXECUTE ON FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enterprise_duplicate_template_tx(uuid, uuid, uuid, text, text, text) TO service_role;

COMMIT;
