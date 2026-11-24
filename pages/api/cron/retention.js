/**
 * POST /api/cron/retention
 *
 * Deletes completed session artifacts older than org retention policy.
 * Protected by RETENTION_CRON_SECRET header.
 */

import { rateLimitCron } from '../../../lib/rateLimit';
import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { filledPdfPath } from '../../../lib/storagePaths';
import { timingSafeEqual } from 'crypto';

// Constant-time string compare that doesn't leak length via early return.
function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Compare against self so timing stays constant, then fail.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  // Vercel Cron invokes with GET + `Authorization: Bearer <secret>`; manual
  // calls may use POST + `x-cron-secret`. Accept both. (PRD §8.1)
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept the app's own secret or Vercel's CRON_SECRET (sent as a Bearer token
  // on scheduled invocations).
  const secret = process.env.RETENTION_CRON_SECRET;
  const vercelCronSecret = process.env.CRON_SECRET;
  if (!secret && !vercelCronSecret) {
    return res.status(503).json({ error: 'Retention cron secret not configured' });
  }

  // Authenticate BEFORE rate limiting so an unauthenticated caller can't probe
  // the endpoint or consume the limiter. Use constant-time comparison.
  const bearer = (req.headers.authorization || '').replace('Bearer ', '');
  const headerSecret = req.headers['x-cron-secret'];
  const authorized =
    (secret && (safeEqual(headerSecret, secret) || safeEqual(bearer, secret)))
    || (vercelCronSecret && safeEqual(bearer, vercelCronSecret));
  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (await rateLimitCron(req, res)) {
    return;
  }

  try {
    const supabase = requireServiceSupabase();

    // Fetch orgs with retention settings
    const { data: orgs } = await supabase
      .from('organizations')
      .select('id, retention_days');

    let deletedSessions = 0;
    let deletedFiles = 0;

    for (const org of orgs || []) {
      const retentionDays = org.retention_days || 365;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - retentionDays);

      const { data: sessions } = await supabase
        .from('fill_sessions')
        .select('id, document_id, metadata, documents:document_id (id, org_id)')
        .eq('status', 'completed')
        .lt('completed_at', cutoff.toISOString());

      for (const session of sessions || []) {
        if (session.documents?.org_id !== org.id) continue;

        // metadata is editable by the session's client: it only says a filled
        // PDF was saved; the path is recomputed the way complete.js stores it.
        const filledPath = session.metadata?.filled_pdf_path && session.document_id
          ? filledPdfPath(session.document_id, session.id)
          : null;
        if (filledPath) {
          await supabase.storage
            .from('filled-documents')
            .remove([filledPath]);
          deletedFiles += 1;
        }

        await supabase
          .from('fill_sessions')
          .delete()
          .eq('id', session.id);

        deletedSessions += 1;
      }
    }

    return res.status(200).json({ success: true, deletedSessions, deletedFiles });
  } catch (err) {
    console.error('[Retention] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
