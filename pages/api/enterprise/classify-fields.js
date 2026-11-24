/**
 * POST /api/enterprise/classify-fields
 *
 * AI-assisted "enable-first" suggestion for setup: given a document's detected
 * fields, classify which ones the END RECIPIENT (the client the signing link
 * is sent to) is expected to personally fill — names, dates, signatures,
 * initials, addresses, party-specific info — versus fields filled by
 * staff/office/internal use or already pre-filled.
 *
 * Returns { recipientFillableIds: string[] }. The result is cached on
 * documents.phase1_data.recipientFillableIds (keyed by field count) so we
 * don't re-spend tokens on every setup visit. On any failure the caller falls
 * back to its local heuristic, so setup never depends on this succeeding.
 *
 * Auth: bearer user + active org membership (document scoped to the org).
 */
import { z } from 'zod';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../lib/auth';
import { requireServiceSupabase } from '../../../lib/supabaseClient';
import anthropic from '../../../lib/anthropic';

const bodySchema = z.object({ documentId: z.string().uuid() });

const MIN_FIELDS_TO_CLASSIFY = 26; // matches the modal's smart-default threshold

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    const parsed = bodySchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'invalid_request_body' });
    }
    const { documentId } = parsed.data;

    const supabase = requireServiceSupabase();
    const authResult = await requireBearerUser(req, supabase);
    if (authResult.error) {
      return res.status(authResult.status).json({ error: authResult.error });
    }
    const membership = await requireOrgMembership(authResult.user.id, supabase, requestedOrgId(req));
    if (membership.error) {
      return res.status(membership.status).json({ error: membership.error });
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, org_id, phase1_data, file_name')
      .eq('id', documentId)
      .eq('org_id', membership.orgId)
      .single();
    if (docError || !doc) {
      return res.status(404).json({ error: 'document_not_found' });
    }

    const { data: fields, error: fieldsError } = await supabase
      .from('fields')
      .select('id, field_name, field_type')
      .eq('document_id', documentId)
      .order('sort_order', { ascending: true });
    if (fieldsError || !Array.isArray(fields) || fields.length === 0) {
      return res.status(200).json({ recipientFillableIds: [], reason: 'no_fields' });
    }

    const allIds = fields.map((f) => String(f.id));

    // Small documents don't need curation — caller enables all anyway.
    if (fields.length < MIN_FIELDS_TO_CLASSIFY) {
      return res.status(200).json({ recipientFillableIds: allIds, reason: 'small_document' });
    }

    // Serve cached classification when it still matches the current field set.
    const cached = doc?.phase1_data?.recipientFillableIds;
    if (Array.isArray(cached) && cached.length > 0) {
      const valid = cached.map(String).filter((id) => allIds.includes(id));
      if (valid.length > 0) {
        return res.status(200).json({ recipientFillableIds: valid, reason: 'cached' });
      }
    }

    const documentType = doc?.phase1_data?.documentType || 'document';
    const numbered = fields
      .map((f, i) => `${i + 1}. [${f.field_type || 'text'}] ${String(f.field_name || '').slice(0, 120)}`)
      .join('\n');

    const prompt = `You are preparing a ${documentType} to send to a client for signing.
Below are the document's detected fields. Decide which fields the RECIPIENT (the client who receives the signing link) is expected to personally fill in or sign.

Include a field if it is something the recipient provides: their name, signature, initials, date, address, contact info, party-specific details, amounts they enter, checkboxes they select, etc.
EXCLUDE a field only if it is clearly NOT for the recipient: "for office use", staff/internal/examiner use, recorder/clerk sections, "reviewed/approved by", or values the office pre-fills.
When unsure, INCLUDE it (better to show an extra field than hide a needed one).

Return ONLY a JSON array of the field numbers to include, e.g. [1,2,5,6]. No prose.

Fields:
${numbered}`;

    let includeNumbers = null;
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = (response?.content?.[0]?.text || '').trim();
      const match = text.match(/\[[\s\S]*\]/);
      if (match) includeNumbers = JSON.parse(match[0]);
    } catch (aiErr) {
      console.warn('[classify-fields] AI classification failed:', aiErr.message);
      return res.status(200).json({ recipientFillableIds: allIds, reason: 'ai_failed' });
    }

    if (!Array.isArray(includeNumbers)) {
      return res.status(200).json({ recipientFillableIds: allIds, reason: 'unparseable' });
    }

    const recipientFillableIds = includeNumbers
      .map((n) => fields[Number(n) - 1])
      .filter(Boolean)
      .map((f) => String(f.id));

    // Guard: if the model returned almost nothing, fall back to all.
    if (recipientFillableIds.length < Math.max(2, Math.floor(allIds.length * 0.1))) {
      return res.status(200).json({ recipientFillableIds: allIds, reason: 'too_few' });
    }

    // Cache for subsequent setup visits.
    try {
      await supabase
        .from('documents')
        .update({ phase1_data: { ...(doc.phase1_data || {}), recipientFillableIds } })
        .eq('id', documentId);
    } catch (cacheErr) {
      console.warn('[classify-fields] cache write failed:', cacheErr.message);
    }

    return res.status(200).json({ recipientFillableIds, reason: 'classified' });
  } catch (err) {
    console.error('[classify-fields] error:', err);
    return res.status(500).json({ error: 'internal_error' });
  }
}
