/**
 * POST /api/sessions/create
 *
 * Client creates a fill session for a document, generating a unique
 * token-based URL that can be sent to a customer for filling.
 *
 * Auth: Supabase JWT (authenticated client)
 *
 * Body: {
 *   documentId: string (required),
 *   recipientEmail?: string,
 *   recipientName?: string,
 *   recipientLastName?: string,
 *   assignedRole?: string,         // e.g., 'tenant', 'employee'
 *   fieldFilter?: string[],        // array of field IDs to include (null = all)
 *   requireSignature?: boolean,
 *   expiresInDays?: number,        // default 30
 *   sendMethod?: 'email' | 'embed' | 'link',
 *   preferredLanguage?: 'en' | 'vi' | 'es',
 *   embedOrigin?: string,          // allowed origin for iframe embeds
 * }
 */

import { z } from 'zod';
import { generateSessionToken } from '../../../lib/sessionAuth.js';
import { logAudit } from '../../../lib/auditLog.js';
import { sendFillInviteEmail } from '../../../lib/email.js';
import { effectiveSetting } from '../../../lib/hostSettings';
import { normalizeEmbedOriginInput } from '../../../lib/embedOrigin.js';
import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../../lib/auth';

const trimmedString = z.string().trim();
// Clients send null for blank optional fields — treat null like undefined.
const optionalTrimmedString = z.string().trim().nullish().transform((value) => value ?? undefined);
const fieldFilterItem = z.union([z.string(), z.number()]).transform((value) => String(value).trim()).refine(
  (value) => value.length > 0,
  { message: 'fieldFilter items must be non-empty strings' }
);

const createSessionBodySchema = z.object({
  documentId: trimmedString.min(1, 'documentId is required'),
  recipientEmail: optionalTrimmedString,
  recipientName: optionalTrimmedString,
  recipientLastName: optionalTrimmedString,
  assignedRole: optionalTrimmedString,
  fieldFilter: z.array(fieldFilterItem).optional(),
  requireSignature: z.boolean().optional().default(false),
  expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
  sendMethod: z.enum(['email', 'embed', 'link']).default('email'),
  preferredLanguage: z.enum(['en', 'vi', 'es', 'pt', 'fr', 'zh', 'yue', 'ht', 'ne']).optional(),
  embedOrigin: optionalTrimmedString,
});

function formatValidationMessage(error) {
  if (!error?.issues?.length) {
    return 'Invalid request body';
  }

  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      return `${path}${issue.message}`;
    })
    .join('; ');
}

function jsonValidationError(res, errorCode, message) {
  return res.status(400).json({
    error: message,
    errorCode,
    message,
  });
}

function extractMissingColumnName(errorMessage) {
  const message = String(errorMessage || '');
  const schemaCacheMatch = message.match(/Could not find the '([^']+)' column/i);
  if (schemaCacheMatch?.[1]) return schemaCacheMatch[1];

  const relationMatch = message.match(/column "([^"]+)" of relation/i);
  if (relationMatch?.[1]) return relationMatch[1];

  return null;
}

function isStatusConstraintError(errorMessage) {
  const message = String(errorMessage || '').toLowerCase();
  return message.includes('check constraint') && message.includes('status');
}

// Env first, then the site address saved at setup.
function savedAppUrl() {
  return effectiveSetting('NEXT_PUBLIC_APP_URL', process.env);
}

