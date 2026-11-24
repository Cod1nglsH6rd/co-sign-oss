-- Enterprise hardening and workflow transactional helpers

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure optional legacy columns exist in mixed environments.
ALTER TABLE public.fields ADD COLUMN IF NOT EXISTS explanation_es text;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS lifecycle_status text DEFAULT 'uploaded';

-- Ensure we can safely normalize legacy status values first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'documents'
      AND c.conname = 'documents_status_check'
  ) THEN
    ALTER TABLE public.documents DROP CONSTRAINT documents_status_check;
  END IF;
END $$;

-- Normalize legacy status values so any subsequent updates stop tripping the
-- documents_status_check constraint in mixed environments.
UPDATE public.documents
SET status = CASE
    WHEN status IN ('setup_required', 'ready_to_send', 'sent', 'opened') THEN 'ready'
    WHEN status IN ('prepping', 'finalizing') THEN 'processing'
    WHEN status = 'done' THEN 'completed'
    WHEN status IS NULL THEN NULL
    WHEN status IN ('uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error') THEN status
    ELSE 'uploaded'
  END
WHERE status IS NOT NULL
  AND status NOT IN ('uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error');

-- Ensure status check allows the normalized compatibility set.
ALTER TABLE public.documents
  ADD CONSTRAINT documents_status_check
  CHECK (
    status IS NULL
    OR status IN ('uploaded', 'processing', 'in_progress', 'ready', 'completed', 'error')
  );

-- Backfill split status columns for legacy rows.
UPDATE public.documents
SET processing_status = CASE
    WHEN status = 'processing' THEN 'prepping'
    WHEN COALESCE(metadata->>'post_setup', 'false') = 'true' THEN 'finalizing'
    WHEN status = 'error' THEN 'error'
    ELSE COALESCE(processing_status, 'idle')
  END,
  lifecycle_status = CASE
    WHEN status = 'completed' THEN 'completed'
    WHEN status = 'ready' AND COALESCE((phase1_data->>'setupCompleted')::boolean, false) = false THEN 'setup_required'
    WHEN status = 'ready' AND COALESCE((phase1_data->>'setupCompleted')::boolean, false) = true THEN 'ready_to_send'
    ELSE COALESCE(lifecycle_status, 'uploaded')
  END
WHERE processing_status IS NULL
   OR lifecycle_status IS NULL
   OR (status = 'processing' AND processing_status <> 'prepping')
   OR (status = 'completed' AND lifecycle_status <> 'completed')
   OR (status = 'ready');

CREATE INDEX IF NOT EXISTS idx_documents_processing_status ON public.documents(processing_status);
CREATE INDEX IF NOT EXISTS idx_documents_lifecycle_status ON public.documents(lifecycle_status);

-- Enforce split-status value domains.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'documents'
      AND c.conname = 'documents_processing_status_check'
  ) THEN
    ALTER TABLE public.documents DROP CONSTRAINT documents_processing_status_check;
  END IF;
END $$;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_processing_status_check
  CHECK (
    processing_status IS NULL
    OR processing_status IN ('idle', 'prepping', 'finalizing', 'error')
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'documents'
      AND c.conname = 'documents_lifecycle_status_check'
  ) THEN
    ALTER TABLE public.documents DROP CONSTRAINT documents_lifecycle_status_check;
  END IF;
END $$;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_lifecycle_status_check
  CHECK (
    lifecycle_status IS NULL
    OR lifecycle_status IN ('uploaded', 'setup_required', 'ready_to_send', 'sent', 'opened', 'completed')
  );

-- Backfill token hashes for legacy plaintext-token sessions.
UPDATE public.fill_sessions
SET token_hash = encode(digest(token, 'sha256'), 'hex')
WHERE (token_hash IS NULL OR token_hash = '')
  AND token IS NOT NULL
  AND token <> '';

CREATE OR REPLACE FUNCTION public.enterprise_finalize_setup_tx(
  p_document_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_preferred_language text,
  p_phase1_patch jsonb DEFAULT '{}'::jsonb,
  p_updated_fields jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc public.documents%ROWTYPE;
  v_item jsonb;
  v_field_id bigint;
  v_custom_count integer := 0;
  v_updated_count integer := 0;
  v_sort_order bigint;
  v_position jsonb;
BEGIN
  SELECT * INTO v_doc
  FROM public.documents
  WHERE id = p_document_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found';
  END IF;

  IF p_updated_fields IS NULL THEN
    p_updated_fields := '[]'::jsonb;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_updated_fields)
  LOOP
    v_position := CASE
      WHEN jsonb_typeof(v_item->'position') = 'object' THEN v_item->'position'
      ELSE NULL
    END;

    IF COALESCE(v_item->>'id', '') LIKE 'custom-%' THEN
      SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort_order
      FROM public.fields
      WHERE document_id = p_document_id;

      INSERT INTO public.fields (
        document_id,
        field_name,
        field_type,
        position,
        position_hint,
        sort_order
      ) VALUES (
        p_document_id,
        COALESCE(NULLIF(v_item->>'field_name', ''), 'Untitled Field'),
        COALESCE(NULLIF(v_item->>'field_type', ''), 'text'),
        v_position,
        NULLIF(v_item->>'position_hint', ''),
        v_sort_order
      );

      v_custom_count := v_custom_count + 1;
    ELSE
      v_field_id := NULLIF(v_item->>'id', '')::bigint;
      IF v_field_id IS NULL THEN
        CONTINUE;
      END IF;

      UPDATE public.fields
      SET
        position = COALESCE(v_position, position)
      WHERE id = v_field_id
        AND document_id = p_document_id;

      IF FOUND THEN
        v_updated_count := v_updated_count + 1;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.documents
  SET
    preferred_language = COALESCE(NULLIF(p_preferred_language, ''), preferred_language, 'en'),
    processing_status = 'finalizing',
    lifecycle_status = 'ready_to_send',
    phase1_data = COALESCE(phase1_data, '{}'::jsonb)
      || COALESCE(p_phase1_patch, '{}'::jsonb)
      || jsonb_build_object('setupCompleted', true),
    updated_at = now()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'documentId', p_document_id,
    'updatedCount', v_updated_count,
    'customCount', v_custom_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.enterprise_finalize_setup_tx(uuid, uuid, uuid, text, jsonb, jsonb) TO authenticated, service_role;

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
  v_template public.documents%ROWTYPE;
  v_new_document_id uuid;
BEGIN
  SELECT * INTO v_template
  FROM public.documents
  WHERE id = p_template_id
    AND org_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found';
  END IF;

  IF COALESCE((v_template.phase1_data->>'setupCompleted')::boolean, false) = false THEN
    RAISE EXCEPTION 'template_not_ready';
  END IF;

  INSERT INTO public.documents (
    org_id,
    user_id,
    created_by,
    file_name,
    file_path,
    file_url,
    file_size,
    file_type,
    status,
    processing_status,
    lifecycle_status,
    preferred_language,
    page_count,
    has_rect,
    metadata,
    phase1_data,
    is_multi_party,
    document_type
  ) VALUES (
    p_org_id,
    p_user_id,
    p_user_id,
    p_new_file_name,
    p_new_file_path,
    p_new_file_url,
    v_template.file_size,
    v_template.file_type,
    'uploaded',
    'idle',
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
    translation,
    vietnamese_translation,
    spanish_translation,
    explanation,
    explanation_en,
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
    f.translation,
    f.vietnamese_translation,
    f.spanish_translation,
    f.explanation,
    f.explanation_en,
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
