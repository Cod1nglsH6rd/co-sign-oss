/**
 * Phase1SetupModal - Setup wizard for documents without rects
 *
 * Flow:
 * 1. Welcome screen
 * 2. Role question (skip if single-person form)
 * 3. Step-by-step field positioning on PDF with draggable boxes
 * 4. Add missing fields
 *
 * Phase 1 shows: position_hint (where the field is on the document)
 * Phase 2 shows: explanation (what the field is)
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import DraggableFieldBox from './DraggableFieldBox';
import { getLabel as getFieldLabel } from '../lib/fieldTranslations';
import { localeNames } from '../lib/i18n';
import { defaultManualPosition } from '../lib/manualFieldPosition';
import {
  FiX, FiChevronRight, FiChevronLeft, FiCheck,
  FiSettings, FiTarget, FiList, FiMapPin, FiPlus, FiChevronDown,
  FiChevronUp, FiMove, FiZoomIn, FiZoomOut, FiLoader
} from 'react-icons/fi';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const ROLE_OPTIONS = {
  rental: [
    { label: 'Landlord', value: 'landlord', excludeFields: ['tenant', 'renter'] },
    { label: 'Tenant', value: 'tenant', excludeFields: ['landlord', 'owner', 'lessor'] },
  ],
  employment: [
    { label: 'Employer', value: 'employer', excludeFields: ['employee', 'worker'] },
    { label: 'Employee', value: 'employee', excludeFields: ['employer', 'company', 'hr'] },
  ],
  nda: [
    { label: 'Disclosing Party', value: 'disclosing', excludeFields: ['receiving', 'recipient'] },
    { label: 'Receiving Party', value: 'receiving', excludeFields: ['disclosing', 'discloser'] },
  ],
  sales: [
    { label: 'Buyer', value: 'buyer', excludeFields: ['seller', 'vendor'] },
    { label: 'Seller', value: 'seller', excludeFields: ['buyer', 'purchaser'] },
  ],
  'other-contract': [
    { label: 'Client/Company', value: 'client', excludeFields: ['contractor', 'consultant', 'provider', 'vendor'] },
    { label: 'Consultant/Contractor', value: 'contractor', excludeFields: ['client', 'company', 'employer'] },
  ],
};

const MACHINE_FIELD_TOKEN_RE = /(?:topmost|subform|textfield|fieldname|obj|widget|\[\d+\]|[./\\])/i;
const GENERIC_FIELD_TOKEN_RE = /^(?:field|text|textfield|check|checkbox|combo|dropdown|radio|sig|signature|button|input|entry|box|line|obj|widget)\d*$/i;

function titleizeToken(token) {
  if (!token) return '';
  if (/^[A-Z0-9]{2,}$/.test(token)) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function toReadableFieldName(rawName, fallbackIndex = 1) {
  const raw = String(rawName || '').trim();
  if (!raw) return `Field ${fallbackIndex}`;

  let normalized = raw
    .replace(/\[[0-9]+\]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_./\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => !GENERIC_FIELD_TOKEN_RE.test(t))
    .filter((t) => !/^(topmost|subform|obj|widget)$/i.test(t))
    .filter((t) => !/^page\d*$/i.test(t))
    .filter((t) => !/^\d+$/.test(t));

  if (!tokens.length) return `Field ${fallbackIndex}`;
  if (tokens.length <= 2 && tokens.every((t) => /^[a-z]?\d+$/i.test(t))) return `Field ${fallbackIndex}`;

  const label = tokens.map(titleizeToken).join(' ').trim();
  if (!label || /^field$/i.test(label)) return `Field ${fallbackIndex}`;
  return label;
}

function shouldNormalizeFieldName(rawName) {
  const value = String(rawName || '').trim();
  if (!value) return true;
  if (/^field[_\s-]*\d+$/i.test(value)) return true;
  if (/^f\d+(?:[_-]\d+)*$/i.test(value)) return true;
  if (/^(?:text|textfield|check|checkbox|combo|dropdown|radio|sig|signature|button|input)\d+(?:[_-]\d+)*$/i.test(value)) return true;
  if (value.length > 48 && /[_./\\[\]]/.test(value)) return true;
  return MACHINE_FIELD_TOKEN_RE.test(value);
}

function selectBestFieldName(field) {
  const candidates = [
    field?.field_name,
    field?.display_name,
    field?.label_text,
    field?.name,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  if (!candidates.length) return '';

  const preferred = candidates.find((value) => !shouldNormalizeFieldName(value));
  return preferred || candidates[0];
}

export default function Phase1SetupModal({
  isOpen,
  onClose,
  onComplete,
  onFileLoadError,
  onFileRetry,
  fields = [],
  documentContext = {},
  fileUrl,
  fileType,
  fileName,
  viewLang = 'en',
  translations = { en: {}, vi: {}, es: {} },
  embedded = false,
  minimal = false,
  initialStep = 0,
  finalizingLabels = false,
  suggestedEnabledIds = null,
  fieldsLoading = false,
  noFieldsReason = null,
}) {
  const { documentType = 'unknown', isMultiParty = false } = documentContext;

  // Local language state for Phase 1 (user can toggle between selected lang and English)
  const [phaseLang, setPhaseLang] = useState(viewLang);
  // The only alternate worth offering is the document's own language. When the
  // doc is English there is no second language — don't invent one (it used to
  // fall back to whatever non-English UI bundle happened to be loaded, e.g. vi).
  const altLang = viewLang && viewLang !== 'en' ? viewLang : 'en';

  // Use translations from prop based on phaseLang
  const t = useCallback((key, params = {}) => {
    const langTranslations = translations[phaseLang] || translations.en || {};
    const keys = key.split('.');
    let value = langTranslations;
    for (const k of keys) {
      value = value?.[k];
    }
    if (typeof value !== 'string') return key;
    return value.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
  }, [translations, phaseLang]);

  // Force re-render when phaseLang changes
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    forceUpdate(n => n + 1);
  }, [phaseLang]);

  // Helper to get translated field name based on phaseLang
  const getFieldName = (field, fallbackIndex = 1) => {
    const baseEnglishName = selectBestFieldName(field);
    const localizedName = getFieldLabel(field, phaseLang) || baseEnglishName;

    if (shouldNormalizeFieldName(localizedName)) {
      return toReadableFieldName(localizedName || baseEnglishName, fallbackIndex);
    }
    return localizedName || toReadableFieldName(baseEnglishName, fallbackIndex);
  };

  const initialResolvedStep = minimal ? 2 : initialStep;
  const [step, setStep] = useState(initialResolvedStep); // 0=welcome, 1=role, 2=position
  const [role, setRole] = useState(null);
  const [includedFieldIds, setIncludedFieldIds] = useState(new Set());
  // Enable-first setup: the set of fields the recipient will actually fill.
  // Defaults to all fields enabled (no regression); staff can disable the
  // ones that don't apply so recipients aren't shown every field on a large
  // form. Only used/surfaced in minimal (enterprise setup) mode.
  const [enabledFieldIds, setEnabledFieldIds] = useState(new Set());
  // No fields found (and none still loading): open the add-field form so the
  // person can start adding them by hand.
  const noFieldsFound = !fieldsLoading && (fields || []).length === 0;
  const [showAddField, setShowAddField] = useState(noFieldsFound);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldType, setNewFieldType] = useState('text');
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [reviewedFields, setReviewedFields] = useState(new Set());
  const [fieldSearch, setFieldSearch] = useState('');
  const [localFields, setLocalFields] = useState(fields);
  const [showAddDropdown, setShowAddDropdown] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [stepByStepMode, setStepByStepMode] = useState(true);
  const [fileLoadError, setFileLoadError] = useState('');

  // PDF state
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [pageLoading, setPageLoading] = useState(true);
  const [renderedPageSize, setRenderedPageSize] = useState({ width: 0, height: 0 });
  const [activeFieldId, setActiveFieldId] = useState(null);
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Smart default for enable-first: which fields a recipient is likely to
  // fill. We err toward INCLUDING — disabling a needed field is worse than
  // leaving an extra one on — so we only drop fields with strong
  // non-recipient signals (office/staff use) or ones already pre-filled.
  // Always applied as a reviewable suggestion (staff can Enable all in one
  // click). Only used on larger documents; small docs just enable everything.
  const SMART_DEFAULT_THRESHOLD = 25;
  const NON_RECIPIENT_PATTERNS = [
    'office use', 'official use', 'for office', 'staff use', 'agent use',
    'examiner use', 'for recording', 'recorder', 'reviewed by', 'approved by',
    'internal use', 'do not write', 'for department', 'clerk use', 'do not staple',
  ];
  const isLikelyRecipientField = (f) => {
    const label = `${f?.field_name || ''} ${f?.label || ''} ${f?.textLabel || ''}`.toLowerCase();
    if (NON_RECIPIENT_PATTERNS.some((p) => label.includes(p))) return false;
    // Already filled (pre-populated by the form) — not something to ask for.
    const v = f?.value ?? f?.field_value;
    if (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'false') return false;
    return true;
  };
  const computeDefaultEnabled = (list, aiIds = null) => {
    const all = new Set((list || []).map((f) => f.id));
    if (!minimal || (list || []).length <= SMART_DEFAULT_THRESHOLD) {
      return { set: all, suggested: false };
    }
    // Prefer the AI classification when available; otherwise use the local
    // keyword heuristic. Both are guarded against gutting the document.
    const idSet = new Set(all);
    let suggested;
    if (Array.isArray(aiIds) && aiIds.length > 0) {
      suggested = new Set(aiIds.map(String).filter((id) => idSet.has(id)));
    } else {
      suggested = new Set((list || []).filter(isLikelyRecipientField).map((f) => f.id));
    }
    if (suggested.size < Math.max(2, Math.floor(all.size * 0.1))) {
      return { set: all, suggested: false };
    }
    return { set: suggested, suggested: suggested.size < all.size };
  };

  const [smartSuggestionApplied, setSmartSuggestionApplied] = useState(false);
  // Once staff manually change the enabled set, stop auto-reseeding from the
  // (async) AI suggestion so we don't clobber their choices.
  const enableTouchedRef = useRef(false);

  useEffect(() => {
    setLocalFields(fields);
    setCurrentFieldIndex(0);
    setReviewedFields(new Set());
    setIncludedFieldIds(new Set());
    enableTouchedRef.current = false;
    const { set, suggested } = computeDefaultEnabled(fields || [], suggestedEnabledIds);
    setEnabledFieldIds(set);
    setSmartSuggestionApplied(suggested);
  }, [fields]);

  useEffect(() => {
    setShowAddField(noFieldsFound);
  }, [noFieldsFound]);

  // The AI suggestion can arrive after the modal has mounted with fields.
  // Re-seed from it (once) as long as staff haven't manually adjusted yet.
  useEffect(() => {
    if (!minimal || enableTouchedRef.current) return;
    if (!Array.isArray(suggestedEnabledIds) || suggestedEnabledIds.length === 0) return;
    const { set, suggested } = computeDefaultEnabled(localFields || [], suggestedEnabledIds);
    setEnabledFieldIds(set);
    setSmartSuggestionApplied(suggested);
  }, [suggestedEnabledIds]);

  const toggleEnabledField = (fieldId) => {
    enableTouchedRef.current = true;
    setSmartSuggestionApplied(false);
    setEnabledFieldIds((prev) => {
      const next = new Set(prev);
      if (next.has(fieldId)) next.delete(fieldId);
      else next.add(fieldId);
      return next;
    });
  };
  const enableAllFields = () => { enableTouchedRef.current = true; setSmartSuggestionApplied(false); setEnabledFieldIds(new Set(localFields.map((f) => f.id))); };
  const disableAllFields = () => { enableTouchedRef.current = true; setSmartSuggestionApplied(false); setEnabledFieldIds(new Set()); };

  // Determine if we should skip role question (single-person form)
  const shouldSkipRoleQuestion = !isMultiParty || documentType === 'single-form';

  console.log('[Phase1] documentType:', documentType, 'isMultiParty:', isMultiParty, 'shouldSkip:', shouldSkipRoleQuestion);

  // Filter fields based on selected role
  const filteredFields = useMemo(() => {
    console.log('[Phase1] Filtering - role:', role, 'documentType:', documentType, 'total fields:', localFields.length);

    if (!role) {
      console.log('[Phase1] No role selected, showing all fields');
      return localFields;
    }

    const roleOption = (ROLE_OPTIONS[documentType] || ROLE_OPTIONS['other-contract'])?.find(r => r.value === role);
    const excludeFields = roleOption?.excludeFields || [];
    console.log('[Phase1] Excluding fields containing:', excludeFields);

    const filtered = localFields.filter(f => {
      if (includedFieldIds.has(f.id)) return true;
      const fieldLower = (f.field_name || '').toLowerCase();
      const shouldExclude = excludeFields.some(ex => fieldLower.includes(ex.toLowerCase()));
      if (shouldExclude) {
        console.log('[Phase1] Excluding field:', f.field_name);
      }
      return !shouldExclude;
    });

    console.log('[Phase1] Filtered fields count:', filtered.length);
    return filtered;
  }, [localFields, role, documentType, includedFieldIds]);

  const excludedFields = useMemo(() => {
    if (!role) return [];
    const roleOption = (ROLE_OPTIONS[documentType] || ROLE_OPTIONS['other-contract'])?.find(r => r.value === role);
    const excludeFields = roleOption?.excludeFields || [];
    return localFields.filter(f => {
      const fieldLower = (f.field_name || '').toLowerCase();
      const shouldExclude = excludeFields.some(ex => fieldLower.includes(ex.toLowerCase()));
      return shouldExclude && !includedFieldIds.has(f.id);
    });
  }, [localFields, role, documentType, includedFieldIds]);

  const currentField = filteredFields[currentFieldIndex];

  // Get fields on current page
  const currentPageFields = useMemo(() => {
    return filteredFields.filter(f => {
      if (!f.position) return false;
      return (f.position.page || 1) === currentPage;
    });
  }, [filteredFields, currentPage]);

  // Handle welcome continue
  const handleWelcomeContinue = () => {
    if (shouldSkipRoleQuestion) {
      setStep(2); // Go to positioning
    } else {
      setStep(1); // Go to role question
    }
  };

  // Handle role selection
  const handleRoleSelect = (roleValue) => {
    setRole(roleValue);
    setStep(2); // Go to positioning
  };

  // Handle position change from draggable box
  const handlePositionChange = useCallback((fieldId, newPos) => {
    setLocalFields(prev => prev.map(f =>
      f.id === fieldId ? { ...f, position: newPos } : f
    ));
    // Mark this field as reviewed
    setReviewedFields(prev => new Set([...prev, fieldId]));
  }, []);

  const ensureFieldHasPosition = useCallback((fieldId, page = currentPage) => {
    if (!fieldId) return;
    setLocalFields((prev) =>
      prev.map((f, idx) => {
        if (f.id !== fieldId || f.position) return f;
        return { ...f, position: defaultManualPosition(f.field_type, idx, page) };
      })
    );
  }, [currentPage]);

  // Navigate to next field
  const handleNextField = () => {
    if (currentFieldIndex < filteredFields.length - 1) {
      const nextIdx = currentFieldIndex + 1;
      setCurrentFieldIndex(nextIdx);
      const nextField = filteredFields[nextIdx];
      if (nextField?.position?.page && nextField.position.page !== currentPage) {
        setCurrentPage(nextField.position.page);
      }
      setActiveFieldId(nextField?.id);
      ensureFieldHasPosition(nextField?.id, nextField?.position?.page || currentPage);
    }
  };

  // Navigate to previous field
  const handlePrevField = () => {
    if (currentFieldIndex > 0) {
      const prevIdx = currentFieldIndex - 1;
      setCurrentFieldIndex(prevIdx);
      const prevField = filteredFields[prevIdx];
      if (prevField?.position?.page && prevField.position.page !== currentPage) {
        setCurrentPage(prevField.position.page);
      }
      setActiveFieldId(prevField?.id);
      ensureFieldHasPosition(prevField?.id, prevField?.position?.page || currentPage);
    }
  };

  // Go to specific field
  const handleGoToField = (idx) => {
    setCurrentFieldIndex(idx);
    const field = filteredFields[idx];
    if (field?.position?.page && field.position.page !== currentPage) {
      setCurrentPage(field.position.page);
    }
    setActiveFieldId(field?.id);
    ensureFieldHasPosition(field?.id, field?.position?.page || currentPage);
  };

  // Complete Phase 1
  const handleComplete = () => {
    if (onComplete) {
      const normalizedFields = localFields.map((field, idx) => {
        const baseEnglishName = selectBestFieldName(field);
        const resolvedName = shouldNormalizeFieldName(baseEnglishName)
          ? toReadableFieldName(baseEnglishName, idx + 1)
          : baseEnglishName;

        if (!resolvedName) return field;
        if (String(field.field_name || '').trim() === resolvedName) return field;
        return {
          ...field,
          field_name: resolvedName,
        };
      });

      // In setup (minimal) mode, includedFieldIds carries the enabled set
      // that scopes what the recipient fills. Convention: an empty array means
      // "all fields" (no restriction), so when every field is enabled we send
      // [] to keep the default unfiltered. A strict subset is sent as-is.
      const allEnabled = enabledFieldIds.size >= localFields.length;
      const resolvedIncludedFieldIds = minimal
        ? (allEnabled ? [] : Array.from(enabledFieldIds))
        : Array.from(includedFieldIds);

      onComplete({
        role,
        includedFieldIds: resolvedIncludedFieldIds,
        documentType,
        fields: normalizedFields,
      });
    }
    if (onClose) onClose();
  };

  const handleAddCustomField = () => {
    const name = newFieldName.trim();
    if (!name) return;
    const customField = {
      id: `custom-${Date.now()}`,
      field_name: name,
      field_type: newFieldType,
      // A box on the current page at once, one row below the last one added.
      position: defaultManualPosition(newFieldType, localFields.length, currentPage),
      position_hint: '',
      is_custom: true,
    };
    setLocalFields(prev => [customField, ...prev]);
    setCurrentFieldIndex(0);
    setActiveFieldId(customField.id);
    setEnabledFieldIds(prev => { const next = new Set(prev); next.add(customField.id); return next; });
    setNewFieldName('');
    setNewFieldType('text');
    setShowAddField(false);
  };

  // Get role options
  const getRoleOptions = () => {
    if (ROLE_OPTIONS[documentType]) {
      return ROLE_OPTIONS[documentType];
    }
    return ROLE_OPTIONS['other-contract'];
  };

  // PDF setup
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width - 48);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const pageWidth = Math.min(containerWidth, 680) * zoom;

  const onDocumentLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setPageLoading(false);
    setFileLoadError('');
  }, []);

  const onPageRenderSuccess = useCallback((page) => {
    setRenderedPageSize({ width: page.width, height: page.height });
  }, []);

  const goToPage = (p) => setCurrentPage(Math.max(1, Math.min(p, numPages || 1)));
  const adjustZoom = (d) => setZoom(prev => Math.max(0.5, Math.min(2.5, +(prev + d).toFixed(2))));

  const isPdf = fileType === 'pdf' || fileName?.toLowerCase()?.endsWith('.pdf');
  const hasFileUrl = typeof fileUrl === 'string' && fileUrl.length > 0;

  useEffect(() => {
    if (isPdf && hasFileUrl) {
      setPageLoading(true);
      setFileLoadError('');
      return;
    }

    setPageLoading(false);
    if (!hasFileUrl) {
      setFileLoadError('Document file is unavailable. Please retry.');
    } else {
      setFileLoadError('');
    }
  }, [fileUrl, isPdf, hasFileUrl]);

  useEffect(() => {
    if (!isOpen) return;
    if (minimal && step !== 2) setStep(2);
  }, [isOpen, minimal, step]);

  useEffect(() => {
    if (step !== 2) return;
    if (!currentField) return;
    ensureFieldHasPosition(currentField.id, currentField?.position?.page || currentPage);
  }, [step, currentField, currentPage, ensureFieldHasPosition]);

  if (!isOpen) return null;

  const reviewedCount = filteredFields.filter(f => reviewedFields.has(f.id)).length;
  const reviewPct = filteredFields.length > 0 ? Math.round((reviewedCount / filteredFields.length) * 100) : 0;

  const content = (
    <div className={`${embedded ? 'w-full h-full' : 'w-full max-w-[95vw] h-[95vh]'} bg-white ${embedded ? '' : 'rounded-2xl shadow-2xl border border-slateish-200'} flex flex-col overflow-hidden`}>

        {/* Header - only for non-positioning steps */}
        {!embedded && !minimal && step < 2 && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slateish-200 bg-white">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center">
                <FiSettings className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slateish-900">
                  {step === 0 && t('setup.title')}
                  {step === 1 && t('setup.yourRole')}
                </h2>
                <p className="text-sm text-slateish-500">
                  {step === 0 && t('setup.step1of3')}
                  {step === 1 && t('setup.step2of3')}
                </p>
              </div>
            </div>

            {/* Language Toggle — only when the document actually has a second
                (non-English) language; an English-only doc needs no toggle. */}
            {altLang !== 'en' && (
              <div className="flex items-center gap-1 bg-slateish-100 rounded-lg p-1">
                <button
                  onClick={() => setPhaseLang('en')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    phaseLang === 'en' ? 'bg-white text-slateish-900 shadow-sm' : 'text-slateish-500 hover:text-slateish-700'
                  }`}
                >
                  English
                </button>
                <button
                  onClick={() => setPhaseLang(phaseLang === 'en' ? altLang : 'en')}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
                    phaseLang !== 'en' ? 'bg-white text-slateish-900 shadow-sm' : 'text-slateish-500 hover:text-slateish-700'
                  }`}
                >
                  {localeNames[altLang] || 'English'}
                </button>
              </div>
            )}

            {onClose && (
              <button onClick={onClose} className="p-2 hover:bg-slateish-100 rounded-lg transition-colors">
                <FiX className="w-5 h-5 text-slateish-400" />
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 flex overflow-hidden">

          {/* Step 0: Welcome */}
          {!minimal && step === 0 && (
            <div className="flex-1 flex items-center justify-center p-8 bg-slateish-50">
              <div className="max-w-lg text-center">
                <div className="w-20 h-20 bg-brand-50 border border-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <FiTarget className="w-10 h-10 text-brand-600" />
                </div>
                <h3 className="text-2xl font-bold text-slateish-900 mb-3">
                  {t('setup.letsSetup')}
                </h3>
                <p className="text-slateish-500 mb-8 text-base leading-relaxed">
                  {shouldSkipRoleQuestion
                    ? t('setup.welcomeMessage', { count: fields.length })
                    : t('setup.welcomeMessage', { count: fields.length })
                  }
                </p>
                <div className="bg-white rounded-xl border border-slateish-200 p-6 text-left">
                  <h4 className="font-bold text-slateish-900 mb-4 text-sm uppercase tracking-wide">{t('setup.whatWellDo')}</h4>
                  <div className="space-y-3">
                    {!shouldSkipRoleQuestion && (
                      <div className="flex items-start gap-3">
                        <div className="w-7 h-7 bg-brand-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold">1</span>
                        </div>
                        <span className="text-slateish-700 text-sm">{t('setup.roleQuestion')}</span>
                      </div>
                    )}
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-brand-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold">{shouldSkipRoleQuestion ? 1 : 2}</span>
                      </div>
                      <span className="text-slateish-700 text-sm">{t('setup.dragFields')}</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 bg-brand-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold">{shouldSkipRoleQuestion ? 2 : 3}</span>
                      </div>
                      <span className="text-slateish-700 text-sm">{t('setup.fillInfo')}</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleWelcomeContinue}
                  className="mt-8 px-8 py-3 bg-brand-900 text-white rounded-lg font-semibold hover:bg-brand-800 transition-colors shadow-sm"
                >
                  {t('setup.getStarted')} →
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Role Question */}
          {!minimal && step === 1 && (
            <div className="flex-1 flex items-center justify-center p-8 bg-slateish-50">
              <div className="max-w-lg w-full">
                <h3 className="text-xl font-bold text-slateish-900 mb-2">
                  {t('setup.roleQuestionTitle')}
                </h3>
                <p className="text-slateish-500 mb-8 text-sm">
                  {t('setup.roleDescription')}
                </p>

                <div className="space-y-3">
                  {getRoleOptions().map(option => (
                    <button
                      key={option.value}
                      onClick={() => handleRoleSelect(option.value)}
                      className="w-full text-left px-6 py-4 rounded-xl border border-slateish-200 bg-white hover:border-brand-400 hover:bg-brand-50 transition-all text-base font-semibold text-slateish-800 shadow-sm hover:shadow"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setStep(2)}
                  className="mt-6 text-sm text-slateish-400 hover:text-slateish-600 transition-colors"
                >
                  {t('setup.skipRole')}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: PDF Positioning */}
          {step === 2 && (
            <>
              {/* PDF Area */}
              <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden bg-slateish-100">
                {/* Toolbar */}
                <div className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 bg-brand-50 border-b border-brand-100">
                  <div className="flex items-center gap-2 text-brand-800 text-sm font-medium">
                    <FiMove className="w-4 h-4" />
                    <span>{t('setup.positionInstructions')}</span>
                  </div>
                    <div className="flex items-center gap-2">
                      {/* Language Toggle */}
                      {altLang !== 'en' && (
                        <div className="flex items-center bg-white rounded-md border border-brand-200 overflow-hidden">
                          <button
                            onClick={() => setPhaseLang('en')}
                            className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                              phaseLang === 'en' ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50'
                            }`}
                          >
                            EN
                          </button>
                          <button
                            onClick={() => setPhaseLang(phaseLang === 'en' ? altLang : 'en')}
                            className={`px-2.5 py-1 text-xs font-semibold transition-colors ${
                              phaseLang !== 'en' ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-50'
                            }`}
                          >
                            {altLang === 'en' ? 'EN' : altLang.toUpperCase()}
                          </button>
                        </div>
                      )}
                    {!minimal && (
                      <button
                        onClick={() => setShowSidebar(!showSidebar)}
                        className="px-3 py-1.5 text-xs font-semibold bg-white border border-slateish-200 rounded-lg hover:bg-slateish-50 text-slateish-600 transition-colors"
                      >
                        {showSidebar ? 'Hide Sidebar' : 'Show Sidebar'}
                      </button>
                    )}
                  </div>
                </div>

                {/* PDF + overlays */}
                <div
                  className="flex-1 overflow-auto flex justify-center p-4"
                  onClick={() => setActiveFieldId(null)}
                >
                  <div className="relative" onClick={(e) => e.stopPropagation()}>
                    {pageLoading && isPdf && (
                      <div className="flex flex-col items-center justify-center py-20">
                        <FiLoader className="w-8 h-8 text-brand-500 animate-spin mb-3" />
                        <p className="text-sm text-slateish-500">Loading document...</p>
                      </div>
                    )}

                    {fileLoadError && hasFileUrl && (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <FiLoader className="w-8 h-8 text-slateish-300 mb-3" />
                        <p className="text-sm text-slateish-700 font-semibold">Unable to load document</p>
                        <p className="text-xs text-slateish-500 mt-1 max-w-[320px]">{fileLoadError}</p>
                      </div>
                    )}

                    {isPdf && hasFileUrl ? (
                      <Document
                        file={fileUrl}
                        onLoadSuccess={onDocumentLoadSuccess}
                        onLoadError={(err) => {
                          const message = err?.message || 'Failed to load PDF file.';
                          setFileLoadError(message);
                          setPageLoading(false);
                          if (onFileLoadError) onFileLoadError(err);
                        }}
                        loading={null}
                        className="flex flex-col items-center"
                      >
                        <div className="bg-white rounded-xl shadow-lg overflow-visible ring-1 ring-slateish-200 relative">
                          <Page
                            pageNumber={currentPage}
                            width={pageWidth}
                            loading={<div className="flex items-center justify-center py-20" style={{ width: pageWidth, minHeight: 400 }}><FiLoader className="w-6 h-6 text-slateish-400 animate-spin" /></div>}
                            renderTextLayer={false}
                            renderAnnotationLayer={false}
                            onRenderSuccess={onPageRenderSuccess}
                          />
                          {/* Draggable field boxes - show only current field in step-by-step mode */}
                          {renderedPageSize.width > 0 && currentPageFields
                            .filter(field => !stepByStepMode || field.id === currentField?.id)
                            .map((field) => {
                              const displayIndex = Math.max(0, filteredFields.findIndex((f) => f.id === field.id));
                              return (
                                <DraggableFieldBox
                                  key={field.id}
                                  field={{ ...field, display_name: getFieldName(field, displayIndex + 1) }}
                                  pageWidth={renderedPageSize.width}
                                  pageHeight={renderedPageSize.height}
                                  isActive={activeFieldId === field.id}
                                  onSelect={(id) => {
                                    setActiveFieldId(id);
                                    const idx = filteredFields.findIndex((f) => f.id === id);
                                    if (idx >= 0) setCurrentFieldIndex(idx);
                                  }}
                                  onPositionChange={(newPos) => handlePositionChange(field.id, newPos)}
                                  colorIndex={displayIndex}
                                />
                              );
                            })}
                        </div>
                      </Document>
                    ) : !isPdf && hasFileUrl ? (
                      <div className="bg-white rounded-xl shadow-lg overflow-visible ring-1 ring-slateish-200 relative">
                        <img
                          src={fileUrl}
                          alt={fileName}
                          className="w-full h-auto"
                          style={{ maxWidth: `${680 * zoom}px`, display: 'block' }}
                          onLoad={(e) => setRenderedPageSize({ width: e.target.clientWidth, height: e.target.clientHeight })}
                          onError={(err) => {
                            setFileLoadError('Failed to load document image.');
                            setPageLoading(false);
                            if (onFileLoadError) onFileLoadError(err);
                          }}
                        />
                        {renderedPageSize.width > 0 && currentPageFields
                          .filter(field => !stepByStepMode || field.id === currentField?.id)
                          .map((field) => {
                            const displayIndex = Math.max(0, filteredFields.findIndex((f) => f.id === field.id));
                            return (
                              <DraggableFieldBox
                                key={field.id}
                                field={{ ...field, display_name: getFieldName(field, displayIndex + 1) }}
                                pageWidth={renderedPageSize.width}
                                pageHeight={renderedPageSize.height}
                                isActive={activeFieldId === field.id}
                                onSelect={(id) => {
                                  setActiveFieldId(id);
                                  const idx = filteredFields.findIndex((f) => f.id === id);
                                  if (idx >= 0) setCurrentFieldIndex(idx);
                                }}
                                onPositionChange={(newPos) => handlePositionChange(field.id, newPos)}
                                colorIndex={displayIndex}
                              />
                            );
                          })}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-20 text-center">
                        <p className="text-sm text-slateish-700 font-semibold">Document unavailable</p>
                        <p className="text-xs text-slateish-500 mt-1 max-w-[320px]">
                          We could not access the file for setup. Please retry.
                        </p>
                        {onFileRetry && (
                          <button
                            type="button"
                            onClick={onFileRetry}
                            className="mt-4 px-3 py-2 text-xs font-semibold bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
                          >
                            Retry loading file
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Bottom navigation */}
                {!minimal && (
                  <div className="flex-shrink-0 flex items-center justify-center gap-3 px-4 py-3 bg-white border-t border-slateish-200">
                    <button
                      onClick={handlePrevField}
                      disabled={currentFieldIndex === 0}
                      className="px-4 py-2 text-sm font-semibold border border-slateish-200 rounded-lg hover:bg-slateish-50 disabled:opacity-30 disabled:cursor-not-allowed text-slateish-700 transition-colors"
                    >
                      ← {t('setup.previous')}
                    </button>
                    <span className="text-sm text-slateish-500 font-medium px-2">
                      {t('setup.fieldCounter', { current: currentFieldIndex + 1, total: filteredFields.length })}
                    </span>
                    <button
                      onClick={handleNextField}
                      disabled={currentFieldIndex === filteredFields.length - 1}
                      className="px-4 py-2 text-sm font-semibold border border-slateish-200 rounded-lg hover:bg-slateish-50 disabled:opacity-30 disabled:cursor-not-allowed text-slateish-700 transition-colors"
                    >
                      {t('common.next')} →
                    </button>
                    <div className="w-px h-6 bg-slateish-200 mx-1" />
                    <button
                      onClick={handleComplete}
                      className="px-6 py-2 bg-brand-900 text-white text-sm font-semibold rounded-lg hover:bg-brand-800 transition-colors shadow-sm"
                    >
                      {t('setup.doneButton')}
                    </button>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              {showSidebar && (
                <div className="w-80 bg-white border-l border-slateish-200 flex flex-col flex-shrink-0 overflow-hidden">
                  {/* Sidebar header */}
                  <div className="p-4 border-b border-slateish-200">
                    <h3 className="font-bold text-slateish-900 text-sm flex items-center gap-2">
                      <FiMapPin className="w-4 h-4 text-brand-600" />
                      {t('setup.positionFields')}
                    </h3>
                    <p className="text-xs text-slateish-500 mt-1">
                      {t('setup.positionDescription')}
                    </p>
                    {/* Progress */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] font-semibold mb-1.5">
                        <span className="text-brand-700">{reviewedCount} reviewed</span>
                        <span className="text-slateish-400">{filteredFields.length} total</span>
                      </div>
                      <div className="h-1.5 bg-slateish-100 rounded-full overflow-hidden">
                        <div className="h-full bg-brand-600 rounded-full transition-all duration-500" style={{ width: `${reviewPct}%` }} />
                      </div>
                    </div>
                  </div>

                  {noFieldsFound && (
                    <div role="status" className="mx-3 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 space-y-1">
                      <p className="font-semibold">No fields were found. Add each field and drag it onto the page.</p>
                      {noFieldsReason === 'no_ai_key' && (
                        <p>Automatic field detection is off because no AI key is set.</p>
                      )}
                    </div>
                  )}

                  {!minimal && (
                    <>
                      {/* Role-based excluded fields: allow add-back */}
                      {role && excludedFields.length > 0 && (
                        <div className="px-3 pt-3">
                          <div className="text-[11px] font-bold text-slateish-500 uppercase tracking-wide mb-2">
                            Excluded by role
                          </div>
                          <div className="max-h-28 overflow-y-auto border border-slateish-200 rounded-lg bg-white">
                            {excludedFields.map((field) => (
                              <label
                                key={field.id}
                                className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-slateish-700 hover:bg-slateish-50 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  className="accent-brand-600"
                                  checked={includedFieldIds.has(field.id)}
                                  onChange={(e) => {
                                    setIncludedFieldIds(prev => {
                                      const next = new Set(prev);
                                      if (e.target.checked) next.add(field.id);
                                      else next.delete(field.id);
                                      return next;
                                    });
                                  }}
                                />
                                <span className="truncate">{getFieldName(field)}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add custom field */}
                      <div className="px-3 pt-3">
                        {!showAddField ? (
                          <button
                            onClick={() => setShowAddField(true)}
                            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-brand-700 border border-brand-200 rounded-lg hover:bg-brand-50 bg-white transition-colors"
                          >
                            <FiPlus className="w-3.5 h-3.5" />
                            Add custom field
                          </button>
                        ) : (
                          <div className="border border-slateish-200 rounded-lg p-3 space-y-2 bg-slateish-50">
                            <input
                              value={newFieldName}
                              onChange={(e) => setNewFieldName(e.target.value)}
                              placeholder={t('setup.fieldNamePlaceholder')}
                              className="w-full border border-slateish-300 rounded-md px-2.5 py-2 text-xs text-slateish-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                            />
                            <select
                              value={newFieldType}
                              onChange={(e) => setNewFieldType(e.target.value)}
                              className="w-full border border-slateish-300 rounded-md px-2.5 py-2 text-xs text-slateish-900 bg-white"
                            >
                              <option value="text">{t('setup.fieldTypes.text')}</option>
                              <option value="date">{t('setup.fieldTypes.date')}</option>
                              <option value="email">{t('setup.fieldTypes.email')}</option>
                              <option value="tel">{t('setup.fieldTypes.tel')}</option>
                              <option value="number">{t('setup.fieldTypes.number')}</option>
                              <option value="checkbox">{t('setup.fieldTypes.checkbox')}</option>
                              <option value="signature">{t('setup.fieldTypes.signature')}</option>
                              <option value="address">{t('setup.fieldTypes.address')}</option>
                            </select>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={handleAddCustomField}
                                className="flex-1 px-2.5 py-2 text-xs font-semibold bg-brand-900 text-white rounded-md hover:bg-brand-800 transition-colors"
                              >
                                {t('setup.add')}
                              </button>
                              <button
                                onClick={() => setShowAddField(false)}
                                className="px-2.5 py-2 text-xs font-semibold border border-slateish-200 rounded-md hover:bg-slateish-50 text-slateish-600"
                              >
                                {t('setup.cancel')}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Enable-first controls (setup mode) */}
                  {minimal && (
                    <div className="px-3 pt-3 pb-2 border-b border-slateish-100 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slateish-600">
                          <span className="font-semibold text-slateish-900">{enabledFieldIds.size}</span> of {localFields.length} fields enabled
                          {smartSuggestionApplied && (
                            <span className="ml-1 text-[10px] text-brand-600 font-medium">· suggested</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={enableAllFields} className="text-[11px] font-semibold text-brand-700 hover:text-brand-800">Enable all</button>
                          <span className="text-slateish-300">·</span>
                          <button type="button" onClick={disableAllFields} className="text-[11px] font-semibold text-slateish-500 hover:text-slateish-700">Disable all</button>
                        </div>
                      </div>
                      <p className="text-[10px] text-slateish-400 leading-snug">Only enabled fields are sent to the recipient. Click a field to position it.</p>
                      {localFields.length > 15 && (
                        <input
                          type="text"
                          value={fieldSearch}
                          onChange={(e) => setFieldSearch(e.target.value)}
                          placeholder={t('setup.searchFields')}
                          className="w-full border border-slateish-300 rounded-md px-2.5 py-1.5 text-xs text-slateish-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
                        />
                      )}
                      {!showAddField ? (
                        <button type="button" onClick={() => setShowAddField(true)} className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-xs font-semibold text-brand-700 border border-brand-200 rounded-lg hover:bg-brand-50 bg-white transition-colors">
                          <FiPlus className="w-3.5 h-3.5" /> Add field
                        </button>
                      ) : (
                        <div className="border border-slateish-200 rounded-lg p-2.5 space-y-2 bg-slateish-50">
                          <input value={newFieldName} onChange={(e) => setNewFieldName(e.target.value)} placeholder="Field name" className="w-full border border-slateish-300 rounded-md px-2.5 py-1.5 text-xs text-slateish-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500" />
                          <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)} className="w-full border border-slateish-300 rounded-md px-2.5 py-1.5 text-xs text-slateish-900 bg-white">
                            <option value="text">{t('setup.fieldTypes.text')}</option>
                            <option value="date">{t('setup.fieldTypes.date')}</option>
                            <option value="email">{t('setup.fieldTypes.email')}</option>
                            <option value="tel">{t('setup.fieldTypes.tel')}</option>
                            <option value="number">{t('setup.fieldTypes.number')}</option>
                            <option value="checkbox">{t('setup.fieldTypes.checkbox')}</option>
                            <option value="signature">{t('setup.fieldTypes.signature')}</option>
                            <option value="address">{t('setup.fieldTypes.address')}</option>
                          </select>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={handleAddCustomField} className="flex-1 px-2.5 py-1.5 text-xs font-semibold bg-brand-900 text-white rounded-md hover:bg-brand-800 transition-colors">{t('setup.add')}</button>
                            <button type="button" onClick={() => setShowAddField(false)} className="px-2.5 py-1.5 text-xs font-semibold border border-slateish-200 rounded-md hover:bg-slateish-50 text-slateish-600">{t('setup.cancel')}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Field list */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {filteredFields.map((field, index) => {
                      // Search filters the visible rows but keeps the real index
                      // so positioning navigation / colors stay consistent.
                      if (fieldSearch.trim()) {
                        const q = fieldSearch.trim().toLowerCase();
                        const hay = `${getFieldName(field, index + 1)} ${field.field_name || ''}`.toLowerCase();
                        if (!hay.includes(q)) return null;
                      }
                      const isActive = currentFieldIndex === index;
                      const isReviewed = reviewedFields.has(field.id);
                      const color = ['#1c7e9d', '#ef4444', '#059669', '#f59e0b', '#8b5cf6',
                        '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'][index % 10];

                      const enabled = enabledFieldIds.has(field.id);
                      return (
                        <div
                          key={field.id}
                          className={`flex items-center gap-1.5 rounded-lg ${minimal && !enabled ? 'opacity-45' : ''}`}
                        >
                          {minimal && (
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={() => toggleEnabledField(field.id)}
                              title={enabled ? 'Enabled — the recipient fills this field' : 'Disabled — hidden from the recipient'}
                              aria-label={enabled ? 'Disable field' : 'Enable field'}
                              className="w-4 h-4 ml-1 flex-shrink-0 cursor-pointer rounded border-slateish-300"
                              style={{ accentColor: 'var(--brand-600)' }}
                            />
                          )}
                          <button
                            onClick={() => handleGoToField(index)}
                            className={`flex-1 min-w-0 text-left px-3 py-2.5 rounded-lg text-sm transition-all flex items-center gap-2.5 ${
                              isActive
                                ? 'bg-brand-50 border border-brand-300 shadow-sm'
                                : 'hover:bg-slateish-50 border border-transparent'
                            }`}
                          >
                            <div
                              className="w-3 h-3 rounded-sm flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                            <div className="min-w-0 flex-1">
                              <div className={`font-semibold truncate text-xs ${isActive ? 'text-brand-900' : 'text-slateish-800'}`}>{getFieldName(field, index + 1)}</div>
                              <div className="text-[10px] text-slateish-400">
                                {field.position
                                  ? `${field.position.x?.toFixed(1)}%, ${field.position.y?.toFixed(1)}%`
                                  : t('setup.noPosition')}
                              </div>
                            </div>
                            {isReviewed && (
                              <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <FiCheck className="w-3 h-3 text-emerald-600" />
                              </div>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Actions */}
                  <div className="p-3 border-t border-slateish-200">
                    <button
                      onClick={handleComplete}
                      disabled={finalizingLabels}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-brand-900 rounded-lg hover:bg-brand-800 transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {finalizingLabels ? (
                        <>
                          <FiLoader className="w-4 h-4 animate-spin" />
                          Finalizing field labels…
                        </>
                      ) : (
                        <>
                          <FiCheck className="w-4 h-4" />
                          {minimal ? 'Save & continue' : 'Done — Fill Fields'}
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2">
      {content}
    </div>
  );
}