// The app's own address for links and its own background calls. A configured
// address wins (NEXT_PUBLIC_APP_URL from env, else the one saved at setup,
// then NEXT_PUBLIC_SITE_URL, then the production host name Vercel sets); the
// request's Host, which a visitor controls, is used only when none is set.
function getAppBaseUrl(req) {
  const vercelHost = nonBlank(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  const configured = savedAppUrl()
    || nonBlank(process.env.NEXT_PUBLIC_SITE_URL)
    || (vercelHost ? `https://${vercelHost}` : null);
  if (configured) return configured.trim().replace(/\/+$/, '');
  return getRequestBaseUrl(req);
}

function nonBlank(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getRequestBaseUrl(req) {
  const forwardedHost = req.headers['x-forwarded-host'];
  const host = (typeof forwardedHost === 'string' && forwardedHost.trim())
    ? forwardedHost
    : req.headers.host;
  if (!host) return savedAppUrl() || process.env.NEXT_PUBLIC_SITE_URL || null;

  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = (typeof forwardedProto === 'string' && forwardedProto.trim())
    ? forwardedProto
    : (host.includes('localhost') ? 'http' : 'https');

  return `${proto}://${host}`;
}

const POST_SETUP_TRANSLATION_CHECK_LIMIT = Number(process.env.OCR_POST_SETUP_MAX_FIELDS || 80);

async function createFillSessionWithCompatibility({
  supabase,
  payload,
}) {
  const workingPayload = { ...payload };
  const droppedColumns = [];
  const maxAttempts = 10;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data: session, error } = await supabase
      .from('fill_sessions')
      .insert([workingPayload])
      .select()
      .single();

    if (!error) {
      return { session, droppedColumns, finalPayload: workingPayload };
    }

    const missingColumn = extractMissingColumnName(error.message);
    if (missingColumn && Object.prototype.hasOwnProperty.call(workingPayload, missingColumn)) {
      delete workingPayload[missingColumn];
      droppedColumns.push(missingColumn);
      console.warn('[Sessions] Retrying create without missing column', {
        attempt,
        missingColumn,
      });
      continue;
    }

    if (isStatusConstraintError(error.message) && workingPayload.status === 'queued') {
      workingPayload.status = 'pending';
      console.warn('[Sessions] Retrying create with compatibility status fallback', {
        attempt,
        previousStatus: 'queued',
        nextStatus: 'pending',
      });
      continue;
    }

    return { error, droppedColumns, finalPayload: workingPayload };
  }

  return {
    error: { message: 'Session create retries exhausted' },
    droppedColumns,
    finalPayload: workingPayload,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabase = requireServiceSupabase();

    // 1. Authenticate client via JWT
    const auth = await requireBearerUser(req, supabase);
    if (auth.error) {
      return res.status(401).json({
        error: auth.error === 'missing_auth' ? 'Missing authorization header' : 'Invalid or expired token',
      });
    }
    const { user } = auth;
    const jwt = req.headers.authorization.replace('Bearer ', '');

    // 2. Parse & validate request body
    const bodyResult = createSessionBodySchema.safeParse(req.body ?? {});
    if (!bodyResult.success) {
      return jsonValidationError(
        res,
        'invalid_request_body',
        formatValidationMessage(bodyResult.error)
      );
    }
    const {
      documentId,
      recipientEmail,
      recipientName,
      recipientLastName,
      assignedRole,
      fieldFilter,
      requireSignature = false,
      expiresInDays = 30,
      sendMethod = 'email',
      preferredLanguage: requestedPreferredLanguage,
      embedOrigin,
    } = bodyResult.data;

    const normalizedEmbedOrigin = embedOrigin
      ? normalizeEmbedOriginInput(embedOrigin)
      : null;

    if (embedOrigin && !normalizedEmbedOrigin) {
      return jsonValidationError(
        res,
        'invalid_embed_origin',
        'embedOrigin must be a valid http(s) origin'
      );
    }

    // 3. Verify client owns the document (in the org they selected, if any)
    const { membership, error: membershipError } = await requireOrgMembership(
      user.id,
      supabase,
      requestedOrgId(req)
    );

    if (membershipError) {
      return res.status(403).json({ error: 'User is not a member of any organization' });
    }

    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('id, file_name, status, lifecycle_status, processing_status, metadata, preferred_language, org_id, phase1_data')
      .eq('id', documentId)
      .eq('org_id', membership.org_id)
      .single();

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found or access denied' });
    }

    // 3b. Org policy (L1): when recipient verification is required, every signing
    // link must carry an identity to verify against (email + last name), so an
    // anonymous link can't be opened/signed by anyone who has the URL.
    const { data: orgSettings } = await supabase
      .from('organizations')
      .select('require_recipient_verification')
      .eq('id', membership.org_id)
      .single();
    if (orgSettings?.require_recipient_verification && (!recipientEmail || !recipientLastName)) {
      return res.status(400).json({
        error: 'recipient_verification_required',
        message: 'This organization requires a recipient email and last name on every signing link.',
      });
    }

    // 4. Verify document has fields
    const { data: fields, error: fieldsError } = await supabase
      .from('fields')
      .select('id')
      .eq('document_id', documentId);

    if (fieldsError || !fields || fields.length === 0) {
      return res.status(400).json({ error: 'Document has no extracted fields. Run OCR first.' });
    }

    // 5. Validate field filter if provided
    if (fieldFilter && Array.isArray(fieldFilter)) {
      const fieldIds = new Set(fields.map(f => String(f.id)));
      const invalidIds = fieldFilter.filter(id => !fieldIds.has(String(id)));
      if (invalidIds.length > 0) {
        return jsonValidationError(
          res,
          'invalid_field_ids',
          `Invalid field IDs: ${invalidIds.join(', ')}`
        );
      }
    }

    // 6. Generate secure token
    const { token, tokenHash } = generateSessionToken();

    // 7. Calculate expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Math.min(expiresInDays, 365));

    // 8. Create fill session
    const lifecycleReadyStates = new Set(['ready_to_send', 'sent', 'opened', 'completed']);
    const isReady = doc.lifecycle_status
      ? lifecycleReadyStates.has(doc.lifecycle_status)
      : (doc.status === 'ready' && doc?.phase1_data?.setupCompleted === true);
    const queued = !isReady;
    const sessionStatus = queued ? 'queued' : 'pending';
    const shouldSendEmailNow = !queued && sendMethod === 'email' && Boolean(recipientEmail);
    const preferredLanguage = requestedPreferredLanguage || doc.preferred_language || 'en';

    // Field scope for the recipient. An explicit per-recipient fieldFilter
    // (send-time picker) wins; otherwise fall back to the fields enabled
    // during setup (phase1_data.includedFieldIds). Setup stores an empty list
    // when ALL fields are enabled, so the default case stays unfiltered (no
    // regression) — only an actual setup curation narrows the recipient's set.
    const currentFieldIdSet = new Set(fields.map((f) => String(f.id)));
    const setupIncluded = Array.isArray(doc?.phase1_data?.includedFieldIds)
      && doc.phase1_data.includedFieldIds.length > 0
      ? doc.phase1_data.includedFieldIds.map(String).filter((id) => currentFieldIdSet.has(id))
      : null;
    const effectiveFieldFilter = (fieldFilter && fieldFilter.length > 0)
      ? fieldFilter
      : (setupIncluded && setupIncluded.length > 0 ? setupIncluded : null);

    const insertPayload = {
      // SECURITY: we deliberately do NOT persist the plaintext `token`. Only the
      // hash is stored; recipients are validated by hashing their token and
      // matching `token_hash`. The plaintext token is returned to the creator
      // in-memory (below) for the share link and never written at rest, so a DB
      // read can't yield usable signing links.
      document_id: documentId,
      client_user_id: user.id,
      token_hash: tokenHash,
      recipient_email: recipientEmail || null,
      recipient_name: recipientName || null,
      recipient_last_name: recipientLastName || null,
      assigned_role: assignedRole || null,
      field_filter: effectiveFieldFilter ? { ids: effectiveFieldFilter } : null,
      require_signature: requireSignature,
      preferred_language: preferredLanguage,
      send_method: sendMethod,
      embed_origin: normalizedEmbedOrigin,
      expires_at: expiresAt.toISOString(),
      sent_at: null,
      status: sessionStatus,
    };

    const {
      session,
      error: sessionError,
      droppedColumns,
      finalPayload,
    } = await createFillSessionWithCompatibility({
      supabase,
      payload: insertPayload,
    });

    if (sessionError || !session) {
      console.error('[Sessions] Create error:', {
        message: sessionError?.message || 'Failed to create session',
        code: sessionError?.code || null,
        droppedColumns,
      });
      return res.status(500).json({
        error: 'Failed to create session',
        errorCode: 'session_create_failed',
        message: 'Failed to create session',
      });
    }

    if (droppedColumns.length > 0) {
      console.info('[Sessions] Created with compatibility column fallback', {
        sessionId: session.id,
        droppedColumns,
      });
    }

    // 9. Log audit event
    await logAudit(supabase, {
      action: 'created',
      entityType: 'fill_session',
      entityId: session.id,
      actorType: 'client',
      actorId: user.id,
      sessionId: session.id,
      documentId,
      details: {
        recipient_email: recipientEmail,
        send_method: sendMethod,
        preferred_language: preferredLanguage,
        require_signature: requireSignature,
        field_count: effectiveFieldFilter ? effectiveFieldFilter.length : fields.length,
      },
      req,
    });

    // 10. Build response
    // The saved site address first: the Host header is chosen by whoever
    // sends the request, so it is only a fallback when no address is set.
    const appUrl = getAppBaseUrl(req) || 'http://localhost:3000';
    const shareUrl = `${appUrl}/${preferredLanguage}/fill/${token}`;
    const embedCode = `<iframe src="${appUrl}/embed/${token}" style="width:100%;height:800px;border:none;" allow="camera"></iframe>`;

    let finalStatus = sessionStatus;
    let sentAt = session.sent_at || null;
    let emailDeliveryFailed = false;
    let emailSent = false;
    let mailOff = false;

    if (shouldSendEmailNow) {
      try {
        const delivery = await sendFillInviteEmail({
          baseUrl: appUrl,
          to: recipientEmail,
          recipientName,
          documentName: doc.file_name,
          token,
          expiresAt,
          clientName: user.email,
          language: preferredLanguage,
        });

        if (delivery?.sent === false) {
          // PRD §2.2: nothing went out, so the session is not marked sent and
          // the staff member gets the link to copy and send themselves.
          mailOff = delivery.reason === 'mail_off';
          emailDeliveryFailed = !mailOff;
          finalStatus = 'pending';
        } else {
          emailSent = true;
          sentAt = new Date().toISOString();
          finalStatus = 'sent';
          await supabase
            .from('fill_sessions')
            .update({ status: finalStatus, sent_at: sentAt })
            .eq('id', session.id);
        }
      } catch (emailErr) {
        emailDeliveryFailed = true;
        finalStatus = 'pending';
        console.error('[Sessions] Email send failed:', emailErr);
      }
    }

    const shouldMarkDocumentSent = !queued && (sendMethod === 'link' || finalStatus === 'sent');
    if (shouldMarkDocumentSent) {
      const { error: lifecycleError } = await supabase
        .from('documents')
        .update({
          lifecycle_status: 'sent',
          processing_status: 'idle',
          metadata: null,
        })
        .eq('id', documentId);

      if (lifecycleError) {
        console.error('[Sessions] Document lifecycle update failed:', lifecycleError);
      }
    }

    // If the session is sent in any non-English language and document
    // translations are missing, run post-setup enrichment in the background.
    const shouldQueueLanguageEnrichment = !queued
      && typeof preferredLanguage === 'string'
      && preferredLanguage !== 'en'
      && preferredLanguage.length > 0;
    if (shouldQueueLanguageEnrichment) {
      const alreadyFinalizing = doc.processing_status === 'finalizing' && doc?.metadata?.post_setup === true;
      if (alreadyFinalizing) {
        console.info('[Sessions] Skipping language enrichment; post-setup already finalizing', {
          documentId,
          preferredLanguage,
        });
      } else {
        const translationColumn = `field_name_${preferredLanguage}`;
        // Enrich only the fields the recipient will actually see (same scope
        // as field_filter computed above), or all if unfiltered.
        let targetFieldIds = effectiveFieldFilter;

        if (!targetFieldIds) {
          const { data: candidateRows, error: candidateError } = await supabase
            .from('fields')
            .select('id')
            .eq('document_id', documentId)
            .order('sort_order', { ascending: true })
            .limit(Math.max(1, POST_SETUP_TRANSLATION_CHECK_LIMIT));

          if (candidateError) {
            console.warn('[Sessions] Translation candidate field query failed', {
              documentId,
              preferredLanguage,
              message: candidateError.message,
            });
          } else {
            targetFieldIds = (candidateRows || []).map((row) => String(row.id));
          }
        }

        if (targetFieldIds && targetFieldIds.length > 0) {
          const { data: missingTranslations, error: missingTranslationsError } = await supabase
            .from('fields')
            .select('id')
            .eq('document_id', documentId)
            .in('id', targetFieldIds)
            .or(`${translationColumn}.is.null,${translationColumn}.eq.`)
            .limit(1);

          if (missingTranslationsError) {
            console.warn('[Sessions] Translation readiness check failed', {
              documentId,
              preferredLanguage,
              message: missingTranslationsError.message,
            });
          } else if ((missingTranslations || []).length > 0) {
            const baseUrl = getAppBaseUrl(req);
            if (!baseUrl) {
              console.warn('[Sessions] Skipping background language enrichment: unable to resolve base URL', {
                documentId,
                preferredLanguage,
              });
            } else {
              void (async () => {
                try {
                  const ocrRes = await fetch(`${baseUrl}/api/ocr`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${jwt}`,
                      'X-Org-Id': membership.org_id,
                    },
                    body: JSON.stringify({
                      documentId,
                      userId: user.id,
                      preferredLanguage,
                      mode: 'post_setup',
                    }),
                  });

                  if (!ocrRes.ok) {
                    const text = await ocrRes.text().catch(() => '');
                    console.warn('[Sessions] Background language enrichment failed', {
                      documentId,
                      preferredLanguage,
                      status: ocrRes.status,
                      body: text.slice(0, 300),
                    });
                    return;
                  }

                  console.info('[Sessions] Background language enrichment queued', {
                    documentId,
                    preferredLanguage,
                  });
                } catch (err) {
                  console.warn('[Sessions] Background language enrichment request error', {
                    documentId,
                    preferredLanguage,
                    message: err?.message || 'unknown_error',
                  });
                }
              })();
            }
          }
        }
      }      
    }

    return res.status(201).json({
      success: true,
      emailDeliveryFailed,
      emailSent,
      mailOff,
      shareUrl,
      session: {
        id: session.id,
        token,
        documentId: session.document_id,
        documentName: doc.file_name,
        status: finalStatus || finalPayload?.status || sessionStatus,
        recipientEmail: session.recipient_email,
        recipientName: session.recipient_name,
        recipientLastName: session.recipient_last_name,
        preferredLanguage: session.preferred_language || preferredLanguage,
        assignedRole: session.assigned_role,
        requireSignature: session.require_signature,
        queued,
        shareUrl,
        embedCode,
        expiresAt: session.expires_at,
        sentAt,
        createdAt: session.created_at,
      },
    });
  } catch (err) {
    console.error('[Sessions] Unexpected error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
