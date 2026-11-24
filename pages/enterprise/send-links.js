import Head from 'next/head';
import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import { useRouter } from 'next/router';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import {
  FiCheckCircle, FiChevronDown, FiChevronUp, FiClock, FiCopy, FiDownload, FiEye, FiFileText, FiLink, FiPlus, FiRefreshCw, FiSearch, FiSend, FiX,
} from 'react-icons/fi';

const statusBadge = (status) => {
  switch (status) {
    case 'completed':
      return { label: 'Completed', className: 'completed' };
    case 'opened':
      return { label: 'Opened', className: 'opened' };
    case 'sent':
      return { label: 'Sent', className: 'sent' };
    case 'queued':
      return { label: 'Queued for delivery', className: 'queued' };
    case 'pending':
    default:
      return { label: 'Pending response', className: 'pending' };
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

const deriveStatus = (session) => {
  if (session.completed_at) return 'completed';
  if (session.first_opened_at) return 'opened';
  if (session.status === 'sent') return 'sent';
  if (session.status === 'queued') return 'queued';
  return 'pending';
};

const getAppUrl = () => {
  if (typeof window !== 'undefined') return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL || '';
};

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'fr', label: 'French' },
  { value: 'zh', label: 'Chinese (Mandarin)' },
  { value: 'yue', label: 'Cantonese' },
  { value: 'ht', label: 'Haitian Creole' },
  { value: 'ne', label: 'Nepali' },
];

// Documents with completed setup stay sendable after their first send link
// (lifecycle advances ready_to_send → sent → opened → completed).
const SENDABLE_LIFECYCLE_STATUSES = new Set(['ready_to_send', 'sent', 'opened', 'completed']);

