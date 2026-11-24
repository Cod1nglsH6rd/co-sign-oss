/**
 * Document Viewer Page
 * Split-view: PDF viewer + field sidebar with AI chat
 * Features: Real OCR field extraction, field persistence, PDF export,
 *           language toggle, DocuSign-style viewer
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import dynamic2 from 'next/dynamic';
import {
  FiArrowLeft, FiDownload, FiSend, FiMessageCircle, FiList,
  FiLoader, FiLogOut, FiCheck, FiFileText, FiGlobe, FiSettings, FiChevronDown, FiChevronUp, FiX, FiAlertTriangle
} from 'react-icons/fi';
import { useAuth } from '../../../hooks/useAuth';
import { useInvitePasswordGate } from '../../../hooks/useInvitePasswordGate';
import { supabase } from '../../../lib/supabaseClient';
import { locales, localeNames, localeFlags } from '../../../lib/i18n';
import { resolveEnterpriseDocumentUrl } from '../../../lib/enterpriseDocumentUrl';
import SignatureCanvas from '../../../components/SignatureCanvas';
import SnakeGame from '../../../components/SnakeGame';
import { getDocumentDisplayTitle } from '../../../lib/documentLabels';
import toast from 'react-hot-toast';

import { getLabel as getTrLabel, getExplanation as getTrExplanation } from '../../../lib/fieldTranslations';
import { colorForIndex } from '../../../lib/fieldColors';
// Dynamic import for PDF viewer (SSR-incompatible)
const PdfViewer = dynamic2(() => import('../../../components/PdfViewer'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-slateish-50">
      <FiLoader className="w-8 h-8 text-slateish-400 animate-spin" />
    </div>
  ),
});

// Dynamic import for FieldConfigurer (SSR-incompatible — uses react-pdf)
const FieldConfigurer = dynamic2(() => import('../../../components/FieldConfigurer'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-brand-50">
      <FiLoader className="w-8 h-8 text-brand-400 animate-spin" />
    </div>
  ),
});

// Dynamic import for Phase1SetupModal (SSR-incompatible — uses react-pdf)
const Phase1SetupModal = dynamic2(() => import('../../../components/Phase1SetupModal'), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <FiLoader className="w-8 h-8 text-white animate-spin" />
    </div>
  ),
});

const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'vi', label: 'Tiếng Việt', flag: '🇻🇳' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇧🇷' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'zh', label: '中文（普通话）', flag: '🇨🇳' },
  { code: 'yue', label: '粵語', flag: '🇭🇰' },
  { code: 'ht', label: 'Kreyòl Ayisyen', flag: '🇭🇹' },
  { code: 'ne', label: 'नेपाली', flag: '🇳🇵' },
];

// Filter languages: always show English + preferred non-English (if any) + current selection
const getFilteredLanguages = (selectedLang, preferredLang) => {
  const codes = new Set(['en']);
  if (preferredLang && preferredLang !== 'en') codes.add(preferredLang);
  if (selectedLang && selectedLang !== 'en') codes.add(selectedLang);
  return LANGUAGES.filter(l => codes.has(l.code));
};

const ROLE_OPTIONS_GLOBAL = {
  rental: [
    { value: 'landlord', excludeFields: ['tenant', 'renter'] },
    { value: 'tenant', excludeFields: ['landlord', 'owner', 'lessor'] },
  ],
  employment: [
    { value: 'employer', excludeFields: ['employee', 'worker'] },
    { value: 'employee', excludeFields: ['employer', 'company', 'hr'] },
  ],
  nda: [
    { value: 'disclosing', excludeFields: ['receiving', 'recipient'] },
    { value: 'receiving', excludeFields: ['disclosing', 'discloser'] },
  ],
  sales: [
    { value: 'buyer', excludeFields: ['seller', 'vendor'] },
    { value: 'seller', excludeFields: ['buyer', 'purchaser'] },
  ],
  'other-contract': [
    { value: 'client', excludeFields: ['contractor', 'consultant', 'provider', 'vendor'] },
    { value: 'contractor', excludeFields: ['client', 'company', 'employer'] },
  ],
};

export default function DocumentViewer() {
  const t = useTranslations();
  const router = useRouter();
  const locale = router.query?.locale || 'en';
  const id = router.query?.id;
  const isEnterpriseRoute = router.pathname.startsWith('/enterprise');
  const { user, orgId, orgLoading, loading: authLoading, signOut } = useAuth({
    redirectTo: isEnterpriseRoute ? '/enterprise/login' : '/login',
  });
  // On /enterprise/documents/[id] only: the invite password step comes first.
  useInvitePasswordGate(router.pathname?.startsWith('/enterprise/') ? user : null);

  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState([]);
  const [fieldsLoading, setFieldsLoading] = useState(true);
  const [ocrProcessing, setOcrProcessing] = useState(false);
  const [ocrFailed, setOcrFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const ocrAttemptedRef = useRef(false);
  const [activeTab, setActiveTab] = useState('fields');
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [pendingChatContext, setPendingChatContext] = useState('');
  const [chatConsentOpen, setChatConsentOpen] = useState(false);
  const [chatConsentChecked, setChatConsentChecked] = useState(false);
  const [chatConsentAccepted, setChatConsentAccepted] = useState(false);
  const [currentChatField, setCurrentChatField] = useState('');
  const [exporting, setExporting] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [viewLang, setViewLang] = useState(locale); // language toggle for translations
  const [preferredLang, setPreferredLang] = useState(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const [positioningMode, setPositioningMode] = useState('auto'); // 'auto' | 'manual'
  const [manualStep, setManualStep] = useState('configure'); // 'configure' | 'fill'
  const [extractionMethod, setExtractionMethod] = useState(null);
  const [expandedFields, setExpandedFields] = useState(new Set());
  const [focusField, setFocusField] = useState(null); // field to scroll the viewer to
  
  // Phase 1 state
  const [phase1Completed, setPhase1Completed] = useState(false);
  const [showPhase1Modal, setShowPhase1Modal] = useState(false);
  // Sticky dismissal for the Phase-1 setup modal (state + per-doc localStorage)
  // so closing it actually closes it instead of re-opening on every field edit.
  const [phase1Dismissed, setPhase1Dismissed] = useState(false);
  useEffect(() => {
    if (!id) return;
    try {
      setPhase1Dismissed(window.localStorage.getItem(`cosign_phase1_dismissed_${id}`) === '1');
    } catch { /* noop */ }
  }, [id]);
  const [postSetupPromptOpen, setPostSetupPromptOpen] = useState(false);
  const [postSetupLanguage, setPostSetupLanguage] = useState('en');
  const [postSetupConfirmed, setPostSetupConfirmed] = useState(false);
  const [postSetupFinalizing, setPostSetupFinalizing] = useState(false);
  const [phaseTranslations, setPhaseTranslations] = useState({ en: {} });
  const [documentContext, setDocumentContext] = useState({ documentType: 'unknown', isMultiParty: false, role: null, includedFieldIds: [] });
  const [resolvedFileUrl, setResolvedFileUrl] = useState(null);
  const [fileRetryUsed, setFileRetryUsed] = useState(false);
  const [fileAccessError, setFileAccessError] = useState('');
  const [randomMessage, setRandomMessage] = useState('');
  const [funFact, setFunFact] = useState('');
  const [snakeGameStarted, setSnakeGameStarted] = useState(false);
  // Optional "translate this document into another language" prompt (personal).
  const [translateLang, setTranslateLang] = useState('');
  const [translating, setTranslating] = useState(false);
  const [translateDismissed, setTranslateDismissedState] = useState(false);
  // Remember "Keep English" per document — re-prompting on every visit nags
  // users who already made the choice.
  useEffect(() => {
    if (!id) return;
    try {
      if (window.localStorage.getItem(`cosign_translate_dismissed_${id}`) === '1') {
        setTranslateDismissedState(true);
      }
    } catch { /* noop */ }
  }, [id]);
  const setTranslateDismissed = useCallback((v) => {
    setTranslateDismissedState(v);
    if (v) {
      try { window.localStorage.setItem(`cosign_translate_dismissed_${id}`, '1'); } catch { /* noop */ }
    }
  }, [id]);
  const [translateError, setTranslateError] = useState('');
  const chatEndRef = useRef(null);
  const saveTimeouts = useRef({});
  const langMenuRef = useRef(null);
  const messageIntervalRef = useRef(null);

  // Localized viewer/chat labels follow the selected view language
  const tView = useCallback((key, params = {}) => {
    const langTranslations = phaseTranslations[viewLang] || phaseTranslations.en || {};
    const keys = key.split('.');
    let value = langTranslations;
    for (const k of keys) {
      value = value?.[k];
    }
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  }, [phaseTranslations, viewLang]);
  const getViewerText = useCallback((key, params = {}) => {
    const value = tView(key, params);
    return value === key ? t(key, params) : value;
  }, [tView, t]);
  const funFactIntervalRef = useRef(null);

  // Close language menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (langMenuRef.current && !langMenuRef.current.contains(e.target)) {
        setLangMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  // ============ FETCH DOCUMENT ============
  useEffect(() => {
    if (!id || !user) return;
    // Wait for org membership to resolve so org-scoped docs aren't missed on
    // the first render (orgId still null) and bounced to the dashboard.
    if (orgLoading) return;

    const fetchDocument = async () => {
      try {
        let query = supabase
          .from('documents')
          .select('*')
          .eq('id', id);

        if (orgId) {
          query = query.or(`org_id.eq.${orgId},created_by.eq.${user.id},user_id.eq.${user.id}`);
        } else {
          query = query.or(`created_by.eq.${user.id},user_id.eq.${user.id}`);
        }

        const { data, error } = await query.single();

        if (error) throw error;
        const freshFileUrl = await resolveEnterpriseDocumentUrl({
          filePath: data?.file_path,
          fallbackUrl: data?.file_url,
        });
        setResolvedFileUrl(freshFileUrl || data?.file_url || null);
        setFileRetryUsed(false);
        setFileAccessError('');
        setDocument(data);
        // Hydrate the extraction-method badge from the stored value so it shows
        // on reload, not only right after OCR runs.
        if (data?.phase1_data?.extractionMethod) {
          setExtractionMethod(data.phase1_data.extractionMethod);
        }
        if (data?.phase1_data?.setupCompleted) {
          setPhase1Completed(true);
        }
        if (data?.phase1_data?.documentType) {
          setDocumentContext({
            documentType: data.phase1_data.documentType || 'unknown',
            isMultiParty: !!data.phase1_data.isMultiParty,
            parties: data.phase1_data.parties || [],
            detectedRoles: data.phase1_data.detectedRoles || [],
            role: data.phase1_data.role || null,
            includedFieldIds: data.phase1_data.includedFieldIds || [],
          });
        }

        // Set viewLang to document's preferred language if set
        if (data.preferred_language) {
          setViewLang(data.preferred_language);
          if (data.preferred_language !== 'en') {
            setPreferredLang(data.preferred_language);
          }
        } else {
          setViewLang('en');
        }

        setChatMessages([{
          role: 'assistant',
          content: 'chat.greeting',
        }]);
      } catch (err) {
        toast.error(getViewerText('viewer.toast.documentNotFound'));
        router.push(`/${locale}/dashboard`);
      } finally {
        setLoading(false);
      }
    };

    fetchDocument();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, orgId, orgLoading, locale, router]);

  // ============ FETCH FIELDS ============
  const fieldsMountedRef = useRef(true);
  const fetchFields = useCallback(async () => {
    if (!id) return;

    try {
      const { data, error } = await supabase
        .from('fields')
        .select('*')
        .eq('document_id', id)
        .order('sort_order', { ascending: true });

      if (!fieldsMountedRef.current) return [];
      if (error) throw error;
      setFields(data || []);
      return data || [];
    } catch (err) {
      // Swallow transient network aborts when the user navigates away
      // (e.g. "TypeError: Failed to fetch" after unmount).
      if (!fieldsMountedRef.current) return [];
      const msg = err?.message || '';
      if (/failed to fetch/i.test(msg) || err?.name === 'AbortError') {
        return [];
      }
      console.error('Error fetching fields:', err);
      return [];
    } finally {
      if (fieldsMountedRef.current) setFieldsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fieldsMountedRef.current = true;
    if (id) fetchFields();
    return () => {
      fieldsMountedRef.current = false;
    };
  }, [id, fetchFields]);

  // Non-English languages this document already has field content for.
  const availableTranslations = useMemo(() => {
    const have = new Set();
    for (const lng of locales) {
      if (lng === 'en') continue;
      if (fields.some((f) => f[`field_name_${lng}`] && String(f[`field_name_${lng}`]).trim())) have.add(lng);
    }
    return have;
  }, [fields]);

  // Show the optional translate prompt when the doc is English-only and ready.
  const showTranslatePrompt =
    !translateDismissed &&
    !ocrProcessing &&
    !fieldsLoading &&
    fields.length > 0 &&
    viewLang === 'en' &&
    availableTranslations.size === 0 &&
    (!document?.preferred_language || document.preferred_language === 'en');

  const handleTranslateDocument = useCallback(async (language) => {
    if (!language || language === 'en' || translating) return;
    setTranslating(true);
    setTranslateError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(`/api/documents/${id}/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ language }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setTranslateError(body.error || 'Translation failed. Please try again.');
        return;
      }
      await fetchFields();
      setPreferredLang(language);
      setViewLang(language);
      setTranslateDismissed(true);
      toast.success(`${localeFlags[language] || ''} ${localeNames[language] || language}`.trim());
    } catch (e) {
      setTranslateError('Translation failed. Please try again.');
    } finally {
      setTranslating(false);
    }
  }, [id, translating, fetchFields]);

  const activeDocumentUrl = resolvedFileUrl || document?.file_url || null;

  const handleDocumentFileLoadError = useCallback(async () => {
    if (!document) return;
    if (!fileRetryUsed && document.file_path) {
      setFileRetryUsed(true);
      const refreshed = await resolveEnterpriseDocumentUrl({
        filePath: document.file_path,
        fallbackUrl: activeDocumentUrl,
      });
      if (refreshed && refreshed !== activeDocumentUrl) {
        setResolvedFileUrl(refreshed);
        setFileAccessError('');
        return;
      }
    }
    setFileAccessError('Document link expired or inaccessible.');
  }, [document, fileRetryUsed, activeDocumentUrl]);

  // ============ AUTO-TRIGGER OCR ============
  useEffect(() => {
    if (!document || !user || fieldsLoading) return;
    if (
      (document.status === 'uploaded' || document.status === 'processing') &&
      fields.length === 0 &&
      !ocrProcessing &&
      !ocrAttemptedRef.current
    ) {
      const triggerOcr = async () => {
        ocrAttemptedRef.current = true;
        setOcrProcessing(true);
        setOcrFailed(false);
        setSnakeGameStarted(false);
        const ocrMode = isEnterpriseRoute ? 'pre_setup' : 'full';

        const messageKeys = [
          'viewer.processingMessage0', 'viewer.processingMessage1', 'viewer.processingMessage2',
          'viewer.processingMessage3', 'viewer.processingMessage4', 'viewer.processingMessage5',
          'viewer.processingMessage6', 'viewer.processingMessage7', 'viewer.processingMessage8',
          'viewer.processingMessage9', 'viewer.processingMessage10', 'viewer.processingMessage11',
          'viewer.processingMessage12', 'viewer.processingMessage13', 'viewer.processingMessage14',
        ];
        const funFactKeys = [
          'viewer.funFact0', 'viewer.funFact1', 'viewer.funFact2',
          'viewer.funFact3', 'viewer.funFact4', 'viewer.funFact5',
        ];

        const getRandomMessage = () => {
          const key = messageKeys[Math.floor(Math.random() * messageKeys.length)];
          return getViewerText(key);
        };
        const getRandomFunFact = () => {
          const key = funFactKeys[Math.floor(Math.random() * funFactKeys.length)];
          return getViewerText(key);
        };
        setRandomMessage(getRandomMessage());
        setFunFact(getRandomFunFact());

        messageIntervalRef.current = setInterval(() => setRandomMessage(getRandomMessage()), 10000);
        funFactIntervalRef.current = setInterval(() => setFunFact(getRandomFunFact()), 20000);

        try {
          toast.loading(getViewerText('viewer.toast.analyzing'), { id: 'ocr' });
          const { data: { session } } = await supabase.auth.getSession();
          const response = await fetch('/api/ocr', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              ...(orgId ? { 'X-Org-Id': orgId } : {}),
            },
            body: JSON.stringify({
              documentId: id,
              userId: user.id,
              preferredLanguage: document?.preferred_language || 'en',
              mode: ocrMode,
            }),
          });
          const data = await response.json();
          if (response.status === 202) {
            // Parked/queued: the job continues server-side (resumed by the
            // per-minute cron). Poll the document until it reaches a terminal
            // status instead of reporting a bogus success ("Found undefined
            // fields!") and leaving the user with an empty panel.
            toast.loading(getViewerText('viewer.toast.stillAnalyzing'), { id: 'ocr' });
            const POLL_MS = 10000;
            const DEADLINE = Date.now() + 15 * 60 * 1000;
            let finalStatus = 'timeout';
            while (Date.now() < DEADLINE) {
              await new Promise((r) => setTimeout(r, POLL_MS));
              const { data: polled } = await supabase
                .from('documents').select('status').eq('id', id).single();
              if (polled?.status === 'completed' || polled?.status === 'ready') { finalStatus = polled.status; break; }
              if (polled?.status === 'error') { finalStatus = 'error'; break; }
            }
            if (finalStatus === 'completed' || finalStatus === 'ready') {
              toast.success(getViewerText('viewer.toast.analysisComplete'), { id: 'ocr' });
              await fetchFields();
              const { data: updatedDoc } = await supabase.from('documents').select('status, file_url').eq('id', id).single();
              if (updatedDoc) setDocument(prev => prev ? { ...prev, ...updatedDoc } : updatedDoc);
            } else {
              setOcrFailed(true);
              toast.error(
                finalStatus === 'error'
                  ? getViewerText('viewer.toast.analysisFailedRetry')
                  : getViewerText('viewer.toast.analysisSlow'),
                { id: 'ocr' }
              );
            }
            return;
          }
          if (!response.ok) throw new Error(data.message || data.error || 'OCR failed');
          toast.success(getViewerText('viewer.toast.fieldsFound', { count: data.fieldsCount ?? 0 }), { id: 'ocr' });
          setExtractionMethod(data.extractionMethod);
          await fetchFields();
          const { data: updatedDoc } = await supabase.from('documents').select('status, file_url').eq('id', id).single();
          if (updatedDoc) {
            setDocument(prev => prev ? { ...prev, ...updatedDoc } : updatedDoc);
          }
        } catch (err) {
          console.error('OCR error:', err);
          // A timed-out/killed function or a network drop lands here — surface a
          // recoverable "failed" state instead of an endless spinner.
          setOcrFailed(true);
          toast.error(getViewerText('viewer.toast.analysisFailed', { error: err.message }), { id: 'ocr' });
        } finally {
          setOcrProcessing(false);
          if (messageIntervalRef.current) {
            clearInterval(messageIntervalRef.current);
            messageIntervalRef.current = null;
          }
          if (funFactIntervalRef.current) {
            clearInterval(funFactIntervalRef.current);
            funFactIntervalRef.current = null;
          }
        }
      };
      triggerOcr();
    }
  }, [document, fields, fieldsLoading, user, ocrProcessing, isEnterpriseRoute, getViewerText, id, fetchFields, retryNonce]);

  // Retry after a failed/timed-out analysis: reset the guard and re-run the
  // auto-trigger effect.
  const retryOcr = useCallback(() => {
    ocrAttemptedRef.current = false;
    setOcrFailed(false);
    setRetryNonce((n) => n + 1);
  }, []);


  // If locale starts non-English, treat it as preferred language
  useEffect(() => {
    if (viewLang !== 'en') {
      setPreferredLang(prev => prev || viewLang);
    }
  }, [viewLang]);

  // ============ LOAD TRANSLATIONS FOR PHASE 1 ============
  // Only fetch the locales the UI can actually show — English plus the
  // document's own language (the viewer/menu never offers more than that). The
  // old code fetched all 9 locale bundles up front, which both wasted requests
  // and made the setup modal offer a random second language (e.g. vi) for an
  // English-only document. Merge so a later language switch keeps what's loaded.
  useEffect(() => {
    const codes = Array.from(
      new Set(['en', document?.preferred_language, viewLang].filter(Boolean))
    );
    const loadTranslations = async () => {
      try {
        const entries = await Promise.all(
          codes.map(async (code) => {
            try {
              const res = await fetch(`/locales/${code}.json`);
              return [code, res.ok ? await res.json() : {}];
            } catch {
              return [code, {}];
            }
          })
        );
        setPhaseTranslations((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      } catch (err) {
        console.error('Error loading translations:', err);
      }
    };
    loadTranslations();
  }, [document?.preferred_language, viewLang]);

  const hasStableRectBackedPositions = useMemo(
    () => {
      if (document?.has_rect === true) return true;

      return fields.some((f) => {
        const pos = f.position || {};
        const hasNumericRectCoords = [pos.x, pos.y, pos.width, pos.height].every((n) => Number.isFinite(Number(n)));
        const nativeSource = ['native-form', 'acroform', 'annotation'].includes(pos.source);
        return hasNumericRectCoords && nativeSource;
      });
    },
    [document?.has_rect, fields]
  );

  // ============ CHECK IF PHASE 1 IS NEEDED ============
  useEffect(() => {
    // Wait for translations and document to load
    if (!phaseTranslations.en?.setup) return;
    if (!document) return;
    if (fieldsLoading || fields.length === 0 || ocrProcessing) return;
    if (document?.phase1_data?.setupCompleted) return;

    // Determine document type and if it's multi-party based on field names
    const fieldNameList = fields.map(f => (f.field_name || '').toLowerCase());
    const fieldNames = fieldNameList.join(' ');
    const contains = (needle) => fieldNameList.some(n => n.includes(needle));
    const containsAny = (needles) => needles.some(contains);
    const hasPair = (a, b) => containsAny(a) && containsAny(b);

    const isRental = containsAny(['landlord', 'tenant', 'rental', 'lease', 'lessor', 'lessee']);
    const isEmployment = containsAny(['employer', 'employee', 'position', 'salary', 'worker', 'hr']);
    const isNDA = containsAny(['nda', 'confidential', 'disclosing', 'receiving', 'recipient']);
    const isSales = containsAny(['buyer', 'seller', 'purchase', 'sale', 'vendor', 'purchaser']);
    
    let docType = 'other-contract';
    if (isRental) docType = 'rental';
    else if (isEmployment) docType = 'employment';
    else if (isNDA) docType = 'nda';
    else if (isSales) docType = 'sales';
    
    const hasSignaturePair =
      (containsAny(['signature 1', 'signer 1', 'sig 1', 'signature a', 'signer a', 'sig a', 'party a', 'party 1', 'party one']) &&
       containsAny(['signature 2', 'signer 2', 'sig 2', 'signature b', 'signer b', 'sig b', 'party b', 'party 2', 'party two'])) ||
      fieldNameList.filter(n => /signature|signer|sig\b/.test(n)).length >= 2;

    const isMulti = (
      (isRental || isNDA || isSales) && (
        hasPair(['landlord', 'lessor', 'owner'], ['tenant', 'renter', 'lessee']) ||
        hasPair(['buyer', 'purchaser'], ['seller', 'vendor']) ||
        hasPair(['disclosing', 'discloser'], ['receiving', 'recipient'])
      )
    ) || (
      hasPair(['client', 'customer', 'company'], ['contractor', 'consultant', 'provider', 'vendor']) ||
      hasPair(['employer'], ['employee', 'worker']) ||
      hasPair(['borrower', 'debtor', 'applicant'], ['lender', 'creditor', 'co-applicant', 'coapplicant']) ||
      hasPair(['licensor'], ['licensee']) ||
      hasPair(['grantor'], ['grantee']) ||
      hasPair(['assignor'], ['assignee']) ||
      hasPair(['party a', 'party 1', 'party one', 'first party', 'party i'], ['party b', 'party 2', 'party two', 'second party', 'party ii']) ||
      hasSignaturePair
    );

    // The OCR pipeline runs a real AI classification (analyzeDocumentContext)
    // and persists it in phase1_data — prefer it over this keyword heuristic
    // (whose default of 'other-contract' misclassifies plain forms), and never
    // discard the parties/roles it detected.
    const persisted = document?.phase1_data || {};
    setDocumentContext((prev) => ({
      ...prev,
      documentType: persisted.documentType || docType,
      isMultiParty: typeof persisted.isMultiParty === 'boolean' ? persisted.isMultiParty : isMulti,
      ...(persisted.parties ? { parties: persisted.parties } : {}),
      ...(persisted.detectedRoles ? { detectedRoles: persisted.detectedRoles } : {}),
    }));

    // Show Phase 1 only if:
    // 1. Not yet completed
    // 2. Fields exist
    // 3. AcroForm/rect positions are NOT available
    // 4. OCR processing is done
    // 5. The user hasn't dismissed it (they can reopen via "Return to Setup")
    const shouldShowPhase1 =
      !phase1Completed &&
      !phase1Dismissed &&
      fields.length > 0 &&
      !hasStableRectBackedPositions &&
      !ocrProcessing;

    if (shouldShowPhase1) {
      setShowPhase1Modal(true);
    }
  }, [fields, fieldsLoading, ocrProcessing, phase1Completed, phase1Dismissed, document, phaseTranslations, hasStableRectBackedPositions]);

  // Keep fun facts and processing messages aligned with the current view language
  useEffect(() => {
    if (!ocrProcessing) return;
    if (!phaseTranslations.en?.viewer) return;

    const messageKeys = [
      'viewer.processingMessage0',
      'viewer.processingMessage1',
      'viewer.processingMessage2',
      'viewer.processingMessage3',
      'viewer.processingMessage4',
      'viewer.processingMessage5',
      'viewer.processingMessage6',
      'viewer.processingMessage7',
      'viewer.processingMessage8',
      'viewer.processingMessage9',
      'viewer.processingMessage10',
      'viewer.processingMessage11',
      'viewer.processingMessage12',
      'viewer.processingMessage13',
      'viewer.processingMessage14',
    ];
    const funFactKeys = [
      'viewer.funFact0',
      'viewer.funFact1',
      'viewer.funFact2',
      'viewer.funFact3',
      'viewer.funFact4',
      'viewer.funFact5',
    ];

    const keyMessage = messageKeys[Math.floor(Math.random() * messageKeys.length)];
    const keyFunFact = funFactKeys[Math.floor(Math.random() * funFactKeys.length)];
    setRandomMessage(getViewerText(keyMessage));
    setFunFact(getViewerText(keyFunFact));
  }, [ocrProcessing, viewLang, phaseTranslations, getViewerText]);

  // ============ FIELD VALUE PERSISTENCE ============
  // pendingSaves holds the latest unsaved value per field so navigation away
  // can FLUSH them instead of silently dropping the last keystrokes.
  const pendingSaves = useRef({});
  const [savingCount, setSavingCount] = useState(0);

  const persistFieldValue = async (fieldId, value) => {
    delete pendingSaves.current[fieldId];
    try {
      const { error } = await supabase
        .from('fields')
        .update({ field_value: value })
        .eq('id', fieldId);
      if (error) throw error;
    } catch (err) {
      console.error('Error saving field:', err);
      toast.error(getViewerText('viewer.toast.saveFieldFailed'));
    }
  };

  const handleFieldChange = (fieldId, value) => {
    setFields(prev => prev.map(f => f.id === fieldId ? { ...f, field_value: value } : f));

    pendingSaves.current[fieldId] = value;
    if (saveTimeouts.current[fieldId]) {
      clearTimeout(saveTimeouts.current[fieldId]);
    } else {
      setSavingCount((n) => n + 1);
    }

    saveTimeouts.current[fieldId] = setTimeout(async () => {
      delete saveTimeouts.current[fieldId];
      await persistFieldValue(fieldId, value);
      setSavingCount((n) => Math.max(0, n - 1));
    }, 500);
  };

  useEffect(() => {
    const timeouts = saveTimeouts.current;
    const pending = pendingSaves.current;
    return () => {
      Object.values(timeouts).forEach(clearTimeout);
      // Flush anything still unsaved — the update is fire-and-forget but the
      // supabase-js request survives route changes within the SPA, and even a
      // full unload usually completes it (vs. guaranteed loss before).
      for (const [fieldId, value] of Object.entries(pending)) {
        supabase.from('fields').update({ field_value: value }).eq('id', fieldId)
          .then(() => {}, () => {});
      }
      if (messageIntervalRef.current) {
        clearInterval(messageIntervalRef.current);
      }
      if (funFactIntervalRef.current) {
        clearInterval(funFactIntervalRef.current);
      }
    };
  }, []);

  // Ensure greeting is localized after translations load or language changes
  useEffect(() => {
    if (chatMessages.length === 0) return;
    const first = chatMessages[0];
    if (first.role !== 'assistant') return;
    if (first.content !== 'chat.greeting') return;
    setChatMessages(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[0] = { ...next[0], content: getViewerText('chat.greeting') };
      return next;
    });
  }, [chatMessages, getViewerText, viewLang, phaseTranslations]);

  // ============ MANUAL MODE: Position updates ============
  const handlePositionsUpdate = useCallback((updatedFields) => {
    setFields(updatedFields);
    // Debounced save of all position changes
    if (saveTimeouts.current['__positions']) {
      clearTimeout(saveTimeouts.current['__positions']);
    }
    saveTimeouts.current['__positions'] = setTimeout(async () => {
      for (const field of updatedFields) {
        if (field.position?.source === 'manual') {
          await supabase
            .from('fields')
            .update({ position: field.position })
            .eq('id', field.id);
        }
      }
    }, 800);
  }, []);

  const handleConfigDone = useCallback(() => {
    // Save all positions immediately then switch to fill step
    const manualFields = fields.filter(f => f.position?.source === 'manual');
    Promise.all(
      manualFields.map(f =>
        supabase.from('fields').update({ position: f.position }).eq('id', f.id)
      )
    ).then(() => {
      toast.success(getViewerText('viewer.toast.positionsSaved'));
    });
    setManualStep('fill');
  }, [fields, getViewerText]);

  // ============ RE-PROCESS POSITIONS ============
  const handleReprocessPositions = async () => {
    if (reprocessing) return;
    setReprocessing(true);

    try {
      toast.loading(getViewerText('viewer.toast.reprocessing'), { id: 'reprocess' });

      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch('/api/reprocess-positions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
          ...(orgId ? { 'X-Org-Id': orgId } : {}),
        },
        body: JSON.stringify({ documentId: id }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || data.error || 'Reprocessing failed');
      }

      toast.success(getViewerText('viewer.toast.positionsUpdated', { updated: data.updatedCount, total: data.totalFields }), { id: 'reprocess' });
      await fetchFields();
    } catch (err) {
      console.error('Reprocess error:', err);
      toast.error(getViewerText('viewer.toast.reprocessFailed', { error: err.message }), { id: 'reprocess' });
    } finally {
      setReprocessing(false);
    }
  };

  // ============ PDF EXPORT ============
  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);

    try {
      const { generateFilledPdf } = await import('../../../lib/exportPdf');

      const pdfBytes = await generateFilledPdf({
        documentName: document?.file_name || 'Document',
        fileUrl: activeDocumentUrl,
        fileType: document?.file_type,
        fields,
        locale: viewLang,
      });

      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${(document?.file_name || 'document').replace(/\.[^/.]+$/, '')}_filled.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(getViewerText('viewer.toast.exportSuccess'));
    } catch (err) {
      console.error('Export error:', err);
      toast.error(getViewerText('viewer.toast.exportFailed'));
    } finally {
      setExporting(false);
    }
  };

  // ============ CHAT ============
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const pushChatMessages = (newMessages) => {
    setChatMessages(prev => {
      const combined = [...prev, ...newMessages];
      return combined.slice(-6);
    });
  };

  const sendChatMessage = async (message) => {
    if (!message || chatLoading) return;
    pushChatMessages([{ role: 'user', content: message }]);
    setChatLoading(true);

    try {
      const history = [...chatMessages, { role: 'user', content: message }].slice(-6);
      const { data: { session: authSession } } = await supabase.auth.getSession();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession?.access_token ? { Authorization: `Bearer ${authSession.access_token}` } : {}),
        },
        body: JSON.stringify({
          message,
          documentId: id,
          messages: history,
          context: pendingChatContext || '',
          language: viewLang,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Chat failed');
      }

      pushChatMessages([{ role: 'assistant', content: data.response }]);
    } catch {
      toast.error(getViewerText('viewer.toast.chatFailed'));
    } finally {
      setChatLoading(false);
      setPendingChatContext('');
    }
  };

  const handleSendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMessage = chatInput.trim();
    if (!chatConsentAccepted) {
      setChatConsentOpen(true);
      setChatConsentChecked(false);
      setActiveTab('chat');
      return;
    }
    setChatInput('');
    await sendChatMessage(userMessage);
  };

  const handleAskCo = async (field) => {
    if (!field) return;
    setChatMessages([]);
    setActiveTab('chat');
    setChatInput('');

    const displayName = getDisplayFieldName(field) || field.field_name || 'Unknown field';
    const englishName = field.field_name || '';
    const explanation = getExplanation(field);
    const positionHint = field.position_hint || '';

    const contextLines = [
      `Document: ${document?.file_name || 'Document'}`,
      `Document type: ${documentContext?.documentType || 'unknown'}`,
      `Multi-party: ${documentContext?.isMultiParty ? 'yes' : 'no'}`,
      `Extraction: ${extractionMethod || 'unknown'}`,
      `Field (current label): ${displayName}`,
    ];
    if (englishName && englishName !== displayName) {
      contextLines.push(`Field (English): ${englishName}`);
    }
    if (positionHint) {
      contextLines.push(`Field location hint: ${positionHint}`);
    }
    if (explanation) {
      contextLines.push(`Current explanation: ${explanation}`);
    }

    const context = contextLines.join('\n');
    setPendingChatContext(context);
    setCurrentChatField(displayName);

    if (!chatConsentAccepted) {
      setChatConsentOpen(true);
      setChatConsentChecked(false);
    }
  };

  // ============ HELPERS: field labels/explanations based on viewLang ============
  const getDisplayFieldName = (field) => {
    return getTrLabel(field, viewLang) || field.field_name || '';
  };

  const getSubFieldName = (field) => {
    // Only show English as the sub-header when viewing non-English
    if (viewLang === 'en') return '';
    return field.field_name || '';
  };

  const getExplanation = (field) => {
    return getTrExplanation(field, viewLang);
  };

  const currentLang = LANGUAGES.find(l => l.code === viewLang) || LANGUAGES[0];

  // ============ RENDER ============

  const visibleFields = useMemo(() => {
    const role = documentContext?.role;
    if (!role) return fields;
    const docType = documentContext?.documentType || 'other-contract';
    const roleOption = (ROLE_OPTIONS_GLOBAL[docType] || ROLE_OPTIONS_GLOBAL['other-contract']).find(r => r.value === role);
    if (!roleOption) return fields;
    const excludeFields = roleOption.excludeFields || [];
    const included = new Set(documentContext?.includedFieldIds || []);
    return fields.filter(f => {
      if (included.has(f.id)) return true;
      const name = (f.field_name || '').toLowerCase();
      const shouldExclude = excludeFields.some(ex => name.includes(ex));
      return !shouldExclude;
    });
  }, [fields, documentContext]);

  // Default expand first field when list loads
  useEffect(() => {
    if (visibleFields.length === 0) return;
    setExpandedFields((prev) => {
      if (prev.size > 0) return prev;
      return new Set([visibleFields[0].id]);
    });
  }, [visibleFields]);
  const filledCount = visibleFields.filter(f => f.field_value).length;
  const progressPercent = visibleFields.length > 0
    ? Math.round((filledCount / visibleFields.length) * 100)
    : 0;

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-slateish-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return null;

  // ============ MANUAL FIELD CREATION ============
  // Detection isn't guaranteed to find every blank (flat prose contracts in
  // particular). Let the user add a field themselves; it gets a centered
  // default box on the current page which they can reposition.
  const addManualField = async (type) => {
    const typeDefaults = {
      text: { name: tView('viewer.manualTextFieldName'), width: 30, height: 3.5 },
      signature: { name: tView('viewer.manualSignatureFieldName'), width: 30, height: 6 },
      date: { name: tView('viewer.manualDateFieldName'), width: 16, height: 3.5 },
    };
    const cfg = typeDefaults[type] || typeDefaults.text;
    // Page state lives inside PdfViewer; default new fields to page 1 — the
    // box is repositionable and the sidebar entry works regardless of page.
    const page = 1;
    const existingCount = fields.filter((f) => f.field_type === type).length;
    const fieldName = existingCount > 0 ? `${cfg.name} ${existingCount + 1}` : cfg.name;
    const { error: addError } = await supabase.from('fields').insert({
      document_id: id,
      field_name: fieldName,
      field_type: type,
      sort_order: Date.now() % 1000000,
      position: {
        page,
        x: 35,
        y: 45,
        width: cfg.width,
        height: cfg.height,
        source: 'manual',
      },
    });
    if (addError) {
      console.error('Manual field insert failed:', addError);
      toast.error(getViewerText('viewer.toast.addFieldFailed', { error: addError.message }));
      return;
    }
    toast.success(tView('viewer.manualFieldAdded'));
    await fetchFields();
  };

  // ============ PHASE 1 HANDLERS ============
  const handlePhase1Complete = async (result) => {
    console.log('[Phase1] Completed with result:', result);
    
    // Save field positions to database
    const { fields: updatedFields } = result;
    if (updatedFields && updatedFields.length > 0) {
      const customFields = updatedFields.filter(f => typeof f.id === 'string' && f.id.startsWith('custom-'));
      const existingFields = updatedFields.filter(f => !customFields.includes(f));

      if (customFields.length > 0) {
        const ts = Date.now() % 1000000;
        const { error: customInsertError } = await supabase
          .from('fields')
          .insert(customFields.map((f, i) => ({
            document_id: id,
            field_name: f.field_name,
            field_type: f.field_type || 'text',
            position: f.position || null,
            position_hint: f.position_hint || null,
            sort_order: ts + i,
          })));
        if (customInsertError) {
          console.error('Custom field insert failed:', customInsertError);
          toast.error(getViewerText('viewer.toast.customFieldsFailed', { error: customInsertError.message }));
        }
      }

      for (const field of existingFields) {
        if (field.position) {
          await supabase
            .from('fields')
            .update({ position: field.position })
            .eq('id', field.id);
        }
      }
      // Refresh fields
      await fetchFields();
    }

    // Persist role-based access for Phase 2
    if (id) {
      await supabase
        .from('documents')
        .update({
          phase1_data: {
            ...(document?.phase1_data || {}),
            role: result.role || null,
            includedFieldIds: result.includedFieldIds || [],
            setupCompleted: true,
          }
        })
        .eq('id', id);
      setDocumentContext(prev => ({
        ...prev,
        role: result.role || null,
        includedFieldIds: result.includedFieldIds || [],
      }));
    }

    setPhase1Completed(true);
    setShowPhase1Modal(false);
    setPostSetupLanguage(document?.preferred_language || viewLang || 'en');
    setPostSetupConfirmed(false);
    setPostSetupPromptOpen(true);
    toast.success(getViewerText('viewer.toast.positionsSaved'));
  };

  const handlePostSetupBack = () => {
    setPostSetupPromptOpen(false);
    setShowPhase1Modal(true);
  };

  const handlePostSetupConfirm = async () => {
    if (!postSetupConfirmed || postSetupFinalizing) return;
    setPostSetupFinalizing(true);

    try {
      if (id && postSetupLanguage && postSetupLanguage !== document?.preferred_language) {
        await supabase
          .from('documents')
          .update({ preferred_language: postSetupLanguage })
          .eq('id', id);
        setDocument((prev) => (prev ? { ...prev, preferred_language: postSetupLanguage } : prev));
      }

      if (postSetupLanguage) {
        setViewLang(postSetupLanguage);
        if (postSetupLanguage !== 'en') setPreferredLang(postSetupLanguage);
      }

      // Run post-setup enrichment (Step 3) to add explanations/translations
      try {
        toast.loading(getViewerText('viewer.toast.finalizing'), { id: 'post-setup' });
        const { data: { session } } = await supabase.auth.getSession();
        const enrichRes = await fetch('/api/ocr', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              ...(orgId ? { 'X-Org-Id': orgId } : {}),
          },
          body: JSON.stringify({
            documentId: id,
            userId: user.id,
            preferredLanguage: postSetupLanguage || 'en',
            mode: 'post_setup',
          }),
        });
        if (!enrichRes.ok) {
          const errData = await enrichRes.json().catch(() => ({}));
          throw new Error(errData.message || errData.error || 'Enrichment failed');
        }
        await fetchFields();
        toast.success(getViewerText('viewer.toast.setupComplete'), { id: 'post-setup' });
      } catch (err) {
        toast.error(getViewerText('viewer.toast.enrichmentFailed'), { id: 'post-setup' });
      }
    } finally {
      setPostSetupFinalizing(false);
      setPostSetupPromptOpen(false);
    }
  };

  // Check if we should show Return to Setup button
  const hasAcroformOrRect = hasStableRectBackedPositions;

  const showReturnToSetup = 
    fields.length > 0 && 
    !hasAcroformOrRect && 
    !ocrProcessing;

  const displayTitle = getDocumentDisplayTitle({
    documentType: document?.phase1_data?.documentType,
    fileName: document?.file_name,
  });

  return (
    <>
      <Head>
        <title>{`${displayTitle || 'Document'} — Cô Sign`}</title>
      </Head>

      <div className="h-screen flex flex-col bg-slateish-100">
        {/* Header */}
        <header className="bg-white border-b border-slateish-200 flex-shrink-0 z-30">
          <div className="flex items-center justify-between px-5 h-14">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => router.push(`/${locale}/dashboard`)}
                className="p-2 rounded-lg hover:bg-slateish-100 transition-colors text-slateish-500 flex-shrink-0"
              >
                <FiArrowLeft className="w-5 h-5" />
              </button>
              <div className="min-w-0">
                <p className="font-semibold text-slateish-900 truncate text-sm">
                  {displayTitle || 'Document'}
                </p>
                <p className="text-xs text-slateish-500">
                  {ocrProcessing
                    ? tView('viewer.statusAnalyzing')
                    : visibleFields.length > 0
                      ? tView('viewer.fieldsCompleted', { filled: filledCount, total: visibleFields.length })
                      : tView('viewer.noFields')}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Extraction method status badge */}
              {extractionMethod && extractionMethod !== 'unknown' && (() => {
                const BADGE = {
                  'native-form': { key: 'nativeForm', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
                  hybrid: { key: 'nativeForm', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
                  'native-no-rect': { key: 'nativeForm', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
                  'text-layer': { key: 'textLayer', cls: 'bg-green-100 text-green-800 border-green-200' },
                  'text-layer-hybrid': { key: 'textLayer', cls: 'bg-green-100 text-green-800 border-green-200' },
                  'text-layer-disabled': { key: 'aiDisabled', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
                  vision: { key: 'vision', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
                  'vision-ocr-anchor': { key: 'vision', cls: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
                  'post-setup': { key: 'ready', cls: 'bg-slateish-100 text-slateish-700 border-slateish-200' },
                  none: { key: 'noFields', cls: 'bg-slateish-100 text-slateish-700 border-slateish-200' },
                };
                const m = BADGE[extractionMethod] || { key: 'ready', cls: 'bg-slateish-100 text-slateish-700 border-slateish-200' };
                return (
                  <span className={`px-2.5 py-1.5 text-xs font-medium rounded-full border ${m.cls}`}>
                    {tView(`viewer.extractionMethod.${m.key}`)}
                  </span>
                );
              })()}

              {/* Return to Setup */}
              {showReturnToSetup && (
                <button
                  onClick={() => setShowPhase1Modal(true)}
                  className="hidden sm:flex items-center gap-2 text-sm text-amber-800 px-3 py-2 rounded-full border border-amber-200 bg-amber-50 hover:bg-amber-100 transition-colors"
                >
                  <FiSettings className="w-4 h-4" />
                  {tView('setup.returnToSetup') || 'Return to Setup'}
                </button>
              )}

              {/* Download original */}
              {activeDocumentUrl && (
                <a
                  href={activeDocumentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hidden sm:flex items-center gap-2 text-sm text-slateish-600 hover:text-slateish-900 px-3 py-2 rounded-full hover:bg-slateish-100 transition-colors border border-slateish-200"
                >
                  <FiDownload className="w-4 h-4" />
                  {tView('viewer.download')}
                </a>
              )}

              {/* Language toggle */}
              <div className="relative" ref={langMenuRef}>
                <button
                  onClick={() => setLangMenuOpen(!langMenuOpen)}
                  className="flex items-center gap-1.5 text-sm text-slateish-600 hover:text-slateish-900 px-3 py-2 rounded-full hover:bg-slateish-100 transition-colors border border-slateish-200"
                >
                  <FiGlobe className="w-4 h-4" />
                  <span className="hidden sm:inline">{currentLang.flag} {currentLang.label}</span>
                  <span className="sm:hidden">{currentLang.flag}</span>
                </button>

                {langMenuOpen && (
                  <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-slateish-200 py-1 z-50">
                    {getFilteredLanguages(viewLang, preferredLang).map((lang) => (
                      <button
                        key={lang.code}
                        onClick={() => {
                          setViewLang(lang.code);
                          if (lang.code !== 'en') setPreferredLang(lang.code);
                          setLangMenuOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2.5 transition-colors ${
                          viewLang === lang.code
                            ? 'bg-brand-50 text-brand-700 font-medium'
                            : 'text-slateish-700 hover:bg-slateish-50'
                        }`}
                      >
                        <span>{lang.flag}</span>
                        <span>{lang.label}</span>
                        {viewLang === lang.code && (
                          <FiCheck className="w-4 h-4 ml-auto text-brand-600" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={signOut}
                className="p-2 rounded-lg hover:bg-slateish-100 transition-colors text-slateish-500"
              >
                <FiLogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {fileAccessError && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
            {fileAccessError}
          </div>
        )}

        {/* Full screen processing overlay */}
        {ocrProcessing && (
          <div className="fixed inset-0 z-30 overflow-hidden">
            {/* Atmospheric background */}
            <div className="absolute inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950" />
            <div className="absolute -top-24 -left-24 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl animate-float-slow" />
            <div className="absolute -bottom-28 right-0 h-96 w-96 rounded-full bg-cyan-300/10 blur-3xl animate-float" />
            <div className="absolute inset-0 opacity-40" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.25) 1px, transparent 0)', backgroundSize: '24px 24px' }} />

            <div className="relative h-full w-full flex flex-col">
              <div className="flex-1 flex items-center justify-center px-6 py-12">
                <div className="relative w-full max-w-3xl rounded-3xl border border-white/10 bg-slate-950/70 backdrop-blur-xl shadow-2xl">
                  {/* Hidden game panel */}
                  <div
                    className={`absolute right-6 top-6 transition-all duration-500 ${
                      snakeGameStarted ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-[2px] scale-95'
                    }`}
                    style={{ pointerEvents: snakeGameStarted ? 'auto' : 'none' }}
                  >
                    <SnakeGame
                      isActive={true}
                      compact={true}
                      showUi={false}
                      onStart={() => setSnakeGameStarted(true)}
                      onGameOver={() => setSnakeGameStarted(false)}
                    />
                  </div>

                  <div
                    className={`p-6 sm:p-8 transition-opacity duration-500 ${
                      snakeGameStarted ? 'opacity-0' : 'opacity-100'
                    }`}
                  >
                    <div className="flex items-center gap-3 text-emerald-300 text-sm font-medium mb-4">
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      {getViewerText('viewer.statusAnalyzing')}
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2 tracking-tight">
                      {randomMessage || getViewerText('viewer.processingMessage0')}
                    </h2>

                    {/* Fun facts */}
                    <div className="mt-4 mb-3">
                      <p className="text-slate-200 text-lg sm:text-xl font-medium leading-snug">
                        {funFact || getViewerText('viewer.funFact0')}
                      </p>
                    </div>

                    {/* Hint between fun facts and progress */}
                    <p className="text-slate-400 text-sm mb-6">
                      {getViewerText('viewer.processingHint')}
                    </p>
                  </div>

                  {/* Bottom progress bar */}
                  <div className="border-t border-white/10 px-6 py-4 sm:px-8">
                    <div className="flex items-center gap-3">
                      <div className="relative flex-1 h-2.5 rounded-full overflow-hidden bg-slate-800/60">
                        <div
                          className="absolute inset-0 opacity-40 animate-bar-shimmer"
                          style={{
                            backgroundImage:
                              'linear-gradient(90deg, rgba(15,23,42,0) 0%, rgba(148,163,184,0.25) 45%, rgba(15,23,42,0) 100%)',
                            backgroundSize: '200% 100%',
                          }}
                        />
                        <div className="absolute -left-1/2 top-0 h-full w-1/2 rounded-full bg-gradient-to-r from-emerald-400 via-cyan-300 to-emerald-400 animate-bar-sweep" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <style jsx>{`
              @keyframes floatSlow {
                0%, 100% { transform: translate3d(0, 0, 0); }
                50% { transform: translate3d(12px, -14px, 0); }
              }
              @keyframes float {
                0%, 100% { transform: translate3d(0, 0, 0); }
                50% { transform: translate3d(-10px, 16px, 0); }
              }
              @keyframes barSweep {
                0% { transform: translateX(0); }
                100% { transform: translateX(200%); }
              }
              @keyframes barShimmer {
                0% { background-position: 0% 50%; }
                100% { background-position: 200% 50%; }
              }
              .animate-float-slow { animation: floatSlow 10s ease-in-out infinite; }
              .animate-float { animation: float 8s ease-in-out infinite; }
              .animate-bar-sweep { animation: barSweep 2.2s linear infinite; }
              .animate-bar-shimmer { animation: barShimmer 3.4s ease-in-out infinite; }
            `}</style>
          </div>
        )}

        {/* Main content */}
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
          {/* MANUAL MODE — Configure step: full-width FieldConfigurer with its own sidebar */}
          {positioningMode === 'manual' && manualStep === 'configure' && activeDocumentUrl ? (
            <FieldConfigurer
              fileUrl={activeDocumentUrl}
              fileName={document.file_name}
              fileType={document.file_type}
              fields={fields}
              onPositionsUpdate={handlePositionsUpdate}
              onDone={handleConfigDone}
              onFileLoadError={handleDocumentFileLoadError}
            />
          ) : (
          <>
          {/* AUTO MODE or MANUAL FILL step: normal PDF viewer + sidebar.
              Mobile: the panes stack (tabs on top) and the document pane is a
              third tab — previously the fixed 420px sidebar crushed the PDF
              pane to zero width, so phones could never see the document. */}
          <div className={`flex-1 ${activeTab === 'document' ? 'flex' : 'hidden'} md:flex flex-col overflow-hidden order-2 md:order-1`}>
            {activeDocumentUrl ? (
              <PdfViewer
                fileUrl={activeDocumentUrl}
                fileName={document.file_name}
                fileType={document.file_type}
                fields={visibleFields}
                highlightFieldIds={expandedFields}
                focusField={focusField}
                onLoadError={handleDocumentFileLoadError}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slateish-400" style={{ background: 'linear-gradient(135deg, #f6fbfc 0%, #e8f5f7 100%)' }}>
                <FiLoader className="w-12 h-12 animate-spin mb-4" />
                <p>Loading document...</p>
              </div>
            )}
          </div>

          {/* Sidebar (full-width panel above the document on mobile) */}
          <div className={`w-full md:w-[420px] bg-white md:border-l border-b md:border-b-0 border-slateish-200 flex flex-col flex-shrink-0 overflow-hidden order-1 md:order-2 ${activeTab === 'document' ? '' : 'flex-1'} md:flex-none`}>
            {/* Tabs */}
            <div className="flex border-b border-slateish-200 flex-shrink-0">
              <button
                onClick={() => setActiveTab('document')}
                className={`md:hidden flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === 'document'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slateish-500 hover:text-slateish-700'
                }`}
              >
                <FiFileText className="w-4 h-4" />
                {tView('viewer.documentTab')}
              </button>
              <button
                onClick={() => setActiveTab('fields')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === 'fields'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slateish-500 hover:text-slateish-700'
                }`}
              >
                <FiList className="w-4 h-4" />
                {tView('viewer.fields')}
                {visibleFields.length > 0 && (
                  <span className="bg-brand-100 text-brand-700 text-xs px-1.5 py-0.5 rounded-full">
                    {visibleFields.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-semibold transition-colors border-b-2 ${
                  activeTab === 'chat'
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-slateish-500 hover:text-slateish-700'
                }`}
              >
                <FiMessageCircle className="w-4 h-4" />
                {tView('viewer.chat')}
              </button>
            </div>

            <div className="px-4 pt-4">
              <div className="flex items-center justify-between text-xs font-semibold flex-wrap gap-x-2">
                <span className="text-brand-600">{tView('viewer.fieldsCompleted', { filled: filledCount, total: visibleFields.length })}</span>
                <span className={savingCount > 0 ? 'text-amber-500' : 'text-slateish-400'}>
                  {savingCount > 0
                    ? tView('viewer.saving')
                    : tView('viewer.remaining', { count: Math.max(visibleFields.length - filledCount, 0) })}
                </span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-brand-50 overflow-hidden">
                <div className="h-full bg-gradient-to-r from-brand-400 to-brand-500" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>

            {/* Fields Tab */}
            {activeTab === 'fields' && (
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* OCR Processing State */}
                {ocrProcessing && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="w-12 h-12 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mb-4" />
                    <h4 className="font-semibold text-slateish-900 text-sm mb-1">{tView('viewer.analyzingTitle')}</h4>
                    <p className="text-xs text-slateish-500 max-w-[240px]">
                      {tView('viewer.analyzingDescription')}
                    </p>
                  </div>
                )}

                {/* Analysis failed / timed out — recoverable */}
                {!ocrProcessing && ocrFailed && visibleFields.length === 0 && !fieldsLoading && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FiAlertTriangle className="w-10 h-10 text-amber-400 mb-3" />
                    <h4 className="font-semibold text-slateish-900 text-sm mb-1">{tView('viewer.analysisIncompleteTitle')}</h4>
                    <p className="text-xs text-slateish-500 mb-4 max-w-[260px]">
                      {tView('viewer.analysisIncompleteDescription')}
                    </p>
                    <button
                      type="button"
                      onClick={retryOcr}
                      className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors"
                    >
                      {tView('viewer.retryAnalysis')}
                    </button>
                  </div>
                )}

                {/* No fields yet: offer a retry AND manual field creation, so a
                    contract whose blanks weren't detected is never a dead end. */}
                {!ocrProcessing && !ocrFailed && visibleFields.length === 0 && !fieldsLoading && (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FiFileText className="w-10 h-10 text-slateish-300 mb-3" />
                    <h4 className="font-semibold text-slateish-900 text-sm mb-1">{tView('viewer.noFieldsDetected')}</h4>
                    <p className="text-xs text-slateish-500 mb-4 max-w-[240px]">
                      {tView('viewer.noFieldsDescription')}
                    </p>
                    <button
                      type="button"
                      onClick={retryOcr}
                      className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-brand-700 transition-colors mb-4"
                    >
                      {tView('viewer.retryAnalysis')}
                    </button>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {[
                        { type: 'text', label: tView('viewer.addTextField') },
                        { type: 'signature', label: tView('viewer.addSignatureField') },
                        { type: 'date', label: tView('viewer.addDateField') },
                      ].map(({ type, label }) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => addManualField(type)}
                          className="inline-flex items-center gap-1.5 border border-slateish-200 text-slateish-600 px-3 py-1.5 rounded-lg text-xs font-semibold hover:border-brand-300 hover:text-brand-600 transition-colors"
                        >
                          + {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Real extracted fields */}
                {visibleFields.map((field, index) => {
                  const isExpanded = expandedFields.has(field.id);
                  const hasValue = !!field.field_value && field.field_value !== 'false';
                  const fieldColor = colorForIndex(index);
                  return (
                    <div
                      key={field.id}
                      className="border border-slateish-100 rounded-xl overflow-hidden hover:border-brand-200 transition-colors"
                      style={isExpanded ? { borderLeft: `4px solid ${fieldColor.border}` } : { borderLeft: `4px solid ${fieldColor.dot}` }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          let expanding = false;
                          setExpandedFields((prev) => {
                            const next = new Set(prev);
                            if (next.has(field.id)) next.delete(field.id);
                            else { next.add(field.id); expanding = true; }
                            return next;
                          });
                          if (expanding) setFocusField(field);
                        }}
                        className="w-full flex items-start justify-between gap-2 p-4 bg-gradient-to-r from-white to-brand-50 text-left"
                      >
                        <div>
                          <span className="text-xs font-medium flex items-center gap-1.5" style={{ color: fieldColor.dot }}>
                            <span className="inline-block w-2 h-2 rounded-full" style={{ background: fieldColor.dot }} />
                            Field {index + 1}
                          </span>
                          <h4 className="font-semibold text-slateish-900 text-sm">{getDisplayFieldName(field)}</h4>
                          {getSubFieldName(field) && (
                            <p className="text-xs text-brand-600 mt-0.5">{getSubFieldName(field)}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className={`text-[10px] font-semibold px-2 py-1 rounded-full ${hasValue ? 'bg-emerald-100 text-emerald-700' : 'bg-slateish-100 text-slateish-500'}`}>
                            {hasValue ? 'Done' : 'Empty'}
                          </span>
                          {isExpanded ? <FiChevronUp className="w-4 h-4 text-slateish-400" /> : <FiChevronDown className="w-4 h-4 text-slateish-400" />}
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="p-4 space-y-3">
                          {getExplanation(field) && (
                            <p className="text-sm text-slateish-500 leading-relaxed">{getExplanation(field)}</p>
                          )}

                          {field.field_type === 'signature' ? (
                            <div className="flex items-start gap-2">
                              <div className="flex-1">
                                <SignatureCanvas
                                  value={field.field_value || ''}
                                  onChange={(dataUrl) => handleFieldChange(field.id, dataUrl)}
                                />
                              </div>
                              <button
                                onClick={() => handleAskCo(field)}
                                className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                title={tView('viewer.askCoTooltip')}
                                aria-label={tView('viewer.askCoTooltip')}
                              >
                                <FiMessageCircle className="w-4 h-4 mx-auto" />
                              </button>
                            </div>
                          ) : field.field_type === 'checkbox' ? (
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-2 cursor-pointer flex-1">
                                <input
                                  type="checkbox"
                                  checked={field.field_value === 'true'}
                                  onChange={(e) => handleFieldChange(field.id, e.target.checked ? 'true' : '')}
                                  className="w-4 h-4 text-brand-600 rounded border-slateish-300 focus:ring-brand-500"
                                />
                                <span className="text-sm text-slateish-700">{getDisplayFieldName(field)}</span>
                              </label>
                              <button
                                onClick={() => handleAskCo(field)}
                                className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                title={tView('viewer.askCoTooltip')}
                                aria-label={tView('viewer.askCoTooltip')}
                              >
                                <FiMessageCircle className="w-4 h-4 mx-auto" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              <input
                                type={['text', 'date', 'email', 'tel', 'number'].includes(field.field_type) ? field.field_type : 'text'}
                                value={field.field_value || ''}
                                onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                placeholder={tView('viewer.fillIn')}
                                className="flex-1 border border-slateish-200 rounded-lg px-3 py-2 text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                              />
                              <button
                                onClick={() => handleAskCo(field)}
                                className="h-10 w-10 rounded-lg border border-slateish-200 text-slateish-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                                title={tView('viewer.askCoTooltip')}
                                aria-label={tView('viewer.askCoTooltip')}
                              >
                                <FiMessageCircle className="w-4 h-4 mx-auto" />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Chat Tab */}
            {activeTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {currentChatField && (
                  <div className="px-4 pt-4">
                    <div className="text-xs text-slateish-500 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
                      <span className="text-slateish-800">{tView('chat.askingAbout', { fieldName: currentChatField })}</span>
                    </div>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {chatMessages.map((msg, i) => (
                    <div
                      key={i}
                      className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0 mr-2 mt-1">
                          <span className="text-xs font-bold text-brand-600">Cô</span>
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-brand-600 text-white rounded-br-sm'
                            : 'bg-slateish-50 text-slateish-800 rounded-bl-sm'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}

                  {chatLoading && (
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-bold text-brand-600">Cô</span>
                      </div>
                      <div className="bg-slateish-50 rounded-2xl rounded-bl-sm px-4 py-3">
                        <div className="flex gap-1">
                          <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-2 h-2 bg-slateish-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="border-t border-slateish-100 p-3 flex-shrink-0">
                  <div className="flex items-end gap-2">
                    <textarea
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendChat();
                        }
                      }}
                      placeholder={tView('chat.placeholder')}
                      rows={1}
                      className="flex-1 border border-slateish-200 rounded-xl px-3 py-2.5 text-sm text-slateish-900 placeholder-slateish-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent resize-none"
                      style={{ minHeight: '42px', maxHeight: '120px' }}
                    />
                    <button
                      onClick={handleSendChat}
                      disabled={!chatInput.trim() || chatLoading}
                      className="p-2.5 bg-brand-600 text-white rounded-xl hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      <FiSend className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'fields' && visibleFields.length > 0 && (
              <div className="border-t border-slateish-200 p-4 flex-shrink-0">
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full bg-brand-600 text-white py-3 rounded-xl font-semibold text-sm hover:bg-brand-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <>
                      <FiLoader className="w-4 h-4 animate-spin" />
                      Exporting...
                    </>
                  ) : (
                    <>
                      <FiDownload className="w-4 h-4" />
                      {tView('viewer.export')}
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
          </>
          )}
        </div>
      </div>

      {/* Phase 1 Setup Modal */}
      <Phase1SetupModal
        isOpen={showPhase1Modal}
        onClose={() => {
          setShowPhase1Modal(false);
          // Respect the dismissal: without this the setup effect re-opens the
          // modal on every fields change (each keystroke) until completed.
          setPhase1Dismissed(true);
          try { window.localStorage.setItem(`cosign_phase1_dismissed_${id}`, '1'); } catch { /* noop */ }
        }}
        onComplete={handlePhase1Complete}
        onFileLoadError={handleDocumentFileLoadError}
        fields={fields}
        documentContext={documentContext}
        fileUrl={activeDocumentUrl}
        fileType={document?.file_type}
        fileName={document?.file_name}
        viewLang={viewLang}
        translations={phaseTranslations}
      />

      {postSetupPromptOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-2xl border border-slateish-200">
            <div className="p-5 border-b border-slateish-200">
              <h3 className="text-lg font-semibold text-slateish-900">Confirm setup</h3>
              <p className="text-sm text-slateish-600 mt-1">
                Confirm the field setup looks correct and choose a language for the recipient experience.
              </p>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slateish-600 uppercase tracking-wider mb-2">
                  Preferred language
                </label>
                <select
                  value={postSetupLanguage}
                  onChange={(e) => setPostSetupLanguage(e.target.value)}
                  className="w-full border border-slateish-200 rounded-xl px-3 py-2 text-sm text-slateish-700 focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  {LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
                </select>
              </div>
              <label className="flex items-start gap-3 text-sm text-slateish-700">
                <input
                  type="checkbox"
                  checked={postSetupConfirmed}
                  onChange={(e) => setPostSetupConfirmed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-brand-600 border-slateish-300 rounded focus:ring-brand-500"
                />
                <span>I confirm the setup looks correct.</span>
              </label>
            </div>
            <div className="px-5 pb-5 flex items-center justify-between gap-2">
              <button
                onClick={handlePostSetupBack}
                className="px-4 py-2 text-sm text-slateish-600 border border-slateish-200 rounded-lg hover:bg-slateish-100"
              >
                Back to setup
              </button>
              <button
                onClick={handlePostSetupConfirm}
                disabled={!postSetupConfirmed || postSetupFinalizing}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {postSetupFinalizing && <FiLoader className="w-4 h-4 animate-spin" />}
                Confirm &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Optional: translate this document into another language */}
      {showTranslatePrompt && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-xl">
          <div className="bg-white border border-slateish-200 shadow-xl rounded-2xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
                <FiGlobe className="w-5 h-5" aria-hidden />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slateish-900">{getViewerText('viewer.translatePromptTitle')}</p>
                <p className="text-xs text-slateish-500 mt-0.5">{getViewerText('viewer.translatePromptBody')}</p>
                {translateError && (
                  <p className="text-xs text-red-600 mt-2">{translateError}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <select
                    value={translateLang}
                    onChange={(e) => setTranslateLang(e.target.value)}
                    disabled={translating}
                    className="text-sm rounded-lg border border-slateish-200 bg-white px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:opacity-60"
                  >
                    <option value="">{getViewerText('viewer.translatePromptSelect')}</option>
                    {locales.filter((l) => l !== 'en').map((lng) => (
                      <option key={lng} value={lng}>{localeFlags[lng]} {localeNames[lng]}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleTranslateDocument(translateLang)}
                    disabled={!translateLang || translating}
                    className="inline-flex items-center gap-2 bg-brand-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    {translating && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                    {translating ? getViewerText('viewer.exporting') : getViewerText('viewer.translatePromptCta')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranslateDismissed(true)}
                    disabled={translating}
                    className="px-3 py-2 text-sm text-slateish-500 hover:text-slateish-700"
                  >
                    {getViewerText('viewer.translatePromptSkip')}
                  </button>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTranslateDismissed(true)}
                aria-label="Dismiss"
                className="text-slateish-400 hover:text-slateish-600 flex-shrink-0"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Chat consent modal */}
      {chatConsentOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slateish-200">
            <div className="p-5 border-b border-slateish-200">
              <h3 className="text-lg font-semibold text-slateish-900">{getViewerText('chat.consentTitle')}</h3>
              <p className="text-sm text-slateish-600 mt-1">{getViewerText('chat.consentDescription')}</p>
            </div>
            <div className="p-5">
              <label className="flex items-start gap-3 text-sm text-slateish-700">
                <input
                  type="checkbox"
                  checked={chatConsentChecked}
                  onChange={(e) => setChatConsentChecked(e.target.checked)}
                  className="mt-0.5 h-4 w-4 text-brand-600 border-slateish-300 rounded focus:ring-brand-500"
                />
                <span>{getViewerText('chat.consentCheckbox')}</span>
              </label>
            </div>
            <div className="px-5 pb-5 flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setChatConsentOpen(false);
                  setChatConsentChecked(false);
                  setPendingChatContext('');
                  setCurrentChatField('');
                }}
                className="px-4 py-2 text-sm text-slateish-600 hover:text-slateish-800"
              >
                {getViewerText('chat.consentCancel')}
              </button>
              <button
                onClick={() => {
                  if (!chatConsentChecked) return;
                  setChatConsentAccepted(true);
                  setChatConsentOpen(false);
                  setChatConsentChecked(false);
                  if (chatInput.trim()) {
                    const msg = chatInput.trim();
                    setChatInput('');
                    sendChatMessage(msg);
                  }
                }}
                disabled={!chatConsentChecked}
                className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {getViewerText('chat.consentConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export async function getStaticProps({ params }) {
  const { locale } = params;
  return {
    props: {
      messages: (await import(`../../../locales/${locale}.json`)).default
    }
  };
}

export async function getStaticPaths() {
  return {
    paths: [],
    fallback: 'blocking'
  };
}
