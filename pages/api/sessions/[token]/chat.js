import { z } from 'zod';
import { validateSessionToken, isSessionVerified } from '../../../../lib/sessionAuth.js';
import { rateLimitPublic, consumeDailyQuota } from '../../../../lib/rateLimit';
import { chatWithCo } from '../../../../lib/anthropic';
import { buildDocumentChatContext } from '../../../../lib/chatContext';
import { enforceEmbedOriginForSession } from '../../../../lib/embedOrigin.js';
import { requireServiceSupabase } from '../../../../lib/supabaseClient';
import {
  sendInvalidRequest,
  sendMethodNotAllowed,
  sendSessionError,
  sendTokenError,
} from '../../../../lib/sessionApiErrors.js';

// Anyone holding a signing link can call this route without an account, and
// every call is paid for by the owner's AI key, so every input is bounded.
const MAX_HISTORY_ITEMS = 20;
const MAX_HISTORY_ITEM_CHARS = 2000;
const MAX_HISTORY_TOTAL_CHARS = 24000;
const MAX_CHAT_MESSAGES_PER_SESSION_PER_DAY = 200;

// The largest valid body is a message (8,000 characters) plus a history
// (24,000 characters), up to 3 bytes each in UTF-8, plus JSON overhead:
// about 100 KB. Next.js answers a larger body with 413 before the handler runs;
// the handler also refuses a declared Content-Length over the same limit.
const BODY_SIZE_LIMIT_BYTES = 128 * 1024;
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '128kb',
    },
  },
};

const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(MAX_HISTORY_ITEM_CHARS),
});
const historySchema = z
  .array(historyItemSchema)
  .max(MAX_HISTORY_ITEMS)
  .refine(
    (items) => items.reduce((sum, item) => sum + item.content.length, 0) <= MAX_HISTORY_TOTAL_CHARS,
    { message: `History is over ${MAX_HISTORY_TOTAL_CHARS} characters in total` }
  );

const querySchema = z.object({ token: z.string().min(1) });
const bodySchema = z.object({
  message: z.string().min(1).max(8000),
  messages: historySchema.optional(),
  chatHistory: historySchema.optional(),
  // Accepted so older clients are not refused, but never used: the server
  // builds the document context itself (see buildDocumentChatContext).
  context: z.string().max(16000).optional(),
  // The field the signer opened the chat from; the server looks it up in the
  // session's own document.
  fieldId: z.union([z.string().max(100), z.number()]).optional(),
  language: z.string().max(16).optional(),
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendMethodNotAllowed(res);
  }

  try {
    const declaredLength = Number(req.headers?.['content-length']);
    if (Number.isFinite(declaredLength) && declaredLength > BODY_SIZE_LIMIT_BYTES) {
      return sendSessionError(res, 413, 'body_too_large', 'Request body is too large');
    }

    const queryResult = querySchema.safeParse(req.query);
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!queryResult.success || !bodyResult.success) {
      return sendInvalidRequest(res);
    }

    const { token } = queryResult.data;
    const { message, messages, chatHistory, fieldId, language } = bodyResult.data;

    if (await rateLimitPublic(req, res, 'sessions-chat', token)) {
      return;
    }

    const supabase = requireServiceSupabase();

    const { session, error: tokenError } = await validateSessionToken(token, supabase, {
      allowCompleted: true,
    });
    if (tokenError) {
      return sendTokenError(res, tokenError);
    }

    const embedOriginCheck = enforceEmbedOriginForSession({
      req,
      session,
      endpoint: 'sessions-chat',
    });
    if (!embedOriginCheck.ok) {
      return sendSessionError(
        res,
        embedOriginCheck.status,
        embedOriginCheck.errorCode,
        embedOriginCheck.message
      );
    }

    if (session.status === 'queued') {
      return sendSessionError(res, 409, 'not_ready', 'Document is still being prepared');
    }

    const verificationToken = req.headers['x-session-verify'];
    if (!isSessionVerified(session, verificationToken)) {
      return sendSessionError(res, 403, 'verification_required', 'Verification is required before chat');
    }

    const quota = await consumeDailyQuota(
      'sessions-chat-daily',
      session.id,
      MAX_CHAT_MESSAGES_PER_SESSION_PER_DAY
    );
    if (!quota.success) {
      return sendSessionError(
        res,
        429,
        'chat_daily_limit',
        `This signing link has reached its limit of ${MAX_CHAT_MESSAGES_PER_SESSION_PER_DAY} chat messages for today. Please try again tomorrow.`
      );
    }

    const history = Array.isArray(messages) && messages.length > 0
      ? messages
      : Array.isArray(chatHistory) && chatHistory.length > 0
        ? chatHistory
        : [];

    let documentContext = [];
    try {
      documentContext = await buildDocumentChatContext(supabase, session.document_id, {
        fieldIds: Array.isArray(session.field_filter?.ids) ? session.field_filter.ids : undefined,
        focusFieldId: fieldId === undefined ? undefined : String(fieldId),
      });
    } catch (err) {
      console.warn('[Sessions Chat] Context build failed:', err.message);
    }

    const result = await chatWithCo(message, documentContext || [], history, language || 'en');
    return res.status(200).json({ response: result.message || '' });
  } catch (error) {
    console.error('[Sessions Chat] Error:', error);
    return sendSessionError(res, 500, 'chat_failed', 'Failed to get response');
  }
}
