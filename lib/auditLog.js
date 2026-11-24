/**
 * Audit Log Utilities
 * Centralized logging for all session actions
 */

import { clientIp } from './clientIp';

/**
 * Log an audit event
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase - Service role client
 * @param {object} params
 * @param {string} params.action - created | sent | opened | filled | signed | submitted | completed | exported | revoked
 * @param {string} params.entityType - fill_session | document | field
 * @param {string} [params.entityId] - UUID of the entity
 * @param {string} params.actorType - client | customer | system
 * @param {string} [params.actorId] - UUID of the actor (null for anonymous)
 * @param {string} [params.sessionId] - Fill session UUID
 * @param {string} [params.documentId] - Document UUID
 * @param {object} [params.details] - Additional details (field count, etc.)
 * @param {import('http').IncomingMessage} [params.req] - Request object for IP/UA
 */
export async function logAudit(supabase, {
  action,
  entityType,
  entityId,
  actorType,
  actorId = null,
  sessionId = null,
  documentId = null,
  details = {},
  req = null,
}) {
  try {
    // lib/clientIp.js: the X-Forwarded-For entry the trusted proxies wrote
    // (COSIGN_TRUSTED_PROXY_HOPS, set by the host owner), else the socket
    // address. Never the left-most entry or X-Real-IP, which the signer
    // can send.
    const ipAddress = clientIp(req);

    const userAgent = req?.headers?.['user-agent'] || null;

    await supabase.from('audit_log').insert([{
      action,
      entity_type: entityType,
      entity_id: entityId,
      actor_type: actorType,
      actor_id: actorId,
      session_id: sessionId,
      document_id: documentId,
      details,
      ip_address: ipAddress,
      user_agent: userAgent,
    }]);
  } catch (err) {
    // Audit logging should never break the main flow
    console.error('[AuditLog] Failed to write audit log:', err.message);
  }
}

/**
 * Get audit log entries for a session
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} sessionId
 * @param {number} [limit=100]
 * @returns {Promise<object[]>}
 */
export async function getSessionAuditLog(supabase, sessionId, limit = 100) {
  const { data, error } = await supabase
    .from('audit_log')
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true })
    .limit(limit);

  if (error) {
    console.error('[AuditLog] Failed to read audit log:', error.message);
    return [];
  }

  return data || [];
}
