/**
 * Personal dashboard — the authenticated home for a personal (non-enterprise)
 * user. Lists the documents in their workspace, with upload (drag-drop + a
 * target-language picker), search, quick filters, and bulk actions. Built on
 * the shared <AppLayout> chrome and the teal brand system.
 *
 * Reverses the earlier "personal portal retired" decision (PRD §9) per an
 * explicit product call to ship a real personal dashboard.
 */

import { useState, useMemo, useRef, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import {
  FiUploadCloud,
  FiSearch,
  FiArchive,
  FiX,
  FiTrash2,
  FiCheckSquare,
} from 'react-icons/fi';
import toast from 'react-hot-toast';
import AppLayout from '../../components/layout/AppLayout';
import DocumentCard from '../../components/dashboard/DocumentCard';
import { useAuth } from '../../hooks/useAuth';
import { useDocuments } from '../../hooks/useDocuments';
import { supabase } from '../../lib/supabaseClient';
import { getDocumentDisplayTitle } from '../../lib/documentLabels';
import { locales, localeNames, localeFlags } from '../../lib/i18n';

const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export default function Dashboard() {
  const t = useTranslations('dashboard');
  const router = useRouter();
  const locale = router.query?.locale || 'en';

  const { user, orgId, loading: authLoading, orgLoading, signOut } = useAuth({
    redirectTo: '/login',
  });
  // Uploads need the org membership resolved (bootstrap runs async after the
  // dashboard renders); firing before that fails with "Organization is required".
  const uploadReady = !orgLoading && !!orgId && !!user?.id;

  const {
    documents,
    loading: docsLoading,
    error,
    deleteDocument,
    deleteDocuments,
    uploadDocument,
    archiveDocument,
  } = useDocuments(user?.id, orgId);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | recent | completed
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  // Default to English only — translation into another language is an optional,
  // deliberate pick (the 1 included language), not automatic from the page locale.
  const [uploadLang, setUploadLang] = useState('en');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const processFiles = useCallback(
    async (fileList) => {
      // Mirror the storage bucket's allow-list (pdf/png/jpeg) so a HEIC or
      // WebP fails HERE with a clear message instead of at the storage API
      // with a raw error string.
      const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);
      const rejected = [];
      const isValidFile = (f) => {
        const isPdf =
          f.type === 'application/pdf' || f.name?.toLowerCase().endsWith('.pdf');
        const isImg = ALLOWED_IMAGE_TYPES.has(f.type)
          || /\.(png|jpe?g)$/i.test(f.name || '');
        if (!isPdf && !isImg) {
          rejected.push(f.name || 'file');
          return false;
        }
        if (f.size > MAX_FILE_BYTES) {
          rejected.push(f.name || 'file');
          return false;
        }
        return true;
      };

      const files = Array.from(fileList || []).filter(isValidFile);
      if (rejected.length) {
        toast.error(`${t('unsupportedFileType')}: ${rejected.join(', ')}`, { duration: 6000 });
      }
      if (!files.length) return;
      if (!uploadReady) {
        toast(t('preparingWorkspace'));
        return;
      }

      setUploading(true);
      const uploaded = [];
      const failed = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const tid = toast.loading(
          files.length > 1
            ? `(${i + 1}/${files.length}) ${t('uploadingFile', { fileName: file.name })}`
            : t('uploadingFile', { fileName: file.name })
        );
        const res = await uploadDocument(file, user.id, uploadLang);
        toast.dismiss(tid);
        if (res.success && res.document) {
          uploaded.push(res.document);
        } else {
          failed.push(file.name);
        }
      }
      setUploading(false);
      if (failed.length) {
        toast.error(`${t('uploadFailed')}: ${failed.join(', ')}`, { duration: 8000 });
      }

      if (uploaded.length) {
        toast.success(t('uploadSuccess'));
        // Kick OCR for every uploaded doc so a batch all processes — not just
        // the one you open. We fire /api/ocr for the extras in the background
        // (no await / no AbortController, so they survive navigation, each in its
        // own server-side invocation) and open the first, whose detail page
        // auto-triggers its own analysis.
        if (uploaded.length > 1) {
          try {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            uploaded.slice(1).forEach((d) => {
              fetch('/api/ocr', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(orgId ? { 'X-Org-Id': orgId } : {}) },
                body: JSON.stringify({
                  documentId: d.id,
                  userId: user.id,
                  preferredLanguage: d.preferred_language || uploadLang || 'en',
                  mode: 'full',
                }),
              }).catch(() => {});
            });
          } catch { /* non-fatal: the docs can still be opened to process */ }
        }
        router.push(`/${locale}/documents/${uploaded[0].id}`);
      }
    },
    [user?.id, orgId, uploadReady, uploadLang, uploadDocument, t, router, locale]
  );

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (uploading) return;
    if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files);
  };

  const filtered = useMemo(() => {
    let list = documents;
    if (filter === 'recent') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      list = list.filter(
        (d) => d.created_at && new Date(d.created_at).getTime() >= weekAgo
      );
    } else if (filter === 'completed') {
      list = list.filter((d) => d.status === 'completed');
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const title = getDocumentDisplayTitle({
          documentType: d.phase1_data?.documentType,
          fileName: d.file_name,
        });
        return (
          (d.file_name || '').toLowerCase().includes(q) ||
          (title || '').toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [documents, filter, search]);

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (filtered.length > 0 && filtered.every((d) => prev.has(d.id))) {
        return new Set();
      }
      return new Set(filtered.map((d) => d.id));
    });
  };

  const handleDelete = async (id, filePath) => {
    const res = await deleteDocument(id, filePath);
    if (res.success) {
      toast.success(t('documentDeleted'));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      toast.error(res.error || t('deleteFailed'));
    }
  };

  const handleArchive = async (doc) => {
    const res = await archiveDocument(doc.id);
    if (!res.success) toast.error(res.error || 'Could not archive document');
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    if (!confirm(t('deleteConfirm', { count: ids.length }))) return;
    const res = await deleteDocuments(ids);
    if (res.success) {
      toast.success(t('documentsDeleted', { count: ids.length }));
      setSelectedIds(new Set());
    } else {
      toast.error(res.error || t('deleteFailed'));
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  const userName =
    user.user_metadata?.full_name || user.email?.split('@')[0] || '';
  const hasDocuments = documents.length > 0;
  const selectedCount = selectedIds.size;

  const FILTERS = [
    { key: 'all', label: t('filter.all') },
    { key: 'recent', label: t('filter.recent') },
    { key: 'completed', label: t('filter.completed') },
  ];

  return (
    <>
      <Head>
        <title>{t('title')} — Cô Sign</title>
      </Head>

      <AppLayout locale={locale} onSignOut={signOut} maxWidth="max-w-6xl">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!uploading) setDragActive(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            if (e.currentTarget === e.target) setDragActive(false);
          }}
          onDrop={handleDrop}
          className="relative"
        >
          {/* Drag overlay */}
          {dragActive && (
            <div className="absolute inset-0 z-30 rounded-3xl border-2 border-dashed border-brand-400 bg-brand-50/90 backdrop-blur-sm flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <FiUploadCloud className="w-10 h-10 text-brand-600 mx-auto mb-2" />
                <p className="text-brand-700 font-semibold">{t('dropToUpload')}</p>
              </div>
            </div>
          )}

          {/* Header */}
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div>
              <p className="text-sm text-slateish-500">
                {t('welcome')}
                {userName ? `, ${userName}` : ''}
              </p>
              <h1 className="text-3xl font-display font-extrabold text-slateish-900">
                {t('title')}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2">
                <label htmlFor="upload-lang" className="text-xs text-slateish-500">
                  {t('chooseLanguage')}
                </label>
                <select
                  id="upload-lang"
                  value={uploadLang}
                  onChange={(e) => setUploadLang(e.target.value)}
                  className="text-sm rounded-lg border border-slateish-200 bg-white px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {locales.map((lng) => (
                    <option key={lng} value={lng}>
                      {lng === 'en'
                        ? `${localeFlags[lng]} ${localeNames[lng]} ${t('languageEnglishOnly')}`
                        : `${localeFlags[lng]} ${localeNames[lng]}`}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || !uploadReady}
                className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2.5 rounded-xl font-semibold hover:bg-brand-700 transition-colors disabled:opacity-60"
              >
                <FiUploadCloud className="w-4 h-4" />
                {uploading ? t('uploading') : !uploadReady ? t('preparingWorkspace') : t('upload')}
              </button>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg"
            multiple
            className="hidden"
            onChange={(e) => {
              processFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {/* Dropzone (primary uploader) */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !uploadReady}
            className="w-full mb-8 rounded-3xl border-2 border-dashed border-slateish-200 bg-white px-6 py-10 text-center hover:border-brand-300 hover:bg-brand-50/40 transition-colors disabled:opacity-60"
          >
            <div className="w-14 h-14 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center mx-auto mb-4">
              <FiUploadCloud className="w-7 h-7" />
            </div>
            <p className="font-semibold text-slateish-800">{t('empty.cta')}</p>
            <p className="text-sm text-slateish-500 mt-1">
              {t('uploadHint')}
            </p>
          </button>

          {/* Controls */}
          {hasDocuments && (
            <div className="flex flex-wrap items-center gap-3 mb-5">
              <div className="relative flex-1 min-w-[200px]">
                <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slateish-400 w-4 h-4" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('searchPlaceholder')}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slateish-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>
              <div className="flex items-center gap-1 bg-white border border-slateish-200 rounded-xl p-1">
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      filter === f.key
                        ? 'bg-brand-600 text-white'
                        : 'text-slateish-600 hover:bg-slateish-50'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <Link
                href={`/${locale}/documents/archived`}
                aria-label={t('archived')}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slateish-200 text-sm font-medium text-slateish-600 hover:border-brand-300 hover:bg-brand-50 transition-colors"
              >
                <FiArchive className="w-4 h-4" aria-hidden />
                <span className="hidden sm:inline">{t('archived')}</span>
              </Link>
            </div>
          )}

          {/* Bulk toolbar */}
          {selectedCount > 0 && (
            <div className="flex flex-wrap items-center gap-3 mb-5 bg-brand-50 border border-brand-100 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-brand-700">
                {selectedCount} selected
              </span>
              <button
                type="button"
                onClick={toggleSelectAll}
                className="inline-flex items-center gap-1.5 text-sm text-slateish-600 hover:text-brand-700"
              >
                <FiCheckSquare className="w-4 h-4" />
                {t('selectAll')}
              </button>
              <div className="flex-1" />
              <button
                type="button"
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"
              >
                <FiTrash2 className="w-4 h-4" />
                {t('deleteSelected', { count: selectedCount })}
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                aria-label="Clear selection"
                className="text-slateish-400 hover:text-slateish-600"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Content */}
          {docsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-slateish-100 p-4 animate-pulse"
                >
                  <div className="flex items-start gap-4">
                    <div className="w-11 h-11 rounded-xl bg-slateish-100" />
                    <div className="flex-1">
                      <div className="h-4 bg-slateish-100 rounded w-2/3 mb-2" />
                      <div className="h-3 bg-slateish-100 rounded w-1/3" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="bg-white border border-red-100 rounded-2xl p-8 text-center text-red-600">
              {error}
            </div>
          ) : !hasDocuments ? (
            <div className="border-2 border-dashed border-slateish-200 bg-white rounded-3xl p-16 text-center">
              <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <FiUploadCloud className="w-10 h-10 text-brand-500" />
              </div>
              <h3 className="text-xl font-semibold text-slateish-900 mb-2">
                {t('empty.title')}
              </h3>
              <p className="text-slateish-500 mb-8">{t('empty.description')}</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 bg-brand-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-brand-700 transition-colors"
              >
                <FiUploadCloud className="w-5 h-5" />
                {t('empty.cta')}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border border-slateish-100 rounded-2xl p-16 text-center">
              <h3 className="text-lg font-semibold text-slateish-900 mb-1">
                {t('noSearchResults')}
              </h3>
              <p className="text-slateish-500">{t('tryDifferentSearch')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {filtered.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  onDelete={handleDelete}
                  onArchive={handleArchive}
                  selected={selectedIds.has(doc.id)}
                  onSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </div>
      </AppLayout>
    </>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../locales/${locale}.json`)).default,
    },
  };
}

export async function getStaticPaths() {
  return {
    paths: locales.map((locale) => ({ params: { locale } })),
    fallback: false,
  };
}