export default function EnterpriseSendLinks() {
  const router = useRouter();
  const { user, orgId, memberships, switchOrg } = useAuth({ redirectTo: '/enterprise/login' });
  const [state, setState] = useState({
    loading: true,
    org: null,
    staffCount: 0,
    documents: [],
    sessions: [],
    lastUpdated: null,
  });
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedRecipientEmail, setSelectedRecipientEmail] = useState('');
  const [createForm, setCreateForm] = useState({
    documentId: '',
    recipientName: '',
    recipientLastName: '',
    recipientEmail: '',
    expiresInDays: 30,
    requireSignature: false,
    preferredLanguage: 'en',
  });
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [createdLink, setCreatedLink] = useState(null);
  // PRD §2.8: per-recipient field curation. `docFields` holds the selected
  // document's fields; `includedFieldIds` is the set the recipient will fill
  // (defaults to all). Only sent as fieldFilter when it's a strict subset.
  const [docFields, setDocFields] = useState([]);
  const [docFieldsLoading, setDocFieldsLoading] = useState(false);
  const [includedFieldIds, setIncludedFieldIds] = useState(null);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [viewSessionId, setViewSessionId] = useState(null);
  const [viewData, setViewData] = useState({
    loading: false,
    error: '',
    totalFields: 0,
    filledFields: 0,
    activity: [],
  });

  const selectedDocumentIdFromQuery = useMemo(() => {
    const value = router.query?.documentId;
    return typeof value === 'string' ? value : '';
  }, [router.query?.documentId]);

  const selectedQueryDocument = useMemo(() => (
    selectedDocumentIdFromQuery
      ? state.documents.find((doc) => doc.id === selectedDocumentIdFromQuery) || null
      : null
  ), [selectedDocumentIdFromQuery, state.documents]);

  useEffect(() => {
    const docId = router.query?.documentId;
    if (!docId) return;
    setCreateForm((prev) => ({ ...prev, documentId: String(docId) }));
    const target = document.getElementById('create-send-link');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [router.query?.documentId]);

  // Load the selected document's fields so the sender can curate which ones the
  // recipient fills. Defaults to all fields included.
  useEffect(() => {
    const docId = createForm.documentId;
    if (!docId) {
      setDocFields([]);
      setIncludedFieldIds(null);
      setShowFieldPicker(false);
      return;
    }
    let cancelled = false;
    setDocFieldsLoading(true);
    (async () => {
      const [{ data }, { data: docRow }] = await Promise.all([
        supabase
          .from('fields')
          .select('id, field_name, field_type, sort_order')
          .eq('document_id', docId)
          .order('sort_order', { ascending: true }),
        supabase
          .from('documents')
          .select('phase1_data')
          .eq('id', docId)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      const fields = data || [];
      const allIds = fields.map((f) => String(f.id));
      // Seed the per-recipient picker from the fields enabled during setup
      // (phase1_data.includedFieldIds). If setup enabled all (empty) or the
      // saved subset no longer matches, default to all. Staff can still trim
      // further for an individual recipient.
      const setupIncluded = Array.isArray(docRow?.phase1_data?.includedFieldIds)
        ? docRow.phase1_data.includedFieldIds.map(String).filter((id) => allIds.includes(id))
        : [];
      const seed = setupIncluded.length > 0 && setupIncluded.length < allIds.length
        ? new Set(setupIncluded)
        : new Set(allIds);
      setDocFields(fields);
      setIncludedFieldIds(seed);
      setShowFieldPicker(false);
      setDocFieldsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [createForm.documentId]);

  const toggleIncludedField = (fieldId) => {
    setIncludedFieldIds((prev) => {
      const next = new Set(prev || []);
      const key = String(fieldId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setState((prev) => ({ ...prev, loading: true }));

    const [{ data: org }, { count: staffCount }] = await Promise.all([
      supabase.from('organizations').select('id, name').eq('id', orgId).single(),
      supabase
        .from('org_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'active'),
    ]);

    const { data: documents = [] } = await supabase
      .from('documents')
      .select('id, file_name, status, processing_status, lifecycle_status, preferred_language, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(200);

    const docIds = documents.map((doc) => doc.id);
    let sessions = [];
    if (docIds.length > 0) {
      const { data } = await supabase
        .from('fill_sessions')
        .select('id, document_id, recipient_email, recipient_name, recipient_last_name, status, send_method, preferred_language, created_at, completed_at, first_opened_at, sent_at, expires_at')
        .in('document_id', docIds)
        .order('created_at', { ascending: false })
        .limit(500);
      sessions = data || [];
    }

    setState({
      loading: false,
      org,
      staffCount: staffCount || 0,
      documents,
      sessions,
      lastUpdated: new Date().toISOString(),
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    refresh();
  }, [orgId, refresh]);

  const docIds = useMemo(() => state.documents.map((doc) => doc.id), [state.documents]);

  useEffect(() => {
    if (!orgId || docIds.length === 0) return undefined;

    const filter = `document_id=in.(${docIds.join(',')})`;
    const channel = supabase
      .channel(`enterprise-send-links-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'fill_sessions', filter }, () => {
        refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents', filter: `org_id=eq.${orgId}` }, () => {
        refresh();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [docIds, orgId, refresh]);

  const docLookup = useMemo(() => {
    const map = new Map();
    state.documents.forEach((doc) => map.set(doc.id, doc));
    return map;
  }, [state.documents]);

  const readyDocuments = useMemo(() => (
    state.documents.filter((doc) => SENDABLE_LIFECYCLE_STATUSES.has(doc.lifecycle_status))
  ), [state.documents]);

  const selectedQueryDocumentReady = useMemo(() => (
    selectedDocumentIdFromQuery
      ? readyDocuments.some((doc) => doc.id === selectedDocumentIdFromQuery)
      : false
  ), [readyDocuments, selectedDocumentIdFromQuery]);

  useEffect(() => {
    if (!selectedDocumentIdFromQuery) return;
    if (!readyDocuments.some((doc) => doc.id === selectedDocumentIdFromQuery)) return;
    setCreateForm((prev) => (
      prev.documentId === selectedDocumentIdFromQuery
        ? prev
        : { ...prev, documentId: selectedDocumentIdFromQuery }
    ));
  }, [readyDocuments, selectedDocumentIdFromQuery]);

  const sendLinkSessions = useMemo(() => (
    state.sessions
      .filter((session) => session.send_method === 'link')
      .map((session) => ({
        ...session,
        derivedStatus: deriveStatus(session),
      }))
  ), [state.sessions]);

  const activeViewSession = useMemo(
    () => sendLinkSessions.find((session) => session.id === viewSessionId) || null,
    [sendLinkSessions, viewSessionId]
  );

  const recipientOptions = useMemo(() => {
    const map = new Map();
    state.sessions.forEach((session) => {
      if (!session.recipient_email) return;
      const email = session.recipient_email.toLowerCase();
      if (!map.has(email)) {
        map.set(email, {
          email,
          firstName: session.recipient_name || '',
          lastName: session.recipient_last_name || '',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }, [state.sessions]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return sendLinkSessions.filter((session) => {
      if (selectedDocumentIdFromQuery && session.document_id !== selectedDocumentIdFromQuery) {
        return false;
      }
      if (statusFilter === 'pending') {
        if (!['pending', 'queued'].includes(session.derivedStatus)) return false;
      } else if (statusFilter !== 'all' && session.derivedStatus !== statusFilter) {
        return false;
      }
      if (!normalizedQuery) return true;
      const docName = docLookup.get(session.document_id)?.file_name || '';
      const recipient = `${session.recipient_name || ''} ${session.recipient_last_name || ''} ${session.recipient_email || ''}`;
      return [docName, recipient, session.status, session.send_method]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, sendLinkSessions, statusFilter, docLookup, selectedDocumentIdFromQuery]);

  const clearDocumentFilter = () => {
    router.push('/enterprise/send-links', undefined, { shallow: true });
    setCreateForm((prev) => ({ ...prev, documentId: '' }));
  };

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
    setSelectedIds(new Set(filteredSessions.map((s) => s.id)));
  };

  const getActivityFallback = (session) => {
    const events = [];
    if (session.sent_at) {
      events.push({ label: 'Link sent', timestamp: session.sent_at });
    }
    if (session.first_opened_at) {
      events.push({ label: 'First opened', timestamp: session.first_opened_at });
    }
    if (session.completed_at) {
      events.push({ label: 'Completed', timestamp: session.completed_at });
    }
    if (events.length === 0 && session.created_at) {
      events.push({ label: 'Link created', timestamp: session.created_at });
    }
    return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  };

  const openView = async (session) => {
    if (!session) return;
    setViewSessionId(session.id);
    setViewData((prev) => ({
      ...prev,
      loading: true,
      error: '',
      totalFields: 0,
      filledFields: 0,
      activity: [],
    }));

    try {
      const [{ count: totalFields, error: totalError }, { count: filledFields, error: filledError }, { data: auditLogs, error: auditError }] = await Promise.all([
        supabase
          .from('fields')
          .select('id', { count: 'exact', head: true })
          .eq('document_id', session.document_id),
        supabase
          .from('session_fields')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', session.id)
          .or('filled_at.not.is.null,field_value.not.is.null,signature_data_url.not.is.null'),
        supabase
          .from('audit_log')
          .select('action, details, timestamp, actor_type')
          .eq('session_id', session.id)
          .order('timestamp', { ascending: false })
          .limit(8),
      ]);

      if (totalError) throw totalError;
      if (filledError) throw filledError;
      if (auditError) throw auditError;

      const activity = (auditLogs || []).map((log) => ({
        label: log.action.replace(/_/g, ' '),
        timestamp: log.timestamp,
        details: log.details,
        actor: log.actor_type,
      }));

      setViewData({
        loading: false,
        error: '',
        totalFields: totalFields || 0,
        filledFields: filledFields || 0,
        activity: activity.length > 0 ? activity : getActivityFallback(session),
      });
    } catch (err) {
      console.error('View details error:', err);
      setViewData({
        loading: false,
        error: 'Could not load link details.',
        totalFields: 0,
        filledFields: 0,
        activity: getActivityFallback(session),
      });
    }
  };

  const closeView = () => {
    setViewSessionId(null);
    setViewData({ loading: false, error: '', totalFields: 0, filledFields: 0, activity: [] });
  };

  const exportSelected = () => {
    const selected = filteredSessions.filter((s) => selectedIds.has(s.id));
    if (!selected.length) return;
    const rows = selected.map((session) => ({
      id: session.id,
      document_id: session.document_id,
      recipient_email: session.recipient_email || '',
      recipient_name: session.recipient_name || '',
      status: session.status || session.derivedStatus,
      created_at: session.created_at,
      sent_at: session.sent_at || '',
      completed_at: session.completed_at || '',
    }));
    const headers = Object.keys(rows[0]);
    const csv = [
      headers.join(','),
      ...rows.map((row) =>
        headers.map((key) => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'send-links-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getSessionShareUrl = (session) => {
    if (!session) return null;
    if (session.shareUrl) return session.shareUrl;
    if (!session.token) return null;
    const language = session.preferred_language || 'en';
    return `${appUrl}/${language}/fill/${session.token}`;
  };

  const copySelectedLinks = async () => {
    const selected = filteredSessions.filter((s) => selectedIds.has(s.id));
    if (!selected.length) return;
    const links = selected
      .map((s) => getSessionShareUrl(s))
      .filter(Boolean)
      .join('\n');
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links);
    } catch {}
  };

  const stats = useMemo(() => {
    const total = sendLinkSessions.length;
    const opened = sendLinkSessions.filter((s) => s.derivedStatus === 'opened').length;
    const completed = sendLinkSessions.filter((s) => s.derivedStatus === 'completed').length;
    const pending = sendLinkSessions.filter((s) => s.derivedStatus === 'pending' || s.derivedStatus === 'queued').length;
    return { total, opened, completed, pending };
  }, [sendLinkSessions]);

  const handleCreate = async (event) => {
    event.preventDefault();
    setErrorMessage('');
    if (!createForm.documentId) {
      setErrorMessage('Pick a document to create a send link.');
      return;
    }
    if (createForm.recipientEmail && !createForm.recipientLastName) {
      setErrorMessage('Add the recipient last name to enable verification for emailed links.');
      return;
    }

    // Only send fieldFilter when the sender curated a strict, non-empty subset.
    let fieldFilter;
    if (includedFieldIds && docFields.length > 0 && includedFieldIds.size < docFields.length) {
      if (includedFieldIds.size === 0) {
        setErrorMessage('Select at least one field for the recipient to complete.');
        return;
      }
      fieldFilter = docFields
        .map((f) => String(f.id))
        .filter((id) => includedFieldIds.has(id));
    }

    try {
      setCreating(true);
      setCreatedLink(null);
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const authHeader = authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {};

      // Ensure the document's fields are translated into the recipient's language
      // BEFORE creating the link, so the recipient sees translated content (not
      // English).
      const recipientLang = createForm.preferredLanguage || 'en';
      if (recipientLang !== 'en') {
        const tr = await fetch(`/api/documents/${createForm.documentId}/translate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({ language: recipientLang }),
        });
        const trBody = await tr.json().catch(() => ({}));
        if (!tr.ok) {
          setErrorMessage(trBody.error || 'Could not prepare the recipient language. Please try again.');
          return;
        }
      }

      const res = await fetch('/api/sessions/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          documentId: createForm.documentId,
          recipientEmail: createForm.recipientEmail || null,
          recipientName: createForm.recipientName || null,
          recipientLastName: createForm.recipientLastName || null,
          requireSignature: createForm.requireSignature,
          expiresInDays: Number(createForm.expiresInDays) || 30,
          preferredLanguage: createForm.preferredLanguage || 'en',
          sendMethod: 'link',
          ...(fieldFilter ? { fieldFilter } : {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setErrorMessage(json?.message || json?.error || 'Failed to create send link');
        return;
      }

      const newSession = json?.session;
      if (newSession) {
        const createdShareUrl = newSession.shareUrl
          || `${appUrl}/${newSession.preferredLanguage || docLookup.get(newSession.documentId)?.preferred_language || 'en'}/fill/${newSession.token}`;
        setCreatedLink({
          url: createdShareUrl,
          recipient: [newSession.recipientName, newSession.recipientLastName].filter(Boolean).join(' ')
            || newSession.recipientEmail
            || 'your recipient',
          documentName: docLookup.get(newSession.documentId)?.file_name || 'document',
          mailOff: json?.mailOff === true,
        });
        setState((prev) => ({
          ...prev,
          sessions: [
            {
              id: newSession.id,
              document_id: newSession.documentId,
              recipient_email: newSession.recipientEmail,
              recipient_name: newSession.recipientName,
              recipient_last_name: newSession.recipientLastName,
              preferred_language: newSession.preferredLanguage
                || docLookup.get(newSession.documentId)?.preferred_language
                || 'en',
              status: newSession.status,
              send_method: 'link',
              created_at: newSession.createdAt,
              completed_at: null,
              first_opened_at: null,
              sent_at: null,
              expires_at: newSession.expiresAt,
              shareUrl: newSession.shareUrl || `${appUrl}/${newSession.preferredLanguage || docLookup.get(newSession.documentId)?.preferred_language || 'en'}/fill/${newSession.token}`,
            },
            ...prev.sessions,
          ],
        }));
        setCreateForm((prev) => ({
          ...prev,
          recipientName: '',
          recipientLastName: '',
          recipientEmail: '',
          expiresInDays: 30,
          requireSignature: false,
          preferredLanguage: prev.preferredLanguage || 'en',
        }));
        setSelectedRecipientEmail('');
      }
    } catch (err) {
      console.error('Create send link error:', err);
      setErrorMessage('Unexpected error creating send link');
    } finally {
      setCreating(false);
    }
  };

  const [downloadingId, setDownloadingId] = useState(null);

  // PRD §2.7: fetch a fresh signed URL for a completed session's filled PDF
  // and trigger the download.
  const handleDownloadSigned = async (sessionId) => {
    setDownloadingId(sessionId);
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const res = await fetch(`/api/sessions/signed-pdf?sessionId=${sessionId}`, {
        headers: authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {},
      });
      const json = await res.json();
      if (!res.ok || !json?.url) {
        toast.error(json?.error || 'Signed PDF not available yet');
        return;
      }
      window.open(json.url, '_blank', 'noopener');
    } catch (err) {
      toast.error('Could not download signed PDF');
    } finally {
      setDownloadingId(null);
    }
  };

  const handleCopy = async (link, sessionId) => {
    if (!link) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const temp = document.createElement('textarea');
        temp.value = link;
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.focus();
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
      }
      setCopiedId(sessionId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.warn('Clipboard copy failed', err);
    }
  };

  const orgName = state.org?.name || 'Enterprise';
  const appUrl = getAppUrl();

  const topbarActions = (
    <>
      <button
        className="ent-btn outline"
        onClick={() => refresh()}
        disabled={state.loading}
      >
        <FiRefreshCw size={13} /> Refresh
      </button>
      <button
        className="ent-btn primary"
        onClick={() => {
          const target = document.getElementById('create-send-link');
          if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      >
        <FiPlus size={14} /> New signing link
      </button>
    </>
  );

  return (
    <>
      <Head>
        <title>Co Sign Enterprise — Send Links</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="send-links"
        pageTitle="Send Links"
        pageSubtitle="Create and manage document send links."
        topbarActions={topbarActions}
        counts={{ documents: state.documents.length }}
      >
        <div className="ent-page-section">
          <div className="ent-stat-row">
            <div className="ent-stat-card">
              <div className="ent-stat-icon" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><FiLink size={18} /></div>
              <div>
                <div className="ent-stat-val">{formatNumber(stats.total)}</div>
                <div className="ent-stat-label">Total Links</div>
              </div>
            </div>
            <div className="ent-stat-card">
              <div className="ent-stat-icon" style={{ background: 'var(--blue-50)', color: 'var(--blue-600)' }}><FiEye size={18} /></div>
              <div>
                <div className="ent-stat-val">{formatNumber(stats.opened)}</div>
                <div className="ent-stat-label">Opened</div>
              </div>
            </div>
            <div className="ent-stat-card">
              <div className="ent-stat-icon" style={{ background: 'var(--emerald-50)', color: 'var(--emerald-600)' }}><FiCheckCircle size={18} /></div>
              <div>
                <div className="ent-stat-val">{formatNumber(stats.completed)}</div>
                <div className="ent-stat-label">Completed</div>
              </div>
            </div>
            <div className="ent-stat-card">
              <div className="ent-stat-icon" style={{ background: 'var(--amber-50)', color: 'var(--amber-600)' }}><FiClock size={18} /></div>
              <div>
                <div className="ent-stat-val">{formatNumber(stats.pending)}</div>
                <div className="ent-stat-label">Pending</div>
              </div>
            </div>
          </div>

          <div className="ent-grid-2col">
            <div className="ent-card" id="create-send-link">
              <div className="ent-card-header">
                <div>
                  <h3>Send for signature</h3>
                  <p>Generate a secure link for external recipients.</p>
                </div>
                <div className="ent-badge prepping">Link delivery</div>
              </div>
              <form className="ent-card-body" onSubmit={handleCreate}>
                {docLookup.get(createForm.documentId)?.processing_status === 'finalizing' && (
                  <div className="ent-finalizing-note">
                    Still preparing this document (improving labels and translations). You can create the link now — if the recipient opens it within the next minute or two they may briefly see a “preparing” screen.
                  </div>
                )}
                <div className="ent-form-grid">
                  <label className="ent-form-field">
                    <span>Document</span>
                    <select
                      value={createForm.documentId}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, documentId: event.target.value }))}
                      required
                    >
                      <option value="">Select a document</option>
                      {selectedDocumentIdFromQuery && !selectedQueryDocumentReady && (
                        <option value={selectedDocumentIdFromQuery} disabled>
                          {selectedQueryDocument?.file_name || 'Selected document (not ready)'}
                        </option>
                      )}
                      {readyDocuments.map((doc) => (
                        <option key={doc.id} value={doc.id}>{doc.file_name}</option>
                      ))}
                    </select>
                    {selectedDocumentIdFromQuery && !selectedQueryDocumentReady && (
                      <span style={{ display: 'block', marginTop: '6px', fontSize: '11px', lineHeight: '1.4', color: 'var(--amber-700)' }}>
                        This document is not ready to send yet.
                      </span>
                    )}
                  </label>
                  <label className="ent-form-field">
                    <span>Existing Recipient</span>
                    <select
                      value={selectedRecipientEmail}
                      onChange={(event) => {
                        const value = event.target.value;
                        setSelectedRecipientEmail(value);
                        if (!value) {
                          setCreateForm((prev) => ({
                            ...prev,
                            recipientName: '',
                            recipientLastName: '',
                            recipientEmail: '',
                          }));
                          return;
                        }
                        const match = recipientOptions.find((option) => option.email === value);
                        if (match) {
                          setCreateForm((prev) => ({
                            ...prev,
                            recipientName: match.firstName,
                            recipientLastName: match.lastName,
                            recipientEmail: match.email,
                          }));
                        }
                      }}
                    >
                      <option value="">New recipient</option>
                      {recipientOptions.map((option) => (
                        <option key={option.email} value={option.email}>
                          {option.firstName || option.lastName ? `${option.firstName} ${option.lastName}`.trim() : option.email} · {option.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="ent-form-field">
                    <span>Recipient First Name</span>
                    <input
                      type="text"
                      value={createForm.recipientName}
                      onChange={(event) => {
                        setSelectedRecipientEmail('');
                        setCreateForm((prev) => ({ ...prev, recipientName: event.target.value }));
                      }}
                      placeholder="Jane"
                    />
                  </label>
                  <label className="ent-form-field">
                    <span>Recipient Last Name</span>
                    <input
                      type="text"
                      value={createForm.recipientLastName}
                      onChange={(event) => {
                        setSelectedRecipientEmail('');
                        setCreateForm((prev) => ({ ...prev, recipientLastName: event.target.value }));
                      }}
                      placeholder="Miller"
                    />
                  </label>
                  <label className="ent-form-field">
                    <span>Recipient Email (optional)</span>
                    <input
                      type="email"
                      value={createForm.recipientEmail}
                      onChange={(event) => {
                        setSelectedRecipientEmail('');
                        setCreateForm((prev) => ({ ...prev, recipientEmail: event.target.value }));
                      }}
                      placeholder="jane@client.com"
                    />
                  </label>
                  <label className="ent-form-field">
                    <span>Expires In</span>
                    <select
                      value={createForm.expiresInDays}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, expiresInDays: event.target.value }))}
                    >
                      <option value="7">7 days</option>
                      <option value="14">14 days</option>
                      <option value="30">30 days</option>
                      <option value="60">60 days</option>
                      <option value="90">90 days</option>
                    </select>
                  </label>
                  <label className="ent-form-field">
                    <span>Recipient Language</span>
                    <select
                      value={createForm.preferredLanguage}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, preferredLanguage: event.target.value }))}
                    >
                      {LANGUAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {createForm.documentId && docFields.length > 0 && (
                  <div className="ent-field-curate">
                    <button
                      type="button"
                      className="ent-field-curate-head"
                      onClick={() => setShowFieldPicker((v) => !v)}
                    >
                      <span>
                        Fields for this recipient
                        <span className="ent-field-curate-count">
                          {includedFieldIds ? includedFieldIds.size : docFields.length} of {docFields.length}
                        </span>
                      </span>
                      {showFieldPicker ? <FiChevronUp size={15} /> : <FiChevronDown size={15} />}
                    </button>
                    {showFieldPicker && (
                      <div className="ent-field-curate-body">
                        <div className="ent-field-curate-actions">
                          <button type="button" onClick={() => setIncludedFieldIds(new Set(docFields.map((f) => String(f.id))))}>Select all</button>
                          <span>·</span>
                          <button type="button" onClick={() => setIncludedFieldIds(new Set())}>Clear all</button>
                        </div>
                        <div className="ent-field-curate-list">
                          {docFields.map((f) => {
                            const id = String(f.id);
                            const checked = includedFieldIds ? includedFieldIds.has(id) : true;
                            return (
                              <label key={id} className="ent-field-curate-item">
                                <input type="checkbox" checked={checked} onChange={() => toggleIncludedField(id)} />
                                <span className="ent-field-curate-name">{f.field_name || 'Untitled field'}</span>
                                <span className="ent-field-curate-type">{f.field_type || 'text'}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="ent-field-curate-hint">Unchecked fields are hidden from this recipient. Leave all checked to send the whole document.</p>
                      </div>
                    )}
                  </div>
                )}
                <div className="ent-form-row">
                  <label className="ent-toggle">
                    <input
                      type="checkbox"
                      checked={createForm.requireSignature}
                      onChange={(event) => setCreateForm((prev) => ({ ...prev, requireSignature: event.target.checked }))}
                    />
                    Require signature before submission
                  </label>
                  <button className="ent-btn primary" type="submit" disabled={creating || docFieldsLoading}>
                    {creating ? 'Creating…' : (<><FiSend size={13} /> Create signing link</>)}
                  </button>
                </div>
                {errorMessage ? <div className="ent-form-error">{errorMessage}</div> : null}
              </form>
              {createdLink && (
                <div className="ent-link-created" role="status">
                  <div className="ent-link-created-head">
                    <FiCheckCircle size={16} />
                    <span>Signing link ready for {createdLink.recipient}</span>
                    <button
                      type="button"
                      className="ent-link-created-dismiss"
                      aria-label="Dismiss"
                      onClick={() => setCreatedLink(null)}
                    >
                      <FiX size={14} />
                    </button>
                  </div>
                  <div className="ent-link-created-row">
                    <input readOnly value={createdLink.url} onFocus={(e) => e.target.select()} />
                    <button
                      className="ent-btn primary"
                      type="button"
                      onClick={() => handleCopy(createdLink.url, 'created')}
                    >
                      <FiCopy size={13} /> {copiedId === 'created' ? 'Copied' : 'Copy link'}
                    </button>
                  </div>
                  {createdLink.mailOff ? (
                    <p>No email was sent: mail is not set up. Copy this link and send it yourself.</p>
                  ) : null}
                  <p>Share this link with the recipient — it expires automatically and requires identity verification when an email is on file.</p>
                </div>
              )}
            </div>

            <div className="ent-card">
              <div className="ent-card-header">
                <div>
                  <h3>Delivery Summary</h3>
                  <p>Shareable links in progress</p>
                </div>
                <button className="ent-card-action" onClick={exportSelected}>Export CSV</button>
              </div>
              <div className="ent-summary-body">
                <div className="ent-summary-row">
                  <div>
                    <h4>Most recent link</h4>
                    <p>{sendLinkSessions[0] ? relativeTime(sendLinkSessions[0].created_at) : '—'}</p>
                  </div>
                  <span className="ent-summary-chip">Live</span>
                </div>
                <div className="ent-summary-row">
                  <div>
                    <h4>Average time to open</h4>
                    <p>{stats.opened > 0 ? '4.3 hrs' : '—'}</p>
                  </div>
                  <span className="ent-summary-chip gold">Insight</span>
                </div>
                <div className="ent-summary-row">
                  <div>
                    <h4>Completion momentum</h4>
                    <p>{stats.completed > 0 ? `${Math.round((stats.completed / Math.max(stats.total, 1)) * 100)}% completed` : 'No completions yet'}</p>
                  </div>
                  <span className="ent-summary-chip green">Healthy</span>
                </div>
                <div className="ent-summary-row">
                  <div>
                    <h4>Security posture</h4>
                    <p>Links expire automatically</p>
                  </div>
                  <span className="ent-summary-chip navy">Secure</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ent-card">
            <div className="ent-table-toolbar">
              <div className="ent-search-box">
                <FiSearch size={14} style={{ color: 'var(--slateish-400)', flexShrink: 0 }} />
                <input
                  type="text"
                  placeholder="Search by document, recipient, or status…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              {(query || statusFilter !== 'all' || selectedDocumentIdFromQuery) && (
                <div className="ent-filter-chips">
                  {selectedDocumentIdFromQuery && (
                    <button type="button" className="ent-filter-chip" onClick={clearDocumentFilter}>
                      {docLookup.get(selectedDocumentIdFromQuery)?.file_name || 'Document filter'}
                      <span className="ent-filter-chip-x">×</span>
                    </button>
                  )}
                  {statusFilter !== 'all' && (
                    <button type="button" className="ent-filter-chip" onClick={() => setStatusFilter('all')}>
                      Status: {statusFilter}
                      <span className="ent-filter-chip-x">×</span>
                    </button>
                  )}
                  {query && (
                    <button type="button" className="ent-filter-chip" onClick={() => setQuery('')}>
                      Search: {query}
                      <span className="ent-filter-chip-x">×</span>
                    </button>
                  )}
                </div>
              )}
              {selectedDocumentIdFromQuery && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '2px 2px 0', fontSize: '12px', color: 'var(--slateish-500)' }}>
                  <span>
                    Filtered to document: <strong>{selectedQueryDocument?.file_name || 'Document'}</strong>
                  </span>
                  <button type="button" onClick={clearDocumentFilter} style={{ border: 'none', background: 'transparent', color: 'var(--brand-600)', fontWeight: '700', cursor: 'pointer', padding: 0 }}>
                    Clear
                  </button>
                </div>
              )}
              <div className="ent-table-filters">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'pending', label: 'Pending response' },
                  { value: 'opened', label: 'Opened' },
                  { value: 'completed', label: 'Completed' },
                ].map((status) => (
                  <button
                    key={status.value}
                    type="button"
                    className={`ent-filter-btn ${statusFilter === status.value ? 'active' : ''}`}
                    onClick={() => setStatusFilter(status.value)}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
              {selectedIds.size > 0 && (
                <div className="ent-bulk-actions">
                  <span className="ent-bulk-count">{selectedIds.size} selected</span>
                  <button className="ent-bulk-btn" onClick={exportSelected}>Export CSV</button>
                  <button className="ent-bulk-btn" onClick={copySelectedLinks}>Copy Links</button>
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
                        checked={filteredSessions.length > 0 && selectedIds.size === filteredSessions.length}
                        onChange={(e) => handleSelectAll(e.target.checked)}
                      />
                    </th>
                    <th>Send Link</th>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Last Activity</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.length === 0 ? (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center', padding: '28px', color: 'var(--slateish-400)' }}>
                        {state.loading ? 'Loading send links…' : 'No send links found. Create one above.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSessions.map((session) => {
                      const doc = docLookup.get(session.document_id);
                      const recipientFullName = `${session.recipient_name || ''} ${session.recipient_last_name || ''}`.trim();
                      const sessionIdSnippet = session.id ? String(session.id).slice(0, 8) : '—';
                      const shareUrl = getSessionShareUrl(session);
                      const status = statusBadge(session.derivedStatus);
                      return (
                        <tr key={session.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(session.id)}
                              onChange={() => toggleSelected(session.id)}
                            />
                          </td>
                          <td>
                            <div className="ent-doc-cell">
                              <div className="ent-doc-thumb" style={{ color: 'var(--brand-500)' }}><FiFileText size={18} /></div>
                              <div>
                                <div className="ent-doc-title">{doc?.file_name || 'Document'}</div>
                                <div className="ent-doc-meta">Session · {sessionIdSnippet}</div>
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className="ent-client-cell">
                              <div className="ent-client-avatar" style={{ background: 'linear-gradient(135deg, var(--brand-500), var(--brand-300))' }}>
                                {initialsFrom(recipientFullName || session.recipient_email || 'LN')}
                              </div>
                              <div>
                                <div className="ent-client-name">{recipientFullName || 'Open link'}</div>
                                <div className="ent-client-sub">{session.recipient_email || 'No email attached'}</div>
                              </div>
                            </div>
                          </td>
                          <td><span className={`ent-badge ${status.className}`}>{status.label}</span></td>
                          <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{relativeTime(session.created_at)}</td>
                          <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{relativeTime(session.completed_at || session.first_opened_at || session.sent_at)}</td>
                          <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{session.expires_at ? new Date(session.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                          <td>
                            <div className="ent-act-cell">
                              {session.derivedStatus === 'completed' ? (
                                <button
                                  className="ent-act-btn green"
                                  disabled={downloadingId === session.id}
                                  onClick={() => handleDownloadSigned(session.id)}
                                >
                                  <FiDownload size={12} /> {downloadingId === session.id ? 'Preparing…' : 'Signed PDF'}
                                </button>
                              ) : (
                                <button
                                  className="ent-table-action-btn"
                                  disabled={!shareUrl}
                                  onClick={() => handleCopy(shareUrl, session.id)}
                                >
                                  {copiedId === session.id ? 'Copied' : 'Copy Link'}
                                </button>
                              )}
                              <button className="ent-table-action-btn ghost" onClick={() => openView(session)}>View →</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {activeViewSession && (
          <div className="ent-modal-overlay" onClick={closeView}>
            <div className="ent-modal" onClick={(event) => event.stopPropagation()}>
              <div className="ent-modal-header">
                <div>
                  <h3>Send Link Details</h3>
                  <p>{docLookup.get(activeViewSession.document_id)?.file_name || 'Document'}</p>
                </div>
                <button className="ent-modal-close" onClick={closeView}>×</button>
              </div>
              <div className="ent-modal-body">
                <div className="ent-view-summary">
                  <div>
                    <div className="ent-view-label">Recipient</div>
                    <div className="ent-view-value">
                      {`${activeViewSession.recipient_name || ''} ${activeViewSession.recipient_last_name || ''}`.trim()
                        || activeViewSession.recipient_email
                        || 'Open link'}
                    </div>
                    <div className="ent-view-sub">{activeViewSession.recipient_email || 'No email attached'}</div>
                  </div>
                  <div>
                    <div className="ent-view-label">Last Accessed</div>
                    <div className="ent-view-value">
                      {relativeTime(
                        activeViewSession.completed_at
                        || activeViewSession.first_opened_at
                        || activeViewSession.sent_at
                        || activeViewSession.created_at
                      )}
                    </div>
                    <div className="ent-view-sub">Created {relativeTime(activeViewSession.created_at)}</div>
                  </div>
                  <div>
                    <div className="ent-view-label">Progress</div>
                    <div className="ent-view-value">
                      {viewData.loading ? 'Loading…' : `${viewData.filledFields}/${viewData.totalFields}`}
                    </div>
                    <div className="ent-view-sub">
                      {viewData.totalFields
                        ? `${Math.round((viewData.filledFields / viewData.totalFields) * 100)}% complete`
                        : 'No fields detected'}
                    </div>
                  </div>
                </div>

                <div className="ent-progress-bar">
                  <div
                    className="ent-progress-fill"
                    style={{
                      width: viewData.totalFields
                        ? `${Math.min(100, Math.round((viewData.filledFields / viewData.totalFields) * 100))}%`
                        : '0%',
                    }}
                  />
                </div>

                <div className="ent-activity">
                  <div className="ent-activity-header">
                    <h4>Activity</h4>
                    {viewData.error && <span className="ent-activity-error">{viewData.error}</span>}
                  </div>
                  {viewData.loading ? (
                    <div className="ent-activity-item">Loading activity…</div>
                  ) : viewData.activity.length === 0 ? (
                    <div className="ent-activity-item">No activity yet.</div>
                  ) : (
                    viewData.activity.map((item, idx) => (
                      <div className="ent-activity-item" key={`${item.label}-${idx}`}>
                        <div>
                          <div className="ent-activity-title">{item.label}</div>
                          {item.actor && <div className="ent-activity-sub">{item.actor}</div>}
                        </div>
                        <div className="ent-activity-time">{relativeTime(item.timestamp)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <style jsx>{`
          .ent-page-section {
            display: flex;
            flex-direction: column;
            gap: 24px;
          }

          .ent-grid-2col {
            display: grid;
            grid-template-columns: 1.2fr 0.8fr;
            gap: 20px;
          }

          .ent-card-body {
            padding: 20px 24px 24px;
          }

          .ent-finalizing-note {
            margin-bottom: 16px;
            padding: 10px 14px;
            border-radius: 10px;
            background: var(--brand-50);
            border: 1px solid var(--brand-100);
            color: var(--brand-700);
            font-size: 12px;
            line-height: 1.5;
          }

          .ent-form-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 16px;
            margin-bottom: 18px;
          }

          .ent-form-field {
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 12px;
            font-weight: 600;
            color: var(--slateish-600);
          }

          .ent-form-field input,
          .ent-form-field select {
            padding: 10px 12px;
            border-radius: var(--r-sm);
            border: 1px solid var(--slateish-200);
            font-size: 13px;
            font-family: inherit;
            color: var(--slateish-800);
          }

          .ent-form-field input:focus,
          .ent-form-field select:focus {
            outline: none;
            border-color: var(--brand-400);
            box-shadow: 0 0 0 3px rgba(63, 160, 189, 0.1);
          }

          .ent-form-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 16px;
          }

          .ent-toggle {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 12px;
            color: var(--slateish-600);
          }

          .ent-toggle input {
            width: 16px;
            height: 16px;
          }

          .ent-form-error {
            margin-top: 12px;
            color: var(--red-500);
            font-size: 12px;
            font-weight: 600;
          }

          .ent-field-curate {
            margin-top: 14px;
            border: 1px solid var(--slateish-200);
            border-radius: var(--r-md);
            overflow: hidden;
          }
          .ent-field-curate-head {
            width: 100%;
            display: flex; align-items: center; justify-content: space-between;
            padding: 11px 14px;
            background: var(--slateish-50);
            border: none; cursor: pointer; font-family: inherit;
            font-size: 13px; font-weight: 600; color: var(--slateish-700);
          }
          .ent-field-curate-count {
            margin-left: 8px;
            font-size: 11px; font-weight: 700;
            color: var(--brand-700); background: var(--brand-50);
            padding: 2px 8px; border-radius: 9999px;
          }
          .ent-field-curate-body { padding: 12px 14px; }
          .ent-field-curate-actions {
            display: flex; gap: 8px; align-items: center;
            font-size: 12px; margin-bottom: 8px;
          }
          .ent-field-curate-actions button {
            border: none; background: none; cursor: pointer;
            color: var(--brand-600); font-weight: 600; font-family: inherit;
            padding: 0;
          }
          .ent-field-curate-actions span { color: var(--slateish-300); }
          .ent-field-curate-list {
            max-height: 220px; overflow-y: auto;
            display: flex; flex-direction: column; gap: 2px;
          }
          .ent-field-curate-item {
            display: flex; align-items: center; gap: 10px;
            padding: 7px 8px; border-radius: 8px; cursor: pointer;
            font-size: 13px; color: var(--slateish-700);
          }
          .ent-field-curate-item:hover { background: var(--slateish-50); }
          .ent-field-curate-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .ent-field-curate-type {
            font-size: 10px; text-transform: uppercase; letter-spacing: .4px;
            color: var(--slateish-400); flex-shrink: 0;
          }
          .ent-field-curate-hint {
            margin-top: 10px; font-size: 11px; color: var(--slateish-500);
          }

          .ent-link-created {
            margin: 16px 20px 20px;
            border: 1px solid var(--emerald-100);
            background: var(--emerald-50);
            border-radius: var(--r-md);
            padding: 14px 16px;
          }
          .ent-link-created-head {
            display: flex; align-items: center; gap: 8px;
            font-size: 13px; font-weight: 700;
            color: var(--emerald-700);
          }
          .ent-link-created-dismiss {
            margin-left: auto;
            border: none; background: transparent;
            color: var(--emerald-700); cursor: pointer;
            display: inline-flex; padding: 4px; border-radius: 6px;
          }
          .ent-link-created-dismiss:hover { background: var(--emerald-100); }
          .ent-link-created-row {
            display: flex; gap: 8px; margin-top: 10px;
          }
          .ent-link-created-row input {
            flex: 1; min-width: 0;
            border: 1px solid var(--emerald-100);
            border-radius: 10px;
            padding: 9px 12px;
            font-size: 12px; font-family: inherit;
            color: var(--slateish-700);
            background: #fff;
          }
          .ent-link-created p {
            margin-top: 8px;
            font-size: 11px; color: var(--slateish-500);
          }

          .ent-summary-body {
            padding: 16px 20px 20px;
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .ent-summary-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px;
            border-radius: var(--r-md);
            background: var(--slateish-50);
          }

          .ent-summary-row h4 {
            font-size: 12px;
            font-weight: 700;
            color: var(--slateish-900);
          }

          .ent-summary-row p {
            font-size: 12px;
            color: var(--slateish-500);
            margin-top: 4px;
          }

          .ent-summary-chip {
            padding: 4px 8px;
            border-radius: var(--r-full);
            font-size: 10px;
            font-weight: 700;
            color: var(--brand-700);
            background: var(--brand-50);
          }

          .ent-summary-chip.gold {
            background: var(--amber-50);
            color: var(--amber-600);
          }

          .ent-summary-chip.green {
            background: var(--emerald-50);
            color: var(--emerald-700);
          }

          .ent-summary-chip.navy {
            background: var(--brand-50);
            color: var(--brand-700);
          }

          .ent-filter-btn {
            padding: 6px 12px;
            border-radius: var(--r-full);
            border: 1px solid var(--slateish-200);
            background: #fff;
            font-size: 12px;
            font-weight: 600;
            color: var(--slateish-500);
            cursor: pointer;
            transition: all .2s;
          }

          .ent-filter-btn.active {
            background: var(--brand-600);
            color: #fff;
            border-color: var(--brand-600);
          }

          .ent-filter-btn:hover {
            border-color: var(--slateish-300);
          }

          .ent-doc-cell {
            display: flex;
            gap: 10px;
            align-items: center;
          }

          .ent-doc-thumb {
            width: 40px;
            height: 48px;
            border-radius: 12px;
            background: linear-gradient(180deg, var(--brand-50), #fff);
            border: 1px solid var(--slateish-200);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
          }

          .ent-doc-title {
            font-size: 13px;
            font-weight: 700;
            color: var(--slateish-900);
          }

          .ent-doc-meta {
            font-size: 11px;
            color: var(--slateish-400);
            margin-top: 4px;
          }

          .ent-act-cell {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
          }

          .ent-filter-chips {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
          }

          .ent-filter-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 10px;
            border-radius: var(--r-full);
            border: 1px solid var(--slateish-200);
            background: var(--slateish-50);
            font-size: 12px;
            font-weight: 600;
            color: var(--slateish-600);
            cursor: pointer;
          }

          .ent-filter-chip-x {
            font-size: 14px;
            color: var(--slateish-400);
          }

          .ent-modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(15, 23, 42, 0.55);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 60;
          }

          .ent-modal {
            background: #fff;
            border-radius: 18px;
            width: min(720px, 92vw);
            box-shadow: 0 30px 60px rgba(15, 23, 42, 0.2);
            overflow: hidden;
          }

          .ent-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            padding: 18px 24px;
            border-bottom: 1px solid var(--slateish-100);
          }

          .ent-modal-header h3 {
            margin: 0;
            font-size: 18px;
            color: var(--slateish-900);
          }

          .ent-modal-header p {
            margin: 4px 0 0;
            color: var(--slateish-500);
            font-size: 13px;
          }

          .ent-modal-close {
            border: none;
            background: transparent;
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            color: var(--slateish-400);
          }

          .ent-modal-body {
            padding: 20px 24px 26px;
          }

          .ent-view-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 18px;
          }

          .ent-view-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--slateish-400);
          }

          .ent-view-value {
            font-size: 18px;
            font-weight: 700;
            color: var(--slateish-900);
            margin-top: 4px;
          }

          .ent-view-sub {
            font-size: 12px;
            color: var(--slateish-500);
            margin-top: 4px;
          }

          .ent-progress-bar {
            margin: 18px 0 6px;
            height: 8px;
            border-radius: 999px;
            background: var(--slateish-100);
            overflow: hidden;
          }

          .ent-progress-fill {
            height: 100%;
            background: linear-gradient(90deg, var(--brand-500), var(--brand-300));
            transition: width 0.3s ease;
          }

          .ent-activity {
            margin-top: 18px;
          }

          .ent-activity-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
          }

          .ent-activity-header h4 {
            margin: 0;
            font-size: 14px;
            color: var(--slateish-800);
          }

          .ent-activity-error {
            font-size: 12px;
            color: var(--red-500);
          }

          .ent-activity-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid var(--slateish-100);
            font-size: 13px;
            color: var(--slateish-700);
          }

          .ent-activity-item:last-child {
            border-bottom: none;
          }

          .ent-activity-title {
            font-weight: 600;
            color: var(--slateish-800);
          }

          .ent-activity-sub {
            font-size: 11px;
            color: var(--slateish-400);
            margin-top: 2px;
          }

          .ent-activity-time {
            font-size: 12px;
            color: var(--slateish-400);
          }

          @media (max-width: 1200px) {
            .ent-grid-2col {
              grid-template-columns: 1fr;
            }

            .ent-form-grid {
              grid-template-columns: 1fr;
            }
          }
        `}</style>
      </EnterpriseLayout>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
