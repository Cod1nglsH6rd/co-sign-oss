/**
 * Archived Documents Page
 * Lists soft-deleted (archived) docs with a per-row restore action.
 */

import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { FiRotateCcw, FiArchive } from 'react-icons/fi';
import { formatDistanceToNow } from 'date-fns';
import AppLayout from '../../../components/layout/AppLayout';
import { useAuth } from '../../../hooks/useAuth';
import { useDocuments } from '../../../hooks/useDocuments';
import toast from 'react-hot-toast';

export default function ArchivedDocuments() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';

  const { user, orgId, loading: authLoading, signOut } = useAuth({
    redirectTo: '/login',
  });

  const { documents, loading: docsLoading, restoreDocument } = useDocuments(
    user?.id,
    orgId,
    { includeArchived: true }
  );

  const archivedDocs = documents.filter((doc) => doc.archived_at);

  const handleRestore = async (id) => {
    const result = await restoreDocument(id);
    if (result.success) {
      toast.success('Document restored');
    } else {
      toast.error(result.error || 'Could not restore document');
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

  return (
    <>
      <Head>
        <title>Archived Documents — Cô Sign</title>
      </Head>

      <AppLayout locale={locale} onSignOut={signOut} maxWidth="max-w-5xl">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-2">
              <FiArchive className="w-6 h-6 text-slateish-500" />
              <h1 className="text-2xl font-display font-extrabold text-slateish-900">
                Archived Documents
              </h1>
            </div>
            <p className="text-sm text-slateish-500">
              Documents you've archived. Restore to return them to your dashboard.
            </p>
          </div>

          {docsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-slateish-100 p-5 animate-pulse"
                >
                  <div className="h-5 bg-slateish-200 rounded w-1/3 mb-3" />
                  <div className="h-3 bg-slateish-200 rounded w-2/3" />
                </div>
              ))}
            </div>
          ) : archivedDocs.length > 0 ? (
            <div className="space-y-3">
              {archivedDocs.map((doc) => {
                let archivedAt = '';
                if (doc.archived_at) {
                  try {
                    const d = new Date(doc.archived_at);
                    if (!isNaN(d.getTime())) {
                      archivedAt = formatDistanceToNow(d, { addSuffix: true });
                    }
                  } catch {}
                }
                const fileExt = (doc.file_type || doc.file_name?.split('.').pop() || 'file').toUpperCase();
                return (
                  <div
                    key={doc.id}
                    className="bg-white rounded-2xl border border-slateish-100 p-4 flex items-center gap-4"
                  >
                    <div className="w-11 h-11 rounded-xl bg-slateish-100 text-slateish-500 flex items-center justify-center text-xl flex-shrink-0">
                      📄
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3
                        className="text-sm font-semibold text-slateish-900 truncate"
                        title={doc.file_name}
                      >
                        {doc.file_name || 'Untitled document'}
                      </h3>
                      <div className="mt-1 text-xs text-slateish-400">
                        <span>{fileExt}</span>
                        {archivedAt && (
                          <>
                            {' · '}
                            <span>Archived {archivedAt}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRestore(doc.id)}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-full border border-slateish-200 text-xs font-semibold text-slateish-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
                      type="button"
                    >
                      <FiRotateCcw className="w-4 h-4" />
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="border-2 border-dashed border-slateish-200 bg-white rounded-2xl p-16 text-center">
              <div className="w-20 h-20 bg-slateish-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <FiArchive className="w-10 h-10 text-slateish-400" />
              </div>
              <h3 className="text-xl font-semibold text-slateish-900 mb-2">
                No archived documents
              </h3>
              <p className="text-slateish-500 mb-8">
                When you archive a document, it'll appear here.
              </p>
              <Link
                href={`/${locale}/dashboard`}
                className="inline-flex items-center gap-2 bg-brand-600 text-white px-6 py-3 rounded-xl font-semibold hover:bg-brand-700 transition-colors"
              >
                Back to documents
              </Link>
            </div>
          )}
      </AppLayout>
    </>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../../locales/${locale}.json`)).default,
    },
  };
}

export async function getStaticPaths() {
  return {
    paths: [
      { params: { locale: 'en' } },
      { params: { locale: 'vi' } },
      { params: { locale: 'es' } },
      { params: { locale: 'pt' } },
      { params: { locale: 'fr' } },
      { params: { locale: 'zh' } },
      { params: { locale: 'yue' } },
      { params: { locale: 'ht' } },
      { params: { locale: 'ne' } },
    ],
    fallback: false,
  };
}
