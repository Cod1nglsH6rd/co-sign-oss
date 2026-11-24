import Head from 'next/head';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabaseClient';
import { useAuth } from '../../hooks/useAuth';
import EnterpriseLayout from '../../components/enterprise/EnterpriseLayout';
import { FiArchive, FiLayers, FiPlus, FiSearch, FiSend } from 'react-icons/fi';
import EnterpriseUploadModal from '../../components/enterprise/EnterpriseUploadModal';
import { uploadEnterpriseDocument } from '../../lib/enterpriseUpload';
import { formatFileSize, resolveFileSizeBytes } from '../../lib/fileSize';
import { resolveEnterpriseDocumentUrl } from '../../lib/enterpriseDocumentUrl';

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

const templateState = (sessions) => {
  if (!sessions.length) return { key: 'idle', label: 'Ready', badgeClass: 'idle' };
  const hasInFlight = sessions.some((session) => (
    session.status === 'pending'
    || session.status === 'queued'
    || session.status === 'sent'
    || session.first_opened_at
  ) && session.status !== 'completed');
  if (hasInFlight) return { key: 'active', label: 'In use', badgeClass: 'active' };
  return { key: 'idle', label: 'Ready', badgeClass: 'idle' };
};

const getTemplateStatus = (template) => {
  const status = template?.metadata?.templateStatus;
  if (status === 'archived') return 'archived';
  return 'active';
};

const buildCopyName = (name = '') => {
  if (!name) return 'Untitled Copy.pdf';
  const match = name.match(/^(.*?)(\.[^.]*)?$/);
  const base = (match?.[1] || name).trim();
  const ext = match?.[2] || '.pdf';
  return `${base} Copy${ext}`;
};

