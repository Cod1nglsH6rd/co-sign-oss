import { z } from 'zod';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../../lib/auth';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';

const fieldSchema = z.object({
  id: z.union([z.string(), z.number()]),
  field_name: z.string().optional(),
  field_type: z.string().optional(),
  position_hint: z.string().optional(),
  sort_order: z.number().optional(),
  position: z.record(z.any()).nullable().optional(),
});

const bodySchema = z.object({
  documentId: z.string().uuid(),
  preferredLanguage: z.string().trim().min(2).max(8).optional().default('en'),
  updatedFields: z.array(fieldSchema).optional().default([]),
  phase1Patch: z.record(z.any()).optional().default({}),
});

function sanitizePhase1Patch(input) {
  if (!input || typeof input !== 'object') return {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(input, 'role')) {
    patch.role = input.role || null;
  }

  if (Array.isArray(input.includedFieldIds)) {
    patch.includedFieldIds = input.includedFieldIds.map((id) => String(id));
  }

  if (Array.isArray(input.parties)) {
    patch.parties = input.parties;
  }

  if (Array.isArray(input.detectedRoles)) {
    patch.detectedRoles = input.detectedRoles;
  }

  if (typeof input.documentType === 'string') {
    patch.documentType = input.documentType;
  }

  if (Object.prototype.hasOwnProperty.call(input, 'isMultiParty')) {
    patch.isMultiParty = Boolean(input.isMultiParty);
  }

  return patch;
}

function sanitizeFields(fields) {
  return (fields || []).map((field) => ({
    id: typeof field.id === 'number' ? String(field.id) : field.id,
    field_name: field.field_name || null,
    field_type: field.field_type || null,
    position_hint: field.position_hint || null,
    sort_order: Number.isFinite(field.sort_order) ? Number(field.sort_order) : null,
    position: field.position && typeof field.position === 'object' ? field.position : null,
  }));
}

function normalizeFieldId(rawId) {
  if (rawId === null || rawId === undefined) return null;
  const trimmed = String(rawId).trim();
  if (!trimmed) return null;
  return trimmed;
}

function isBigintCompatibleId(rawId) {
  const id = normalizeFieldId(rawId);
  return !!id && /^\d+$/.test(id);
}

function buildFieldLookup(existingFields = []) {
  const byId = new Map();
  const byNumericId = new Map();
  const bySortOrder = new Map();

  for (const row of existingFields) {
    const idKey = normalizeFieldId(row?.id);
    if (idKey) {
      byId.set(idKey, row);
      if (/^\d+$/.test(idKey)) byNumericId.set(Number.parseInt(idKey, 10), row);
    }
    if (Number.isFinite(row?.sort_order)) {
      bySortOrder.set(Number(row.sort_order), row);
    }
  }

  return { byId, byNumericId, bySortOrder };
}

function resolvePersistedField({
  field,
  lookup,
}) {
  const idKey = normalizeFieldId(field?.id);
  if (idKey && lookup.byId.has(idKey)) return lookup.byId.get(idKey);

  if (idKey && /^\d+$/.test(idKey)) {
    const numericMatch = lookup.byNumericId.get(Number.parseInt(idKey, 10));
    if (numericMatch) return numericMatch;
  }

  if (Number.isFinite(field?.sort_order)) {
    const sortMatch = lookup.bySortOrder.get(Number(field.sort_order));
    if (sortMatch) return sortMatch;
  }

  return null;
}

function buildPhase1Data(existingPhase1Data = {}, phase1Patch = {}) {
  return {
    ...(existingPhase1Data || {}),
    ...(phase1Patch || {}),
    setupCompleted: true,
  };
}

function isMissingColumnError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find the')
  );
}

async function updateDocumentAfterSetup({
  supabase,
  documentId,
  preferredLanguage = 'en',
  phase1Data = {},
}) {
  const basePayload = {
    preferred_language: preferredLanguage || 'en',
    phase1_data: phase1Data,
    updated_at: new Date().toISOString(),
  };

  const attempts = [
    {
      ...basePayload,
      processing_status: 'finalizing',
      lifecycle_status: 'ready_to_send',
      status: 'ready',
    },
    {
      ...basePayload,
      status: 'ready',
    },
    basePayload,
  ];

  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const payload = attempts[attemptIndex];
    const { error } = await supabase
      .from('documents')
      .update(payload)
      .eq('id', documentId);

    if (!error) {
      return { attempt: attemptIndex + 1 };
    }

    lastError = error;
    console.warn('[Enterprise Setup Save] Document update attempt failed', {
      documentId,
      attempt: attemptIndex + 1,
      message: error.message,
    });

    // Missing-column errors are expected on partially migrated DBs, keep falling back.
    if (!isMissingColumnError(error) && attemptIndex === attempts.length - 1) {
      break;
    }
  }

  throw lastError || new Error('Failed to update document');
}

