import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import {
  FiBarChart2, FiCheck, FiClock, FiDownload, FiEye, FiLink, FiPlus, FiSend, FiUpload, FiUsers,
} from 'react-icons/fi';
import EnterpriseUploadModal from '../../components/enterprise/EnterpriseUploadModal';
import { uploadEnterpriseDocument } from '../../lib/enterpriseUpload';

const languageMeta = {
  en: { label: 'English', flag: '🇺🇸', color: 'var(--emerald-600)' },
  es: { label: 'Spanish', flag: '🇪🇸', color: 'var(--amber-500)' },
  vi: { label: 'Vietnamese', flag: '🇻🇳', color: 'var(--brand-500)' },
  pt: { label: 'Portuguese', flag: '🇧🇷', color: 'var(--emerald-600)' },
  fr: { label: 'French', flag: '🇫🇷', color: 'var(--blue-600)' },
  zh: { label: 'Chinese (Mandarin)', flag: '🇨🇳', color: 'var(--red-500)' },
  yue: { label: 'Cantonese', flag: '🇭🇰', color: 'var(--red-500)' },
  ht: { label: 'Haitian Creole', flag: '🇭🇹', color: 'var(--blue-600)' },
  ne: { label: 'Nepali', flag: '🇳🇵', color: 'var(--brand-500)' },
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
      return { label: 'In progress', className: 'in-progress' };
    default:
      return { label: 'In progress', className: 'in-progress' };
  }
};

const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US').format(value);
};

