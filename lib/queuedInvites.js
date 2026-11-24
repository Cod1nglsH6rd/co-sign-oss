/**
 * Release the signing sessions that were queued while a document was still
 * being processed (called by /api/ocr when a full run finishes).
 *
 * Sessions store only token_hash: sessions/create.js never saves the
 * plaintext token (it is shown once to the creator). An email invite
 * therefore needs a fresh token, minted the same way (generateSessionToken)
 * with its hash stored on the session before the email goes out. If the
 * email does not go out (mail off, provider error, exception), the previous
 * hash is put back, so the link shown at creation keeps working, and the
 * session becomes 'pending', never 'sent'.
 */
import { sendFillInviteEmail } from './email.js';
import { generateSessionToken } from './sessionAuth.js';

async function updateSession(supabase, sessionId, patch) {
  const { error } = await supabase
    .from('fill_sessions')
    .update(patch)
    .eq('id', sessionId);
  return error || null;
}

async function releaseEmailSession(supabase, session, documentName) {
  let clientName = 'Client';
  if (session.client_user_id) {
    try {
      const { data: clientUser } = await supabase.auth.admin.getUserById(session.client_user_id);
      clientName = clientUser?.user?.email || clientName;
    } catch {}
  }

  const { token, tokenHash } = generateSessionToken();
  const hashError = await updateSession(supabase, session.id, { token_hash: tokenHash });
  if (hashError) {
    // Without the new hash stored, the emailed link would not open: send
    // nothing and leave the session queued.
    console.error('[QueuedInvites] Could not store the invite token; invite not sent', {
      sessionId: session.id,
      error: hashError.message,
    });
    return;
  }

  let delivery;
  try {
    delivery = await sendFillInviteEmail({
      to: session.recipient_email,
      recipientName: session.recipient_name,
      documentName,
      token,
      expiresAt: session.expires_at,
      clientName,
      language: session.preferred_language || 'en',
    });
  } catch (err) {
    console.error('[QueuedInvites] Invite email failed:', err?.message);
    delivery = { sent: false, reason: 'provider_error' };
  }

  if (delivery?.sent === true) {
    await updateSession(supabase, session.id, { status: 'sent', sent_at: new Date().toISOString() });
    return;
  }

  console.warn('[QueuedInvites] Invite not sent; session left pending', {
    sessionId: session.id,
    reason: delivery?.reason || 'unknown',
  });
  await updateSession(supabase, session.id, {
    status: 'pending',
    ...(session.token_hash ? { token_hash: session.token_hash } : {}),
  });
}

/**
 * @param {object} args
 * @param {object} args.supabase - service-role Supabase client
 * @param {string} args.documentId
 * @param {string} args.documentName
 * @returns {Promise<number>} how many queued sessions were found
 */
export async function releaseQueuedSessions({ supabase, documentId, documentName }) {
  const { data: queuedSessions } = await supabase
    .from('fill_sessions')
    .select('*')
    .eq('document_id', documentId)
    .eq('status', 'queued');

  for (const session of queuedSessions || []) {
    if (session.send_method === 'email' && session.recipient_email) {
      await releaseEmailSession(supabase, session, documentName);
    } else {
      await updateSession(supabase, session.id, { status: 'pending' });
    }
  }

  return queuedSessions?.length || 0;
}