async function runLegacyFinalizeSetup({
  supabase,
  documentId,
  preferredLanguage = 'en',
  phase1Patch = {},
  updatedFields = [],
  existingPhase1Data = {},
  lookup,
}) {
  let updatedPersistedCount = 0;
  let skippedPersistedCount = 0;
  let customCount = 0;

  const customFields = [];
  const positionedFields = [];

  for (const field of updatedFields || []) {
    if (String(field.id || '').startsWith('custom-')) customFields.push(field);
    else positionedFields.push(field);
  }

  for (const field of positionedFields) {
    const matched = resolvePersistedField({ field, lookup });
    if (!matched) {
      skippedPersistedCount += 1;
      console.warn('[Enterprise Setup Save] Legacy update skipped unresolved field', {
        documentId,
        incomingId: normalizeFieldId(field.id),
        sortOrder: field.sort_order ?? null,
      });
      continue;
    }

    const fieldId = matched.id;

    const { error } = await supabase
      .from('fields')
      .update({
        position: field.position && typeof field.position === 'object' ? field.position : null,
        field_name: field.field_name || undefined,
        field_type: field.field_type || undefined,
        position_hint: field.position_hint || undefined,
      })
      .eq('id', fieldId)
      .eq('document_id', documentId);

    if (error) {
      console.error('[Enterprise Setup Save] Legacy field update failed', {
        documentId,
        fieldId: String(fieldId),
        message: error.message,
      });
      throw error;
    }
    updatedPersistedCount += 1;
  }

  if (customFields.length > 0) {
    const { data: maxSortRow } = await supabase
      .from('fields')
      .select('sort_order')
      .eq('document_id', documentId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextSortOrder = Number.isFinite(maxSortRow?.sort_order) ? Number(maxSortRow.sort_order) + 1 : 1;
    const inserts = customFields.map((field) => {
      const row = {
        document_id: documentId,
        field_name: field.field_name || 'Untitled Field',
        field_type: field.field_type || 'text',
        position_hint: field.position_hint || null,
        position: field.position && typeof field.position === 'object' ? field.position : null,
        sort_order: nextSortOrder,
      };
      nextSortOrder += 1;
      return row;
    });

    const { error: insertError } = await supabase.from('fields').insert(inserts);
    if (insertError) throw insertError;
    customCount = inserts.length;
  }

  await updateDocumentAfterSetup({
    supabase,
    documentId,
    preferredLanguage,
    phase1Data: buildPhase1Data(existingPhase1Data, phase1Patch),
  });

  return {
    documentId,
    updatedPersistedCount,
    skippedPersistedCount,
    customCount,
    fallback: true,
  };
}

async function syncFieldLabels({
  supabase,
  documentId,
  updatedFields = [],
  lookup,
}) {
  let syncedCount = 0;
  let skippedCount = 0;

  const existingFieldUpdates = (updatedFields || []).filter((field) => {
    if (!field?.id) return false;
    if (String(field.id).startsWith('custom-')) return false;
    return true;
  });

  for (const field of existingFieldUpdates) {
    const matched = resolvePersistedField({ field, lookup });
    if (!matched) {
      skippedCount += 1;
      console.warn('[Enterprise Setup Save] Field label sync skipped unresolved field', {
        documentId,
        incomingId: normalizeFieldId(field.id),
        sortOrder: field.sort_order ?? null,
      });
      continue;
    }

    const fieldId = matched.id;

    const updatePayload = {};
    if (field.field_name) updatePayload.field_name = field.field_name;
    if (field.field_type) updatePayload.field_type = field.field_type;
    if (field.position_hint) updatePayload.position_hint = field.position_hint;
    if (field.position && typeof field.position === 'object') updatePayload.position = field.position;

    if (Object.keys(updatePayload).length === 0) continue;

    const { error } = await supabase
      .from('fields')
      .update(updatePayload)
      .eq('id', fieldId)
      .eq('document_id', documentId);

    if (error) {
      skippedCount += 1;
      console.warn('[Enterprise Setup Save] Field label sync warning', {
        documentId,
        fieldId: String(fieldId),
        message: error.message,
      });
      continue;
    }

    syncedCount += 1;
  }

  return { syncedCount, skippedCount };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'method_not_allowed',
      errorCode: 'method_not_allowed',
      message: 'Method not allowed',
    });
  }

  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'invalid_request_body',
        errorCode: 'invalid_request_body',
        message: 'Invalid request body',
      });
    }

    const { documentId, updatedFields, phase1Patch } = parsed.data;
    const preferredLanguage = 'en';

    const supabase = requireServiceSupabase();
    const authResult = await requireBearerUser(req, supabase);
    if (authResult.error) {
      return res.status(authResult.status).json({
        error: authResult.error,
        errorCode: authResult.error,
        message: 'Authentication required',
      });
    }

    const membershipResult = await requireOrgMembership(authResult.user.id, supabase, requestedOrgId(req));
    if (membershipResult.error) {
      return res.status(membershipResult.status).json({
        error: membershipResult.error,
        errorCode: membershipResult.error,
        message: 'Organization membership required',
      });
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, org_id, phase1_data')
      .eq('id', documentId)
      .eq('org_id', membershipResult.orgId)
      .single();

    if (docError || !doc) {
      return res.status(404).json({
        error: 'document_not_found',
        errorCode: 'document_not_found',
        message: 'Document not found',
      });
    }

    const sanitizedPhase1Patch = sanitizePhase1Patch(phase1Patch);
    const sanitizedFields = sanitizeFields(updatedFields);
    const persistedFieldIds = sanitizedFields
      .filter((field) => field && !String(field.id || '').startsWith('custom-'))
      .map((field) => normalizeFieldId(field.id))
      .filter(Boolean);

    const { data: existingFields, error: existingFieldsError } = await supabase
      .from('fields')
      .select('id, sort_order')
      .eq('document_id', documentId);

    if (existingFieldsError) {
      console.error('[Enterprise Setup Save] Could not load existing fields:', existingFieldsError);
      return res.status(500).json({
        error: 'setup_save_failed',
        errorCode: 'setup_save_failed',
        message: 'Failed to save setup',
      });
    }

    const lookup = buildFieldLookup(existingFields || []);
    const rpcEligible = persistedFieldIds.every((id) => isBigintCompatibleId(id));

    let saveResult = null;
    let usedRpc = false;
    if (!rpcEligible) {
      console.info('[Enterprise Setup Save] RPC skipped due non-bigint field IDs', {
        documentId,
        sampleIds: persistedFieldIds.slice(0, 5),
        totalPersistedIds: persistedFieldIds.length,
      });
    } else {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('enterprise_finalize_setup_tx', {
        p_document_id: documentId,
        p_org_id: membershipResult.orgId,
        p_user_id: authResult.user.id,
        p_preferred_language: preferredLanguage || 'en',
        p_phase1_patch: sanitizedPhase1Patch,
        p_updated_fields: sanitizedFields,
      });

      if (!rpcError) {
        usedRpc = true;
        saveResult = rpcResult || null;
      } else {
        console.error('[Enterprise Setup Save] RPC error, falling back to legacy save:', rpcError);
      }
    }

    if (!usedRpc) {
      try {
        saveResult = await runLegacyFinalizeSetup({
          supabase,
          documentId,
          preferredLanguage,
          phase1Patch: sanitizedPhase1Patch,
          updatedFields: sanitizedFields,
          existingPhase1Data: doc?.phase1_data || {},
          lookup,
        });
      } catch (fallbackError) {
        console.error('[Enterprise Setup Save] Legacy fallback error:', fallbackError);
        return res.status(500).json({
          error: 'setup_save_failed',
          errorCode: 'setup_save_failed',
          message: 'Failed to save setup',
        });
      }
    }

    const labelSync = await syncFieldLabels({
      supabase,
      documentId,
      updatedFields: sanitizedFields,
      lookup,
    });

    console.info('[Enterprise Setup Save] Save complete', {
      documentId,
      usedRpc,
      fallbackUsed: !usedRpc,
      updatedPersistedCount: saveResult?.updatedPersistedCount ?? saveResult?.updatedCount ?? null,
      skippedPersistedCount: saveResult?.skippedPersistedCount ?? null,
      customCount: saveResult?.customCount ?? null,
      labelSynced: labelSync?.syncedCount ?? 0,
      labelSkipped: labelSync?.skippedCount ?? 0,
    });

    return res.status(200).json({
      success: true,
      documentId,
      result: saveResult,
    });
  } catch (err) {
    console.error('[Enterprise Setup Save] Unexpected error:', err);
    return res.status(500).json({
      error: 'internal_error',
      errorCode: 'internal_error',
      message: 'Internal server error',
    });
  }
}