const formatPercent = (value) => {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${Math.round(value)}%`;
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

const statusOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'opened', label: 'Opened' },
  { value: 'sent', label: 'Sent' },
  { value: 'in_progress', label: 'In Progress' },
];

const sortOptions = [
  { value: 'recent', label: 'Latest activity' },
  { value: 'oldest', label: 'Oldest activity' },
  { value: 'progress', label: 'Progress' },
  { value: 'name', label: 'Recipient name' },
  { value: 'document', label: 'Document name' },
];

export default function EnterpriseAdmin() {
  const { user, orgId, memberships, switchOrg, loading: authLoading } = useAuth({ redirectTo: '/enterprise/login' });
  const router = useRouter();
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [filters, setFilters] = useState({
    query: '',
    status: 'all',
    language: 'all',
    sort: 'recent',
  });
  const [lastUpdated, setLastUpdated] = useState(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [reqVerify, setReqVerify] = useState(false);
  const [reqVerifyBusy, setReqVerifyBusy] = useState(false);
  const refreshTimeoutRef = useRef(null);
  const activeRef = useRef(true);
  const [state, setState] = useState({
    loading: true,
    org: null,
    staffCount: 0,
    docs: [],
    sessions: [],
    chart: { labels: [], completed: [], opened: [] },
    languageBreakdown: [],
    activityFeed: [],
    recipients: [],
    kpi: {
      recipientsMonth: 0,
      sendLinksMonth: 0,
      completionRate: 0,
      avgCycleHours: null,
    },
  });

  // L1: load + toggle the org's "require recipient verification" policy.
  useEffect(() => {
    if (!orgId) return undefined;
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        const res = await fetch('/api/enterprise/org-settings', { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json().catch(() => ({}));
        if (active && res.ok) setReqVerify(Boolean(json.requireRecipientVerification));
      } catch { /* non-fatal */ }
    })();
    return () => { active = false; };
  }, [orgId]);

  const handleToggleReqVerify = useCallback(async () => {
    const next = !reqVerify;
    setReqVerifyBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/enterprise/org-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ requireRecipientVerification: next }),
      });
      if (res.ok) {
        setReqVerify(next);
        toast.success(next ? 'Recipient verification is now required' : 'Recipient verification is now optional');
      } else if (res.status === 403) {
        toast.error('Only an admin can change this setting.');
      } else {
        toast.error('Could not update the setting.');
      }
    } catch {
      toast.error('Could not update the setting.');
    } finally {
      setReqVerifyBusy(false);
    }
  }, [reqVerify]);

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
      .select('id, file_name, created_by, preferred_language, status, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);

    const docIds = docs.map((doc) => doc.id);
    let sessions = [];
    if (docIds.length > 0) {
      const { data } = await supabase
        .from('fill_sessions')
        .select('id, document_id, recipient_email, recipient_name, status, preferred_language, created_at, completed_at, first_opened_at, sent_at, client_user_id')
        .in('document_id', docIds)
        .order('created_at', { ascending: false })
        .limit(500);
      sessions = data || [];
    }

    if (!activeRef.current) return;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sessionsThisMonth = sessions.filter((session) => new Date(session.created_at) >= monthStart);
    const completedThisMonth = sessionsThisMonth.filter((session) => session.status === 'completed');
    const recipientsMonth = sessionsThisMonth.length;
    const completionRate = sessionsThisMonth.length
      ? (completedThisMonth.length / sessionsThisMonth.length) * 100
      : 0;

    const cycleDurations = completedThisMonth
      .map((session) => {
        const start = session.sent_at || session.created_at;
        if (!session.completed_at || !start) return null;
        return (new Date(session.completed_at) - new Date(start)) / 3600000;
      })
      .filter((val) => val !== null);
    const avgCycleHours = cycleDurations.length
      ? cycleDurations.reduce((sum, val) => sum + val, 0) / cycleDurations.length
      : null;

    const days = Array.from({ length: 8 }).map((_, idx) => {
      const d = new Date(now);
      d.setDate(now.getDate() - (7 - idx));
      return d;
    });
    const chartLabels = days.map((d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    const completedCounts = days.map((day) => {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      return sessions.filter((s) => s.completed_at && new Date(s.completed_at) >= start && new Date(s.completed_at) < end).length;
    });
    const openedCounts = days.map((day) => {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      return sessions.filter((s) => s.first_opened_at && new Date(s.first_opened_at) >= start && new Date(s.first_opened_at) < end).length;
    });

    const languageCounts = sessionsThisMonth.reduce((acc, session) => {
      const code = session.preferred_language || 'en';
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {});

    const languageBreakdown = Object.entries(languageCounts)
      .map(([code, count]) => ({
        code,
        count,
        label: languageMeta[code]?.label || code.toUpperCase(),
        flag: languageMeta[code]?.flag || '🌐',
        color: languageMeta[code]?.color || 'var(--slateish-300)',
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    const totalLang = languageBreakdown.reduce((sum, entry) => sum + entry.count, 0) || 1;
    const languageRows = languageBreakdown.map((entry) => ({
      ...entry,
      percent: Math.round((entry.count / totalLang) * 100),
    }));

    const activityFeed = sessions
      .slice(0, 4)
      .map((session) => {
        const doc = docs.find((d) => d.id === session.document_id);
        const name = session.recipient_name || session.recipient_email || 'Recipient';
        let action = 'sent';
        let dot = 'amber';
        if (session.completed_at || session.status === 'completed') {
          action = 'completed';
          dot = 'emerald';
        } else if (session.first_opened_at) {
          action = 'opened';
          dot = 'blue';
        }
        return {
          id: session.id,
          name,
          document: doc?.file_name || 'Document',
          action,
          dot,
          time: relativeTime(session.completed_at || session.first_opened_at || session.sent_at || session.created_at),
        };
      });

    const recentSessions = sessions.slice(0, 50);
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

    const recipients = recentSessions.map((session) => {
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
      };
    });

    if (!activeRef.current) return;

    setState({
      loading: false,
      org,
      staffCount: staffCount || 0,
      docs,
      sessions,
      chart: { labels: chartLabels, completed: completedCounts, opened: openedCounts },
      languageBreakdown: languageRows,
      activityFeed,
      recipients,
      kpi: {
        recipientsMonth,
        sendLinksMonth: recipientsMonth,
        completionRate,
        avgCycleHours,
      },
    });
    setLastUpdated(new Date());
  }, [orgId, user?.id]);

  const handleUploadConfirm = async ({ file, fileName, addAsTemplate }) => {
    if (!user?.id || !file) return;
    try {
      setUploading(true);
      const { data: { session } } = await supabase.auth.getSession();
      await uploadEnterpriseDocument({
        file,
        fileName,
        orgId,
        userId: user.id,
        addAsTemplate,
        accessToken: session?.access_token,
      });
      toast.success('Document uploaded');
      setUploadModalOpen(false);
    } catch (err) {
      console.error('Error uploading document:', err);
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleCreateSendLink = () => {
    router.push('/enterprise/send-links#create-send-link');
  };

  const handleBulkReminders = () => {
    router.push('/enterprise/recipients?mode=bulk-reminders');
  };

  const handleMonthlyReport = () => {
    const rows = [
      ['Monthly Report', monthLabel].join(','),
      ['Organization', orgName || '—'].join(','),
      ['Recipients (Month)', formatNumber(state.kpi.recipientsMonth)].join(','),
      ['Send Links (Month)', formatNumber(state.kpi.sendLinksMonth)].join(','),
      ['Completion Rate', formatPercent(state.kpi.completionRate)].join(','),
      ['Avg Cycle Hours', state.kpi.avgCycleHours ? Math.round(state.kpi.avgCycleHours) : '—'].join(','),
      '',
      ['Day', 'Completed', 'Opened'].join(','),
      ...state.chart.labels.map((label, idx) => [
        `"${label}"`,
        state.chart.completed[idx] || 0,
        state.chart.opened[idx] || 0,
      ].join(',')),
    ].join('\n');

    const blob = new Blob([rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `monthly-report-${monthLabel.replace(/\s+/g, '-').toLowerCase()}.csv`;
    link.click();
    window.URL.revokeObjectURL(url);
    toast.success('Monthly report downloaded');
  };

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
      .channel(`enterprise-live-${orgId}`)
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

  const monthLabel = useMemo(() => new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' }), []);
  const orgName = state.org?.name || 'Enterprise';
  const docCount = state.docs.length;
  const lastUpdatedLabel = lastUpdated
    ? lastUpdated.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    : '—';

  const chartMax = Math.max(...state.chart.completed, ...state.chart.opened, 1);

  const languageOptions = useMemo(
    () => [
      { value: 'all', label: 'All languages' },
      ...Object.entries(languageMeta).map(([code, meta]) => ({
        value: code,
        label: `${meta.flag} ${meta.label}`,
      })),
    ],
    [],
  );

  const filteredRecipients = useMemo(() => {
    const query = filters.query.trim().toLowerCase();
    let rows = [...state.recipients];

    if (query) {
      rows = rows.filter((row) => {
        return [
          row.recipientName,
          row.recipientEmail,
          row.document,
          row.assignedTo,
        ].some((value) => value?.toLowerCase().includes(query));
      });
    }

    if (filters.status !== 'all') {
      rows = rows.filter((row) => row.statusKey === filters.status);
    }

    if (filters.language !== 'all') {
      rows = rows.filter((row) => row.languageCode === filters.language);
    }

    rows.sort((a, b) => {
      if (filters.sort === 'recent') return new Date(b.lastActivityAt) - new Date(a.lastActivityAt);
      if (filters.sort === 'oldest') return new Date(a.lastActivityAt) - new Date(b.lastActivityAt);
      if (filters.sort === 'progress') return b.progress - a.progress;
      if (filters.sort === 'name') return a.recipientName.localeCompare(b.recipientName);
      if (filters.sort === 'document') return a.document.localeCompare(b.document);
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

  const exportSelected = () => {
    const selected = filteredRecipients.filter((r) => selectedIds.has(r.id));
    if (!selected.length) {
      toast('Select at least one recipient to export');
      return;
    }
    downloadRecipientsCsv(selected, 'admin-recipients-selected-export.csv');
  };

  const downloadRecipientsCsv = (rows, fileName = 'admin-recipients-export.csv') => {
    if (!rows.length) return;
    const csvRows = rows.map((r) => ({
      recipient_name: r.recipientName,
      recipient_email: r.recipientEmail,
      document: r.document,
      language: r.language,
      assigned_to: r.assignedTo,
      progress: r.progressText,
      status: r.status.label,
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

  const exportVisibleRecipients = () => {
    if (!filteredRecipients.length) {
      toast('No recipients to export');
      return;
    }
    downloadRecipientsCsv(filteredRecipients, 'admin-recipients-export.csv');
  };

  const topbarActions = (
    <>
      <button className="ent-btn outline" onClick={selectedIds.size > 0 ? exportSelected : exportVisibleRecipients}>
        <FiDownload size={13} /> Export
      </button>
      <button className="ent-btn primary" onClick={handleCreateSendLink}>
        <FiPlus size={14} /> New signing link
      </button>
    </>
  );

  if (state.loading || authLoading) {
    return (
      <>
        <Head>
          <title>Co Sign Enterprise — Organization Dashboard</title>
        </Head>
        <div className="ent-loading-screen">
          <div className="ent-loading-spinner"></div>
        </div>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>Co Sign Enterprise — Organization Dashboard</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="admin"
        pageTitle="Dashboard"
        pageSubtitle={`${orgName} · ${formatNumber(state.staffCount)} active staff · ${monthLabel}`}
        topbarActions={topbarActions}
        counts={{ documents: docCount, recipients: state.kpi.recipientsMonth }}
      >
        <EnterpriseUploadModal
          open={uploadModalOpen}
          uploading={uploading}
          onClose={() => setUploadModalOpen(false)}
          onConfirm={handleUploadConfirm}
        />
        <div className="kpi-row">
          <div className="ent-stat-card">
            <div className="ent-stat-icon"><FiUsers size={18} /></div>
            <div>
              <div className="ent-stat-val">{formatNumber(state.kpi.recipientsMonth)}</div>
              <div className="ent-stat-label">Recipients This Month</div>
            </div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon"><FiLink size={18} /></div>
            <div>
              <div className="ent-stat-val">{formatNumber(state.kpi.sendLinksMonth)}</div>
              <div className="ent-stat-label">Send Links Created</div>
            </div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon"><FiCheck size={18} /></div>
            <div>
              <div className="ent-stat-val">{formatPercent(state.kpi.completionRate)}</div>
              <div className="ent-stat-label">Completion Rate</div>
            </div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon"><FiClock size={18} /></div>
            <div>
              <div className="ent-stat-val">{state.kpi.avgCycleHours ? Math.round(state.kpi.avgCycleHours) : '—'}</div>
              <div className="ent-stat-label">Avg Cycle Time (hrs)</div>
            </div>
          </div>
        </div>

        <div className="quick-actions">
          <button className="quick-action-btn" onClick={handleCreateSendLink}>
            <div className="quick-action-icon"><FiLink size={16} /></div>
            <div>
              <h4>Create signing link</h4>
              <p>Send to a new recipient</p>
            </div>
          </button>
          <button className="quick-action-btn" onClick={handleBulkReminders}>
            <div className="quick-action-icon"><FiSend size={16} /></div>
            <div>
              <h4>Bulk reminders</h4>
              <p>{formatNumber(state.kpi.recipientsMonth)} recipients this month</p>
            </div>
          </button>
          <button className="quick-action-btn" onClick={handleMonthlyReport}>
            <div className="quick-action-icon"><FiBarChart2 size={16} /></div>
            <div>
              <h4>Download monthly report</h4>
              <p>PDF ready for compliance</p>
            </div>
          </button>
          <button className="quick-action-btn" onClick={() => setUploadModalOpen(true)}>
            <div className="quick-action-icon"><FiUpload size={16} /></div>
            <div>
              <h4>New Document</h4>
              <p>Start a new document flow</p>
            </div>
          </button>
        </div>

        <div className="ent-card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ maxWidth: 620 }}>
              <h3 style={{ margin: 0 }}>Require recipient verification</h3>
              <p style={{ margin: '6px 0 0', color: '#6f7b84', fontSize: 13 }}>
                When on, every signing link must include the recipient&apos;s email and last name, and the recipient must confirm them before opening the document — so a leaked link can&apos;t be filled or signed by just anyone. When off, you can still send quick links with no identity gate.
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleReqVerify}
              disabled={reqVerifyBusy}
              aria-pressed={reqVerify}
              style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 16px', borderRadius: 9999,
                border: `1px solid ${reqVerify ? '#4344b3' : '#dde3e7'}`,
                background: reqVerify ? '#4344b3' : '#fff',
                color: reqVerify ? '#fff' : '#3f4950',
                fontWeight: 700, fontSize: 14,
                cursor: reqVerifyBusy ? 'default' : 'pointer',
                opacity: reqVerifyBusy ? 0.6 : 1,
              }}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%',
                background: reqVerify ? '#9bf6c0' : '#c6d0d6', display: 'inline-block',
              }} />
              {reqVerify ? 'Required' : 'Optional'}
            </button>
          </div>
        </div>

        <div className="main-grid">
          <div className="ent-card">
            <div className="ent-card-header">
              <div>
                <h3>Document Completions</h3>
                <p>Documents fully completed by recipients</p>
              </div>
              <button className="ent-card-action" onClick={() => router.push('/enterprise/documents')}>
                View Details
              </button>
            </div>
            <div className="chart-area">
              <div className="chart-bars">
                {state.chart.labels.map((label, idx) => {
                  const completed = state.chart.completed[idx] || 0;
                  const opened = state.chart.opened[idx] || 0;
                  const completedHeight = Math.round((completed / chartMax) * 100);
                  const openedHeight = Math.round((opened / chartMax) * 100);
                  return (
                    <div className="chart-bar-group" key={`${label}-${idx}`}>
                      <div className="chart-bar" style={{ height: `${completedHeight}%`, background: 'var(--brand-500)' }}></div>
                      <div className="chart-bar" style={{ height: `${openedHeight}%`, background: 'var(--amber-500)' }}></div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-labels">
                {state.chart.labels.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
            </div>
            <div className="chart-legend">
              <div className="legend-item"><div className="legend-dot" style={{ background: 'var(--brand-500)' }}></div>Completed</div>
              <div className="legend-item"><div className="legend-dot" style={{ background: 'var(--amber-500)' }}></div>Opened</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div className="ent-card">
              <div className="ent-card-header">
                <div><h3>Language Breakdown</h3><p>This month</p></div>
              </div>
              <div className="lang-breakdown">
                {state.languageBreakdown.length === 0 && (
                  <div className="lang-row" style={{ marginBottom: 0 }}>
                    <span className="lang-flag">🌐</span>
                    <div className="lang-info">
                      <div className="lang-info-top"><span>No data yet</span><span className="pct">—</span></div>
                      <div className="lang-bar"><div className="lang-bar-fill" style={{ width: '8%', background: 'var(--slateish-300)', height: '100%', borderRadius: '3px' }}></div></div>
                    </div>
                  </div>
                )}
                {state.languageBreakdown.map((entry, idx) => (
                  <div className="lang-row" key={entry.code} style={idx === state.languageBreakdown.length - 1 ? { marginBottom: 0 } : undefined}>
                    <span className="lang-flag">{entry.flag}</span>
                    <div className="lang-info">
                      <div className="lang-info-top"><span>{entry.label}</span><span className="pct">{entry.percent}%</span></div>
                      <div className="lang-bar"><div className="lang-bar-fill" style={{ width: `${entry.percent}%`, background: entry.color, height: '100%', borderRadius: '3px' }}></div></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="ent-card">
              <div className="ent-card-header"><div><h3>Recent Activity</h3></div></div>
              <div className="activity-feed">
                {state.activityFeed.length === 0 && (
                  <div className="activity-item">
                    <div className="activity-dot amber"><FiLink size={11} /></div>
                    <div className="activity-text">
                      <p>No recent activity yet</p>
                      <div className="time">Waiting for recipients to take action</div>
                    </div>
                  </div>
                )}
                {state.activityFeed.map((item) => (
                  <div className="activity-item" key={item.id}>
                    <div className={`activity-dot ${item.dot}`}>{item.action === 'completed' ? <FiCheck size={11} /> : item.action === 'opened' ? <FiEye size={11} /> : <FiLink size={11} />}</div>
                    <div className="activity-text">
                      <p><strong>{item.name}</strong> {item.action} {item.document}</p>
                      <div className="time">{item.time}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="ent-card">
          <div className="ent-card-header">
            <div>
              <h3>Active Recipients</h3>
              <p>{formatNumber(state.kpi.recipientsMonth)} recipients this month — showing {filteredRecipients.length} of {state.sessions.length}</p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="ent-card-action"
                onClick={() => {
                  setFilters((prev) => ({ ...prev, status: 'all', language: 'all', sort: 'recent' }));
                  toast('Filters reset');
                }}
              >
                Filter
              </button>
              <button className="ent-card-action" onClick={() => router.push('/enterprise/recipients')}>
                View all
              </button>
            </div>
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
                value={filters.status}
                onChange={(event) => setFilters((prev) => ({ ...prev, status: event.target.value }))}
              >
                {statusOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={filters.language}
                onChange={(event) => setFilters((prev) => ({ ...prev, language: event.target.value }))}
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select
                value={filters.sort}
                onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value }))}
              >
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                className="table-refresh"
                onClick={() => loadData({ silent: true })}
              >
                <span className={`status-dot ${liveConnected ? 'live' : 'offline'}`}></span>
                {liveConnected ? 'Live' : 'Offline'} · Updated {lastUpdatedLabel}
              </button>
              {selectedIds.size > 0 && (
                <div className="ent-bulk-actions">
                  <span className="ent-bulk-count">{selectedIds.size} selected</span>
                  <button className="ent-bulk-btn" onClick={exportSelected}>Export CSV</button>
                  <button className="ent-bulk-btn ghost" onClick={clearSelection}>Clear</button>
                </div>
              )}
            </div>
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
                  <th>Document</th>
                  <th>Language</th>
                  <th>Assigned To</th>
                  <th>Progress</th>
                  <th>Status</th>
                  <th>Last Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredRecipients.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: '20px 24px', color: 'var(--slateish-400)', fontSize: '13px' }}>
                      No recipients match those filters yet.
                    </td>
                  </tr>
                )}
                {filteredRecipients.map((recipient) => (
                  <tr key={recipient.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(recipient.id)}
                        onChange={() => toggleSelected(recipient.id)}
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
                    <td style={{ fontSize: '13px', color: 'var(--slateish-700)' }}>{recipient.document}</td>
                    <td style={{ fontSize: '18px' }}>{recipient.language}</td>
                    <td style={{ fontSize: '13px', color: 'var(--slateish-600)' }}>{recipient.assignedTo}</td>
                    <td>
                      <div className="progress-cell">
                        <div className="ent-progress-bar"><div className="ent-progress-fill" style={{ width: `${recipient.progress}%` }}></div></div>
                        <span className="progress-text">{recipient.progressText}</span>
                      </div>
                    </td>
                    <td><span className={`ent-badge ${recipient.status.className}`}>{recipient.status.label}</span></td>
                    <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{recipient.lastActivity}</td>
                    <td>
                      <button
                        className="ent-table-action-btn"
                        onClick={() => router.push('/enterprise/recipients')}
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

      <style jsx>{`
        .kpi-row {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 24px;
        }

        .quick-actions {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 16px;
          margin-bottom: 24px;
        }

        .quick-action-btn {
          background: #fff;
          border-radius: var(--r-lg);
          border: 1px solid var(--slateish-100);
          padding: 16px 18px;
          display: flex;
          align-items: center;
          gap: 12px;
          cursor: pointer;
          text-align: left;
          transition: all .2s;
          font-family: inherit;
        }

        .quick-action-btn:hover {
          border-color: var(--slateish-200);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
        }

        .quick-action-icon {
          width: 36px;
          height: 36px;
          border-radius: var(--r-sm);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          background: var(--brand-50);
        }

        .quick-action-btn h4 {
          font-size: 13px;
          font-weight: 700;
          color: var(--slateish-900);
        }

        .quick-action-btn p {
          font-size: 11px;
          color: var(--slateish-400);
          margin-top: 2px;
        }

        .main-grid {
          display: grid;
          grid-template-columns: 1fr 340px;
          gap: 20px;
          margin-bottom: 24px;
        }

        .chart-area {
          padding: 24px 24px 12px;
        }

        .chart-bars {
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          gap: 10px;
          align-items: end;
          height: 180px;
          margin-bottom: 12px;
        }

        .chart-bar-group {
          display: flex;
          align-items: flex-end;
          gap: 4px;
          height: 100%;
        }

        .chart-bar {
          width: 100%;
          border-radius: 4px 4px 0 0;
        }

        .chart-labels {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--slateish-400);
        }

        .chart-legend {
          display: flex;
          gap: 16px;
          padding: 0 24px 18px;
          font-size: 11px;
          color: var(--slateish-500);
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .legend-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .lang-breakdown {
          padding: 16px 20px 20px;
        }

        .lang-row {
          display: flex;
          gap: 12px;
          margin-bottom: 14px;
        }

        .lang-flag {
          font-size: 18px;
        }

        .lang-info {
          flex: 1;
        }

        .lang-info-top {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 600;
          color: var(--slateish-700);
          margin-bottom: 6px;
        }

        .lang-info-top .pct {
          color: var(--slateish-400);
        }

        .lang-bar {
          height: 6px;
          border-radius: 3px;
          background: var(--slateish-100);
          overflow: hidden;
        }

        .lang-bar-fill {
          display: block;
        }

        .activity-feed {
          padding: 6px 20px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .activity-item {
          display: flex;
          gap: 12px;
        }

        .activity-dot {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }

        .activity-dot.emerald {
          background: var(--emerald-50);
          color: var(--emerald-600);
        }

        .activity-dot.blue {
          background: var(--blue-50);
          color: var(--blue-600);
        }

        .activity-dot.red {
          background: var(--red-50);
          color: var(--red-500);
        }

        .activity-dot.amber {
          background: var(--amber-50);
          color: var(--amber-500);
        }

        .activity-text p {
          font-size: 12px;
          color: var(--slateish-700);
          line-height: 1.35;
        }

        .activity-text .time {
          font-size: 11px;
          color: var(--slateish-400);
          margin-top: 4px;
        }

        .table-refresh {
          border: 1px dashed var(--slateish-200);
          border-radius: var(--r-full);
          padding: 7px 12px;
          font-size: 11px;
          color: var(--slateish-500);
          background: #fff;
          font-family: inherit;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          transition: all .2s;
        }

        .table-refresh:hover {
          border-color: var(--slateish-300);
          color: var(--slateish-700);
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          display: inline-block;
        }

        .status-dot.live {
          background: #22c55e;
        }

        .status-dot.offline {
          background: #f97316;
        }

        .progress-cell {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .progress-text {
          font-size: 11px;
          color: var(--slateish-400);
        }

        @media (max-width: 1200px) {
          .kpi-row {
            grid-template-columns: repeat(2, 1fr);
          }
          .quick-actions {
            grid-template-columns: repeat(2, 1fr);
          }
          .main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 900px) {
          .kpi-row {
            grid-template-columns: 1fr;
          }
          .quick-actions {
            grid-template-columns: 1fr;
          }
          .chart-bars {
            grid-template-columns: repeat(4, 1fr);
            height: 140px;
          }
        }
      `}</style>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
