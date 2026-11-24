/**
 * Re-process Positions API
 * Re-runs text-layer extraction on an existing document's fields
 * to update positions from ai-estimated to text-layer precise coordinates.
 *
 * POST /api/reprocess-positions
 * Body: { documentId }
 * Returns: { success, updatedCount }
 */

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../lib/auth';
import { rateLimitAuth } from '../../lib/rateLimit';
import { refineFieldPositions } from '../../lib/pdfTextExtraction.js';
import {
  downloadDocumentBinary,
  DocumentSourceNotAllowedError,
  DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
} from '../../lib/documentFetch.js';
import { serverSupabaseUrl, serviceKey } from '../../lib/supabaseEnv.js';
import { assertDocumentPathOwned } from '../../lib/storagePaths.js';

function getSupabase() {
  const url = serverSupabaseUrl();
  const key = serviceKey();
  if (!url || !key) throw new Error('Supabase credentials not configured');
  return createClient(url, key);
}

const bodySchema = z.object({
  documentId: z.string().min(1),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const parseResult = bodySchema.safeParse(req.body || {});
  if (!parseResult.success) {
    return res.status(400).json({ error: 'documentId is required' });
  }

  const { documentId } = parseResult.data;

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: 'Supabase credentials not configured' });
  }

  const authResult = await requireBearerUser(req, supabase);
  if (authResult.error) {
    return res.status(authResult.status).json({ error: authResult.error });
  }

  if (await rateLimitAuth(req, res, 'reprocess-positions', authResult.user.id)) {
    return;
  }

  const membership = await requireOrgMembership(authResult.user.id, supabase, requestedOrgId(req));
  if (membership.error) {
    return res.status(membership.status).json({ error: membership.error });
  }

  try {
    // 1. Fetch document
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('org_id', membership.orgId)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 2. Only works for PDFs
    const fileType = doc.file_type?.toLowerCase() || '';
    const isPdf = fileType === 'pdf' || doc.file_name?.toLowerCase().endsWith('.pdf');
    if (!isPdf) {
      return res.status(400).json({ error: 'Text-layer extraction only works for PDFs' });
    }

    // 3. Download the PDF (only from the document owner's folder)
    assertDocumentPathOwned(doc);
    const sourceBinary = await downloadDocumentBinary({
      supabase,
      filePath: doc.file_path,
      fileUrl: doc.file_url,
      bucket: 'documents',
    });
    const fileBuffer = sourceBinary.buffer;

    // 4. Get existing fields
    const { data: fields, error: fieldsError } = await supabase
      .from('fields')
      .select('*')
      .eq('document_id', documentId)
      .order('sort_order');

    if (fieldsError) throw fieldsError;
    if (!fields || fields.length === 0) {
      return res.status(400).json({ error: 'No fields found for this document' });
    }

    // 5. Run text-layer extraction
    const refined = await refineFieldPositions(fileBuffer, fields);

    // 6. Update positions in database
    let updatedCount = 0;
    for (const field of refined) {
      if (field.position && field.position.source === 'text-layer') {
        const { error: updateError } = await supabase
          .from('fields')
          .update({ position: field.position })
          .eq('id', field.id);

        if (!updateError) updatedCount++;
      }
    }

    console.log(`Re-processed ${updatedCount}/${fields.length} field positions for doc ${documentId}`);

    return res.status(200).json({
      success: true,
      updatedCount,
      totalFields: fields.length,
      fields: refined.map(f => ({
        field_name: f.field_name,
        position: f.position,
      })),
    });
  } catch (error) {
    if (error instanceof DocumentSourceNotAllowedError) {
      // The reason and details are for the server log; the caller gets a
      // fixed message.
      console.warn('[ReprocessPositions] Document source not allowed', { documentId, reason: error.message, details: error.details });
      return res.status(422).json({
        error: error.errorCode,
        errorCode: error.errorCode,
        message: DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
      });
    }
    console.error('Reprocess error:', error);
    return res.status(500).json({
      error: 'Position reprocessing failed',
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
  maxDuration: 60,
};
