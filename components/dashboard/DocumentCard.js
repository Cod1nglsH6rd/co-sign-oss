/**
 * DocumentCard Component
 * Individual document card with preview and actions
 */

import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { FiDownload, FiTrash2, FiCheckSquare, FiSquare, FiArchive } from 'react-icons/fi';
import { formatDistanceToNow } from 'date-fns';
import { vi, es, ptBR, fr, zhCN, zhHK, ht } from 'date-fns/locale';
import { getDocumentDisplayTitle } from '../../lib/documentLabels';
import { supabase } from '../../lib/supabaseClient';
import toast from 'react-hot-toast';

// Map app locale -> date-fns locale (en + ne fall back to the default enUS).
const DATE_LOCALES = { vi, es, pt: ptBR, fr, zh: zhCN, yue: zhHK, ht };

// badge = style key; statusKey = i18n key under dashboard.document.status.
const statusConfig = {
  uploaded: { statusKey: 'uploaded', badge: 'uploaded' },
  ready: { statusKey: 'uploaded', badge: 'uploaded' },
  completed: { statusKey: 'processed', badge: 'processed' },
  processing: { statusKey: 'processing', badge: 'processing' },
  in_progress: { statusKey: 'processing', badge: 'processing' },
  error: { statusKey: 'error', badge: 'error' },
};

export default function DocumentCard({ document, onDelete, onArchive, selected, onSelect }) {
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const t = useTranslations('dashboard');

  const statusMeta = statusConfig[document.status] || statusConfig.uploaded;
  const status = { badge: statusMeta.badge, label: t(`document.status.${statusMeta.statusKey}`) };
  const fileExt = (document.file_type || document.file_name?.split('.').pop() || 'file').toLowerCase();
  const displayTitle = getDocumentDisplayTitle({
    documentType: document.phase1_data?.documentType,
    fileName: document.file_name,
  });
  const processingStep = Number.isFinite(document.metadata?.processing_step)
    ? document.metadata.processing_step
    : null;
  const confirmedCount = Number.isFinite(document.metadata?.confirmedCount)
    ? document.metadata.confirmedCount
    : null;
  const pendingCount = Number.isFinite(document.metadata?.pendingCount)
    ? document.metadata.pendingCount
    : null;
  const totalCount = Number.isFinite(document.metadata?.totalFieldCount)
    ? document.metadata.totalFieldCount
    : (Number.isFinite(confirmedCount) && Number.isFinite(pendingCount))
      ? confirmedCount + pendingCount
      : null;
  const showProgress = Number.isFinite(totalCount) && totalCount > 0;
  const confirmedCountSafe = Number.isFinite(confirmedCount) ? confirmedCount : 0;
  const progressPercent = showProgress
    ? Math.min(100, Math.round((confirmedCountSafe / totalCount) * 100))
    : Number.isFinite(processingStep)
      ? Math.min(100, Math.round((processingStep / 5) * 100))
      : null;
  const progressLabel = showProgress
    ? `${confirmedCountSafe}/${totalCount}`
    : Number.isFinite(processingStep)
      ? `${processingStep}/5`
      : null;

  let uploadedAt = '';
  if (document.created_at) {
    try {
      const d = new Date(document.created_at);
      if (!isNaN(d.getTime())) {
        uploadedAt = formatDistanceToNow(d, { addSuffix: true, locale: DATE_LOCALES[locale] });
      }
    } catch {}
  }

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this document?')) return;
    await onDelete(document.id, document.file_path);
  };

  const handleArchive = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onArchive) return;
    await onArchive(document);
  };

  return (
    <Link
      href={`/${locale}/documents/${document.id}`}
      className="group block bg-white rounded-2xl border border-slateish-100 transition hover:shadow-lg"
    >
      <div className="p-4">
        {/* min-w-0 on the shrinkable children is load-bearing: without it the
            row's min-content width (~580px) inflates the mobile layout viewport
            to ~607px and defeats the title truncation on desktop. */}
        <div className="flex items-start gap-4 min-w-0">
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSelect(document.id);
            }}
            aria-label={`${selected ? 'Deselect' : 'Select'} ${displayTitle}`}
            aria-pressed={selected}
            className="mt-1 text-slateish-400"
          >
            {selected ? (
              <FiCheckSquare className="w-5 h-5 text-brand-600" aria-hidden />
            ) : (
              <FiSquare className="w-5 h-5" aria-hidden />
            )}
          </button>
          <div className="w-11 h-11 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center text-xl flex-shrink-0">
            📄
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {/* min-w-0 lets the flex item shrink so truncate can engage;
                  without it the full title sets the card's min-content width
                  and inflates the mobile layout viewport past the screen. */}
              <h3 className="text-sm font-semibold text-slateish-900 truncate min-w-0 max-w-full" title={displayTitle}>
                {displayTitle}
              </h3>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                status.badge === 'uploaded'
                  ? 'bg-slateish-100 text-slateish-600'
                  : status.badge === 'processed'
                    ? 'bg-emerald-100 text-emerald-700'
                    : status.badge === 'processing'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-amber-50 text-amber-700'
              }`}>
                {status.label}
              </span>
            </div>
            <div className="mt-1 text-xs text-slateish-400">
              <span>{fileExt.toUpperCase()}</span> · <span>{uploadedAt}</span>
            </div>
            {progressPercent !== null && (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-slateish-100">
                  <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${progressPercent}%` }} />
                </div>
                {progressLabel && (
                  <span className="text-[11px] font-semibold text-slateish-500">{progressLabel}</span>
                )}
              </div>
            )}
          </div>
          {/* Hover reveal only where hover exists — on touch screens the
              actions must be visible or they're unreachable. */}
          <div className="flex gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition">
            <button
              className="w-9 h-9 rounded-lg bg-white border border-slateish-100 text-slateish-500 flex items-center justify-center"
              title="Download" aria-label="Download"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // The documents bucket is private, so the stored public
                // file_url 400s — mint a short-lived signed URL instead.
                if (!document.file_path) return;
                const { data, error } = await supabase.storage
                  .from('documents')
                  .createSignedUrl(document.file_path, 300, {
                    download: document.file_name || true,
                  });
                if (error || !data?.signedUrl) {
                  toast.error(t('document.downloadFailed'));
                  return;
                }
                window.open(data.signedUrl, '_blank');
              }}
            >
              <FiDownload className="w-4 h-4" />
            </button>
            {onArchive && (
              <button
                className="w-9 h-9 rounded-lg bg-white border border-slateish-200 text-slateish-500 flex items-center justify-center hover:border-amber-300 hover:text-amber-600"
                title="Archive" aria-label="Archive"
                onClick={handleArchive}
              >
                <FiArchive className="w-4 h-4" />
              </button>
            )}
            <button
              className="w-9 h-9 rounded-lg bg-white border border-red-200 text-red-500 flex items-center justify-center"
              title="Delete" aria-label="Delete"
              onClick={handleDelete}
            >
              <FiTrash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </Link>
  );
}
