import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import toast from 'react-hot-toast';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import {
  FiAlertTriangle, FiCheckCircle, FiDownload, FiFileText, FiLoader, FiMoreHorizontal,
  FiPlus, FiSearch, FiSend, FiSettings,
} from 'react-icons/fi';
import EnterpriseUploadModal from '../../components/enterprise/EnterpriseUploadModal';
import { uploadEnterpriseDocument } from '../../lib/enterpriseUpload';
import { formatFileSize, resolveFileSizeBytes } from '../../lib/fileSize';

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
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatDateTime = (timestamp) => {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
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

const deriveDocStatus = (doc, totalFields = 0, sessions = []) => {
  if (!doc) return { key: 'unknown', label: 'Unknown', badge: 'unknown' };

  const processingMessage = typeof doc?.metadata?.processing_message === 'string'
    ? doc.metadata.processing_message.trim()
    : '';
  const getSecondary = (fallback) => processingMessage || fallback;
  const lifecycle = doc.lifecycle_status;

  if (doc.processing_status === 'prepping') {
    return {
      key: 'prepping',
      label: 'Prepping',
      badge: 'prepping',
      secondary: getSecondary('Preparing fields'),
    };
  }
  if (lifecycle === 'setup_required') {
    return { key: 'setup', label: 'Setup required', badge: 'setup' };
  }
  if (lifecycle === 'sent') return { key: 'sent', label: 'Sent', badge: 'sent' };
  if (lifecycle === 'opened') return { key: 'opened', label: 'Opened', badge: 'opened' };
  if (lifecycle === 'completed') return { key: 'completed', label: 'Completed', badge: 'completed' };

  if (doc.processing_status === 'finalizing') {
    return {
      key: 'finalizing',
      label: 'Finalizing',
      badge: 'finalizing',
      secondary: getSecondary('Finalizing details'),
    };
  }
  if (doc.processing_status === 'error') {
    return { key: 'error', label: 'Error', badge: 'error' };
  }

  if (lifecycle) {
    if (lifecycle === 'ready_to_send') return { key: 'ready', label: 'Ready to send', badge: 'ready' };
    if (lifecycle === 'uploaded') {
      return totalFields > 0
        ? { key: 'setup', label: 'Setup required', badge: 'setup' }
        : { key: 'prepping', label: 'Prepping', badge: 'prepping' };
    }
  }

  // Fallback for legacy rows without new columns
  if (!doc?.status) return { key: 'unknown', label: 'Unknown', badge: 'unknown' };
  if (doc.status.startsWith('processing_step_') || doc.status === 'processing') {
    return { key: 'prepping', label: 'Prepping', badge: 'prepping' };
  }
  if (doc.status === 'ready' && !doc?.phase1_data?.setupCompleted) {
    return { key: 'setup', label: 'Setup required', badge: 'setup' };
  }
  if (doc.status === 'ready' && doc?.phase1_data?.setupCompleted) {
    return { key: 'ready', label: 'Ready to send', badge: 'ready' };
  }
  if (doc.status === 'completed') return { key: 'completed', label: 'Completed', badge: 'completed' };
  return { key: 'active', label: doc.status, badge: 'active' };
};

const formatRecipientName = (session) => {
  const name = `${session?.recipient_name || ''} ${session?.recipient_last_name || ''}`.trim();
  return name || session?.recipient_email || 'Open link';
};

export default function EnterpriseDocuments() {
  const { user, orgId, memberships, switchOrg } = useAuth({ redirectTo: '/enterprise/login' });
  const menuRef = useRef(null);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [statsDocId, setStatsDocId] = useState(null);
  const [pinnedDocs, setPinnedDocs] = useState(new Set());
  const [deletingId, setDeletingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [renameModal, setRenameModal] = useState({
    open: false,
    document: null,
    name: '',
  });
  const [renaming, setRenaming] = useState(false);
  const [recipientModal, setRecipientModal] = useState({
    open: false,
    recipient: null,
    document: null,
  });
  const [bulkDeleteModal, setBulkDeleteModal] = useState({
    open: false,
    docs: [],
    deleting: false,
  });
  const isMountedRef = useRef(true);
  const [state, setState] = useState({
    loading: true,
    org: null,
    staffCount: 0,
    documents: [],
    sessionsByDoc: {},
    fieldCounts: {},
  });
  const [activeTab, setActiveTab] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const pollRef = useRef(null);

  const loadData = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [{ data: org }, { count: staffCount }] = await Promise.all([
        orgId
          ? supabase.from('organizations').select('id, name').eq('id', orgId).single()
          : Promise.resolve({ data: null }),
        orgId
          ? supabase
            .from('org_memberships')
            .select('id', { count: 'exact', head: true })
            .eq('org_id', orgId)
            .eq('status', 'active')
          : Promise.resolve({ count: 0 }),
      ]);

      const documentsQuery = supabase
        .from('documents')
        .select('id, file_name, file_path, file_size, status, processing_status, lifecycle_status, preferred_language, created_at, created_by, org_id, user_id, phase1_data, metadata, page_count')
        .order('created_at', { ascending: false })
        .limit(300);

      if (orgId) {
        documentsQuery.or(`org_id.eq.${orgId},created_by.eq.${user.id},user_id.eq.${user.id}`);
      } else {
        documentsQuery.or(`created_by.eq.${user.id},user_id.eq.${user.id}`);
      }

      const { data: documentsData, error: documentsError } = await documentsQuery;
      const documents = documentsError ? [] : (documentsData || []);

      const docIds = documents.map((doc) => doc.id);
      let sessions = [];
      if (docIds.length) {
        const { data } = await supabase
          .from('fill_sessions')
          .select('id, document_id, status, preferred_language, created_at, completed_at, first_opened_at, recipient_name, recipient_last_name, recipient_email, sent_at')
          .in('document_id', docIds)
          .order('created_at', { ascending: false });
        sessions = data || [];
      }

      let fieldCounts = {};
      if (docIds.length) {
        const { data: fields } = await supabase
          .from('fields')
          .select('document_id')
          .in('document_id', docIds);
        fieldCounts = (fields || []).reduce((acc, field) => {
          acc[field.document_id] = (acc[field.document_id] || 0) + 1;
          return acc;
        }, {});
      }

      const sessionsByDoc = sessions.reduce((acc, session) => {
        acc[session.document_id] = acc[session.document_id] || [];
        acc[session.document_id].push(session);
        return acc;
      }, {});

      if (isMountedRef.current) {
        setState({
          loading: false,
          org,
          staffCount: staffCount || 0,
          documents,
          sessionsByDoc,
          fieldCounts,
        });
      }
    } catch (err) {
      console.error('Error loading data:', err);
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    }
  }, [orgId, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    isMountedRef.current = true;

    loadData();

    const applyDocumentPayload = (payload) => {
      if (!isMountedRef.current) return;

      setState((prev) => {
        if (payload.eventType === 'DELETE') {
          const deletedId = payload.old?.id;
          if (!deletedId) return prev;

          return {
            ...prev,
            documents: prev.documents.filter((doc) => doc.id !== deletedId),
          };
        }

        const nextDoc = payload.new;
        if (!nextDoc?.id) return prev;

        const existingIndex = prev.documents.findIndex((doc) => doc.id === nextDoc.id);

        if (payload.eventType === 'INSERT') {
          if (existingIndex !== -1) {
            return {
              ...prev,
              documents: prev.documents.map((doc) =>
                doc.id === nextDoc.id ? { ...doc, ...nextDoc } : doc
              ),
            };
          }

          return {
            ...prev,
            documents: [nextDoc, ...prev.documents],
            sessionsByDoc: { ...prev.sessionsByDoc, [nextDoc.id]: prev.sessionsByDoc[nextDoc.id] || [] },
            fieldCounts: { ...prev.fieldCounts, [nextDoc.id]: prev.fieldCounts[nextDoc.id] || 0 },
          };
        }

        if (payload.eventType === 'UPDATE') {
          if (existingIndex === -1) {
            return {
              ...prev,
              documents: [nextDoc, ...prev.documents],
              sessionsByDoc: { ...prev.sessionsByDoc, [nextDoc.id]: prev.sessionsByDoc[nextDoc.id] || [] },
              fieldCounts: { ...prev.fieldCounts, [nextDoc.id]: prev.fieldCounts[nextDoc.id] || 0 },
            };
          }

          return {
            ...prev,
            documents: prev.documents.map((doc) =>
              doc.id === nextDoc.id ? { ...doc, ...nextDoc } : doc
            ),
          };
        }

        return prev;
      });
    };

    const docFilters = orgId
      ? [`org_id=eq.${orgId}`, `created_by=eq.${user.id}`, `user_id=eq.${user.id}`]
      : [`created_by=eq.${user.id}`, `user_id=eq.${user.id}`];

    const docSubs = docFilters.map((filter, index) =>
      supabase
        .channel(`docs_${orgId || user.id}_${index}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'documents',
            filter,
          },
          applyDocumentPayload
        )
        .subscribe()
    );

    return () => {
      isMountedRef.current = false;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      docSubs.forEach((sub) => sub.unsubscribe());
    };
  }, [user?.id, orgId, loadData]);

  useEffect(() => {
    if (!state.documents.length) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const shouldPoll = state.documents.some((doc) => {
      if (doc.processing_status === 'prepping' || doc.processing_status === 'finalizing') return true;
      if (doc.lifecycle_status === 'uploaded') return true;
      return false;
    });

    if (shouldPoll && !pollRef.current) {
      pollRef.current = setInterval(() => {
        if (isMountedRef.current) {
          loadData();
        }
      }, 4000);
    }

    if (!shouldPoll && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [state.documents, loadData]);

  const orgName = state.org?.name || 'Enterprise';
  const navOrgInitials = initialsFrom(orgName);
  const canUpload = !uploading && !state.loading;

  const totals = useMemo(() => {
    const counts = {
      all: state.documents.length,
      setup: 0,
      prepping: 0,
      finalizing: 0,
      ready: 0,
      sent: 0,
      opened: 0,
      completed: 0,
    };

    state.documents.forEach((doc) => {
      const badge = deriveDocStatus(doc, state.fieldCounts[doc.id] || 0, state.sessionsByDoc[doc.id] || []);
      if (badge.key === 'setup') counts.setup += 1;
      else if (badge.key === 'prepping') counts.prepping += 1;
      else if (badge.key === 'finalizing') counts.finalizing += 1;
      else if (badge.key === 'ready') counts.ready += 1;
      else if (badge.key === 'sent') counts.sent += 1;
      else if (badge.key === 'opened') counts.opened += 1;
      else if (badge.key === 'completed') counts.completed += 1;
    });

    return counts;
  }, [state.documents, state.fieldCounts, state.sessionsByDoc]);

  const orderedDocuments = useMemo(() => {
    return [...state.documents].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [state.documents]);

  const filteredDocuments = useMemo(() => {
    return orderedDocuments.filter((doc) => {
      // Filter by search query
      if (query && !doc.file_name.toLowerCase().includes(query.toLowerCase())) {
        return false;
      }

      if (ownerFilter === 'mine' && doc.created_by !== user?.id && doc.user_id !== user?.id) {
        return false;
      }

      // Filter by active tab
      const badge = deriveDocStatus(doc, state.fieldCounts[doc.id] || 0, state.sessionsByDoc[doc.id] || []);
      if (activeTab === 'all') return true;
      return badge.key === activeTab;
    });
  }, [orderedDocuments, query, activeTab, ownerFilter, state.fieldCounts, state.sessionsByDoc, user?.id]);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = (checked) => {
    if (checked) {
      setSelectedIds(new Set(filteredDocuments.map((doc) => doc.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const openRenameModal = (doc) => {
    if (!doc) return;
    setRenameModal({
      open: true,
      document: doc,
      name: doc.file_name || '',
    });
  };

  const closeRenameModal = useCallback(() => {
    if (renaming) return;
    setRenameModal({ open: false, document: null, name: '' });
  }, [renaming]);

  const closeRecipientModal = () => {
    setRecipientModal({ open: false, recipient: null, document: null });
  };

  useEffect(() => {
    const handleEsc = (event) => {
      if (event.key !== 'Escape') return;
      if (bulkDeleteModal.open && !bulkDeleteModal.deleting) {
        setBulkDeleteModal({ open: false, docs: [], deleting: false });
        return;
      }
      if (renameModal.open && !renaming) {
        closeRenameModal();
        return;
      }
      if (recipientModal.open) {
        closeRecipientModal();
        return;
      }
      if (statsDocId) {
        setStatsDocId(null);
      }
    };

    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [bulkDeleteModal.deleting, bulkDeleteModal.open, closeRenameModal, recipientModal.open, renameModal.open, renaming, statsDocId]);

  const handleRename = async () => {
    if (!renameModal.document?.id || !renameModal.name.trim()) return;
    if (renaming) return;
    setRenaming(true);
    try {
      const { error } = await supabase
        .from('documents')
        .update({ file_name: renameModal.name.trim() })
        .eq('id', renameModal.document.id);

      if (error) throw error;

      setState((prev) => ({
        ...prev,
        documents: prev.documents.map((doc) =>
          doc.id === renameModal.document.id
            ? { ...doc, file_name: renameModal.name.trim() }
            : doc
        ),
      }));
      toast.success('Renamed document');
      closeRenameModal();
    } catch (err) {
      console.error('Rename error:', err);
      toast.error('Could not rename document');
    } finally {
      setRenaming(false);
    }
  };

  const togglePin = (id) => {
    setPinnedDocs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDeleteDocument = async (doc, options = {}) => {
    const { skipConfirm = false } = options;
    if (!skipConfirm) {
      const confirmed = window.confirm(`Delete "${doc.file_name}"?`);
      if (!confirmed) return;
    }

    try {
      setDeletingId(doc.id);

      // Delete storage file
      if (doc.file_path) {
        await supabase.storage.from('documents').remove([doc.file_path]);
      }

      // Delete document record
      await supabase.from('documents').delete().eq('id', doc.id);

      setState((prev) => ({
        ...prev,
        documents: prev.documents.filter((d) => d.id !== doc.id),
      }));

      toast.success('Document deleted');
    } catch (err) {
      console.error('Error deleting document:', err);
      toast.error(err?.message || 'Delete failed');
    } finally {
      setDeletingId(null);
    }
  };

  const downloadDocumentsCsv = (docs, fileName = 'documents.csv') => {
    if (!docs.length) return;
    const csv = [
      ['File Name', 'Status', 'Recipients', 'Uploaded'].join(','),
      ...docs.map((doc) => {
        const badge = deriveDocStatus(doc, state.fieldCounts[doc.id] || 0, state.sessionsByDoc[doc.id] || []);
        const sessions = state.sessionsByDoc[doc.id] || [];
        const recipientCount = sessions.length;
        return [
          `"${doc.file_name}"`,
          badge.label,
          recipientCount,
          relativeTime(doc.created_at),
        ].join(',');
      }),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportSelected = () => {
    const selectedDocs = filteredDocuments.filter((doc) => selectedIds.has(doc.id));
    if (!selectedDocs.length) {
      toast('Select at least one document to export');
      return;
    }
    downloadDocumentsCsv(selectedDocs, 'documents-selected.csv');
  };

  const deleteSelected = async () => {
    const selectedDocs = filteredDocuments.filter((doc) => selectedIds.has(doc.id));
    if (!selectedDocs.length) {
      toast('Select at least one document');
      return;
    }
    setBulkDeleteModal({ open: true, docs: selectedDocs, deleting: false });
  };

  const confirmBulkDelete = async () => {
    if (bulkDeleteModal.deleting) return;
    setBulkDeleteModal((prev) => ({ ...prev, deleting: true }));
    for (const doc of bulkDeleteModal.docs) {
      // eslint-disable-next-line no-await-in-loop
      await handleDeleteDocument(doc, { skipConfirm: true });
    }
    clearSelection();
    setBulkDeleteModal({ open: false, docs: [], deleting: false });
  };

  const statsDoc = useMemo(() => {
    if (!statsDocId) return null;
    return state.documents.find((doc) => doc.id === statsDocId) || null;
  }, [statsDocId, state.documents]);

  const statsSessions = statsDoc ? (state.sessionsByDoc[statsDoc.id] || []) : [];
  const statsCompleted = statsSessions.filter((s) => s.status === 'completed').length;
  const statsRecipients = statsSessions.length;
  const statsCompletionPct = statsRecipients ? Math.round((statsCompleted / statsRecipients) * 100) : 0;
  const statsFieldsCount = statsDoc ? (state.fieldCounts[statsDoc.id] || 0) : 0;

  const handleUploadClick = () => {
    if (!canUpload) return;
    setUploadModalOpen(true);
  };

  const handleUploadConfirm = async ({ file, fileName, addAsTemplate }) => {
    if (!user?.id || !file) return;
    try {
      setUploading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const docData = await uploadEnterpriseDocument({
        file,
        fileName,
        orgId,
        userId: user.id,
        addAsTemplate,
        accessToken: session?.access_token,
      });

      setState((prev) => ({
        ...prev,
        documents: [docData, ...prev.documents],
        sessionsByDoc: { ...prev.sessionsByDoc, [docData.id]: [] },
        fieldCounts: { ...prev.fieldCounts, [docData.id]: 0 },
      }));

      toast.success('Uploaded — detecting fields. "Set up" appears when it\'s ready.');
      setUploadModalOpen(false);
    } catch (err) {
      console.error('Error uploading document:', err);
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const topbarActions = (
    <>
      <button
        className="ent-btn outline"
        onClick={selectedIds.size > 0 ? exportSelected : () => downloadDocumentsCsv(filteredDocuments, 'documents.csv')}
      >
        <FiDownload size={13} /> Export
      </button>
      <button
        className="ent-btn primary"
        onClick={handleUploadClick}
        disabled={!canUpload}
      >
        {uploading ? 'Uploading…' : (<><FiPlus size={14} /> New document</>)}
      </button>
    </>
  );

  if (state.loading) {
    return (
      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="documents"
        pageTitle="All Documents"
        pageSubtitle="Manage and track all your documents."
      >
        <EnterpriseUploadModal
          open={uploadModalOpen}
          uploading={uploading}
          onClose={() => setUploadModalOpen(false)}
          onConfirm={handleUploadConfirm}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}>
          <div style={{
            width: '32px',
            height: '32px',
            borderRadius: '9999px',
            border: '3px solid var(--brand-200)',
            borderTopColor: 'var(--brand-600)',
            animation: 'spin 0.9s linear infinite',
          }} />
          <style jsx>{`
            @keyframes spin { to { transform: rotate(360deg); } }
          `}</style>
        </div>
      </EnterpriseLayout>
    );
  }

  return (
    <>
      <Head>
        <title>Co Sign Enterprise — All Documents</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="documents"
        pageTitle="All Documents"
        pageSubtitle="Manage and track all your documents."
        topbarActions={topbarActions}
        counts={{ documents: totals.all }}
      >
        <EnterpriseUploadModal
          open={uploadModalOpen}
          uploading={uploading}
          onClose={() => setUploadModalOpen(false)}
          onConfirm={handleUploadConfirm}
        />
        {/* Stat Cards */}
        <div className="ent-stat-row">
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><FiFileText size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.all)}</div><div className="ent-stat-label">Total Documents</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--amber-50)', color: 'var(--amber-600)' }}><FiAlertTriangle size={18} /></div>
            <div><div className="ent-stat-val" style={{ color: 'var(--amber-600)' }}>{formatNumber(totals.setup)}</div><div className="ent-stat-label">Setup Required</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--blue-50)', color: 'var(--blue-600)' }}><FiLoader size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.prepping)}</div><div className="ent-stat-label">Prepping</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--slateish-100)', color: 'var(--slateish-600)' }}><FiCheckCircle size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.completed)}</div><div className="ent-stat-label">Completed</div></div>
          </div>
        </div>

        {/* Documents Card */}
        <div className="ent-card">
            <div className="ent-table-toolbar">
              <div className="ent-search-box">
                <FiSearch size={14} style={{ color: 'var(--slateish-400)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search documents…"
                value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--slateish-500)', fontWeight: '600' }}>
              Status
              <select
                value={activeTab}
                onChange={(event) => setActiveTab(event.target.value)}
                style={{ padding: '7px 12px', borderRadius: 'var(--r-full)', border: '1px solid var(--slateish-200)', background: '#fff', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', fontFamily: 'inherit' }}
              >
                <option value="all">All</option>
                <option value="prepping">Prepping</option>
                <option value="setup">Setup Required</option>
                <option value="finalizing">Finalizing</option>
                <option value="ready">Ready To Send</option>
                <option value="sent">Sent</option>
                <option value="opened">Opened</option>
                <option value="completed">Completed</option>
              </select>
            </label>
            <button
              style={{ padding: '7px 14px', borderRadius: 'var(--r-full)', border: '1px solid var(--slateish-200)', background: '#fff', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-600)', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .2s', whiteSpace: 'nowrap' }}
              onClick={() => setOwnerFilter((prev) => (prev === 'all' ? 'mine' : 'all'))}
              type="button"
            >
              Owner: {ownerFilter === 'all' ? 'All' : 'Mine'}
            </button>
            {selectedIds.size > 0 && (
              <div className="ent-bulk-actions">
                <span className="ent-bulk-count">{selectedIds.size} selected</span>
                <button className="ent-bulk-btn" onClick={exportSelected}>Export CSV</button>
                <button className="ent-bulk-btn" style={{ color: 'var(--red-500)', borderColor: 'var(--red-100)', background: 'var(--red-50)' }} onClick={deleteSelected}>Delete</button>
                <button className="ent-bulk-btn ghost" onClick={clearSelection}>Clear</button>
              </div>
            )}
            <div style={{ flex: 1 }}></div>
          </div>

          <div className="ent-tab-row">
            <div
              className={`ent-tab-item ${activeTab === 'all' ? 'active' : ''}`}
              onClick={() => setActiveTab('all')}
            >
              All <span className="ent-tab-badge">{formatNumber(totals.all)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'prepping' ? 'active' : ''}`}
              onClick={() => setActiveTab('prepping')}
            >
              Prepping <span className="ent-tab-badge">{formatNumber(totals.prepping)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'setup' ? 'active' : ''}`}
              onClick={() => setActiveTab('setup')}
            >
              Setup Required <span className="ent-tab-badge warn">{formatNumber(totals.setup)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'finalizing' ? 'active' : ''}`}
              onClick={() => setActiveTab('finalizing')}
            >
              Finalizing <span className="ent-tab-badge">{formatNumber(totals.finalizing)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'ready' ? 'active' : ''}`}
              onClick={() => setActiveTab('ready')}
            >
              Ready To Send <span className="ent-tab-badge">{formatNumber(totals.ready)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'sent' ? 'active' : ''}`}
              onClick={() => setActiveTab('sent')}
            >
              Sent <span className="ent-tab-badge">{formatNumber(totals.sent)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'opened' ? 'active' : ''}`}
              onClick={() => setActiveTab('opened')}
            >
              Opened <span className="ent-tab-badge">{formatNumber(totals.opened)}</span>
            </div>
            <div
              className={`ent-tab-item ${activeTab === 'completed' ? 'active' : ''}`}
              onClick={() => setActiveTab('completed')}
            >
              Completed <span className="ent-tab-badge">{formatNumber(totals.completed)}</span>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table className="ent-table">
              <thead>
                <tr>
                  <th style={{ width: '36px' }}>
                    <input
                      type="checkbox"
                      checked={filteredDocuments.length > 0 && selectedIds.size === filteredDocuments.length}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  <th style={{ minWidth: '260px' }}>Document</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Owner</th>
                  <th>Uploaded</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '20px', color: 'var(--slateish-400)', fontSize: '13px' }}>
                      No documents yet.
                    </td>
                  </tr>
                )}
                {filteredDocuments.map((doc) => {
                  const sessions = state.sessionsByDoc[doc.id] || [];
                  const totalFields = state.fieldCounts[doc.id] || 0;
                  const badge = deriveDocStatus(doc, totalFields, sessions);
                  const documentLink = `/enterprise/documents/${doc.id}`;
                  const setupLink = `/enterprise/setup?id=${doc.id}`;
                  const isPinned = pinnedDocs.has(doc.id);
                  const isActionable = ['setup', 'ready', 'finalizing'].includes(badge.key);

                  return (
                    <tr key={doc.id} className={`ent-doc-row ${isActionable ? 'actionable' : ''}`}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(doc.id)}
                          onChange={() => toggleSelected(doc.id)}
                        />
                      </td>
                      <td>
                        <div className="ent-doc-cell">
                          <div className="ent-doc-thumb" style={{ color: 'var(--brand-500)' }}><FiFileText size={18} /></div>
                          <div>
                            <div className="ent-doc-title">
                              <a style={{ textDecoration: 'none' }} href={documentLink}>{doc.file_name}</a>
                              {isPinned && <span style={{ fontSize: '9px', fontWeight: '800', letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--brand-700)', background: 'var(--brand-100)', padding: '2px 6px', borderRadius: 'var(--r-full)' }}>Pinned</span>}
                            </div>
                            <div className="ent-doc-meta">
                              {formatFileSize(resolveFileSizeBytes(doc))}
                              {doc.page_count ? ` · ${doc.page_count} pages` : ''}
                              {totalFields ? ` · ${totalFields} fields` : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className={`ent-status-stack ${isActionable ? 'actionable' : ''}`}>
                          <span className={`ent-badge ${badge.badge}`}>{badge.label}</span>
                          {badge.secondary && (
                            <span className="ent-status-subtext">{badge.secondary}</span>
                          )}
                          {(badge.key === 'prepping' || badge.key === 'finalizing') && (
                            <div className="ent-prep-bar" title="Working — large documents can take a few minutes">
                              <div className="ent-prep-bar-fill" />
                            </div>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="ent-recipient-list">
                          {(() => {
                            const unique = new Map();
                            sessions.forEach((s) => {
                              const label = formatRecipientName(s);
                              const key = (s.recipient_email || label).toLowerCase();
                              if (!unique.has(key)) unique.set(key, s);
                            });
                            const recipients = Array.from(unique.values());
                            const shown = recipients.slice(0, 2);
                            const remaining = recipients.length - shown.length;
                            if (recipients.length === 0) return '—';
                            return (
                              <>
                                {shown.map((recipient) => (
                                  <button
                                    key={recipient.id}
                                    type="button"
                                    className="ent-recipient-chip"
                                    onClick={() => setRecipientModal({ open: true, recipient, document: doc })}
                                  >
                                    <span className="ent-recipient-avatar">{initialsFrom(formatRecipientName(recipient))}</span>
                                    <span className="ent-recipient-name">{formatRecipientName(recipient)}</span>
                                  </button>
                                ))}
                                {remaining > 0 && (
                                  <span className="ent-recipient-more">+{remaining} more</span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{ width: '20px', height: '20px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '8px', fontWeight: '700', color: '#fff', flexShrink: '0', background: 'linear-gradient(135deg, var(--brand-500), var(--brand-300))' }}>
                            {doc.created_by === user?.id ? initialsFrom(user?.email || 'You') : '—'}
                          </div>
                          <span style={{ fontSize: '12px', color: 'var(--slateish-600)', whiteSpace: 'nowrap' }}>{doc.created_by === user?.id ? 'You' : 'Unassigned'}</span>
                        </div>
                      </td>
                      <td style={{ fontSize: '12px', color: 'var(--slateish-400)' }}>{relativeTime(doc.created_at)}</td>
                      <td>
                        <div className="ent-act-cell">
                          {badge.key === 'setup' && (
                            <a className="ent-act-btn amber" href={setupLink}><FiSettings size={12} /> Set up</a>
                          )}
                          {badge.key === 'ready' && (
                            <a className="ent-act-btn green" href={`/enterprise/send-links?documentId=${doc.id}`}><FiSend size={12} /> Send</a>
                          )}
                          {badge.key === 'uploading' && (
                            <button
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: 'var(--r-full)', fontSize: '11px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer', border: 'none', whiteSpace: 'nowrap', background: '#fff', color: 'var(--red-500)', borderColor: 'var(--red-100)' }}
                              type="button"
                              onClick={() => handleDeleteDocument(doc)}
                            >
                              Cancel
                            </button>
                          )}
                          {badge.key === 'prepping' && (
                            <span style={{ fontSize: '11px', color: 'var(--slateish-400)' }}>Processing…</span>
                          )}
                          {badge.key === 'finalizing' && (
                            <a className="ent-act-btn green" href={`/enterprise/send-links?documentId=${doc.id}`}><FiSend size={12} /> Send</a>
                          )}
                          {['sent', 'opened', 'completed'].includes(badge.key) && (
                            <a className="ent-act-btn teal" href={`/enterprise/send-links?documentId=${doc.id}`}>View links</a>
                          )}
                          {!['setup', 'ready', 'uploading', 'prepping', 'finalizing', 'sent', 'opened', 'completed'].includes(badge.key) && (
                            <a className="ent-act-btn teal" href={documentLink}>View</a>
                          )}
                          <div style={{ position: 'relative' }} ref={menuOpenId === doc.id ? menuRef : null}>
                            <button
                              style={{ width: '26px', height: '26px', borderRadius: 'var(--r-sm)', border: '1px solid var(--slateish-200)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--slateish-400)', cursor: 'pointer' }}
                              onClick={() => setMenuOpenId((prev) => (prev === doc.id ? null : doc.id))}
                              aria-label="Document actions"
                            >
                              <FiMoreHorizontal size={14} />
                            </button>
                            {menuOpenId === doc.id && (
                              <div style={{ position: 'absolute', top: '30px', right: '0', background: '#fff', border: '1px solid var(--slateish-200)', boxShadow: '0 4px 12px rgba(0,0,0,.08)', borderRadius: '10px', minWidth: '160px', padding: '6px', zIndex: '10' }}>
                                <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { setStatsDocId(doc.id); setMenuOpenId(null); }}>
                                  View stats
                                </button>
                                <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => togglePin(doc.id)}>
                                  {isPinned ? 'Unpin' : 'Pin'}
                                </button>
                                <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { openRenameModal(doc); setMenuOpenId(null); }}>
                                  Rename
                                </button>
                                <button
                                  style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--red-500)', borderRadius: '8px', cursor: 'pointer', opacity: deletingId === doc.id ? 0.6 : 1 }}
                                  onClick={() => handleDeleteDocument(doc)}
                                  disabled={deletingId === doc.id}
                                >
                                  {deletingId === doc.id ? 'Deleting…' : 'Delete'}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 20px', borderTop: '1px solid var(--slateish-100)', fontSize: '12px', color: 'var(--slateish-500)' }}>
            <span>Showing {formatNumber(filteredDocuments.length)} of {formatNumber(state.documents.length)} documents</span>
          </div>
        </div>
      </EnterpriseLayout>

      <style jsx>{`
        .ent-doc-row.actionable td {
          background: rgba(59, 130, 246, 0.03);
        }

        .ent-doc-row.actionable td:first-child {
          box-shadow: inset 3px 0 0 rgba(59, 130, 246, 0.14);
        }

        .ent-status-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 3px;
        }

        .ent-status-subtext {
          font-size: 11px;
          line-height: 1.2;
          color: var(--slateish-500);
        }
      `}</style>

      {renameModal.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal" role="dialog" aria-modal="true" aria-label="Rename document">
            <div className="ent-modal-header">
              <div>
                <div className="ent-modal-title">Rename document</div>
                <div className="ent-modal-subtitle">Update the name for this document.</div>
              </div>
              <button className="ent-modal-close" type="button" onClick={closeRenameModal}>x</button>
            </div>
            <div className="ent-modal-body">
              <label className="ent-modal-label">
                Document name
                <input
                  value={renameModal.name}
                  onChange={(event) => setRenameModal((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Document name"
                />
              </label>
            </div>
            <div className="ent-modal-actions">
              <button className="ent-btn outline" type="button" onClick={closeRenameModal} disabled={renaming}>
                Cancel
              </button>
              <button className="ent-btn primary" type="button" onClick={handleRename} disabled={renaming}>
                {renaming ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {recipientModal.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal" role="dialog" aria-modal="true" aria-label="Recipient profile">
            <div className="ent-modal-header">
              <div>
                <div className="ent-modal-title">Recipient profile</div>
                <div className="ent-modal-subtitle">
                  {recipientModal.document?.file_name || 'Document'}
                </div>
              </div>
              <button className="ent-modal-close" type="button" onClick={closeRecipientModal}>x</button>
            </div>
            <div className="ent-modal-body">
              <div className="ent-recipient-profile">
                <div className="ent-recipient-avatar-lg">
                  {initialsFrom(formatRecipientName(recipientModal.recipient))}
                </div>
                <div>
                  <div className="ent-recipient-profile-name">
                    {formatRecipientName(recipientModal.recipient)}
                  </div>
                  <div className="ent-recipient-profile-email">
                    {recipientModal.recipient?.recipient_email || 'No email attached'}
                  </div>
                </div>
              </div>

              <div className="ent-recipient-details">
                <div>
                  <span>Status</span>
                  <strong>{recipientModal.recipient?.status || '—'}</strong>
                </div>
                <div>
                  <span>Sent</span>
                  <strong>{formatDateTime(recipientModal.recipient?.sent_at)}</strong>
                </div>
                <div>
                  <span>Opened</span>
                  <strong>{formatDateTime(recipientModal.recipient?.first_opened_at)}</strong>
                </div>
                <div>
                  <span>Completed</span>
                  <strong>{formatDateTime(recipientModal.recipient?.completed_at)}</strong>
                </div>
                <div>
                  <span>Language</span>
                  <strong>{recipientModal.recipient?.preferred_language ? recipientModal.recipient.preferred_language.toUpperCase() : '—'}</strong>
                </div>
              </div>
            </div>
            <div className="ent-modal-actions">
              <button className="ent-btn primary" type="button" onClick={closeRecipientModal}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {bulkDeleteModal.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal" role="dialog" aria-modal="true" aria-label="Delete selected documents">
            <div className="ent-modal-header">
              <div>
                <div className="ent-modal-title">Delete selected documents?</div>
                <div className="ent-modal-subtitle">
                  This will permanently delete {bulkDeleteModal.docs.length} document{bulkDeleteModal.docs.length === 1 ? '' : 's'} and their uploaded files.
                </div>
              </div>
              <button
                className="ent-modal-close"
                type="button"
                onClick={() => setBulkDeleteModal({ open: false, docs: [], deleting: false })}
                disabled={bulkDeleteModal.deleting}
              >
                x
              </button>
            </div>
            <div className="ent-modal-actions">
              <button
                className="ent-btn outline"
                type="button"
                onClick={() => setBulkDeleteModal({ open: false, docs: [], deleting: false })}
                disabled={bulkDeleteModal.deleting}
              >
                Cancel
              </button>
              <button
                className="ent-btn primary"
                type="button"
                onClick={confirmBulkDelete}
                disabled={bulkDeleteModal.deleting}
                style={{ background: 'var(--red-500)', borderColor: 'var(--red-500)' }}
              >
                {bulkDeleteModal.deleting ? 'Deleting…' : 'Delete All'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats Drawer */}
      {statsDoc && (
        <div className="ent-drawer-backdrop">
          <div className="ent-drawer">
            <div className="ent-drawer-header">
              <div>
                <h3>Document stats</h3>
                <p>{statsDoc.file_name}</p>
              </div>
              <button className="ent-drawer-close" onClick={() => setStatsDocId(null)}>×</button>
            </div>
            <div className="ent-drawer-body">
              <div className="ent-drawer-stats">
                <div>
                  <span>Status</span>
                  <strong>{deriveDocStatus(statsDoc, state.fieldCounts[statsDoc.id] || 0, state.sessionsByDoc[statsDoc.id] || []).label}</strong>
                </div>
                <div>
                  <span>Recipients</span>
                  <strong>{formatNumber(statsRecipients)}</strong>
                </div>
                <div>
                  <span>Completed</span>
                  <strong>{formatNumber(statsCompleted)}</strong>
                </div>
                <div>
                  <span>Completion</span>
                  <strong>{statsCompletionPct}%</strong>
                </div>
                <div>
                  <span>Fields</span>
                  <strong>{formatNumber(statsFieldsCount)}</strong>
                </div>
                <div>
                  <span>Uploaded</span>
                  <strong>{relativeTime(statsDoc.created_at)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .ent-act-cell { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
        .ent-act-btn { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: var(--r-full); font-size: 11px; font-weight: 600; font-family: inherit; cursor: pointer; transition: all .2s; border: none; white-space: nowrap; }
        .ent-act-btn.green { background: var(--emerald-50); border: 1px solid var(--emerald-100); color: var(--emerald-700); }
        .ent-act-btn.green:hover { background: var(--emerald-100); }
        .ent-act-btn.amber { background: var(--amber-50); border: 1px solid var(--amber-100); color: var(--amber-600); }
        .ent-act-btn.amber:hover { background: var(--amber-100); }
        .ent-act-btn.teal { background: var(--brand-50); border: 1px solid var(--brand-100); color: var(--brand-700); }
        .ent-act-btn.teal:hover { background: var(--brand-100); }
        .ent-recipient-list { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
        .ent-recipient-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px 4px 4px; border-radius: var(--r-full); border: 1px solid var(--slateish-200); background: #fff; font-size: 12px; color: var(--slateish-700); cursor: pointer; transition: all .2s; }
        .ent-recipient-chip:hover { border-color: var(--brand-200); box-shadow: 0 4px 10px rgba(15, 23, 42, 0.08); }
        .ent-recipient-avatar { width: 22px; height: 22px; border-radius: 50%; background: var(--brand-100); color: var(--brand-700); font-weight: 700; font-size: 10px; display: inline-flex; align-items: center; justify-content: center; text-transform: uppercase; }
        .ent-recipient-name { max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ent-recipient-more { font-size: 11px; color: var(--slateish-400); }
        .ent-recipient-profile { display: flex; align-items: center; gap: 14px; margin-bottom: 18px; }
        .ent-recipient-avatar-lg { width: 48px; height: 48px; border-radius: 50%; background: var(--brand-100); color: var(--brand-700); font-weight: 700; font-size: 16px; display: inline-flex; align-items: center; justify-content: center; text-transform: uppercase; }
        .ent-recipient-profile-name { font-size: 16px; font-weight: 700; color: var(--slateish-900); }
        .ent-recipient-profile-email { font-size: 12px; color: var(--slateish-500); }
        .ent-recipient-details { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
        .ent-recipient-details span { display: block; font-size: 11px; color: var(--slateish-400); text-transform: uppercase; letter-spacing: .4px; }
        .ent-recipient-details strong { display: block; font-size: 13px; color: var(--slateish-800); }
      `}</style>
    </>
  );
}

export async function getServerSideProps() {
  const messages = require('../../locales/en.json');
  return { props: { messages } };
}
