import { z } from 'zod';
import { getServiceSupabase } from '../../lib/supabaseClient';
import { requireBearerUser } from '../../lib/auth';
import { rateLimitAuth } from '../../lib/rateLimit';
import { chatWithCo } from '../../lib/anthropic';
import { buildDocumentChatContext } from '../../lib/chatContext';

const bodySchema = z.object({
  message: z.string().min(1).max(8000),
  documentId: z.string().min(1),
  messages: z.array(z.any()).optional(),
  chatHistory: z.array(z.any()).optional(),
  language: z.string().optional(),
  // Focused-field context from the viewer's "Ask Cô about this field" button.
  // Without this key the viewer's context was silently stripped by safeParse
  // and the model never knew which field the user was asking about. The viewer
  // sends a pre-formatted string; an object form is accepted for future use.
  context: z.union([
    z.string().max(4000),
    z.object({
      fieldName: z.string().max(500).optional(),
      englishFieldName: z.string().max(500).optional(),
      explanation: z.string().max(2000).optional(),
      positionHint: z.string().max(2000).optional(),
    }).partial(),
  ]).optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const parseResult = bodySchema.safeParse(req.body || {});
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    const { message, documentId, messages, chatHistory, language, context: fieldContext } = parseResult.data;

    const supabase = getServiceSupabase();
    if (!supabase) {
      return res.status(500).json({ error: 'Supabase service role key not configured' });
    }

    const authResult = await requireBearerUser(req, supabase);
    if (authResult.error) {
      return res.status(authResult.status).json({ error: authResult.error });
    }

    if (await rateLimitAuth(req, res, 'chat', authResult.user.id)) {
      return;
    }

    // Authorize the document by ownership OR active org membership, matching
    // the viewer's visibility rules so org members can chat about shared
    // enterprise documents they didn't personally create.
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, user_id, created_by, org_id')
      .eq('id', documentId)
      .single();

    if (docError || !document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const userId = authResult.user.id;
    let authorized = document.user_id === userId || document.created_by === userId;
    if (!authorized && document.org_id) {
      const { data: membership } = await supabase
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', userId)
        .eq('org_id', document.org_id)
        .eq('status', 'active')
        .maybeSingle();
      authorized = !!membership;
    }
    if (!authorized) {
      return res.status(404).json({ error: 'Document not found' });
    }

    const history = Array.isArray(messages) && messages.length > 0
      ? messages
      : Array.isArray(chatHistory) && chatHistory.length > 0
        ? chatHistory
        : [];

    let context = [];
    try {
      context = await buildDocumentChatContext(supabase, documentId);
    } catch (err) {
      console.warn('[Chat] Context build failed:', err.message);
    }

    // Put the focused field FIRST so "Ask Cô about this field" actually asks
    // about that field, not just the whole document.
    if (typeof fieldContext === 'string' && fieldContext.trim()) {
      context = [`The user is asking about a specific field. Focused-field context:\n${fieldContext.trim()}`, ...context];
    } else if (fieldContext && typeof fieldContext === 'object' && (fieldContext.fieldName || fieldContext.englishFieldName)) {
      const parts = [
        `The user is asking specifically about this field: "${fieldContext.fieldName || fieldContext.englishFieldName}"`,
      ];
      if (fieldContext.englishFieldName && fieldContext.englishFieldName !== fieldContext.fieldName) {
        parts.push(`English field name: ${fieldContext.englishFieldName}`);
      }
      if (fieldContext.explanation) parts.push(`Field explanation: ${fieldContext.explanation}`);
      if (fieldContext.positionHint) parts.push(`Where it is on the form: ${fieldContext.positionHint}`);
      context = [parts.join('\n'), ...context];
    }

    const result = await chatWithCo(message, context, history, language || 'en');

    res.status(200).json({ response: result.message || '' });
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: 'Failed to get response' });
  }
}