export default function EnterpriseTemplates() {
  const router = useRouter();
  const { user, orgId, memberships, switchOrg, loading: authLoading } = useAuth({ redirectTo: '/enterprise/login' });
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const menuRef = useRef(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [duplicateModal, setDuplicateModal] = useState({
    open: false,
    template: null,
    name: '',
  });
  const [duplicating, setDuplicating] = useState(false);
  const [renameModal, setRenameModal] = useState({
    open: false,
    template: null,
    name: '',
  });
  const [renaming, setRenaming] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pdfOverlay, setPdfOverlay] = useState({
    open: false,
    template: null,
    url: null,
    retryUsed: false,
    error: '',
  });
  const [state, setState] = useState({
    loading: true,
    org: null,
    staffCount: 0,
    templates: [],
    sessionsByDoc: {},
    fieldCounts: {},
  });

  const load = useCallback(async () => {
    if (!user?.id) return;
    setState((prev) => ({ ...prev, loading: true }));

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
        .select('id, file_name, file_url, file_path, file_size, status, preferred_language, created_at, created_by, org_id, user_id, phase1_data, metadata')
        .order('created_at', { ascending: false })
        .limit(300);

      if (orgId) {
        documentsQuery.or(`org_id.eq.${orgId},created_by.eq.${user.id},user_id.eq.${user.id}`);
      } else {
        documentsQuery.or(`created_by.eq.${user.id},user_id.eq.${user.id}`);
      }

      const { data: docs = [] } = await documentsQuery;
      const templates = (docs || []).filter((doc) => doc?.phase1_data?.setupCompleted === true);
      const docIds = templates.map((doc) => doc.id);

      let sessions = [];
      let fieldCounts = {};

      if (docIds.length) {
        const [{ data: sessionsData }, { data: fields }] = await Promise.all([
          supabase
            .from('fill_sessions')
            .select('id, document_id, status, created_at, completed_at, first_opened_at')
            .in('document_id', docIds)
            .order('created_at', { ascending: false })
            .limit(800),
          supabase
            .from('fields')
            .select('document_id')
            .in('document_id', docIds),
        ]);

        sessions = sessionsData || [];
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

      setState({
        loading: false,
        org,
        staffCount: staffCount || 0,
        templates,
        sessionsByDoc,
        fieldCounts,
      });
    } catch (error) {
      console.error('Failed to load enterprise templates:', error);
      setState((prev) => ({
        ...prev,
        loading: false,
        templates: [],
        sessionsByDoc: {},
        fieldCounts: {},
      }));
    }
  }, [orgId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!menuOpenId) return;
    const handler = (event) => {
      if (!menuRef.current || menuRef.current.contains(event.target)) return;
      setMenuOpenId(null);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [menuOpenId]);

  const templatesWithStats = useMemo(() => state.templates.map((template) => {
    const sessions = state.sessionsByDoc[template.id] || [];
    const completed = sessions.filter((session) => session.status === 'completed' || session.completed_at).length;
    const total = sessions.length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;
    return {
      ...template,
      sessions,
      sends: total,
      completed,
      completionRate,
      fieldCount: state.fieldCounts[template.id] || 0,
      state: templateState(sessions),
      templateStatus: getTemplateStatus(template),
    };
  }), [state.fieldCounts, state.sessionsByDoc, state.templates]);

  const totals = useMemo(() => ({
    all: templatesWithStats.length,
    active: templatesWithStats.filter((template) => template.templateStatus === 'active').length,
    archive: templatesWithStats.filter((template) => template.templateStatus === 'archived').length,
    sends: templatesWithStats.reduce((sum, template) => sum + template.sends, 0),
  }), [templatesWithStats]);

  const filteredTemplates = useMemo(() => {
    const lowered = query.trim().toLowerCase();
    return templatesWithStats.filter((template) => {
      if (activeTab === 'active' && template.templateStatus !== 'active') return false;
      if (activeTab === 'archive' && template.templateStatus !== 'archived') return false;
      if (activeTab !== 'all' && !['active', 'archive'].includes(activeTab)) return false;
      if (!lowered) return true;
      return (template.file_name || '').toLowerCase().includes(lowered);
    });
  }, [activeTab, query, templatesWithStats]);

  const orgName = state.org?.name || 'Enterprise';

  if (authLoading || state.loading) {
    return (
      <div className="ent-loading-screen">
        <div className="ent-loading-spinner" />
      </div>
    );
  }

  if (!user) return null;

  const openDuplicateModal = (template) => {
    if (!template) return;
    setDuplicateModal({
      open: true,
      template,
      name: buildCopyName(template.file_name || ''),
    });
  };

  const closeDuplicateModal = () => {
    if (duplicating) return;
    setDuplicateModal({ open: false, template: null, name: '' });
  };

  const handleDuplicate = async () => {
    if (!duplicateModal.template?.id || !duplicateModal.name.trim()) return;
    if (duplicating) return;
    setDuplicating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/enterprise/templates/duplicate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          templateId: duplicateModal.template.id,
          newName: duplicateModal.name.trim(),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json?.error || 'Could not duplicate template');
        return;
      }

      toast.success('Template duplicated');
      setDuplicateModal({ open: false, template: null, name: '' });
      router.push(`/enterprise/setup?id=${json.documentId}`);
    } catch (err) {
      console.error('Duplicate template error:', err);
      toast.error('Could not duplicate template');
    } finally {
      setDuplicating(false);
    }
  };

  const openRenameModal = (template) => {
    if (!template) return;
    setRenameModal({
      open: true,
      template,
      name: template.file_name || '',
    });
  };

  const closeRenameModal = () => {
    if (renaming) return;
    setRenameModal({ open: false, template: null, name: '' });
  };

  const handleRename = async () => {
    if (!renameModal.template?.id || !renameModal.name.trim()) return;
    if (renaming) return;
    setRenaming(true);
    try {
      const { error } = await supabase
        .from('documents')
        .update({ file_name: renameModal.name.trim() })
        .eq('id', renameModal.template.id);

      if (error) throw error;

      setState((prev) => ({
        ...prev,
        templates: prev.templates.map((item) =>
          item.id === renameModal.template.id
            ? { ...item, file_name: renameModal.name.trim() }
            : item
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

  const setTemplateStatus = async (template, status) => {
    if (!template?.id) return;
    try {
      const nextMetadata = {
        ...(template.metadata || {}),
        templateStatus: status,
      };
      const { error } = await supabase
        .from('documents')
        .update({ metadata: nextMetadata })
        .eq('id', template.id);
      if (error) throw error;
      setState((prev) => ({
        ...prev,
        templates: prev.templates.map((item) =>
          item.id === template.id ? { ...item, metadata: nextMetadata } : item
        ),
      }));
      toast.success(status === 'archived' ? 'Template archived' : 'Template activated');
    } catch (err) {
      console.error('Template status update error:', err);
      toast.error('Could not update template status');
    }
  };

  const openPdfOverlay = async (template) => {
    if (!template?.file_path && !template?.file_url) {
      toast.error('No PDF URL available for this template.');
      return;
    }
    const resolvedUrl = await resolveEnterpriseDocumentUrl({
      filePath: template.file_path,
      fallbackUrl: template.file_url,
    });
    if (!resolvedUrl) {
      toast.error('Could not resolve template document URL.');
      return;
    }
    setPdfOverlay({
      open: true,
      template,
      url: resolvedUrl,
      retryUsed: false,
      error: '',
    });
  };

  const closePdfOverlay = () => setPdfOverlay({ open: false, template: null, url: null, retryUsed: false, error: '' });

  const handlePdfOverlayLoadError = async () => {
    if (!pdfOverlay.template) return;
    if (!pdfOverlay.retryUsed && pdfOverlay.template.file_path) {
      const refreshed = await resolveEnterpriseDocumentUrl({
        filePath: pdfOverlay.template.file_path,
        fallbackUrl: pdfOverlay.url || pdfOverlay.template.file_url,
      });
      if (refreshed && refreshed !== pdfOverlay.url) {
        setPdfOverlay((prev) => ({
          ...prev,
          url: refreshed,
          retryUsed: true,
          error: '',
        }));
        return;
      }
    }
    setPdfOverlay((prev) => ({
      ...prev,
      retryUsed: true,
      error: 'Document link expired or inaccessible.',
    }));
  };

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
      await load();
    } catch (err) {
      console.error('Error uploading document:', err);
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Cô Sign Enterprise — Templates</title>
      </Head>

      <EnterpriseLayout
        memberships={memberships}
        onSwitchOrg={switchOrg}
        user={user}
        orgName={orgName}
        staffCount={state.staffCount}
        activePage="templates"
        pageTitle="Templates"
        pageSubtitle="Ready-to-send document templates with setup already completed."
        topbarActions={
          <>
            <a className="ent-btn outline" href="/enterprise/documents">View Documents</a>
            <button className="ent-btn primary" type="button" onClick={() => setUploadModalOpen(true)}><FiPlus size={14} /> New document</button>
          </>
        }
        counts={{ templates: totals.all }}
      >
        <EnterpriseUploadModal
          open={uploadModalOpen}
          uploading={uploading}
          initialDocType="template"
          onClose={() => setUploadModalOpen(false)}
          onConfirm={handleUploadConfirm}
        />
        <div className="ent-stat-row">
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--brand-50)', color: 'var(--brand-600)' }}><FiLayers size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.all)}</div><div className="ent-stat-label">Ready Templates</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--emerald-50)' }}>🔁</div>
            <div><div className="ent-stat-val">{formatNumber(totals.active)}</div><div className="ent-stat-label">Active Templates</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--amber-50)', color: 'var(--amber-600)' }}><FiSend size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.sends)}</div><div className="ent-stat-label">Total Sends</div></div>
          </div>
          <div className="ent-stat-card">
            <div className="ent-stat-icon" style={{ background: 'var(--slateish-100)', color: 'var(--slateish-600)' }}><FiArchive size={18} /></div>
            <div><div className="ent-stat-val">{formatNumber(totals.archive)}</div><div className="ent-stat-label">Archived Templates</div></div>
          </div>
        </div>

        <div className="ent-card">
          <div className="ent-table-toolbar">
            <div className="ent-search-box">
              <FiSearch size={14} style={{ color: 'var(--slateish-400)', flexShrink: 0 }} />
              <input
                type="text"
                placeholder="Search templates…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div style={{ flex: 1 }}></div>
            <button className="ent-card-action" onClick={load} disabled={state.loading}>
              {state.loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          <div className="ent-tab-row">
            <div className={`ent-tab-item ${activeTab === 'active' ? 'active' : ''}`} onClick={() => setActiveTab('active')}>
              Active <span className="ent-tab-badge">{formatNumber(totals.active)}</span>
            </div>
            <div className={`ent-tab-item ${activeTab === 'all' ? 'active' : ''}`} onClick={() => setActiveTab('all')}>
              All <span className="ent-tab-badge">{formatNumber(totals.all)}</span>
            </div>
            <div className={`ent-tab-item ${activeTab === 'archive' ? 'active' : ''}`} onClick={() => setActiveTab('archive')}>
              Archive <span className="ent-tab-badge">{formatNumber(totals.archive)}</span>
            </div>
          </div>

          <table className="ent-table">
            <thead>
              <tr>
                <th style={{ minWidth: '260px' }}>Template</th>
                <th>Status</th>
                <th>Fields</th>
                <th>Sends</th>
                <th>Completed</th>
                <th>Last Updated</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredTemplates.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px', color: 'var(--slateish-500)' }}>
                    {state.templates.length === 0
                      ? 'No templates yet. Complete setup for a document to turn it into a reusable template.'
                      : 'No templates match this filter.'}
                  </td>
                </tr>
              )}
              {filteredTemplates.map((template) => (
                <tr key={template.id}>
                  <td>
                    <div className="ent-doc-cell">
                      <div className="ent-doc-thumb" style={{ color: 'var(--brand-500)' }}><FiLayers size={18} /></div>
                      <div>
                        <div className="ent-doc-title">{template.file_name}</div>
                        <div className="ent-doc-meta">
                          {formatFileSize(resolveFileSizeBytes(template))}
                          {template.preferred_language ? ` · ${template.preferred_language.toUpperCase()}` : ''}
                          {template.fieldCount ? ` · ${template.fieldCount} fields` : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`ent-badge ${template.templateStatus === 'archived' ? 'completed' : 'active'}`}>
                      {template.templateStatus === 'archived' ? 'Archived' : 'Active'}
                    </span>
                  </td>
                  <td>{formatNumber(template.fieldCount)}</td>
                  <td>{formatNumber(template.sends)}</td>
                  <td>
                    {formatNumber(template.completed)}
                    <span style={{ color: 'var(--slateish-400)', fontSize: '11px' }}>{template.sends ? ` · ${template.completionRate}%` : ''}</span>
                  </td>
                  <td>{relativeTime(template.created_at)}</td>
                  <td>
                    <div className="ent-act-cell">
                      <button className="ent-act-btn green" type="button" onClick={() => openDuplicateModal(template)} aria-label="Use template">
                        Use template
                      </button>
                      <div style={{ position: 'relative' }} ref={menuOpenId === template.id ? menuRef : null}>
                        <button
                          style={{ width: '26px', height: '26px', borderRadius: 'var(--r-sm)', border: '1px solid var(--slateish-200)', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--slateish-400)', cursor: 'pointer' }}
                          onClick={() => setMenuOpenId((prev) => (prev === template.id ? null : template.id))}
                          aria-label="Template actions"
                        >
                          ...
                        </button>
                        {menuOpenId === template.id && (
                          <div style={{ position: 'absolute', top: '30px', right: '0', background: '#fff', border: '1px solid var(--slateish-200)', boxShadow: '0 4px 12px rgba(0,0,0,.08)', borderRadius: '10px', minWidth: '160px', padding: '6px', zIndex: '10' }}>
                            <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { openPdfOverlay(template); setMenuOpenId(null); }}>
                              View PDF
                            </button>
                            <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { router.push(`/enterprise/setup?id=${template.id}`); setMenuOpenId(null); }}>
                              Edit
                            </button>
                            <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { openRenameModal(template); setMenuOpenId(null); }}>
                              Rename
                            </button>
                            {template.templateStatus === 'archived' ? (
                              <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { setTemplateStatus(template, 'active'); setMenuOpenId(null); }}>
                                Activate
                              </button>
                            ) : (
                              <button style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: '600', color: 'var(--slateish-700)', borderRadius: '8px', cursor: 'pointer' }} onClick={() => { setTemplateStatus(template, 'archived'); setMenuOpenId(null); }}>
                                Archive
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </EnterpriseLayout>

      {duplicateModal.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal">
            <div className="ent-modal-header">
              <div>
                <div className="ent-modal-title">Duplicate template</div>
                <div className="ent-modal-subtitle">Give this document a name before setup.</div>
              </div>
              <button className="ent-modal-close" type="button" onClick={closeDuplicateModal}>x</button>
            </div>
            <div className="ent-modal-body">
              <label className="ent-modal-label">
                Document name
                <input
                  value={duplicateModal.name}
                  onChange={(event) => setDuplicateModal((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="New document name"
                />
              </label>
            </div>
            <div className="ent-modal-actions">
              <button className="ent-btn outline" type="button" onClick={closeDuplicateModal} disabled={duplicating}>
                Cancel
              </button>
              <button className="ent-btn primary" type="button" onClick={handleDuplicate} disabled={duplicating}>
                {duplicating ? 'Duplicating…' : 'Continue to Setup'}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameModal.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal">
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

      {pdfOverlay.open && (
        <div className="ent-modal-backdrop">
          <div className="ent-modal pdf">
            <div className="ent-modal-header">
              <div>
                <div className="ent-modal-title">{pdfOverlay.template?.file_name || 'Document'}</div>
                <div className="ent-modal-subtitle">PDF preview</div>
              </div>
              <button className="ent-modal-close" type="button" onClick={closePdfOverlay}>x</button>
            </div>
            <div className="ent-modal-body pdf">
              {pdfOverlay.error && (
                <div style={{ marginBottom: '8px', color: '#b91c1c', fontSize: '12px', fontWeight: 600 }}>
                  {pdfOverlay.error}
                </div>
              )}
              <iframe
                className="ent-modal-iframe"
                src={pdfOverlay.url}
                title="PDF preview"
                onError={handlePdfOverlayLoadError}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
