import Head from 'next/head';
import { useRouter } from 'next/router';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { FiLoader, FiRefreshCw } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useInvitePasswordGate } from '../../hooks/useInvitePasswordGate';
import { supabase } from '../../lib/supabaseClient';
import { resolveEnterpriseDocumentUrl } from '../../lib/enterpriseDocumentUrl';

const INITIAL_LOAD_TIMEOUT_MS = 10 * 1000;

function isGenericSetupFieldName(value) {
  const name = String(value || '').trim();
  if (!name) return true;
  return (
    /^field[_\s-]*\d+$/i.test(name)
    || /^text[_\s-]*\d+$/i.test(name)
    || /^radio\s*button[_\s-]*\d+$/i.test(name)
    || /^check(?:\s*box)?[_\s-]*\d+$/i.test(name)
    || /^f\d+(?:[_-]\d+)*$/i.test(name)
  );
}

function withTimeout(promise, timeoutMs, timeoutCode) {
  if (!timeoutMs || timeoutMs <= 0) return promise;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const timeoutError = new Error(timeoutCode || `TIMEOUT:${timeoutMs}`);
      timeoutError.code = timeoutCode || 'TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
}

const Phase1SetupModal = dynamic(() => import('../../components/Phase1SetupModal'), {
  ssr: false,
  loading: ({ error, isLoading, timedOut }) => {
    if (error) {
      // Surface dynamic import failures in browser console for debugging.
      console.error('Phase1SetupModal dynamic import error:', error);
      return (
        <div className="flex-1 flex items-center justify-center bg-slateish-100 p-6">
          <div className="max-w-lg rounded-xl border border-red-200 bg-white p-4 text-left text-sm">
            <div className="font-semibold text-red-700">Setup UI failed to load</div>
            <div className="mt-2 text-red-600 break-words">
              {error?.message || String(error)}
            </div>
          </div>
        </div>
      );
    }

    if (timedOut && !isLoading) {
      return (
        <div className="flex-1 flex items-center justify-center bg-slateish-100 p-6">
          <div className="max-w-lg rounded-xl border border-amber-200 bg-white p-4 text-left text-sm text-amber-700">
            Setup UI is taking longer than expected to load.
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 flex items-center justify-center bg-slateish-100">
        <FiLoader className="w-8 h-8 text-slateish-400 animate-spin" />
      </div>
    );
  },
});

export default function EnterpriseSetup() {
  const router = useRouter();
  const { user, orgId, orgLoading, loading: authLoading } = useAuth({ redirectTo: '/enterprise/login' });
  useInvitePasswordGate(user);
  const { id } = router.query;

  const [document, setDocument] = useState(null);
  const [fields, setFields] = useState([]);
  const [phaseTranslations, setPhaseTranslations] = useState({ en: {} });
  const [viewLang] = useState('en');
  const [documentContext, setDocumentContext] = useState({ documentType: 'unknown', isMultiParty: false });
  // AI suggestion of which fields the recipient fills (enable-first default).
  const [suggestedEnabledIds, setSuggestedEnabledIds] = useState(null);
  const [documentLoading, setDocumentLoading] = useState(true);
  const [fileUrlLoading, setFileUrlLoading] = useState(false);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resolvedFileUrl, setResolvedFileUrl] = useState(null);
  const [fileRetryUsed, setFileRetryUsed] = useState(false);
  const [fileAccessError, setFileAccessError] = useState('');
  const [retryCounter, setRetryCounter] = useState(0);
  const setupLanguage = 'en';
  const [pendingSetupResult, setPendingSetupResult] = useState(null);
  const [labelRefreshRunning, setLabelRefreshRunning] = useState(false);
  const labelRefreshAttemptedRef = useRef(false);

  useEffect(() => {
    const loadTranslations = async () => {
      try {
        const enRes = await fetch('/locales/en.json');
        const en = await enRes.json();
        setPhaseTranslations({ en });
      } catch (err) {
        console.error('Error loading translations:', err);
      }
    };
    loadTranslations();
  }, []);

  const fetchFields = useCallback(async (documentId = id) => {
    if (!documentId) return [];
    try {
      const { data, error } = await supabase
        .from('fields')
        .select('*')
        .eq('document_id', documentId)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      setFields(data || []);
      return data || [];
    } catch (err) {
      console.error('Error fetching fields:', err);
      return [];
    }
  }, [id]);

  // Ask the AI which fields the recipient is likely to fill, to seed the
  // enable-first default. Fire-and-forget; the modal falls back to its local
  // heuristic if this never resolves.
  useEffect(() => {
    if (!id || !user || fields.length === 0 || suggestedEnabledIds !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch('/api/enterprise/classify-fields', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({ documentId: id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && Array.isArray(json.recipientFillableIds)) {
          setSuggestedEnabledIds(json.recipientFillableIds.map(String));
        }
      } catch (err) {
        if (!cancelled) console.warn('Field classification skipped:', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [id, user, fields.length, suggestedEnabledIds]);

  useEffect(() => {
    if (!id || !user) return;
    // Wait for org membership to resolve before the ownership-scoped query.
    if (orgLoading) return;

    let cancelled = false;

    const loadDocument = async () => {
      setDocumentLoading(true);
      setPageError(null);
      setFileAccessError('');
      setDocument(null);
      setResolvedFileUrl(null);
      setFields([]);

      try {
        let query = supabase
          .from('documents')
          .select('*')
          .eq('id', id);

        // Allow setup to open documents owned by the current user even if org_id is null.
        // This matches the ownership visibility rules on /enterprise/documents.
        if (orgId) {
          query = query.or(`org_id.eq.${orgId},created_by.eq.${user.id},user_id.eq.${user.id}`);
        } else if (user?.id) {
          query = query.or(`created_by.eq.${user.id},user_id.eq.${user.id}`);
        }

        const { data, error } = await withTimeout(
          query.single(),
          INITIAL_LOAD_TIMEOUT_MS,
          'SETUP_LOAD_TIMEOUT'
        );

        if (error) throw error;
        if (cancelled) return;

        setDocument(data);

        const phaseData = data?.phase1_data || {};
        setDocumentContext({
          documentType: phaseData.documentType || 'unknown',
          isMultiParty: !!phaseData.isMultiParty,
          parties: phaseData.parties || [],
          detectedRoles: phaseData.detectedRoles || [],
          role: phaseData.role || null,
          includedFieldIds: phaseData.includedFieldIds || [],
        });

        // Unblock setup UI after document row fetch, then load file URL/fields in background.
        setDocumentLoading(false);
        setFileUrlLoading(true);
        setFieldsLoading(true);

        void Promise.allSettled([
          (async () => {
            const signedUrl = await resolveEnterpriseDocumentUrl({
              filePath: data?.file_path,
              fallbackUrl: data?.file_url,
            });

            if (!cancelled) {
              setResolvedFileUrl(signedUrl || data?.file_url || null);
              setFileRetryUsed(false);
              setFileAccessError('');
            }
          })(),
          fetchFields(data?.id),
        ]).finally(() => {
          if (cancelled) return;
          setFileUrlLoading(false);
          setFieldsLoading(false);
        });
      } catch (err) {
        if (cancelled) return;

        setDocumentLoading(false);
        setFileUrlLoading(false);
        setFieldsLoading(false);

        if (err?.code === 'SETUP_LOAD_TIMEOUT') {
          setPageError({
            title: "Couldn't load setup",
            message: 'Loading took longer than expected. Please retry.',
          });
          return;
        }

        const isNotFound = err?.code === 'PGRST116';
        const isForbidden = err?.code === '42501' || /permission denied|not authorized/i.test(err?.message || '');

        if (isNotFound || isForbidden) {
          toast.error('Document not found or inaccessible');
          router.push('/enterprise/documents');
          return;
        }

        setPageError({
          title: "Couldn't load setup",
          message: 'Something went wrong while loading this document. Please retry.',
        });
      }
    };

    loadDocument();
    return () => {
      cancelled = true;
    };
  }, [id, user, orgId, orgLoading, fetchFields, retryCounter, router]);

  useEffect(() => {
    if (!id || !user?.id) return;
    if (!Array.isArray(fields) || fields.length === 0) return;
    if (labelRefreshAttemptedRef.current || labelRefreshRunning) return;

    const genericCount = fields.reduce((count, field) => (
      isGenericSetupFieldName(field?.field_name) ? count + 1 : count
    ), 0);
    const genericRatio = genericCount / Math.max(fields.length, 1);

    // Auto-refresh labels once when most fields are still generic placeholders.
    if (fields.length < 20 || genericRatio < 0.6) return;

    labelRefreshAttemptedRef.current = true;
    setLabelRefreshRunning(true);

    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error('Missing auth session');

        const refreshResponse = await fetch('/api/ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            documentId: id,
            userId: user.id,
            preferredLanguage: 'en',
            mode: 'pre_setup',
          }),
        });

        const refreshPayload = await refreshResponse.json().catch(() => ({}));
        if (!refreshResponse.ok) {
          throw new Error(refreshPayload?.message || refreshPayload?.error || 'Label refresh failed');
        }

        await fetchFields(id);
        toast.success('Field labels refreshed');
      } catch (err) {
        console.warn('Auto label refresh failed:', err);
      } finally {
        setLabelRefreshRunning(false);
      }
    })();
  }, [id, user?.id, fields, labelRefreshRunning, fetchFields]);

  const handleRetryLoad = useCallback(() => {
    setPageError(null);
    setFileAccessError('');
    setDocument(null);
    setResolvedFileUrl(null);
    setFields([]);
    setFileRetryUsed(false);
    setDocumentLoading(true);
    setFileUrlLoading(false);
    setFieldsLoading(false);
    setRetryCounter((prev) => prev + 1);
  }, []);

  const handleSetupFileLoadError = useCallback(async () => {
    if (!document) {
      setFileAccessError('Document link expired or inaccessible.');
      return;
    }

    if (!fileRetryUsed && document.file_path) {
      setFileRetryUsed(true);
      setFileUrlLoading(true);

      const refreshed = await resolveEnterpriseDocumentUrl({
        filePath: document.file_path,
        fallbackUrl: resolvedFileUrl || document.file_url,
      });

      setFileUrlLoading(false);

      if (refreshed && refreshed !== (resolvedFileUrl || document.file_url)) {
        setResolvedFileUrl(refreshed);
        setFileAccessError('');
        return;
      }
    }

    setFileAccessError('Document link expired or inaccessible.');
  }, [document, fileRetryUsed, resolvedFileUrl]);

  const runFinalizeSetup = async (setupResultOverride = null) => {
    const setupResult = setupResultOverride || pendingSetupResult;
    if (!id || !setupResult || saving) return;
    // Recipients would otherwise see generic "Field 2"-style labels when
    // setup is saved before the AI label refresh finishes.
    if (labelRefreshRunning) {
      toast('Improving field labels — one moment, then save again.', { icon: '⏳' });
      return;
    }
    setSaving(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const phase1Patch = {
        role: setupResult?.role ?? documentContext?.role ?? null,
        includedFieldIds: setupResult?.includedFieldIds ?? documentContext?.includedFieldIds ?? [],
        documentType: setupResult?.documentType ?? documentContext?.documentType ?? undefined,
        isMultiParty: setupResult?.isMultiParty ?? documentContext?.isMultiParty ?? undefined,
        parties: setupResult?.parties ?? documentContext?.parties ?? undefined,
        detectedRoles: setupResult?.detectedRoles ?? documentContext?.detectedRoles ?? undefined,
      };

      const saveResponse = await fetch('/api/enterprise/setup/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          documentId: id,
          preferredLanguage: 'en',
          updatedFields: Array.isArray(setupResult?.fields) ? setupResult.fields : [],
          phase1Patch,
        }),
      });

      const savePayload = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !savePayload?.success) {
        const fallbackMessage = `Could not save positions (HTTP ${saveResponse.status})`;
        throw new Error(savePayload?.message || fallbackMessage);
      }

      setDocument((prev) => (
        prev
          ? {
              ...prev,
              preferred_language: 'en',
              processing_status: 'finalizing',
              lifecycle_status: 'ready_to_send',
              phase1_data: {
                ...(prev?.phase1_data || {}),
                ...phase1Patch,
                setupCompleted: true,
              },
            }
          : prev
      ));

      void (async () => {
        try {
          await fetch('/api/ocr', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
            },
            keepalive: true,
            body: JSON.stringify({
              documentId: id,
              userId: user.id,
              preferredLanguage: 'en',
              mode: 'post_setup',
            }),
          });
        } catch (err) {
          console.warn('Post-setup enrichment failed:', err);
        }
      })();
      setPendingSetupResult(null);
      // PRD §2.1: continue straight into the send step with this document
      // preselected instead of dropping the user back at the list.
      toast.success('Setup complete — ready to send.');
      router.push(`/enterprise/send-links?documentId=${id}`);
    } catch (err) {
      console.error('Error saving positions:', err);
      toast.error(err?.message || 'Could not save positions');
    } finally {
      setSaving(false);
    }
  };

  const handlePhase1Complete = (result) => {
    const normalized = result || {};
    setPendingSetupResult(normalized);
    void runFinalizeSetup(normalized);
  };

  if (authLoading || !router.isReady || (id && documentLoading && !document && !pageError)) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  if (!id) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold text-slateish-900">Missing document id</h1>
          <p className="text-sm text-slateish-500 mt-2">Open this page with ?id=DOCUMENT_ID.</p>
        </div>
      </div>
    );
  }

  if (!document && pageError) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slateish-900">{pageError.title}</h1>
          <p className="text-sm text-slateish-500 mt-2">{pageError.message}</p>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            <FiRefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!document) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-slateish-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slateish-900">Setup unavailable</h1>
          <p className="text-sm text-slateish-500 mt-2">We could not load this setup page.</p>
          <button
            type="button"
            onClick={handleRetryLoad}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors"
          >
            <FiRefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>{document?.file_name ? `${document.file_name} — Setup` : 'Document Setup'}</title>
      </Head>

      <div className="h-screen w-screen bg-white">
        {pageError && (
          <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-3">
            <span>{pageError.message}</span>
            <button
              type="button"
              onClick={handleRetryLoad}
              className="inline-flex items-center gap-1 rounded-md border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition-colors"
            >
              <FiRefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          </div>
        )}

        {fileAccessError && (
          <div className="mx-4 mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fileAccessError}
          </div>
        )}

        {(fileUrlLoading || fieldsLoading) && (
          <div className="mx-4 mt-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs font-medium text-brand-700 inline-flex items-center gap-2">
            <FiLoader className="w-3.5 h-3.5 animate-spin" />
            Refreshing setup resources...
          </div>
        )}

        {labelRefreshRunning && (
          <div className="mx-4 mt-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-3 text-xs font-medium text-brand-700 inline-flex items-center gap-2">
            <FiLoader className="w-3.5 h-3.5 animate-spin" />
            Improving detected field labels...
          </div>
        )}

        <Phase1SetupModal
          isOpen
          embedded
          minimal
          initialStep={2}
          finalizingLabels={labelRefreshRunning}
          suggestedEnabledIds={suggestedEnabledIds}
          fieldsLoading={documentLoading || fieldsLoading}
          noFieldsReason={document?.metadata?.no_fields_reason || null}
          onComplete={handlePhase1Complete}
          onFileLoadError={handleSetupFileLoadError}
          onFileRetry={handleRetryLoad}
          fields={fields}
          documentContext={documentContext}
          fileUrl={resolvedFileUrl || document?.file_url || null}
          fileType={document?.file_type}
          fileName={document?.file_name}
          viewLang={viewLang}
          translations={phaseTranslations}
        />

        {saving && (
          <div className="fixed bottom-4 right-4 bg-brand-900 text-white text-xs font-semibold px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-lg">
            <FiLoader className="w-3.5 h-3.5 animate-spin" />
            Saving setup...
          </div>
        )}
      </div>
    </>
  );
}
