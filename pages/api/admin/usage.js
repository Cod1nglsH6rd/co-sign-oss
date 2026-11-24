import { requireServiceSupabase } from '../../../lib/supabaseClient';
import { getServerOwnerEmails, isOwnerEmail } from '../../../lib/ownerEmails';

function toDailySeries(rows, dateField, { statusField = null, statusMatch = null } = {}) {
  const days = 14;
  const labels = [];
  const values = [];
  const today = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - i);

    const nextDate = new Date(date);
    nextDate.setDate(date.getDate() + 1);

    const count = rows.filter((row) => {
      const value = row?.[dateField];
      if (!value) return false;
      const d = new Date(value);
      if (d < date || d >= nextDate) return false;
      if (!statusField || !statusMatch) return true;
      return row?.[statusField] === statusMatch;
    }).length;

    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    values.push(count);
  }

  return { labels, values };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing authorization header' });
    }

    const supabase = requireServiceSupabase();
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    if (!isOwnerEmail(user.email, getServerOwnerEmails())) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date();
    const since14 = new Date(now);
    since14.setDate(now.getDate() - 13);
    since14.setHours(0, 0, 0, 0);

    const [
      organizationsResult,
      membershipsResult,
      documentsResult,
      processedDocumentsResult,
      sessionsResult,
      completedSessionsResult,
      betaResult,
      docsForTrendResult,
      sessionsForTrendResult,
    ] = await Promise.all([
      supabase.from('organizations').select('id', { count: 'exact', head: true }),
      supabase.from('org_memberships').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('documents').select('id', { count: 'exact', head: true }),
      supabase.from('documents').select('id', { count: 'exact', head: true }).in('status', ['ready', 'completed']),
      supabase.from('fill_sessions').select('id', { count: 'exact', head: true }),
      supabase.from('fill_sessions').select('id', { count: 'exact', head: true }).eq('status', 'completed'),
      supabase.from('beta_signups').select('id', { count: 'exact', head: true }),
      supabase.from('documents').select('created_at, status').gte('created_at', since14.toISOString()),
      supabase.from('fill_sessions').select('created_at, status, completed_at').gte('created_at', since14.toISOString()),
    ]);

    const allErrors = [
      organizationsResult.error,
      membershipsResult.error,
      documentsResult.error,
      processedDocumentsResult.error,
      sessionsResult.error,
      completedSessionsResult.error,
      betaResult.error,
      docsForTrendResult.error,
      sessionsForTrendResult.error,
    ].filter(Boolean);

    if (allErrors.length) {
      console.error('[Admin Usage] Query errors:', allErrors);
      return res.status(500).json({ error: 'Failed to load usage metrics' });
    }

    const totalSessions = sessionsResult.count || 0;
    const completedSessions = completedSessionsResult.count || 0;
    const completionRate = totalSessions > 0
      ? Math.round((completedSessions / totalSessions) * 100)
      : 0;

    const docsRows = docsForTrendResult.data || [];
    const sessionsRows = sessionsForTrendResult.data || [];

    const createdSeries = toDailySeries(docsRows, 'created_at');
    const completedSeries = toDailySeries(sessionsRows, 'completed_at');

    return res.status(200).json({
      metrics: {
        organizations: organizationsResult.count || 0,
        activeMembers: membershipsResult.count || 0,
        documents: documentsResult.count || 0,
        processedDocuments: processedDocumentsResult.count || 0,
        sessions: totalSessions,
        completedSessions,
        completionRate,
        betaSignups: betaResult.count || 0,
      },
      trends: {
        labels: createdSeries.labels,
        docsCreated: createdSeries.values,
        sessionsCompleted: completedSeries.values,
      },
      generatedAt: new Date().toISOString(),
      owner: user.email,
    });
  } catch (err) {
    console.error('[Admin Usage] Error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
