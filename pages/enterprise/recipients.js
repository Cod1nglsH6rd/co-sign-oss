import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import { FiDownload, FiPlus } from 'react-icons/fi';
import toast from 'react-hot-toast';

const languageMeta = {
  en: { label: 'English', flag: '🇺🇸' },
  es: { label: 'Spanish', flag: '🇪🇸' },
  vi: { label: 'Vietnamese', flag: '🇻🇳' },
  fr: { label: 'French', flag: '🇫🇷' },
  zh: { label: 'Chinese', flag: '🇨🇳' },
};

const statusBadge = (status) => {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'completed' };
    case 'opened':
      return { label: 'Opened', className: 'opened' };
    case 'sent':
      return { label: 'Sent', className: 'sent' };
    case 'in_progress':
      return { label: 'In Progress', className: 'in-progress' };
    default:
      return { label: 'In Progress', className: 'in-progress' };
  }
};

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
};

const relativeTime = (timestamp) => {
  if (!timestamp) return '—';
  const now = new Date();
  const date = new Date(timestamp);
  const diffMs = now - date;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const initialsFrom = (value) => {
  if (!value) return '—';
  const parts = value
    .replace(/[^a-zA-Z0-9@\s._-]/g, '')
    .split(/\s|@|\./)
    .filter(Boolean);
  if (parts.length === 0) return '—';
  const first = parts[0][0] || '';
  const second = parts[1]?.[0] || '';
  return `${first}${second}`.toUpperCase();
};

const sortOptions = [
  { value: 'recent', label: 'Latest activity' },
  { value: 'oldest', label: 'Oldest activity' },
  { value: 'name', label: 'Recipient name' },
  { value: 'document', label: 'Document name' },
];

export default function EnterpriseRecipients() {
  const { user, orgId, memberships, switchOrg } = useAuth({ redirectTo: '/enterprise/login' });
  const router = useRouter();
  const [filters, setFilters] = useState({
    query: '',
    sort: 'recent',
  });
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [liveConnected, setLiveConnected] = useState(false);
  const bulkModeHandledRef = useRef(false);
  const refreshTimeoutRef = useRef(null);
  const activeRef = useRef(true);
  const [state, setState] = useState({
    loading: true,
    org: null,
    staffCount: 0,
    docs: [],
    sessions: [],
    recipients: [],
  });

  const loadData = useCallback(async ({ silent = false } = {}) => {
    if (!orgId) return;
    if (!silent) {
      setState((prev) => ({ ...prev, loading: true }));
    }

    const [{ data: org }, { count: staffCount }] = await Promise.all([
      supabase.from('organizations').select('id, name').eq('id', orgId).single(),
      supabase
        .from('org_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
    ]);

    const { data: docs = [] } = await supabase
      .from('documents')
      .select('id, file_name, preferred_language, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(300);

    const docIds = docs.map((doc) => doc.id);
    let sessions = [];
    if (docIds.length > 0) {
      const { data } = await supabase
        .from('fill_sessions')
        .select('id, document_id, recipient_email, recipient_name, status, preferred_language, created_at, completed_at, first_opened_at, sent_at, client_user_id')
        .in('document_id', docIds)
        .order('created_at', { ascending: false })
        .limit(1000);
      sessions = data || [];
    }

    if (!activeRef.current) return;

    const recentSessions = sessions.slice(0, 200);
    const recentSessionIds = recentSessions.map((session) => session.id);
    const recentDocIds = [...new Set(recentSessions.map((session) => session.document_id))];

    let fieldCounts = {};
    if (recentDocIds.length) {
      const { data: fields } = await supabase
        .from('fields')
        .select('document_id')
        .in('document_id', recentDocIds);
      fieldCounts = (fields || []).reduce((acc, field) => {
        acc[field.document_id] = (acc[field.document_id] || 0) + 1;
        return acc;
      }, {});
    }

    let sessionFieldCounts = {};
    if (recentSessionIds.length) {
      const { data: sessionFields } = await supabase
        .from('session_fields')
        .select('session_id')
        .in('session_id', recentSessionIds);
      sessionFieldCounts = (sessionFields || []).reduce((acc, field) => {
        acc[field.session_id] = (acc[field.session_id] || 0) + 1;
        return acc;
      }, {});
    }

    const sessionRows = recentSessions.map((session) => {
      const doc = docs.find((d) => d.id === session.document_id);
      const languageCode = session.preferred_language || doc?.preferred_language || 'en';
      const language = languageMeta[languageCode]?.flag || '🌐';
      const totalFields = fieldCounts[session.document_id] || 0;
      const filledFields = session.status === 'completed'
        ? totalFields
        : sessionFieldCounts[session.id] || 0;
      const progress = totalFields ? Math.round((filledFields / totalFields) * 100) : (session.status === 'completed' ? 100 : 0);

      let derivedStatus = 'in_progress';
      if (session.status === 'completed') derivedStatus = 'completed';
      else if (session.first_opened_at) derivedStatus = 'opened';
      else if (session.sent_at) derivedStatus = 'sent';

      const lastActivityAt = session.completed_at || session.first_opened_at || session.sent_at || session.created_at;

      return {
        id: session.id,
        recipientName: session.recipient_name || session.recipient_email || 'Recipient',
        recipientEmail: session.recipient_email || '—',
        document: doc?.file_name || 'Document',
        language,
        languageCode,
        assignedTo: session.client_user_id === user?.id ? 'You' : 'Unassigned',
        progress,
        progressText: totalFields ? `${filledFields}/${totalFields}` : '—',
        status: statusBadge(derivedStatus),
        statusKey: derivedStatus,
        lastActivity: relativeTime(lastActivityAt),
        lastActivityAt,
        raw: session,
      };
    });

    const recipientsMap = new Map();
    sessionRows.forEach((row) => {
      const emailKey = row.recipientEmail && row.recipientEmail !== '—'
        ? row.recipientEmail.toLowerCase()
        : `name:${row.recipientName.toLowerCase()}`;
      const existing = recipientsMap.get(emailKey);
      const signed = row.statusKey === 'completed' || row.raw?.completed_at;
      const sent = Boolean(row.raw?.sent_at) || ['sent', 'opened', 'in_progress', 'completed'].includes(row.statusKey);
      if (!existing) {
        recipientsMap.set(emailKey, {
          id: emailKey,
          recipientName: row.recipientName,
          recipientEmail: row.recipientEmail,
          sentCount: sent ? 1 : 0,
          signedCount: signed ? 1 : 0,
          lastActivityAt: row.lastActivityAt,
          lastActivity: row.lastActivity,
          sessions: [row],
        });
      } else {
        existing.sentCount += sent ? 1 : 0;
        existing.signedCount += signed ? 1 : 0;
        if (new Date(row.lastActivityAt) > new Date(existing.lastActivityAt)) {
          existing.lastActivityAt = row.lastActivityAt;
          existing.lastActivity = row.lastActivity;
        }
        existing.sessions.push(row);
      }
    });

    const recipients = Array.from(recipientsMap.values());

    if (!activeRef.current) return;

    setState({
      loading: false,
      org,
      staffCount: staffCount || 0,
      docs,
      sessions,
      recipients,
    });
    setLastUpdated(new Date());
  }, [orgId, user?.id]);

  useEffect(() => {
    if (!orgId) return;
    activeRef.current = true;

    loadData();

    const scheduleRefresh = () => {
      if (refreshTimeoutRef.current) return;
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        loadData({ silent: true });
      }, 800);
    };

    const channel = supabase
      .channel(`enterprise-recipients-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fill_sessions' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, scheduleRefresh)
      .subscribe((status) => {
        setLiveConnected(status === 'SUBSCRIBED');
      });

    return () => {
      activeRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [orgId, loadData]);

  const orgName = state.org?.name || 'Enterprise';
  const docCount = state.docs.length;
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '—';

  const filteredRecipients = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    let rows = [...state.recipients];

    if (query) {
      rows = rows.filter((row) => {
        return [
          row.recipientName,
          row.recipientEmail,
          row.sessions?.[0]?.document,
        ].some((value) => value?.toLowerCase().includes(query));
      });
    }

    rows.sort((a, b) => {
      if (filters.sort === 'recent') return new Date(b.lastActivityAt) - new Date(a.lastActivityAt);
      if (filters.sort === 'oldest') return new Date(a.lastActivityAt) - new Date(b.lastActivityAt);
      if (filters.sort === 'name') return a.recipientName.localeCompare(b.recipientName);
      if (filters.sort === 'document') return (a.sessions?.[0]?.document || '').localeCompare(b.sessions?.[0]?.document || '');
      return 0;
    });

    return rows;
  }, [filters, state.recipients]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleSelectAll = (checked) => {
    if (!checked) {
      clearSelection();
      return;
    }
    setSelectedIds(new Set(filteredRecipients.map((r) => r.id)));
  };

  const downloadRecipientsCsv = (rows, fileName = 'recipients-export.csv') => {
    if (!rows.length) return;
    const csvRows = rows.map((r) => ({
      recipient_name: r.recipientName,
      recipient_email: r.recipientEmail,
      sent_count: r.sentCount,
      signed_count: r.signedCount,
      last_activity: r.lastActivity,
    }));
    const headers = Object.keys(csvRows[0]);
    const csv = [
      headers.join(','),
      ...csvRows.map((row) =>
        headers.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSelected = () => {
    const selected = filteredRecipients.filter((r) => selectedIds.has(r.id));
    if (!selected.length) {
      toast('Select at least one recipient to export');
      return;
    }
    downloadRecipientsCsv(selected, 'recipients-selected-export.csv');
  };

  const exportVisibleRecipients = () => {
    if (!filteredRecipients.length) {
      toast('No recipients to export');
      return;
    }
    downloadRecipientsCsv(filteredRecipients, 'recipients-export.csv');
  };

  const copyEmails = async () => {
    const selected = filteredRecipients.filter((r) => selectedIds.has(r.id));
    if (!selected.length) return;
    const emails = selected.map((r) => r.recipientEmail).filter(Boolean).join(', ');
    try {
      await navigator.clipboard.writeText(emails);
      toast.success('Copied recipient emails');
    } catch {}
  };

  const sendBulkReminders = () => {
    const selected = filteredRecipients.filter((r) => selectedIds.has(r.id));
    const emails = selected
      .map((r) => r.recipientEmail)
      .filter((email) => email && email !== '—');

    if (!emails.length) {
      toast('No recipient emails selected');
      return;
    }

    const subject = encodeURIComponent('Friendly reminder: document pending signature');
    const body = encodeURIComponent('Hello,\n\nThis is a reminder that your document is still waiting for completion.\n\nThank you.');
    window.location.href = `mailto:?bcc=${encodeURIComponent(emails.join(','))}&subject=${subject}&body=${body}`;
  };

  useEffect(() => {
    if (router.query?.mode !== 'bulk-reminders') {
      bulkModeHandledRef.current = false;
      return;
    }
    if (bulkModeHandledRef.current) return;
    if (!filteredRecipients.length) return;

    const pending = filteredRecipients.filter((recipient) => {
      const hasOpenItems = recipient.sentCount > recipient.signedCount;
      const hasEmail = recipient.recipientEmail && recipient.recipientEmail !== '—';
      return hasOpenItems && hasEmail;
    });

    bulkModeHandledRef.current = true;
    setSelectedIds(new Set(pending.map((recipient) => recipient.id)));
    if (pending.length > 0) {
      toast.success(`Selected ${pending.length} recipients pending completion`);
    } else {
      toast('No pending recipients with email found');
    }

    router.replace('/enterprise/recipients', undefined, { shallow: true });
  }, [filteredRecipients, router]);

  return (
    <>
      <Head>
        <title>Co Sign Enterprise — Recipients</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="recipients"
        pageTitle="Recipients"
        pageSubtitle="Live recipient activity across documents."
        topbarActions={<>
          <button className="ent-btn outline" onClick={selectedIds.size > 0 ? exportSelected : exportVisibleRecipients}>
            <FiDownload size={13} /> Export
          </button>
          <button className="ent-btn primary" onClick={() => router.push('/enterprise/send-links')}>
            <FiPlus size={14} /> New signing link
          </button>
        </>}
        counts={{ recipients: filteredRecipients.length, documents: docCount }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
          <div className="ent-live-pill">
            <span className={`ent-live-dot ${liveConnected ? 'live' : 'offline'}`}></span>
            {liveConnected ? 'Live' : 'Offline'} · Updated {lastUpdatedLabel}
          </div>
          <button
            className="ent-btn primary"
            onClick={() => {
              toast('Create a new recipient from the send-link form');
              router.push('/enterprise/send-links#create-send-link');
            }}
          >
            <FiPlus size={14} /> New recipient
          </button>
        </div>

        <div className="ent-card">
          <div className="ent-card-header">
            <div>
              <h3>Recipient Activity</h3>
              <p>{formatNumber(filteredRecipients.length)} showing · {formatNumber(state.sessions.length)} total sessions</p>
            </div>
            <button className="ent-card-action" onClick={() => loadData({ silent: true })}>Refresh</button>
          </div>
          <div className="ent-table-toolbar">
            <div className="ent-search-box">
              <span>🔎</span>
              <input
                type="text"
                placeholder="Search recipients, documents, emails"
                value={filters.query}
                onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
              />
            </div>
            <div className="ent-table-filters">
              <select
                value={filters.sort}
                onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value }))}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            {selectedIds.size > 0 && (
              <div className="ent-bulk-actions">
                <span className="ent-bulk-count">{selectedIds.size} selected</span>
                <button className="ent-bulk-btn" onClick={exportSelected}>Export CSV</button>
                <button className="ent-bulk-btn" onClick={copyEmails}>Copy Emails</button>
                <button className="ent-bulk-btn" onClick={sendBulkReminders}>Send Reminder</button>
                <button className="ent-bulk-btn ghost" onClick={clearSelection}>Clear</button>
              </div>
            )}
          </div>
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>
                    <input
                      type="checkbox"
                      checked={filteredRecipients.length > 0 && selectedIds.size === filteredRecipients.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th>Recipient</th>
                  <th>Sent</th>
                  <th>Signed</th>
                  <th>Last Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipients.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ padding: '20px 24px', color: 'var(--slateish-400)', fontSize: '13px' }}>
                      No recipients match those filters yet.
                    </td>
                  </tr>
                )}
                {filteredRecipients.map((recipient) => (
                  <tr key={recipient.id} className="clickable" onClick={() => setSelectedRecipient(recipient)}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(recipient.id)}
                        onChange={() => toggleSelected(recipient.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                    </td>
                    <td>
                      <div className="ent-client-cell">
                        <div className="ent-client-avatar">
                          {initialsFrom(recipient.recipientName)}
                        </div>
                        <div>
                          <div className="ent-client-name">{recipient.recipientName}</div>
                          <div className="ent-client-sub">{recipient.recipientEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: '13px', color: 'var(--slateish-700)' }}>{formatNumber(recipient.sentCount)}</td>
                    <td style={{ fontSize: '13px', color: 'var(--slateish-700)' }}>{formatNumber(recipient.signedCount)}</td>
                    <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{recipient.lastActivity}</td>
                    <td>
                      <button
                        className="ent-table-action-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedRecipient(recipient);
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </EnterpriseLayout>

      {selectedRecipient && (
        <div className="ent-drawer-backdrop" onClick={() => setSelectedRecipient(null)}>
          <div className="ent-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="ent-drawer-header">
              <div>
                <h3>{selectedRecipient.recipientName}</h3>
                <p>{selectedRecipient.recipientEmail}</p>
              </div>
              <button className="ent-drawer-close" onClick={() => setSelectedRecipient(null)}>×</button>
            </div>
            <div className="ent-drawer-body">
              <div className="ent-drawer-stats">
                <div>
                  <span>Sent</span>
                  <strong>{formatNumber(selectedRecipient.sentCount)}</strong>
                </div>
                <div>
                  <span>Signed</span>
                  <strong>{formatNumber(selectedRecipient.signedCount)}</strong>
                </div>
                <div>
                  <span>Last Activity</span>
                  <strong>{selectedRecipient.lastActivity}</strong>
                </div>
              </div>
              <div className="ent-drawer-table">
                <div className="ent-drawer-table-head">
                  <span>Document</span>
                  <span>Status</span>
                  <span>Progress</span>
                  <span>Activity</span>
                </div>
                {selectedRecipient.sessions
                  .sort((a, b) => new Date(b.lastActivityAt) - new Date(a.lastActivityAt))
                  .map((session) => (
                    <div className="ent-drawer-row" key={session.id}>
                      <div className="ent-drawer-doc">
                        <strong>{session.document}</strong>
                        <span>{session.language} · {session.progressText}</span>
                      </div>
                      <div>
                        <span className={`ent-badge ${session.status.className}`}>{session.status.label}</span>
                      </div>
                      <div className="ent-drawer-progress">
                        <div className="ent-progress-bar"><div className="ent-progress-fill" style={{ width: `${session.progress}%` }}></div></div>
                        <span>{session.progress}%</span>
                      </div>
                      <div className="ent-drawer-activity">{session.lastActivity}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .clickable { cursor: pointer; }
        .clickable:hover td { background: var(--slateish-50); }
      `}</style>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
