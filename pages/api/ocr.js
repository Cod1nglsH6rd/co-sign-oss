/**
 * OCR API Endpoint — Text-Layer-First Architecture
 *
 * For PDFs with a text layer (most digitally-created PDFs):
 *   1. Extract text layer via Supabase Edge Function (fast)
 *   2. Send extracted TEXT to Claude (text-only prompt, no Vision — fast & cheap)
 *   3. Match fields to text items for precise positions
 *
 * For scanned PDFs / images (no text layer):
 *   1. Fall back to Claude Vision with full document
 *   2. Claude returns fields + estimated positions
 *
 * POST /api/ocr
 * Body: { documentId, userId, preferredLanguage }
 * Returns: { success, fields, fieldsCount, extractionMethod, positionSources }
 * 
 * Progress Steps:
 * - 0: Uploading/Starting
 * - 1: Gathering context (analyzing document type)
 * - 2: Mapping fields (extracting positions)
 * - 3: Adding explanations (Sonnet)
 * - 4: Translating (to target language)
 */

import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { performance } from 'perf_hooks';
import { releaseQueuedSessions } from '../../lib/queuedInvites.js';
import { assertDocumentPathOwned } from '../../lib/storagePaths.js';
import { requireBearerUser, requireOrgMembership, requestedOrgId } from '../../lib/auth';
import { rateLimitAuth } from '../../lib/rateLimit';
import { toVisionImage } from '../../lib/visionImage.js';

import {
  extractTextItems,
  extractFormFields,
} from '../../lib/pdfTextExtraction.js';
import { matchFieldsToTextItems, detectFlatPageBlanks } from '../../lib/textLayerPositioning.js';
import { matchWidget, displayOption, stripOptionToken } from '../../lib/checkboxWidgets.js';
import { isCronAuthorized } from '../../lib/cronAuth.js';
import { isInternalAuthorized } from '../../lib/internalAuth.js';
import {
  readOcrState,
  isResumableState,
  isLeaseHeld,
  attemptsExceeded,
  mergeOcrState,
  isOverBudget,
  DEFAULT_SOFT_BUDGET_MS,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
} from '../../lib/ocrResume.js';
import {
  downloadDocumentBinary,
  DocumentSourceNotAllowedError,
  DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
} from '../../lib/documentFetch.js';
import { anchorFieldsToOcr } from '../../lib/ocrAnchor.js';
import { buildValueSnapshot, applyPreservedValues } from '../../lib/ocrFieldValues.js';
import { serverSupabaseUrl, anonKey, serviceKey } from '../../lib/supabaseEnv.js';
import { ocrProvider, stubFields } from '../../lib/ocrStub.js';
import { effectiveSetting } from '../../lib/hostSettings';


function getSupabase() {
  const url = serverSupabaseUrl();
  const key = serviceKey();
  if (!url || !key) {
    throw new Error('Supabase service role key not configured');
  }
  return createClient(url, key);
}

async function updateDocumentsStrict(supabase, documentId, payload, options = {}) {
  const {
    label = 'documents update',
    fallbackPayload = null,
    context = {},
  } = options;

  const runUpdate = async (data, stage) => {
    const { error } = await supabase
      .from('documents')
      .update(data)
      .eq('id', documentId);

    if (error) {
      console.error(`[OCR] ${label} ${stage} failed`, {
        documentId,
        stage,
        payloadKeys: Object.keys(data || {}),
        ...context,
        error: error.message,
      });
      return { success: false, error };
    }

    console.log(`[OCR] ${label} ${stage} succeeded`, {
      documentId,
      stage,
      payloadKeys: Object.keys(data || {}),
      ...context,
    });
    return { success: true, error: null };
  };

  const primaryResult = await runUpdate(payload, 'primary');
  if (primaryResult.success || !fallbackPayload) {
    return primaryResult;
  }

  const fallbackResult = await runUpdate(fallbackPayload, 'fallback');
  if (!fallbackResult.success) {
    console.error(`[OCR] ${label} fallback failed`, {
      documentId,
      ...context,
      primaryError: primaryResult.error?.message,
      fallbackError: fallbackResult.error?.message,
    });
  }

  return fallbackResult.success
    ? {
        success: true,
        error: null,
        fallbackUsed: true,
        primaryError: primaryResult.error,
      }
    : {
        success: false,
        error: fallbackResult.error,
        primaryError: primaryResult.error,
        fallbackError: fallbackResult.error,
      };
}

async function updateProgress(supabase, documentId, step, message, options = {}) {
  const { setStatus = true, processingStatus, extraMetadata = null } = options;
  const metadata = {
    ...(extraMetadata || {}),
    processing_step: step,
    processing_message: message || '',
  };

  const nextProcessingStatus = processingStatus ?? (setStatus ? 'prepping' : undefined);
  console.log('[OCR] Status update: processing', { documentId, step, message, setStatus, nextProcessingStatus });

  const payload = {
    ...(setStatus ? { status: 'processing' } : {}),
    ...(nextProcessingStatus ? { processing_status: nextProcessingStatus } : {}),
    metadata,
  };

  const fallbackPayload = setStatus
    ? { status: 'processing' }
    : (nextProcessingStatus ? { processing_status: nextProcessingStatus } : null);

  const result = await updateDocumentsStrict(supabase, documentId, payload, {
    label: 'progress update',
    fallbackPayload,
    context: {
      step,
      message,
      setStatus,
      nextProcessingStatus,
      metadataKeys: Object.keys(metadata || {}),
    },
  });

  return result;
}

async function getProgressFromDB(supabase, documentId) {
  const { data } = await supabase
    .from('documents')
    .select('metadata, status')
    .eq('id', documentId)
    .single();
  
  if (data?.metadata?.processing_step !== undefined) {
    return {
      step: data.metadata.processing_step,
      message: data.metadata.processing_message || ''
    };
  }
  
  // Fallback: parse from status
  if (data?.status === 'processing') {
    return { step: 1, message: '' };
  }
  
  return { step: 0, message: '' };
}

async function clearProgress(supabase, documentId, finalStatus = 'ready', options = {}) {
  const { clearMetadata = true, setStatus = true, processingStatus } = options;
  const nextProcessingStatus = processingStatus ?? (finalStatus === 'error' ? 'error' : 'idle');
  const payload = { 
    ...(setStatus ? { status: finalStatus } : {}),
    processing_status: nextProcessingStatus,
    ...(clearMetadata ? { metadata: null } : {}),
  };

  const fallbackPayload = clearMetadata
    ? {
        ...(setStatus ? { status: finalStatus } : {}),
        processing_status: nextProcessingStatus,
      }
    : null;

  const result = await updateDocumentsStrict(supabase, documentId, payload, {
    label: 'status clear',
    fallbackPayload,
    context: {
      status: finalStatus,
      processing_status: nextProcessingStatus,
      clearMetadata,
      setStatus,
    },
  });

  if (result.success) {
    console.log('[OCR] Status update:', { documentId, status: finalStatus, clearMetadata, nextProcessingStatus });
  }

  return result;
}

/**
 * Analyze document to determine if it's single-person or multi-party
 * Returns context needed for Phase 1 setup
 */
async function analyzeDocumentContext(textContent, anthropic, logAnthropic = null, hints = {}) {
  if (!textContent || textContent.length < 50) {
    return { documentType: 'unknown', parties: [], isMultiParty: false };
  }

  const { fileName, pdfTitle } = hints || {};
  const hintLines = [];
  if (fileName) hintLines.push(`- File name: "${String(fileName).slice(0, 200)}"`);
  if (pdfTitle) hintLines.push(`- Embedded PDF title: "${String(pdfTitle).slice(0, 200)}"`);
  const hintsBlock = hintLines.length
    ? `\nAdditional context signals (these are often highly reliable for AcroForm PDFs whose extracted text is mostly widget names — treat them as strong evidence of the visible document title when present):\n${hintLines.join('\n')}\n`
    : '';

  const prompt = `Analyze this document to determine:
1. Is this a SINGLE-PERSON form (like W-2, tax form, application, claim form) or a MULTI-PARTY contract/agreement (rental agreement, employment contract, NDA, sales contract)?
2. If multi-party, what parties are involved (e.g., Landlord/Tenant, Employer/Employee, Buyer/Seller)?
${hintsBlock}
Document text sample (first 2000 chars):
${textContent.slice(0, 2000)}

Return ONLY JSON with these fields:
{
  "isMultiParty": true/false,
  "documentType": "single-form" | "rental" | "employment" | "nda" | "sales" | "other-contract" | "unknown",
  "parties": ["Party1", "Party2"] or [] if single-form,
  "detectedRoles": ["landlord", "tenant", "employer", "employee", "buyer", "seller", "client", "contractor"] or [] if single-form
}

If it's a standard tax form, government form, application, settlement statement, or any form filled by ONE person about themselves, set isMultiParty: false.`;

  try {
    const response = logAnthropic
      ? await logAnthropic('context-haiku', () => anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }), { model: 'claude-haiku-4-5' })
      : await anthropic.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });

    // claude-haiku-4-5 often wraps JSON in a ```json fence and may add prose.
    // Strip fences, then fall back to extracting the first {...} object so a
    // naive JSON.parse can't silently drop the whole context analysis
    // (which would leave documentType/parties/isMultiParty at their defaults).
    const raw = response.content[0].text.trim();
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    let result;
    try {
      result = JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON object in context analysis response');
      result = JSON.parse(match[0]);
    }
    return {
      documentType: result.documentType || 'unknown',
      parties: result.parties || [],
      isMultiParty: result.isMultiParty || false,
      detectedRoles: result.detectedRoles || [],
    };
  } catch (err) {
    console.warn('[OCR] Document context analysis failed:', err.message);
    return { documentType: 'unknown', parties: [], isMultiParty: false };
  }
}

/**
 * Build a map of AcroForm field name -> 1-based page number by reading each
 * field widget's page (/P) reference directly from the PDF. The form-field
 * extractor does not reliably report the page on multi-page documents (it can
 * collapse everything onto page 1), which makes fields render on the wrong
 * page in the fill view. pdf-lib gives us the authoritative page per widget.
 */
async function resolveFieldPagesFromPdf(fileBuffer) {
  const map = new Map();
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false, ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const refKey = (ref) =>
      ref && typeof ref.objectNumber === 'number'
        ? `${ref.objectNumber} ${ref.generationNumber ?? 0}`
        : null;
    const pageRefToNumber = new Map();
    pages.forEach((pg, i) => {
      const key = refKey(pg.ref);
      if (key) pageRefToNumber.set(key, i + 1);
    });

    const form = pdfDoc.getForm();
    for (const field of form.getFields()) {
      let name;
      try { name = field.getName(); } catch { continue; }
      if (!name || map.has(name)) continue;
      try {
        const widgets = field.acroField?.getWidgets?.() || [];
        for (const w of widgets) {
          const key = refKey(w?.P?.());
          if (key && pageRefToNumber.has(key)) {
            map.set(name, pageRefToNumber.get(key));
            break;
          }
        }
      } catch {
        // leave this field unmapped; the extractor's page value stands
      }
    }
  } catch (err) {
    // pdf-lib can't parse XFA/dynamic forms (e.g. USCIS I-485/N-400). That's
    // expected — we return an empty map and the field pages from the
    // extractor (edge function) stand, which handle these forms correctly.
    const xfa = /xfa|parse|invalid object/i.test(err.message || '');
    console.warn(`[OCR] resolveFieldPagesFromPdf skipped${xfa ? ' (XFA/dynamic form — using extractor pages)' : ''}:`, err.message);
  }
  return map;
}

/**
 * Extract checkbox/radio widget export values + positions from the PDF.
 *
 * pdf-lib's `widget.getOnValue()` returns the widget's `/AP /N` "on"-state name
 * — the option's export value (e.g. "Yes"/"No"). For RADIO GROUPS each kid
 * widget carries a distinct value, so this is the authoritative answer for which
 * box is which option, independent of the AI's visual guess. Returns one entry
 * per widget: { groupName, fieldKind: 'radio'|'checkbox', exportValue, page, x, y }
 * with x/y as top-left-origin percentages (matching the edge function/positions).
 */
async function extractCheckboxWidgetExports(fileBuffer) {
  const out = [];
  try {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false, ignoreEncryption: true });
    const pages = pdfDoc.getPages();
    const refKey = (ref) =>
      ref && typeof ref.objectNumber === 'number'
        ? `${ref.objectNumber} ${ref.generationNumber ?? 0}`
        : null;
    const pageRefToNumber = new Map();
    const pageDims = [];
    pages.forEach((pg, i) => {
      const key = refKey(pg.ref);
      if (key) pageRefToNumber.set(key, i + 1);
      pageDims[i] = pg.getSize();
    });

    const form = pdfDoc.getForm();
    for (const field of form.getFields()) {
      const kind = field.constructor?.name;
      if (kind !== 'PDFCheckBox' && kind !== 'PDFRadioGroup') continue;
      let groupName = null;
      try { groupName = field.getName(); } catch { /* unnamed */ }
      const fieldKind = kind === 'PDFRadioGroup' ? 'radio' : 'checkbox';
      let widgets = [];
      try { widgets = field.acroField?.getWidgets?.() || []; } catch { widgets = []; }
      for (const w of widgets) {
        let exportValue = null;
        try {
          const on = w.getOnValue?.();
          if (on) exportValue = on.decodeText?.() ?? on.asString?.() ?? String(on);
        } catch { /* no on-value */ }
        let rect = null;
        try { rect = w.getRectangle?.(); } catch { /* no rect */ }
        const pageNum = pageRefToNumber.get(refKey(w?.P?.())) || null;
        if (!rect || !pageNum) continue;
        const dims = pageDims[pageNum - 1] || { width: 612, height: 792 };
        out.push({
          groupName,
          fieldKind,
          exportValue,
          page: pageNum,
          x: Math.round((rect.x / dims.width) * 1000) / 10,
          y: Math.round(((dims.height - rect.y - rect.height) / dims.height) * 1000) / 10,
          w: Math.round((rect.width / dims.width) * 1000) / 10,
          h: Math.round((rect.height / dims.height) * 1000) / 10,
        });
      }
    }
  } catch (err) {
    console.warn('[OCR] extractCheckboxWidgetExports skipped:', err.message);
  }
  return out;
}

// Display/prompt names for every supported translation language. The `name` is
// what we put in the Claude translation prompt, so it must be unambiguous.
const LANGUAGE_NAMES = {
  en: 'English',
  vi: 'Vietnamese',
  es: 'Spanish',
  pt: 'Portuguese',
  fr: 'French',
  zh: 'Simplified Chinese (Mandarin)',
  yue: 'Cantonese (Traditional Chinese)',
  ht: 'Haitian Creole',
  ne: 'Nepali',
};

function getLanguageConfig(preferredLanguage) {
  const normalized = String(preferredLanguage || 'en').toLowerCase();
  if (LANGUAGE_NAMES[normalized]) {
    return { code: normalized, name: LANGUAGE_NAMES[normalized] };
  }
  return { code: 'en', name: 'English' };
}

// Build the per-language translation columns for a `fields` row from a
// translated field object (keys like `field_name_<code>`). Returns an empty
// object for English (the bare columns already hold English). This replaces the
// old hardcoded vi/es assignments so every supported language persists.
function buildTranslationColumns(langCode, translatedField) {
  if (!langCode || langCode === 'en') return {};
  const tf = translatedField || {};
  return {
    [`field_name_${langCode}`]: tf[`field_name_${langCode}`] || '',
    [`explanation_${langCode}`]: tf[`explanation_${langCode}`] || '',
    [`position_hint_${langCode}`]: tf[`position_hint_${langCode}`] || '',
  };
}

// Non-English language codes that have translation columns on `fields`.
const TRANSLATION_LANGUAGE_CODES = Object.keys(LANGUAGE_NAMES).filter(c => c !== 'en');
const TRANSLATION_BASES = ['field_name', 'explanation', 'position_hint'];

// Pull any populated per-language translation columns off a field object so they
// can be persisted, regardless of which language the document is in.
function pickTranslationColumns(field) {
  const out = {};
  if (!field) return out;
  for (const code of TRANSLATION_LANGUAGE_CODES) {
    for (const base of TRANSLATION_BASES) {
      const key = `${base}_${code}`;
      const val = field[key];
      if (val != null && val !== '') out[key] = val;
    }
  }
  return out;
}

function isGenericFieldLabel(value) {
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

// A field name that is structurally technical (XFA/AcroForm internal names like
// "topmostSubform[0].Page1[0].f1_01[0]" or "Form1[0].Page2[0].DateOfBirth[0]")
// rather than a human label. These need a label derived from the page, not the
// name. (A semantic segment like DateOfBirth is still technical *as stored* —
// humanizeTechnicalName handles those for display, but vision labeling is more
// reliable, so we flag them here too.)
function isTechnicalFieldName(value) {
  const name = String(value || '').trim();
  if (!name) return true;
  if (/\s/.test(name)) return false; // has spaces → already human
  return /\[\d+\]/.test(name) || /topmostSubform|\bsubform\b/i.test(name) || /\.(f|c|p)\d/i.test(name);
}

/**
 * Prompt for text-layer path Step 2 only: detect fields + positioning hints.
 * No explanations and no translations in this step.
 */
function buildTextLayerStep2Prompt(formattedText) {
  return `You are a document analysis expert. I've extracted all text from a PDF with exact coordinates.

Identify ALL user-fillable form fields.

TEXT WITH POSITIONS:
${formattedText}

For EACH field, return a JSON object with:
- "field_name": Short, clean English label (2-6 words)
- "field_type": One of: "text", "date", "number", "email", "tel", "checkbox", "signature", "address", "ssn", "select"
- "label_text": Exact label text from the document that identifies the field
- "approx_page": Page number where this field appears
- "approx_y": Approximate y-coordinate (row position)
- "position_hint": Brief location hint (3-10 words), e.g. "top-left", "below 'Employer Name'", "section 6a2"

IMPORTANT:
- This is Step 2 only. Do NOT include explanations.
- Do NOT include translations.
- Return ONLY a valid JSON array. No markdown, no code blocks, no extra text.
- If no fields are found, return [].
`;
}

/**
 * Prompt for Vision fallback: Claude analyzes the actual document image.
 */
function buildVisionPrompt(preferredLanguage) {
  const { code: langCode, name: langName } = getLanguageConfig(preferredLanguage);
  
  return `You are a document analysis expert. Analyze this document image carefully and extract ALL form fields that a user would need to fill in.

For EACH field, return a JSON object with these properties:
- "field_name": The English label/name of the field as it appears on the form
- "field_type": One of: "text", "date", "email", "tel", "number", "checkbox", "signature", "address", "ssn", "select"
- "field_name_${langCode}": The field name translated to ${langName}
- "explanation": Detailed explanation in English for unfamiliar users. Explain what the field IS and where to FIND the information.
- "explanation_${langCode}": The explanation translated to ${langName}
- "position_hint": Location hint for positioning. Use STANDARDIZED FORMAT:
  - Position keywords: top-left, top-right, bottom-left, bottom-right, top, bottom, left, right, center, middle
  - Prepositions: after, before, above, below, near, under, over, between, next to
  - Page/Section: page [number] (e.g., "page 6"), section [identifier] (e.g., "section 6a2")
  - Format: "[position], after '[label]'" or "page [n], [position]"
  - Examples: "page 1, top-left", "after 'Employer Name'", "page 6, below 'Client Duties', section 2A"
  - Keep to 3-10 words max
- "position": The location of the BLANK/WRITABLE area where the user would write their answer (NOT the label text). Use percentages of page dimensions:
  - "page": Which page number (1-indexed)
  - "x": LEFT edge of the writable area as percentage (0-100) of page width
  - "y": TOP edge of the writable area as percentage (0-100) of page height
  - "width": Width of the writable area as percentage (0-100) of page width
  - "height": Height of the writable area as percentage (0-100) of page height

CRITICAL POSITIONING RULES:
1. Position must point to the BLANK SPACE where users write — NOT the label/question text.
2. For "Name: _______________", position the writable area on the underscores AFTER "Name:", not on the word "Name".
3. For fields with a label on one line and a blank line below it, the y coordinate must be the BLANK LINE BELOW the label, not the label itself.
4. The y value must be where INK WOULD GO when someone writes — on or just above the blank line/underscores.
5. For inline fields like "Date: ___/___/____", x should start right after the colon/label text.
6. height should be the height of just the writable area (typically 2-4% for a single line).

Return ONLY a valid JSON array. No markdown, no code blocks, no extra text.
Do NOT include page numbers (e.g., "page 2" or "p.3") in position_hint. Prefer section or clause references like "Section 6.A.2".
If the document has no form fields, return an empty array [].
Analyze the ENTIRE document thoroughly. Do not miss any fields.`;
}

/**
 * Draw a faint coordinate grid (5% minor / 10% major lines, with 0–100 axis
 * labels) over a rendered page image and re-render it to PNG. Vision models
 * localize markedly better when they can read coordinates off an explicit grid,
 * and it suppresses "box in empty space" guesses. Returns base64 PNG, or null on
 * failure so the caller falls back to the ungridded image.
 */
async function buildGriddedImage(cleanPngBase64, width, height, supabaseUrl, anonKey) {
  try {
    if (!width || !height) return null;
    const { PDFDocument, rgb, StandardFonts } = await import('pdf-lib');
    const pdf = await PDFDocument.create();
    const png = await pdf.embedPng(Buffer.from(cleanPngBase64, 'base64'));
    const page = pdf.addPage([width, height]);
    page.drawImage(png, { x: 0, y: 0, width, height });
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let pct = 0; pct <= 100; pct += 5) {
      const x = (pct / 100) * width;
      const yPdf = height - (pct / 100) * height; // pdf-lib origin is bottom-left
      const major = pct % 10 === 0;
      const thickness = major ? 0.8 : 0.4;
      const opacity = major ? 0.5 : 0.25;
      page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness, color: rgb(0, 0.5, 1), opacity });
      page.drawLine({ start: { x: 0, y: yPdf }, end: { x: width, y: yPdf }, thickness, color: rgb(0, 0.5, 1), opacity });
      if (major) {
        page.drawText(String(pct), { x: x + 1, y: height - 12, size: 9, font, color: rgb(0, 0, 1) });
        page.drawText(String(pct), { x: 2, y: yPdf - 10, size: 9, font, color: rgb(0, 0, 1) });
      }
    }
    const pdfBytes = await pdf.save();
    const res = await fetch(`${supabaseUrl}/functions/v1/pdf-to-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}` },
      body: JSON.stringify({ pdfBase64: Buffer.from(pdfBytes).toString('base64'), pageNum: 1, scale: 1.5 }),
    });
    const j = await res.json();
    return j?.success && j.image ? j.image : null;
  } catch (e) {
    console.warn('[OCR] grid overlay build failed:', e.message);
    return null;
  }
}

/**
 * Prompt for labeling existing rect positions (hybrid flow)
 * Used when we have exact positions but need AI to identify/label the fields
 */
function buildLabelingPrompt(fieldsWithPositions) {
  const fieldsList = fieldsWithPositions.map((f, i) => {
    return `${i + 1}. Position: page ${f.position?.page || 1}, x: ${f.position?.x?.toFixed(1)}%, y: ${f.position?.y?.toFixed(1)}%, width: ${f.position?.width?.toFixed(1)}%, height: ${f.position?.height?.toFixed(1)}% - Internal name: ${f.name || 'unknown'}`;
  }).join('\n');

  return `You are a document analysis expert. I've identified ${fieldsWithPositions.length} form field positions in this document. Analyze the document image and provide labels and explanations for each field.

FIELD POSITIONS TO LABEL:
${fieldsList}

For EACH field, return a JSON object with:
- "field_name": The proper English label/name for this field based on what's visible near that position
- "alternatives": Array of alternative possible names (2-3 options if uncertain)
- "explanation": Detailed explanation for unfamiliar users. Explain what the field IS and where to FIND the information.
- "position_hint": Very brief note about field location (e.g., "top left", "middle right"). 3-5 words max.

IMPORTANT:
- "explanation" should help people unfamiliar with this document - explain concepts clearly
- "position_hint" is ONLY for positioning - keep very brief (3-5 words)
- Do NOT include position info in explanation
- Use what you can see near each position to identify the field

Return ONLY a JSON array in the same order as the positions above. No markdown, no code blocks.`;
}

/**
 * Parse Claude's JSON response, with fallback regex extraction.
 */
function parseClaudeResponse(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('Could not parse field extraction response');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const bodySchema = z.object({
    documentId: z.string().min(1),
    userId: z.string().min(1),
    preferredLanguage: z.string().optional(),
    mode: z.enum(['full', 'pre_setup', 'post_setup']).optional(),
  });

  const parseResult = bodySchema.safeParse(req.body || {});
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const {
    documentId,
    userId,
    preferredLanguage = 'en',
    mode = 'full',
  } = parseResult.data;

  console.log('[OCR] Request received:', { documentId, userId, preferredLanguage, mode });

  const stepTimers = new Map();
  const startStep = (label) => {
    stepTimers.set(label, performance.now());
    console.log('[OCR][timing:start]', { documentId, mode, label });
  };
  const endStep = (label, extra = {}) => {
    const start = stepTimers.get(label);
    const ms = start ? Math.round(performance.now() - start) : null;
    console.log('[OCR][timing:end]', { documentId, mode, label, ms, ...extra });
  };
  const callAnthropic = async (label, fn, meta = {}, timeoutMs) => {
    const limitMs = timeoutMs || ANTHROPIC_TIMEOUT_MS;
    const t0 = performance.now();
    try {
      const response = await Promise.race([
        fn(),
        new Promise((_, reject) => {
          setTimeout(
            () => reject(new Error(`Anthropic timeout after ${limitMs}ms`)),
            limitMs
          );
        }),
      ]);
      const ms = Math.round(performance.now() - t0);
      const usage = response?.usage || response?.meta?.usage || null;
      console.log('[OCR][anthropic]', { documentId, mode, label, ms, usage, ...meta });
      return response;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      console.error('[OCR][anthropic:error]', { documentId, mode, label, ms, message: err.message, ...meta });
      throw err;
    }
  };

  const STEP3_PRIMARY_MODEL = process.env.OCR_STEP3_PRIMARY_MODEL || 'claude-haiku-4-5';
  const STEP3_FALLBACK_MODEL = process.env.OCR_STEP3_FALLBACK_MODEL || 'claude-sonnet-4-5';
  const STEP2_PRIMARY_MODEL = process.env.OCR_STEP2_PRIMARY_MODEL || 'claude-sonnet-4-5';
  const STEP2_FALLBACK_MODEL = process.env.OCR_STEP2_FALLBACK_MODEL || 'claude-haiku-4-5';
  const STEP3_CHUNK_SIZE = Number(process.env.OCR_STEP3_CHUNK_SIZE || 10);
  // How many chunk-sized Claude calls to run concurrently. Enrichment (Step 3a/3b)
  // and labeling (Step 2) are otherwise sequential — on dense forms that's dozens
  // of calls back-to-back. Bounded concurrency cuts that from minutes to seconds.
  const STEP3_CONCURRENCY = Number(process.env.OCR_STEP3_CONCURRENCY || 6);
  const STEP2_CONCURRENCY = Number(process.env.OCR_STEP2_CONCURRENCY || 5);
  const POST_SETUP_MAX_FIELDS = Number(process.env.OCR_POST_SETUP_MAX_FIELDS || 80);
  const STEP2_LABEL_CHUNK_SIZE = Number(process.env.OCR_STEP2_LABEL_CHUNK_SIZE || 40);
  const ANTHROPIC_TIMEOUT_MS = Number(process.env.OCR_ANTHROPIC_TIMEOUT_MS || 30000);

  const maxTokensForModel = (model) => (model === 'claude-haiku-4-5' ? 4096 : 8192);

  // Recover every complete top-level {...} object from text, skipping any that
  // don't parse. Lets us salvage results when the model emits a slightly
  // malformed or truncated array (common on dense vision pages) instead of
  // throwing away the whole response.
  const extractJsonObjects = (text) => {
    const objs = [];
    let depth = 0, start = -1, inStr = false, esc = false;
    for (let i = 0; i < text.length; i += 1) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth === 0) start = i; depth += 1; }
      else if (c === '}') {
        depth -= 1;
        if (depth === 0 && start >= 0) {
          try { objs.push(JSON.parse(text.slice(start, i + 1))); } catch {}
          start = -1;
        }
      }
    }
    return objs;
  };

  const parseJsonArray = (text) => {
    const cleaned = text.replace(/^```json\s*/g, '').replace(/```$/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); } catch {}
      }
      // Last resort: salvage whatever complete objects we can.
      const objs = extractJsonObjects(cleaned);
      if (objs.length) return objs;
      throw new Error('Failed to parse JSON array');
    }
  };

  const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  };

  // Run `fn` over items with bounded concurrency, preserving result order.
  const mapWithConcurrency = async (items, limit, fn) => {
    const results = new Array(items.length);
    let cursor = 0;
    const runner = async () => {
      while (cursor < items.length) {
        const i = cursor;
        cursor += 1;
        results[i] = await fn(items[i], i);
      }
    };
    const workers = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workers }, runner));
    return results;
  };

  const normalizeStep2Name = (name, fallbackName, fallbackIndex) => {
    const raw = String(name || '').trim();
    if (!raw) return fallbackName || `Field ${fallbackIndex}`;
    const cleaned = raw
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return fallbackName || `Field ${fallbackIndex}`;
    if (isGenericFieldLabel(cleaned)) return fallbackName || cleaned;
    return cleaned;
  };

  const normalizeStep2Hint = (hint, fallbackHint = '') => {
    const cleaned = String(hint || '').replace(/\s+/g, ' ').trim();
    return cleaned || String(fallbackHint || '').trim();
  };

  const toPositionIndex = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  };

  const runStep2FieldLabeling = async ({
    client,
    indexedFields,
    fileBufferForPrompt,
    includePositionContext = true,
    labelPrefix = 'step2-labels',
  }) => {
    if (!Array.isArray(indexedFields) || indexedFields.length === 0) return [];
    if (!client) throw new Error('Missing Anthropic client for Step 2 labeling');

    const chunks = chunkArray(indexedFields, STEP2_LABEL_CHUNK_SIZE);
    const labeledByIndex = new Map();
    const base64Pdf = fileBufferForPrompt.toString('base64');

    // Prompt-cache the (identical) PDF across chunks: it's billed once as a
    // cache write (~1.25x input) and then read (~0.1x input) on every
    // subsequent chunk. Only worth it when there's more than one chunk — a
    // single-chunk doc would pay the write premium with no read to amortize
    // it, so it's left uncached. Cache hits/writes show up in the per-call
    // `usage` log (cache_read_input_tokens / cache_creation_input_tokens).
    const cachePdf = chunks.length > 1;

    const processChunk = async (chunk, i) => {
      const chunkIndexSet = new Set(chunk.map((item) => item.position_index));
      const fieldList = chunk
        .map((f) => {
          if (includePositionContext) {
            const pos = f.position;
            return `${f.position_index}. Position: page ${pos?.page || 1}, x=${pos?.x?.toFixed?.(1) ?? pos?.x ?? 0}%, y=${pos?.y?.toFixed?.(1) ?? pos?.y ?? 0}% | Current label: "${f.field_name || ''}"`;
          }
          return `${f.position_index}. Internal field name: "${f.field_name || ''}"`;
        })
        .join('\n');

      const prompt = includePositionContext
        ? `You are a document analysis expert. Look at this PDF and identify each form field.

FIELD POSITIONS (in PDF order):
${fieldList}

For EACH field, return a JSON object with:
1. "position_index": The index from above (must match exactly)
2. "field_name": SHORT clean header in English (2-6 words)
3. "position_hint": VERY brief location hint (3-10 words)

IMPORTANT:
- Return exactly ${chunk.length} objects for this chunk.
- Keep position_index values exactly as provided.
- field_name must be human-readable (not Text123 / f1_01 / field_12).
- Return ONLY a valid JSON array. No markdown/code fences.`
        : `You are a document analysis expert. Analyze this PDF and rename form fields to human-readable labels.

FIELD LIST (in extraction order):
${fieldList}

For EACH item, return JSON with:
- "position_index": Number from the list above
- "field_name": Short human-readable English label (2-6 words)
- "position_hint": Brief location hint (3-10 words)

IMPORTANT:
- Return exactly ${chunk.length} objects for this chunk.
- Keep position_index values exactly as provided.
- field_name must be human-readable (not Text123 / f1_01 / field_12).
- Return ONLY a valid JSON array. No markdown/code fences.`;

      const tryModel = async (model, modelLabel) => {
        const response = await callAnthropic(
          `${labelPrefix}-${modelLabel}-chunk-${i + 1}`,
          () => client.messages.create({
            model,
            max_tokens: maxTokensForModel(model),
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'document',
                    source: {
                      type: 'base64',
                      media_type: 'application/pdf',
                      data: base64Pdf,
                    },
                    ...(cachePdf ? { cache_control: { type: 'ephemeral' } } : {}),
                  },
                  {
                    type: 'text',
                    text: prompt,
                  },
                ],
              },
            ],
          }),
          {
            model,
            chunk: i + 1,
            totalChunks: chunks.length,
            cachedPdf: cachePdf,
          }
        );
        return parseJsonArray(response.content[0].text.trim());
      };

      let parsed = [];
      try {
        parsed = await tryModel(STEP2_PRIMARY_MODEL, 'primary');
      } catch (err) {
        console.warn('[OCR] Step 2 primary failed, falling back:', err.message);
        try {
          parsed = await tryModel(STEP2_FALLBACK_MODEL, 'fallback');
        } catch (fallbackErr) {
          console.warn('[OCR] Step 2 fallback failed:', fallbackErr.message);
          parsed = [];
        }
      }
      return { chunk, chunkIndexSet, parsed: Array.isArray(parsed) ? parsed : [] };
    };

    // When the PDF is cached, run the FIRST chunk alone so it writes the cache,
    // then the rest concurrently (each a cheap cache read). Otherwise run all
    // chunks with bounded concurrency. This turns ~N sequential PDF calls into
    // roughly one wave.
    let chunkOutputs;
    if (cachePdf && chunks.length > 1) {
      const firstOut = await processChunk(chunks[0], 0);
      const restOut = await mapWithConcurrency(chunks.slice(1), STEP2_CONCURRENCY, (c, j) => processChunk(c, j + 1));
      chunkOutputs = [firstOut, ...restOut];
    } else {
      chunkOutputs = await mapWithConcurrency(chunks, STEP2_CONCURRENCY, processChunk);
    }

    for (const { chunk, chunkIndexSet, parsed } of chunkOutputs) {
      for (const item of parsed) {
        const positionIndex = toPositionIndex(item?.position_index);
        if (!positionIndex || !chunkIndexSet.has(positionIndex)) continue;
        const source = chunk.find((f) => f.position_index === positionIndex);
        labeledByIndex.set(positionIndex, {
          position_index: positionIndex,
          field_name: normalizeStep2Name(item?.field_name, source?.field_name, positionIndex),
          position_hint: normalizeStep2Hint(item?.position_hint, source?.position_hint),
        });
      }
    }

    return indexedFields.map((sourceField, idx) => {
      const fallbackIndex = sourceField.position_index || idx + 1;
      const labeled = labeledByIndex.get(fallbackIndex);
      if (labeled) return labeled;
      return {
        position_index: fallbackIndex,
        field_name: normalizeStep2Name(sourceField.field_name, sourceField.field_name, fallbackIndex),
        position_hint: normalizeStep2Hint(sourceField.position_hint, ''),
      };
    });
  };

  const runStep3aExplanations = async (client, fieldsForExplanation, labelPrefix = 'step3a') => {
    if (!fieldsForExplanation?.length) return [];
    const chunks = chunkArray(fieldsForExplanation, STEP3_CHUNK_SIZE);

    const chunkResults = await mapWithConcurrency(chunks, STEP3_CONCURRENCY, async (chunk, i) => {
      const fieldNamesForExplanation = chunk
        .map((f) => `${f.position_index}. ${f.field_name}`)
        .join('\n');

      const explanationPrompt = `You are helping someone unfamiliar with US tax/legal forms understand what each field means and where to find the information. Use simple everyday English.

FIELD LIST:
${fieldNamesForExplanation}

For EACH field, return JSON:
{
  "position_index": 1,
  "field_name": "Original field name",
  "explanation": "What this field is and where to find the information, in simple English that anyone can understand",
  "position_hint": "Location hint for finding this field on the document (e.g., 'top left of page 1', 'after Employer Name')"
}

IMPORTANT:
- explanation should be 1-2 sentences max
- Help people who have never seen this form before
- Tell them WHERE to find the answer (e.g., "check your Social Security card", "look at your pay stub", "ask your employer")
- Use simple words, avoid legal/tax jargon
- Always wrap document text references in SINGLE QUOTES: "after 'Employer Name'", "below 'Client Duties'"

Return JSON array.`;

      const tryModel = async (model, modelLabel) => {
        const response = await callAnthropic(
          `${labelPrefix}-${modelLabel}-chunk-${i + 1}`,
          () => client.messages.create({
            model,
            max_tokens: maxTokensForModel(model),
            messages: [{ role: 'user', content: explanationPrompt }],
          }),
          { model }
        );
        const parsed = parseJsonArray(response.content[0].text.trim());
        if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
          throw new Error(`Unexpected item count: ${parsed?.length || 0} (expected ${chunk.length})`);
        }
        // Trust INPUT order, not the model's echoed position_index — on dense
        // forms the model keeps the order but renumbers the indices, which then
        // mis-merges. Re-stamp each result with the input field's index.
        return parsed.map((p, j) => ({ ...p, position_index: chunk[j].position_index }));
      };

      try {
        return await tryModel(STEP3_PRIMARY_MODEL, 'primary');
      } catch (err) {
        console.warn('[OCR] Step 3a primary failed, falling back:', err.message);
        try {
          return await tryModel(STEP3_FALLBACK_MODEL, 'fallback');
        } catch (err2) {
          // Don't let one bad chunk discard the whole document's explanations —
          // keep this chunk's fields (no explanation) so alignment + count hold.
          console.warn('[OCR] Step 3a chunk failed on both models; keeping names only:', err2.message);
          return chunk.map((f) => ({
            position_index: f.position_index,
            field_name: f.field_name,
            explanation: '',
            position_hint: f.position_hint || '',
          }));
        }
      }
    });

    return chunkResults.flat();
  };

  const runStep3bTranslations = async (client, englishFields, langName, langCode, labelPrefix = 'step3b') => {
    if (!englishFields?.length) return [];
    const chunks = chunkArray(englishFields, STEP3_CHUNK_SIZE);

    // All languages translate on Haiku first (fast, and good quality on every
    // script in testing, including Burmese/Nepali/CJK), Sonnet as fallback.
    // (Routing non-Latin scripts to Sonnet-first regressed this path: Sonnet
    // exceeds the 30s per-call cap on these chunks, so every chunk timed out
    // before falling back. The rare stray-English-token artifact is better
    // handled by a validation/retry pass than by a slow primary model.)
    const primaryModel = STEP3_PRIMARY_MODEL;
    const secondaryModel = STEP3_FALLBACK_MODEL;

    const chunkResults = await mapWithConcurrency(chunks, STEP3_CONCURRENCY, async (chunk, i) => {
      const englishFieldsText = chunk.map(f =>
        `${f.position_index}. ${f.field_name}: ${f.explanation || ''} | Position: ${f.position_hint || 'N/A'}`
      ).join('\n');

      const translationPrompt = `Translate these form field names, explanations, and position hints to ${langName}. The audience is a ${langName}-speaking US resident filling out official forms.

INPUT (English):
${englishFieldsText}

For EACH field, return JSON:
{
  "position_index": 1,
  "field_name_${langCode}": "Translated field name",
  "explanation_${langCode}": "Translated explanation - simple, clear language",
  "position_hint_${langCode}": "Translated position hint - KEEP document references in English (text in quotes, page numbers), translate position keywords only"
}

IMPORTANT:
- Use simple, everyday ${langName}
- Keep explanation 1-2 sentences
- For position_hint: Keep text in QUOTES in English (e.g., 'Consultant Name')
- For position_hint: Keep page numbers in English (e.g., "page 1")
- For position_hint: Translate the position keywords only (e.g. "top-left", "after", "below", "next to"); leave quoted labels and page numbers in English
- Return COMPLETE JSON for ALL fields

Return JSON array.`;

      const tryModel = async (model, modelLabel) => {
        const response = await callAnthropic(
          `${labelPrefix}-${modelLabel}-chunk-${i + 1}`,
          () => client.messages.create({
            model,
            max_tokens: maxTokensForModel(model),
            messages: [{ role: 'user', content: translationPrompt }],
          }),
          { model }
        );
        const parsed = parseJsonArray(response.content[0].text.trim());
        if (!Array.isArray(parsed) || parsed.length !== chunk.length) {
          throw new Error(`Unexpected item count: ${parsed?.length || 0} (expected ${chunk.length})`);
        }
        // Trust INPUT order, not the model's echoed position_index (it keeps
        // order but renumbers on dense forms, which mis-merges the translation).
        return parsed.map((p, j) => ({ ...p, position_index: chunk[j].position_index }));
      };

      try {
        return await tryModel(primaryModel, 'primary');
      } catch (err) {
        console.warn('[OCR] Step 3b primary failed, falling back:', err.message);
        try {
          return await tryModel(secondaryModel, 'fallback');
        } catch (err2) {
          // One chunk timing out must not wipe the whole document's
          // translations — fall back to English for *this* chunk only, keeping
          // position_index + count so the merge stays aligned.
          console.warn('[OCR] Step 3b chunk failed on both models; English fallback for this chunk:', err2.message);
          return chunk.map((f) => ({
            position_index: f.position_index,
            [`field_name_${langCode}`]: f.field_name,
            [`explanation_${langCode}`]: f.explanation || '',
            [`position_hint_${langCode}`]: f.position_hint || '',
          }));
        }
      }
    });

    return chunkResults.flat();
  };

  if (!documentId || !userId) {
    return res.status(400).json({ error: 'documentId and userId are required' });
  }

  // OCR_PROVIDER=stub (tests only): pre_setup saves fixed fields and makes no
  // AI call, so it needs no Anthropic key.
  const useStub = mode === 'pre_setup' && ocrProvider() === 'stub';

  // The host env key first, else the key saved at /setup (as lib/anthropic.js).
  const anthropicApiKey = useStub ? null : effectiveSetting('ANTHROPIC_API_KEY', process.env);

  // With no key at all, pre_setup still finishes (zero fields) so the upload
  // opens the setup screen, and post_setup finishes without explanations or
  // translations so the document does not stay on 'finalizing'; full mode
  // needs the key.
  const noAiKey = !useStub && !anthropicApiKey;

  if (noAiKey && mode !== 'pre_setup' && mode !== 'post_setup') {
    console.error('[OCR] ANTHROPIC_API_KEY not set');
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
  }

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    console.error('[OCR] Supabase service role key not configured');
    return res.status(500).json({ error: 'Supabase service role key not configured' });
  }

  // The in-process OCR worker resumes parked OCR jobs but has no user JWT. When
  // the request carries this process's internal token (the worker re-invoking
  // the app) or a valid cron secret (a manual trigger) we skip user auth and
  // resolve the org from the document row itself (these callers only ever
  // target a specific documentId).
  const cronAuthed = isCronAuthorized(req) || isInternalAuthorized(req);
  let membership;
  if (cronAuthed) {
    const { data: orgRow, error: orgErr } = await supabase
      .from('documents')
      .select('org_id')
      .eq('id', documentId)
      .single();
    if (orgErr || !orgRow) {
      return res.status(404).json({ error: 'Document not found' });
    }
    membership = { org_id: orgRow.org_id };
  } else {
    const authResult = await requireBearerUser(req, supabase);
    if (authResult.error) {
      return res.status(authResult.status).json({ error: authResult.error });
    }

    if (await rateLimitAuth(req, res, 'ocr', authResult.user.id)) {
      return;
    }

    if (userId && authResult.user.id !== userId) {
      return res.status(403).json({ error: 'User mismatch' });
    }

    const membershipResult = await requireOrgMembership(authResult.user.id, supabase, requestedOrgId(req));
    if (membershipResult.error) {
      return res.status(membershipResult.status).json({ error: membershipResult.error });
    }
    membership = { org_id: membershipResult.orgId };
  }

  try {
    // 1. Fetch document
    startStep('db-fetch-document');
    const { data: doc, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('org_id', membership.org_id)
      .single();
    endStep('db-fetch-document', { found: !!doc });

    if (docError || !doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    if (noAiKey) {
      // No detection runs, so the fields are whatever is already saved (none on
      // a first upload; a retry keeps and answers with the earlier ones).
      const { data: existingFields, error: fieldsError } = await supabase
        .from('fields')
        .select('*')
        .eq('document_id', documentId);
      if (fieldsError) {
        return res.status(500).json({ error: 'Failed to load fields' });
      }
      const fields = existingFields || [];

      // Same end state as a finished pre_setup run (post_setup leaves the
      // lifecycle as setup saved it), with the reason merged into the existing
      // metadata. No fallback: the document only finishes if the reason is
      // saved too.
      const metadata = { ...(doc.metadata || {}), no_fields_reason: 'no_ai_key' };
      const noKeyResult = await updateDocumentsStrict(supabase, documentId, {
        ...(mode === 'pre_setup' ? { lifecycle_status: 'setup_required' } : {}),
        processing_status: 'idle',
        metadata,
      }, { label: `${mode} no-ai-key document update`, context: { mode } });
      if (!noKeyResult.success) {
        return res.status(500).json({ error: 'Failed to update document' });
      }

      console.warn(`[OCR] No Anthropic key; ${mode} finished without AI`, { documentId });
      return res.status(200).json({
        success: true,
        fields,
        fieldsCount: fields.length,
        extractionMethod: 'none',
        positionSources: {},
        metadata,
      });
    }

    // 2. Initialize progress — only now that the document is known to be in the
    // caller's org (updates go through the service-role client by id alone).
    if (mode === 'post_setup') {
      await updateProgress(supabase, documentId, 0, 'Finalizing field details...', {
        setStatus: false,
        processingStatus: 'finalizing',
        extraMetadata: { post_setup: true },
      });
    } else if (mode === 'pre_setup') {
      await updateProgress(supabase, documentId, 0, 'Analyzing document...', {
        setStatus: false,
        processingStatus: 'prepping',
      });
    } else {
      await updateProgress(supabase, documentId, 0, 'Analyzing document...');
    }

    if (useStub) {
      const fields = stubFields(documentId);
      await supabase.from('fields').delete().eq('document_id', documentId);
      const { error: insertError } = await supabase.from('fields').insert(fields);
      if (insertError) throw insertError;

      // Same end state as a finished real pre_setup run.
      await updateDocumentsStrict(supabase, documentId, {
        lifecycle_status: 'setup_required',
        processing_status: 'idle',
      }, { label: 'pre-setup document update', context: { mode: 'pre_setup' } });
      await clearProgress(supabase, documentId, 'ready', { setStatus: false, processingStatus: 'idle' });

      console.log('[OCR] Stub provider ran; saved fixed fields, no AI call', { documentId, count: fields.length });
      return res.status(200).json({
        success: true,
        fields,
        fieldsCount: fields.length,
        extractionMethod: 'stub',
        positionSources: { stub: fields.length },
      });
    }

    const targetLanguage = preferredLanguage || doc.preferred_language || 'en';

    // ===== Resumable-OCR setup =====
    // Dense documents that can't finish in one invocation park their progress in
    // phase1_data.ocr and are resumed by the in-process OCR worker. Disabled only if
    // OCR_RESUMABLE_ENABLED='false'. Normal docs finish in the first call, never
    // cross the soft budget, and never write any ocr state — behaviour unchanged.
    const RESUMABLE = process.env.OCR_RESUMABLE_ENABLED !== 'false';
    const SOFT_BUDGET_MS = Number(process.env.OCR_SOFT_BUDGET_MS || DEFAULT_SOFT_BUDGET_MS);
    const MAX_ATTEMPTS = Number(process.env.OCR_MAX_ATTEMPTS || DEFAULT_MAX_ATTEMPTS);
    const procStart = performance.now();
    const leaseId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const overBudget = () => RESUMABLE && isOverBudget(performance.now() - procStart, SOFT_BUDGET_MS);

    let ocrState = readOcrState(doc);
    let resumePhase = null;
    if (RESUMABLE && isResumableState(ocrState, mode)) {
      const now = Date.now();
      if (isLeaseHeld(ocrState, now, DEFAULT_LEASE_MS)) {
        // Another worker is actively processing this doc; back off.
        console.log('[OCR] Resume skipped — lease held by another worker', { documentId, phase: ocrState.phase });
        return res.status(202).json({ inProgress: true, locked: true, phase: ocrState.phase });
      }
      if (attemptsExceeded(ocrState, MAX_ATTEMPTS)) {
        console.warn('[OCR] Resume attempts exhausted; marking error', { documentId, attempts: ocrState.attempts });
        await updateDocumentsStrict(supabase, documentId, {
          phase1_data: mergeOcrState(doc.phase1_data, { phase: 'error', updatedAt: new Date().toISOString() }),
        }, { label: 'ocr attempts exhausted', context: { documentId } });
        if (mode === 'full') {
          await clearProgress(supabase, documentId, 'error');
        } else {
          await clearProgress(supabase, documentId, 'ready', { setStatus: false, processingStatus: 'error' });
        }
        return res.status(200).json({ success: false, error: 'ocr_attempts_exhausted' });
      }
      resumePhase = ocrState.phase;
      console.log('[OCR] Resuming parked OCR job', { documentId, phase: resumePhase, attempts: ocrState.attempts || 0 });
    } else {
      ocrState = null;
    }
    // Past detection: detection already produced positioned fields (in ocr.fields).
    const resumeSkipDetection = resumePhase === 'enrich' || resumePhase === 'backfill';
    // Prep (download/extraction/context) can itself be slow. Once it's been done
    // and persisted (`prepDone`), every resume rehydrates those outputs and skips
    // the slow extraction entirely — otherwise a slow-prep doc could never make
    // progress (it would burn each invocation re-extracting and never reach the
    // budget-guarded loops).
    const resumeSkipExtraction = RESUMABLE && !!(ocrState && ocrState.prepDone);

    // Persist a progress checkpoint into phase1_data.ocr WITHOUT touching
    // status/metadata (clearProgress owns terminal status). Refreshes the lease
    // and bumps the attempt counter. Returns after calling this — one checkpoint
    // per invocation. Keeps the in-memory doc.phase1_data current for later writes.
    const checkpoint = async (patch) => {
      const merged = mergeOcrState(doc.phase1_data, {
        mode,
        attempts: Number((ocrState && ocrState.attempts) || 0) + 1,
        ...patch,
        lease: { id: leaseId, at: Date.now() },
        updatedAt: new Date().toISOString(),
      });
      doc.phase1_data = merged;
      await updateDocumentsStrict(supabase, documentId, { phase1_data: merged }, {
        label: 'ocr checkpoint',
        context: { documentId, phase: patch && patch.phase },
      });
    };

    // 3. Initialize Claude (same client works for both Sonnet and Haiku)
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: anthropicApiKey });
    // Haiku uses same client, just different model in the call

    // Post-setup mode: run Step 3 only (explanations/translations) without changing positions
    if (mode === 'post_setup') {
      if (!doc?.phase1_data?.setupCompleted) {
        console.warn('[OCR] Post-setup called before setup completion; skipping', {
          documentId,
          lifecycle_status: doc?.lifecycle_status || null,
        });
        await clearProgress(supabase, documentId, 'ready', {
          setStatus: false,
          processingStatus: 'idle',
        });
        return res.status(409).json({
          error: 'Setup not completed',
          errorCode: 'setup_not_completed',
        });
      }

      const { data: existingFields, error: fieldsError } = await supabase
        .from('fields')
        .select('id, field_name, position_hint, explanation, sort_order')
        .eq('document_id', documentId)
        .order('sort_order', { ascending: true });

      if (fieldsError) {
        await clearProgress(supabase, documentId, 'ready', {
          setStatus: false,
          processingStatus: 'error',
        });
        return res.status(500).json({ error: 'Failed to load fields for post-setup enrichment' });
      }

      const includedFieldIds = Array.isArray(doc?.phase1_data?.includedFieldIds)
        ? new Set(doc.phase1_data.includedFieldIds.map((id) => String(id)))
        : null;

      let fieldsForPostSetup = Array.isArray(existingFields) ? existingFields : [];
      if (includedFieldIds && includedFieldIds.size > 0) {
        fieldsForPostSetup = fieldsForPostSetup.filter((field) => includedFieldIds.has(String(field.id)));
      }

      if (POST_SETUP_MAX_FIELDS > 0 && fieldsForPostSetup.length > POST_SETUP_MAX_FIELDS) {
        console.log('[OCR] Post-setup field cap applied', {
          documentId,
          before: fieldsForPostSetup.length,
          after: POST_SETUP_MAX_FIELDS,
        });
        fieldsForPostSetup = fieldsForPostSetup.slice(0, POST_SETUP_MAX_FIELDS);
      }

      if (fieldsForPostSetup.length === 0) {
        const clearResult = await clearProgress(supabase, documentId, 'ready', {
          setStatus: false,
          processingStatus: 'idle',
        });
        if (!clearResult.success) {
          console.warn('[OCR] Post-setup no-fields clearProgress failed', {
            documentId,
            error: clearResult.error?.message,
            fallbackError: clearResult.fallbackError?.message,
          });
        }
        return res.status(200).json({
          success: true,
          fieldsCount: 0,
          extractionMethod: doc?.extraction_method || 'post-setup',
          metadata: {
            confirmedCount: 0,
            pendingCount: 0,
            skippedReason: 'no_fields_to_enrich',
          },
        });
      }

      try {
        const existingEnglishFields = fieldsForPostSetup.map((f, i) => ({
          position_index: i + 1,
          field_name: f.field_name,
          explanation: f.explanation || '',
          position_hint: f.position_hint || '',
        }));
        const hasCompleteEnglishExplanations = existingEnglishFields.every((f) => (
          String(f.explanation || '').trim().length > 0
        ));

        let englishFields = existingEnglishFields;
        if (!hasCompleteEnglishExplanations) {
          await updateProgress(supabase, documentId, 3, 'Adding explanations...', {
            setStatus: false,
            processingStatus: 'finalizing',
            extraMetadata: { post_setup: true },
          });

          const fieldsForExplanation = fieldsForPostSetup.map((f, i) => ({
            position_index: i + 1,
            field_name: f.field_name,
          }));

          englishFields = await runStep3aExplanations(anthropic, fieldsForExplanation, 'post-setup-explanations');
          if (!englishFields || !Array.isArray(englishFields) || englishFields.length === 0) {
            englishFields = fieldsForPostSetup.map((f, i) => ({
              position_index: i + 1,
              field_name: f.field_name,
              explanation: '',
              position_hint: f.position_hint || '',
            }));
          }
        } else {
          console.log('[OCR] Post-setup: skipping Step 3a, reusing existing English explanations', {
            documentId,
            fieldsCount: existingEnglishFields.length,
          });
        }

        const targetLang = getLanguageConfig(targetLanguage);
        let translatedFields = [];
        if (targetLang.code !== 'en') {
          await updateProgress(supabase, documentId, 4, 'Translating...', {
            setStatus: false,
            processingStatus: 'finalizing',
            extraMetadata: { post_setup: true },
          });
          translatedFields = await runStep3bTranslations(
            anthropic,
            englishFields,
            targetLang.name,
            targetLang.code,
            'post-setup-translation'
          );
        }

        const updates = fieldsForPostSetup.map((field, idx) => {
          const englishField = englishFields.find(ef => ef.position_index === idx + 1);
          const translatedField = translatedFields.find(tf => tf.position_index === idx + 1);
          const langCode = targetLang.code === 'en' ? null : targetLang.code;

          const updateData = {
            field_name: englishField?.field_name || field.field_name,
            position_hint: englishField?.position_hint || field.position_hint || '',
            explanation: englishField?.explanation || '',
            ...buildTranslationColumns(langCode, translatedField),
          };

          return supabase.from('fields').update(updateData).eq('id', field.id);
        });

        await Promise.all(updates);

        console.log('[OCR] Status update: ready (post-setup)', { documentId });
        const readyToSendResult = await updateDocumentsStrict(
          supabase,
          documentId,
          {
            lifecycle_status: 'ready_to_send',
            phase1_data: {
              ...(doc?.phase1_data || {}),
              setupCompleted: true,
            },
          },
          {
            label: 'post-setup ready-to-send update',
            context: { mode: 'post_setup' },
          }
        );
        if (!readyToSendResult.success) {
          console.warn('[OCR] Failed to persist ready_to_send lifecycle status', {
            documentId,
            error: readyToSendResult.error?.message,
          });
        }

        const completeProgressResult = await updateProgress(supabase, documentId, 5, 'Complete!', {
          setStatus: false,
          processingStatus: 'finalizing',
          extraMetadata: { post_setup: true },
        });
        if (!completeProgressResult.success) {
          console.warn('[OCR] Post-setup completion progress update failed', {
            documentId,
            error: completeProgressResult.error?.message,
          });
        }

        const clearResult = await clearProgress(supabase, documentId, 'ready', {
          setStatus: false,
          processingStatus: 'idle',
        });
        if (!clearResult.success) {
          console.warn('[OCR] Post-setup clearProgress failed', {
            documentId,
            error: clearResult.error?.message,
            fallbackError: clearResult.fallbackError?.message,
          });
        }

        return res.status(200).json({
          success: true,
          fieldsCount: fieldsForPostSetup.length,
          extractionMethod: doc?.extraction_method || 'post-setup',
          metadata: {
            confirmedCount: fieldsForPostSetup.length,
            pendingCount: 0,
          },
        });
      } catch (err) {
        console.error('[OCR] Post-setup error:', err);
        console.log('[OCR] Post-setup error (keeping ready status)', { documentId });
        const errorUpdateResult = await updateDocumentsStrict(
          supabase,
          documentId,
          { processing_status: 'error', metadata: null },
          {
            label: 'post-setup error update',
            context: { mode: 'post_setup' },
          }
        );
        if (!errorUpdateResult.success) {
          console.warn('[OCR] Post-setup error state update failed', {
            documentId,
            error: errorUpdateResult.error?.message,
            fallbackError: errorUpdateResult.fallbackError?.message,
          });
        }
        return res.status(500).json({ error: 'Post-setup processing failed' });
      }
    }
    // 3. Download file
    let fileBuffer;
    let mediaType;

    console.log('[OCR] File info:', { file_url: doc.file_url, file_path: doc.file_path, file_type: doc.file_type });

    startStep('download-file');
    assertDocumentPathOwned(doc);
    const downloadResult = await downloadDocumentBinary({
      supabase,
      filePath: doc.file_path,
      fileUrl: doc.file_url,
      bucket: 'documents',
    });
    fileBuffer = downloadResult.buffer;
    mediaType = downloadResult.contentType || 'image/png';
    console.log('[OCR] Downloaded document', {
      source: downloadResult.source,
      bytes: fileBuffer.length,
      mediaType,
    });
    endStep('download-file', { bytes: fileBuffer?.length || 0, mediaType, source: downloadResult.source });

    const fileType = doc.file_type?.toLowerCase() || '';
    if (fileType === 'pdf' || mediaType.includes('pdf')) {
      mediaType = 'application/pdf';
    }

    // 4. Claude client already initialized above

    let fields;
    let extractionMethod = 'unknown';
    let allTextContent = '';

    // 5. NATIVE FORM FIELDS FIRST: Check if PDF has embedded AcroForms
    let nativeFields = null;
    let textItems = null;
    let needsAI = false;
    let hasRect = false;

    if (resumeSkipExtraction) {
      // Resume: rehydrate the (small) persisted prep outputs and skip the slow
      // extraction edge calls entirely.
      nativeFields = Array.isArray(ocrState.nativeFields) ? ocrState.nativeFields : null;
      textItems = Array.isArray(ocrState.textItems) ? ocrState.textItems : null;
      needsAI = !!ocrState.needsAI;
      hasRect = !!ocrState.hasRect;
      allTextContent = ocrState.allTextContent || '';
      console.log(`[OCR] Resume: skipping extraction — rehydrated ${textItems?.length || 0} text items, ${nativeFields?.length || 0} native fields`);
    } else if (mediaType === 'application/pdf') {
      try {
        console.log('[OCR] Checking for native PDF form fields...');
        startStep('edge-extract-form-fields');
        const extracted = await extractFormFields(fileBuffer);
        nativeFields = extracted?.fields || [];
        console.log(`[OCR] Found ${nativeFields?.length || 0} native form fields`);
        endStep('edge-extract-form-fields', { count: nativeFields?.length || 0 });
        
        // Check metadata
        if (extracted?.metadata) {
          needsAI = extracted.metadata.needsAI;
          hasRect = extracted.metadata.hasRect;
          console.log(`[OCR] Metadata: needsAI=${needsAI}, hasRect=${hasRect}`);
        }

        // Correct each field's page from the PDF itself. The form-field
        // extractor can collapse every field onto page 1 on multi-page
        // documents (its AcroForm path doesn't expose the page, and its
        // name-based backfill is unreliable) — so a field that belongs on
        // page 5 could end up rendered on the wrong page. pdf-lib exposes the
        // page each field's widget lives on via the widget's /P ref; we map
        // that to a 1-based page number and override page + position.page.
        if (nativeFields.length > 0) {
          try {
            const pageByFieldName = await resolveFieldPagesFromPdf(fileBuffer);
            if (pageByFieldName.size > 0) {
              let corrected = 0;
              for (const f of nativeFields) {
                const key = String(f.internalName || f.name || '').trim();
                const realPage = key ? pageByFieldName.get(key) : null;
                if (realPage && realPage !== (f.position?.page ?? f.page)) corrected += 1;
                if (realPage) {
                  f.page = realPage;
                  if (f.position && typeof f.position === 'object') f.position.page = realPage;
                }
              }
              console.log(`[OCR] Page correction: ${corrected}/${nativeFields.length} fields re-paged from widget /P refs`);
            }
          } catch (pageErr) {
            console.warn('[OCR] Field page correction skipped:', pageErr.message);
          }
        }
      } catch (err) {
        endStep('edge-extract-form-fields', { error: err.message });
        console.warn('[OCR] Native form field extraction failed:', err.message);
      }

      // Node-side pdfjs fallback: the edge extractor comes up empty on
      // permissions-encrypted PDFs (SSA SS-5), malformed xrefs, and widgets in
      // compressed object streams — all of which pdfjs parses fine. Without
      // this, a 63-widget government form fell through to the text-layer path
      // and produced zero fields.
      if (!nativeFields || nativeFields.length === 0) {
        try {
          const { extractWidgetAnnotations } = await import('../../lib/pdfjsWidgets.js');
          const jsFields = await extractWidgetAnnotations(fileBuffer);
          if (jsFields.length > 0) {
            nativeFields = jsFields;
            hasRect = true;
            needsAI = true; // internal names are often technical; Step-2 labeling decides per-field
            console.log(`[OCR] pdfjs widget fallback: ${jsFields.length} widgets (edge extractor found none)`);
          }
        } catch (jsErr) {
          console.warn('[OCR] pdfjs widget fallback failed:', jsErr.message);
        }
      }

      const hasNativeFields = nativeFields && nativeFields.length > 0;
      
      // If no native fields, try text extraction for field detection
      if (!hasNativeFields) {
        try {
          console.log('[OCR] Attempting text-layer extraction...');
          startStep('read-text-layer');
          textItems = await extractTextItems(fileBuffer);
          console.log(`[OCR] Extracted ${textItems?.length || 0} text items`);
          endStep('read-text-layer', { count: textItems?.length || 0 });
        } catch (err) {
          endStep('read-text-layer', { error: err.message });
          console.warn('[OCR] Text-layer extraction failed:', err.message);
        }
      } else {
        // Try to get text for AI labeling even when we have native fields
        try {
          console.log('[OCR] Extracting text for AI labeling...');
          startStep('read-text-layer');
          textItems = await extractTextItems(fileBuffer);
          if (textItems && textItems.length > 0) {
            // Get more text items to cover all pages (especially last page with signatures)
            const sampleText = textItems.slice(0, 500).map(t => 
              `Page ${t.page}: "${t.text}" at x:${t.x?.toFixed(0)}, y:${t.y?.toFixed(0)}`
            ).join('\n');
            allTextContent = sampleText;
            console.log(`[OCR] Got ${textItems.length} text items for AI context`);
          }
          endStep('read-text-layer', { count: textItems?.length || 0 });
        } catch (err) {
          endStep('read-text-layer', { error: err.message });
          console.warn('[OCR] Text extraction for AI failed:', err.message);
        }
      }
    }

    // 5b. Analyze document context for Phase 1 (single vs multi-party)
    let documentContext = (resumeSkipExtraction && ocrState.documentContext)
      ? ocrState.documentContext
      : { documentType: 'unknown', parties: [], isMultiParty: false, detectedRoles: [] };
    const fullTextContent = textItems?.slice(0, 300).map(t => t.text).join(' ') || '';

    // Extra classifier signals: file name + embedded PDF title.
    // AcroForm PDFs often extract mostly widget names, so the visible title
    // in the PDF metadata / file name is a much better signal of doc type.
    let pdfTitle = null;
    if (mediaType === 'application/pdf') {
      try {
        const { PDFDocument } = await import('pdf-lib');
        const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false, ignoreEncryption: true });
        const rawTitle = pdfDoc.getTitle?.();
        if (rawTitle && typeof rawTitle === 'string' && rawTitle.trim().length > 0) {
          pdfTitle = rawTitle.trim();
          console.log('[OCR] Embedded PDF title:', pdfTitle);
        }
      } catch (err) {
        console.warn('[OCR] Could not read embedded PDF title:', err.message);
      }
    }
    const classifierHints = { fileName: doc.file_name || null, pdfTitle };

    if (!resumeSkipExtraction && fullTextContent.length > 100) {
      console.log('[OCR] Analyzing document context...', classifierHints);
      startStep('context-analysis');
    await updateProgress(
      supabase,
      documentId,
      1,
      'Gathering context...',
      mode === 'pre_setup' ? { setStatus: false, processingStatus: 'prepping' } : undefined
    );
      documentContext = await analyzeDocumentContext(fullTextContent, anthropic, callAnthropic, classifierHints);
      console.log('[OCR] Document context:', documentContext);
      endStep('context-analysis');
    }

    // Progress: Field mapping
    await updateProgress(
      supabase,
      documentId,
      2,
      'Mapping fields...',
      mode === 'pre_setup' ? { setStatus: false, processingStatus: 'prepping' } : undefined
    );

    const canUseNativeRectPath = (nativeFields?.length || 0) > 0 && hasRect === true;

    // Slow-prep guard: extraction/context can itself eat most of the budget on
    // some documents (a small PDF whose AcroForm/text layer is pathologically
    // slow to parse). If we're already over budget right after prep, persist the
    // (small) prep outputs and hand off — the resume rehydrates them and skips
    // straight to the budget-guarded detection loop instead of re-extracting.
    if (!resumeSkipExtraction && !resumeSkipDetection && overBudget()) {
      await checkpoint({
        phase: 'detect',
        prepDone: true,
        textItems, nativeFields, needsAI, hasRect, allTextContent, documentContext,
      });
      console.log('[OCR] Prep budget hit; parked after extraction (prepDone)');
      return res.status(202).json({ inProgress: true, phase: 'detect', parked: 'post-prep' });
    }

    // A document can pass the text-layer gate (real text items) yet detect zero
    // fields — e.g. the CMS-1500 claim-form sample: the form grid is an image,
    // so the thin text layer is instruction prose only. One escalation pass
    // clears the text inputs and re-runs the branch chain so it lands on the
    // vision (or native-no-rect) branch instead of completing with nothing.
    let visionEscalated = false;
    extraction: for (;;) {
    if (resumeSkipDetection) {
      // Resuming a parked job past detection: the positioned fields were already
      // computed in a prior invocation. Rehydrate them and skip all detection
      // paths so we don't re-run (or overwrite) the expensive Claude detection.
      fields = Array.isArray(ocrState?.fields) ? ocrState.fields : [];
      extractionMethod = ocrState?.extractionMethod || extractionMethod;
      console.log(`[OCR] Resume: skipping detection, rehydrated ${fields.length} fields (phase=${resumePhase})`);
    } else if (canUseNativeRectPath) {
      // ===== HYBRID PATH: Has rect positions =====
      console.log('[OCR] Using HYBRID path (rect positions + AI labeling)');
      extractionMethod = 'hybrid';

      // Map native fields to our format
      fields = nativeFields.map((f, i) => {
        const fieldTypeMap = {
          PDFTextField: 'text',
          PDFCheckBox: 'checkbox',
          PDFDropdown: 'select',
          PDFRadioGroup: 'select',
        };

        let position = f.position;
        if (!position && f.rect) {
          const defaultPage = { width: 612, height: 792 };
          const rect = f.rect;
          position = {
            page: f.page || 1,
            x: Math.round((rect.x / defaultPage.width) * 100 * 10) / 10,
            y: Math.round(((defaultPage.height - rect.y - rect.height) / defaultPage.height) * 100 * 10) / 10,
            width: Math.round((rect.width / defaultPage.width) * 100 * 10) / 10,
            height: Math.round((rect.height / defaultPage.height) * 100 * 10) / 10,
            source: 'native-form',
          };
        }

        // All fields need AI labeling if needsAI is true (no /TU labels in PDF)
        const isPending = needsAI;

        const ts = Date.now() % 1000000;
        
        return {
          field_name: f.name || `field_${i + 1}`,
          alternatives: null,      // To be filled by AI
          explanation: null,      // To be filled by AI
          confidence: null,       // To be filled by AI
          field_type: fieldTypeMap[f.type] || f.type || 'text',
          native_value: f.value,
          options: f.options || [],
          sort_order: ts + i,  // Timestamp + index
          position,
          status: isPending ? 'pending' : 'confirmed',
          needsAI,
        };
      });

      console.log(`[OCR] Native form fields: ${fields.length} fields, running AI to clean up headers and add explanations`);

      // Run AI labeling only for fields whose native name is generic (Text1, Field2, etc.).
      // Fields with descriptive native names (e.g. "FHA_Loan_Type") skip Step 2 entirely —
      // huge cost/latency win on forms like HUD-1 where most widgets ship meaningful names.
      if (fields.length > 0) {
        const fieldsWithIndex = fields.map((f, i) => ({ ...f, position_index: i + 1 }));
        const toLabel = fieldsWithIndex.filter(f => isGenericFieldLabel(f.field_name));
        const alreadyLabeled = fieldsWithIndex.filter(f => !isGenericFieldLabel(f.field_name));
        console.log(`[OCR] Step 2: ${toLabel.length} generic fields need labeling, ${alreadyLabeled.length} already descriptive`);

        try {
          let sonnetFields = [];
          if (toLabel.length > 0) {
            sonnetFields = await runStep2FieldLabeling({
              client: anthropic,
              indexedFields: toLabel,
              fileBufferForPrompt: fileBuffer,
              includePositionContext: true,
              labelPrefix: 'hybrid-field-labels',
            });
            if (!Array.isArray(sonnetFields)) sonnetFields = [];
          }
          // Merge in already-descriptive native names so downstream steps see all fields.
          const labeledByIndex = new Map(sonnetFields.map(f => [f.position_index, f]));
          for (const f of alreadyLabeled) {
            if (!labeledByIndex.has(f.position_index)) {
              labeledByIndex.set(f.position_index, {
                position_index: f.position_index,
                field_name: f.field_name,
                position_hint: f.position_hint || '',
              });
            }
          }
          sonnetFields = [...labeledByIndex.values()].sort((a, b) => a.position_index - b.position_index);
          if (sonnetFields.length === 0) {
            sonnetFields = fields.map((f, i) => ({
              position_index: i + 1,
              field_name: f.field_name,
              position_hint: f.position_hint || '',
            }));
          }

          const humanReadableCount = sonnetFields.reduce((count, field) => (
            isGenericFieldLabel(field?.field_name) ? count : count + 1
          ), 0);
          console.log('[OCR] Step 2 labeling result', {
            totalFields: sonnetFields.length,
            humanReadableCount,
            genericCount: sonnetFields.length - humanReadableCount,
            chunkSize: STEP2_LABEL_CHUNK_SIZE,
          });

          // Merge Step 2 labels into fields. Step 3a/3b enrichment then runs in
          // the unified, budget-checkpointed block below (5c) for BOTH the hybrid
          // and text-layer paths — so a dense hybrid form (hundreds of fields) can
          // no longer run ~one Claude call per 10 fields uninterrupted past the
          // function limit. (pre_setup still skips enrichment via 5c's mode gate.)
          fields = fields.map((f, idx) => {
            const sonnetField = sonnetFields.find(sf => sf.position_index === idx + 1);
            return {
              ...f,
              field_name: sonnetField?.field_name || f.field_name,
              position_hint: sonnetField?.position_hint || f.position_hint || '',
              status: 'confirmed',
            };
          });

        } catch (aiError) {
          console.error('[OCR] AI processing error:', aiError.message);
        }

      }

      // Flat-page augmentation: a hybrid doc's fields all come from widgets, so
      // a widget-less page with plain "Label: ______" blanks (witness pages,
      // addenda in packets) contributed nothing and stayed un-fillable. Detect
      // labeled underscore runs on those pages deterministically (no AI calls)
      // and position them through the tested text-layer matcher.
      try {
        if (Array.isArray(textItems) && textItems.length > 0) {
          const extraBlankFields = detectFlatPageBlanks(fields, textItems, Date.now() % 1000000 + fields.length);
          if (extraBlankFields.length > 0) {
            fields = [...fields, ...extraBlankFields];
            console.log(`[OCR] Flat-page augmentation: +${extraBlankFields.length} text-blank fields on widget-less pages`);
          }
        }
      } catch (augErr) {
        console.warn('[OCR] Flat-page augmentation skipped:', augErr.message);
      }

    } else if (textItems && textItems.length > 0) {
      // ===== TEXT-LAYER PATH WITH PAGE BATCHING =====
      console.log('[OCR] Using TEXT-LAYER path with page batching');
      extractionMethod = 'text-layer-hybrid';

      // Helper: Get text items for a specific page range
      const getTextForPageRange = (items, startPage, endPage) => {
        return items.filter(t => t.page >= startPage && t.page <= endPage);
      };

      // Determine page range to process. Smaller batches keep each Anthropic
      // call light enough to finish within the timeout on dense documents
      // (a 3-page batch of a dense contract was overrunning the 30s cap and
      // taking the whole document's detection down to zero fields).
      const maxPage = Math.max(...textItems.map(t => t.page || 1));
      const PAGES_PER_BATCH = Number(process.env.OCR_TEXT_PAGES_PER_BATCH || 2);
      const TEXT_LAYER_TIMEOUT_MS = Number(process.env.OCR_TEXT_LAYER_TIMEOUT_MS || 60000);
      const totalBatches = Math.ceil(maxPage / PAGES_PER_BATCH);
      
      console.log(`[OCR] Document has ${maxPage} pages, processing in ${totalBatches} batches`);

      // Collect fields from all batches (seed from a parked detect checkpoint)
      let allAiFields = (resumePhase === 'detect' && Array.isArray(ocrState?.allAiFields))
        ? ocrState.allAiFields
        : [];

      try {
        // Run Step-2 field detection for a page range. Returns the parsed
        // field array (or [] if the model reply couldn't be parsed). Throws
        // only if the Anthropic call itself fails (e.g. times out), so the
        // caller can retry that range page-by-page.
        const runTextLayerRange = async (startPage, endPage, label) => {
          const rangeItems = getTextForPageRange(textItems, startPage, endPage);
          if (rangeItems.length === 0) return [];
          const formattedText = rangeItems.map(t =>
            `Page ${t.page}, x:${t.x}, y:${t.y}: "${t.text}"`
          ).join('\n');
          const response = await callAnthropic(label, () => anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 8192,
            messages: [{ role: 'user', content: buildTextLayerStep2Prompt(formattedText) }],
          }), { startPage, endPage }, TEXT_LAYER_TIMEOUT_MS);
          const aiText = response.content[0].text.trim();
          const cleanedAiText = aiText.replace(/^```json\s*/g, '').replace(/```$/g, '').trim();
          let parsed;
          try {
            parsed = JSON.parse(cleanedAiText);
          } catch {
            const jsonMatch = cleanedAiText.match(/\[[\s\S]*\]/);
            if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch { /* unparseable */ } }
          }
          return Array.isArray(parsed) ? parsed : [];
        };

        // Process each batch of pages. Each batch is isolated: if a batch's
        // Anthropic call fails (e.g. a dense batch overruns the timeout), we
        // retry it one page at a time so a single heavy page can't zero out
        // detection for the entire document.
        const batchStart = (resumePhase === 'detect' && Number.isInteger(ocrState?.nextBatch))
          ? ocrState.nextBatch
          : 0;
        for (let batchNum = batchStart; batchNum < totalBatches; batchNum++) {
          // Park progress and hand off to the worker when the soft budget is hit,
          // so a dense doc finishes across invocations instead of timing out.
          if (overBudget()) {
            await checkpoint({
              phase: 'detect', nextBatch: batchNum, allAiFields, extractionMethod: 'text-layer-hybrid',
              prepDone: true, textItems, nativeFields, needsAI, hasRect, allTextContent, documentContext,
            });
            console.log(`[OCR] Detect budget hit; parked at batch ${batchNum}/${totalBatches}`);
            return res.status(202).json({ inProgress: true, phase: 'detect', nextBatch: batchNum, totalBatches });
          }
          const startPage = batchNum * PAGES_PER_BATCH + 1;
          const endPage = Math.min((batchNum + 1) * PAGES_PER_BATCH, maxPage);
          console.log(`[OCR] Processing batch ${batchNum + 1}/${totalBatches}: pages ${startPage}-${endPage}`);
          try {
            const fields = await runTextLayerRange(startPage, endPage, `text-layer-batch-${batchNum + 1}`);
            console.log(`[OCR] Batch ${batchNum + 1}: found ${fields.length} fields`);
            allAiFields = [...allAiFields, ...fields];
          } catch (batchErr) {
            console.warn(`[OCR] Batch ${batchNum + 1} failed (${batchErr.message}); retrying page-by-page`);
            for (let pg = startPage; pg <= endPage; pg++) {
              try {
                const pgFields = await runTextLayerRange(pg, pg, `text-layer-page-${pg}`);
                console.log(`[OCR] Page ${pg} retry: found ${pgFields.length} fields`);
                allAiFields = [...allAiFields, ...pgFields];
              } catch (pgErr) {
                console.warn(`[OCR] Page ${pg} retry failed (${pgErr.message}); skipping`);
              }
            }
          }
        }

        console.log(`[OCR] Total fields found across all batches: ${allAiFields.length}`);

        // Deduplicate fields based on field_name and approximate position
        const seen = new Map();
        const deduplicatedFields = [];
        
        for (const f of allAiFields) {
          // Create a key from field name + page (for dedup)
          const key = `${f.field_name?.toLowerCase()}_${f.approx_page || 1}`;
          
          if (!seen.has(key)) {
            seen.set(key, true);
            deduplicatedFields.push(f);
          } else {
            console.log(`[OCR] Duplicate field: ${f.field_name} on page ${f.approx_page}`);
          }
        }

        console.log(`[OCR] After deduplication: ${deduplicatedFields.length} fields`);

        // Step 3: Match AI fields to actual text positions. The matcher consumes
        // each text item once, so two fields that share a label (e.g. a left
        // "Listing … Phone:" and a right "Selling … Phone:" column both reading
        // "Phone:") can't collapse onto the same coordinate. See lib/textLayerPositioning.
        fields = matchFieldsToTextItems(deduplicatedFields, textItems, Date.now() % 1000000);

      } catch (aiErr) {
        console.error('[OCR] Batched extraction failed:', aiErr.message);
        fields = [];
      }

      if (fields.length === 0 && !visionEscalated) {
        console.log('[OCR] Text-layer path found 0 fields; escalating past the text layer');
        visionEscalated = true;
        textItems = null;
        continue extraction;
      }

    } else if (nativeFields && nativeFields.length > 0) {
      // ===== NATIVE WITHOUT RECTS FALLBACK =====
      // Keep fields so Phase 1/manual setup can proceed, but do not claim rect-backed positioning.
      console.log('[OCR] Native fields found without rect positions; falling back to manual setup path');
      extractionMethod = 'native-no-rect';
      const fieldTypeMap = {
        PDFTextField: 'text',
        PDFCheckBox: 'checkbox',
        PDFDropdown: 'select',
        PDFRadioGroup: 'select',
      };
      const ts = Date.now() % 1000000;
      fields = nativeFields.map((f, i) => ({
        field_name: f.name || `field_${i + 1}`,
        alternatives: null,
        explanation: null,
        confidence: null,
        field_type: fieldTypeMap[f.type] || f.type || 'text',
        native_value: f.value,
        options: f.options || [],
        sort_order: ts + i,
        position: null,
        status: needsAI ? 'pending' : 'confirmed',
        needsAI,
      }));

      // For native-no-rect documents, still run Step 2 field-name labeling so setup
      // doesn't show raw variable names (Text123 / f1_01 / etc).
      if (fields.length > 0) {
        try {
          const indexedFields = fields.map((field, idx) => ({
            position_index: idx + 1,
            field_name: field.field_name || '',
            position_hint: field.position_hint || '',
          }));
          const labeledFields = await runStep2FieldLabeling({
            client: anthropic,
            indexedFields,
            fileBufferForPrompt: fileBuffer,
            includePositionContext: false,
            labelPrefix: 'native-no-rect-labels',
          });

          if (labeledFields.length > 0) {
            fields = fields.map((field, idx) => {
              const ai = labeledFields.find((item) => Number(item?.position_index) === idx + 1);
              return {
                ...field,
                field_name: ai?.field_name || field.field_name,
                position_hint: ai?.position_hint || field.position_hint || '',
                status: 'confirmed',
              };
            });
            const humanReadableCount = fields.reduce((count, field) => (
              isGenericFieldLabel(field?.field_name) ? count : count + 1
            ), 0);
            console.log('[OCR] native-no-rect labeling complete:', {
              totalFields: fields.length,
              labeledCount: labeledFields.length,
              humanReadableCount,
              genericCount: fields.length - humanReadableCount,
              chunkSize: STEP2_LABEL_CHUNK_SIZE,
            });
          }
        } catch (labelErr) {
          console.warn('[OCR] native-no-rect labeling failed, keeping fallback names:', labelErr.message);
        }
      }
    } else {
      // No AcroForm widgets and no text layer — e.g. a scanned PDF or an
      // XFA/dynamic form (USCIS I-485/N-400) that pdf-lib can't parse. Fall back
      // to Claude vision on rendered page images. This only runs when we would
      // otherwise return zero fields, so it can't regress working documents.
      fields = [];
      extractionMethod = 'none';

      // Preferred reliable positioning: OCR-anchored geometry. The vision model
      // names each field + its printed label text (semantics only — vision
      // coordinates proved non-deterministic), Tesseract gives exact word boxes,
      // and lib/ocrAnchor derives the writable box from that geometry. Validated
      // at ~93% in-cell on a scanned W-2 (tests/lib/ocrAnchor.test.js) vs unusable
      // vision coordinates. Gated behind a flag while serverless Tesseract
      // packaging is validated in deployment; falls back to vision-grid otherwise.
      const runOcrAnchorDetection = async () => {
        const SUPABASE_URL = serverSupabaseUrl();
        const ANON = anonKey();
        const MAX_PAGES = Number(process.env.OCR_VISION_DETECT_MAX_PAGES || 10);
        const { ocrWords } = await import('../../lib/ocrWords.js');
        const langCode = getLanguageConfig(preferredLanguage).code;
        let pageCount = Number(doc?.page_count) || 0;
        if (!pageCount) {
          try { const { PDFDocument } = await import('pdf-lib'); pageCount = (await PDFDocument.load(fileBuffer, { updateMetadata: false, ignoreEncryption: true })).getPageCount(); } catch { pageCount = 1; }
        }
        const pages = Math.min(pageCount || 1, MAX_PAGES);
        startStep('vision-ocr-anchor');
        const collected = [];
        for (let pg = 1; pg <= pages; pg += 1) {
          let image = null; let imgW = 0; let imgH = 0;
          try {
            const r = await fetch(`${SUPABASE_URL}/functions/v1/pdf-to-image`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` }, body: JSON.stringify({ pdfBase64: Buffer.from(fileBuffer).toString('base64'), pageNum: pg, scale: 2 }) });
            const jj = await r.json();
            if (jj?.success && jj.image) { image = jj.image; imgW = jj.width; imgH = jj.height; }
          } catch (e) { console.warn('[OCR] anchor render failed page', pg, e.message); }
          if (!image) continue;
          let words = [];
          try { words = await ocrWords(Buffer.from(image, 'base64')); } catch (e) { console.warn('[OCR] tesseract failed page', pg, e.message); continue; }
          if (!words.length) continue;
          let vlmFields = [];
          try {
            const resp = await callAnthropic('ocr-anchor-vlm-page-' + pg, () => anthropic.messages.create({
              model: 'claude-sonnet-4-5', max_tokens: 8192,
              messages: [{ role: 'user', content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
                { type: 'text', text: `This is page ${pg} of a form. List EVERY field a person fills in. For each return JSON {"field_name":"short English name","label_text":"the exact printed label text next to the blank, verbatim as on the form","field_type":"text|date|number|email|tel|checkbox|signature|ssn|address|select","explanation":"one short sentence on what to enter"}. "label_text" MUST literally appear on the form so it can be located. Return ONLY a JSON array.` },
              ] }],
            }), { page: pg, mode: 'ocr-anchor' }, 90000);
            vlmFields = parseJsonArray(resp?.content?.[0]?.text?.trim() || '[]');
          } catch (e) { console.warn('[OCR] anchor VLM failed page', pg, e.message); continue; }
          if (!Array.isArray(vlmFields) || !vlmFields.length) continue;
          for (const p of anchorFieldsToOcr(vlmFields, words, imgW, imgH, { page: pg })) collected.push(p);
        }
        endStep('vision-ocr-anchor', { pages, fields: collected.length });
        const ts = Date.now() % 1000000;
        return collected.map((f, i) => ({
          field_name: f.field_name || f.label_text || `field_${i + 1}`,
          field_type: f.field_type || 'text',
          explanation: f.explanation || '',
          position_hint: '',
          position: f.position || null,
          sort_order: ts + i,
          status: 'confirmed',
          ...buildTranslationColumns(langCode === 'en' ? null : langCode, f),
        }));
      };

      if (mediaType === 'application/pdf' && process.env.OCR_VISION_USE_OCR_ANCHOR === '1') {
        try {
          fields = await runOcrAnchorDetection();
          if (fields.length > 0) { extractionMethod = 'vision-ocr-anchor'; hasRect = true; }
          console.log(`[OCR] OCR-anchor detection: ${fields.length} fields`);
        } catch (anchorErr) {
          console.warn('[OCR] OCR-anchor detection failed, falling back to vision-grid:', anchorErr.message);
          fields = [];
        }
      }

      const isImageUpload = typeof mediaType === 'string' && mediaType.startsWith('image/');
      if ((mediaType === 'application/pdf' || isImageUpload) && fields.length === 0) {
        try {
          const SUPABASE_URL = serverSupabaseUrl();
          const ANON = anonKey();
          const MAX_PAGES = Number(process.env.OCR_VISION_DETECT_MAX_PAGES || 10);

          // Image uploads (a photo/scan of a form) are a single "page" — the
          // upload IS the image, so we skip pdf-to-image and feed it straight to
          // vision detection (normalized to PNG via sharp below).
          let pagesToScan = 1;
          if (!isImageUpload) {
            let pageCount = Number(doc?.page_count) || 0;
            if (!pageCount) {
              try {
                const { PDFDocument } = await import('pdf-lib');
                const pd = await PDFDocument.load(fileBuffer, { updateMetadata: false, ignoreEncryption: true });
                pageCount = pd.getPageCount();
              } catch { pageCount = 1; }
            }
            pagesToScan = Math.min(pageCount || 1, MAX_PAGES);
          }
          console.log(`[OCR] Vision field detection over ${pagesToScan} page(s)${isImageUpload ? ' (image upload)' : ''}`);
          startStep('vision-field-detection');

          const visionPrompt = buildVisionPrompt(preferredLanguage);

          // Dense forms can exceed the single-call budget (a 47-field page may
          // time out). Fallback: slice the page into horizontal stripes (fewer
          // fields per call → faster + more accurate), then remap each stripe's
          // Y back to full-page coordinates and dedupe boundary repeats. X and
          // width are unchanged because stripes span the full page width.
          const tileDetect = async (imgB64, w, h, pg) => {
            const ROWS = Math.max(2, Number(process.env.OCR_VISION_TILE_ROWS || 4));
            const OVERLAP = 0.08;
            const sharp = (await import('sharp')).default;
            const buf = Buffer.from(imgB64, 'base64');
            const found = [];
            for (let r = 0; r < ROWS; r += 1) {
              const y0 = Math.max(0, r / ROWS - (r > 0 ? OVERLAP : 0));
              const y1 = Math.min(1, (r + 1) / ROWS + (r < ROWS - 1 ? OVERLAP : 0));
              const top = Math.floor(y0 * h);
              const sliceH = Math.max(1, Math.min(h - top, Math.ceil((y1 - y0) * h)));
              let tileB64;
              try {
                tileB64 = (await sharp(buf).extract({ left: 0, top, width: w, height: sliceH }).png().toBuffer()).toString('base64');
              } catch (e) { console.warn('[OCR] tile extract failed row', r, e.message); continue; }
              const gridded = await buildGriddedImage(tileB64, w, sliceH, SUPABASE_URL, ANON);
              const promptImg = gridded || tileB64;
              const gi = gridded ? `\n\nThis slice has a faint BLUE coordinate grid (0–100 across and down). READ each field's x/y/width/height off it; the grid lines/labels are NOT fields.` : '';
              try {
                const resp = await callAnthropic(`vision-tile-${pg}-${r}`, () => anthropic.messages.create({
                  model: 'claude-sonnet-4-5', max_tokens: 8192,
                  messages: [{ role: 'user', content: [
                    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: promptImg } },
                    { type: 'text', text: `${visionPrompt}${gi}\n\nThis is a horizontal SLICE of one form page (slice ${r + 1} of ${ROWS}). Detect ONLY fields visible in this slice; all positions are % of THIS slice. Skip anything clipped at the very top or bottom edge — it belongs to an adjacent slice.` },
                  ] }],
                }), { page: pg, tile: r, mode: 'vision-tile' }, 90000);
                const parsed = parseJsonArray(resp?.content?.[0]?.text?.trim() || '[]');
                if (Array.isArray(parsed)) {
                  const span = (y1 - y0) * 100;
                  for (const f of parsed) {
                    if (!f?.field_name || !f.position) continue;
                    const p = { ...f.position };
                    p.y = y0 * 100 + ((Number(p.y) || 0) / 100) * span;
                    p.height = ((Number(p.height) || 0) / 100) * span;
                    p.page = pg;
                    found.push({ ...f, position: p, page: pg });
                  }
                }
              } catch (e) { console.warn('[OCR] tile vision failed row', r, e.message); }
            }
            // Dedupe fields caught twice in the overlap between adjacent stripes.
            const out = [];
            for (const f of found) {
              const dup = out.find((g) => g.position && f.position
                && Math.abs((g.position.x || 0) - (f.position.x || 0)) < 3
                && Math.abs((g.position.y || 0) - (f.position.y || 0)) < 2.5);
              if (!dup) out.push(f);
            }
            return out;
          };

          // Resume support: a multi-page scan that hits the soft budget parks
          // its progress (phase 'vision-detect') and is re-driven by the worker,
          // instead of being hard-killed at maxDuration with the document stuck
          // in 'processing' forever (the pre-fix failure mode for scanned docs).
          const visionStartPage = (resumePhase === 'vision-detect' && Number.isInteger(ocrState?.nextVisionPage))
            ? Math.max(1, ocrState.nextVisionPage)
            : 1;
          const collected = (resumePhase === 'vision-detect' && Array.isArray(ocrState?.visionCollected))
            ? [...ocrState.visionCollected]
            : [];
          if (visionStartPage > 1 || collected.length) {
            console.log(`[OCR] Resuming vision detection at page ${visionStartPage} with ${collected.length} field(s) collected`);
          }
          for (let pg = visionStartPage; pg <= pagesToScan; pg += 1) {
            if (overBudget()) {
              await checkpoint({
                phase: 'vision-detect', nextVisionPage: pg, visionCollected: collected,
                prepDone: true, textItems, nativeFields, needsAI, hasRect, allTextContent, documentContext,
              });
              endStep('vision-field-detection', { parked: true, nextVisionPage: pg });
              console.log(`[OCR] Vision budget hit; parked at page ${pg}/${pagesToScan}`);
              return res.status(202).json({ inProgress: true, phase: 'vision-detect', nextVisionPage: pg, pagesToScan });
            }
            let image = null;
            let imgW = 0;
            let imgH = 0;
            let imageMediaType = 'image/png';
            if (isImageUpload) {
              // The uploaded file is already an image — normalize to PNG and read
              // its dimensions (so the coordinate grid can be overlaid). Without
              // sharp, a JPEG or PNG is sent as-is (no grid).
              try {
                const vis = await toVisionImage(fileBuffer, mediaType);
                image = Buffer.from(vis.buffer).toString('base64');
                imageMediaType = vis.mediaType;
                imgW = vis.width;
                imgH = vis.height;
              } catch (imgErr) {
                console.warn('[OCR] vision-detect: image normalize failed:', imgErr.message);
              }
            } else {
              try {
                const imgRes = await fetch(`${SUPABASE_URL}/functions/v1/pdf-to-image`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` },
                  body: JSON.stringify({ pdfBase64: Buffer.from(fileBuffer).toString('base64'), pageNum: pg, scale: 2 }),
                });
                const imgJson = await imgRes.json();
                if (imgJson?.success && imgJson.image) {
                  image = imgJson.image;
                  imgW = imgJson.width;
                  imgH = imgJson.height;
                }
              } catch (imgErr) {
                console.warn('[OCR] vision-detect: render failed page', pg, imgErr.message);
              }
            }
            if (!image) continue;
            const pageStart = collected.length;

            // Overlay a coordinate grid so the model reads positions off it
            // (much tighter localization, and it stops it inventing boxes in
            // blank space). Falls back to the plain image if the grid render fails.
            const gridImage = await buildGriddedImage(image, imgW, imgH, SUPABASE_URL, ANON);
            const promptImage = gridImage || image;
            const gridInstructions = gridImage
              ? `\n\nThe page has a faint BLUE coordinate grid: vertical lines mark X% of width, horizontal lines mark Y% of height, labelled 0–100 along the top and left. READ each field's x/y/width/height off this grid for accuracy. The blue grid lines and number labels are a measurement aid — they are NOT form fields, do not extract them.`
              : '';
            try {
              const resp = await callAnthropic('vision-detect-page-' + pg, () => anthropic.messages.create({
                model: 'claude-sonnet-4-5',
                max_tokens: 8192,
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'image', source: { type: 'base64', media_type: gridImage ? 'image/png' : imageMediaType, data: promptImage } },
                      { type: 'text', text: `${visionPrompt}${gridInstructions}\n\nInclude EVERY field a person must fill in: (a) those with a visible blank, box, line, or underline, AND (b) clearly-labeled write-in areas where a printed label (e.g. "Employer's name and address", "Name:", "Date") is followed by open space for the answer even when there is no ruled line — put the box on that open space. Do NOT invent fields in UNLABELED empty/whitespace areas: if there is neither a label nor a writable mark, omit it. This is page ${pg} of ${pagesToScan}. All "page" values in position must be ${pg}.` },
                    ],
                  },
                ],
              }), { page: pg, mode: 'vision' }, 120000);
              const parsed = parseJsonArray(resp?.content?.[0]?.text?.trim() || '[]');
              if (Array.isArray(parsed)) {
                for (const f of parsed) {
                  if (!f?.field_name) continue;
                  const pos = f.position && typeof f.position === 'object' ? { ...f.position, page: pg } : null;
                  collected.push({ ...f, position: pos, page: pg });
                }
              }
            } catch (visErr) {
              console.warn('[OCR] vision-detect: page', pg, 'failed:', visErr.message);
            }

            // If the whole-page pass found nothing (dense page timed out, or the
            // model gave up), retry this page by tiling it into stripes.
            if (collected.length === pageStart) {
              console.log(`[OCR] page ${pg}: 0 fields from full-page vision — retrying with tiling`);
              try {
                const tiled = await tileDetect(image, imgW, imgH, pg);
                for (const f of tiled) collected.push(f);
                console.log(`[OCR] tiling recovered ${tiled.length} field(s) on page ${pg}`);
              } catch (tileErr) {
                console.warn('[OCR] tiling fallback failed:', tileErr.message);
              }
            }
          }

          if (collected.length > 0) {
            const ts = Date.now() % 1000000;
            const langCode = getLanguageConfig(preferredLanguage).code;
            fields = collected.map((f, i) => ({
              field_name: f.field_name || `field_${i + 1}`,
              field_type: f.field_type || 'text',
              explanation: f.explanation || '',
              position_hint: f.position_hint || '',
              position: f.position || null,
              sort_order: ts + i,
              status: 'confirmed',
              ...buildTranslationColumns(langCode === 'en' ? null : langCode, f),
            }));
            hasRect = fields.some(f => f.position);
            extractionMethod = 'vision';
          }
          endStep('vision-field-detection', { pages: pagesToScan, fields: fields.length });
          console.log(`[OCR] Vision field detection: ${fields.length} fields across ${pagesToScan} page(s)`);
        } catch (visionErr) {
          console.warn('[OCR] Vision field detection fallback failed:', visionErr.message);
          fields = [];
          extractionMethod = 'none';
        }
      }
    }
    break;
    } // extraction escalation loop

    // 5c. Unified Step 3a/3b enrichment for both the text-layer and hybrid
    // (AcroForm) paths, full mode only. Chunked + budget-checkpointed so a dense
    // doc's enrichment (≈one Claude call per 10 fields) can span invocations.
    // runStep3a/3b re-stamp results with the caller's position_index, so passing
    // global indices per chunk keeps the merge aligned. Skipped when resuming
    // straight into backfill (enrichment already completed in a prior call).
    if (mode === 'full'
      && (extractionMethod === 'text-layer-hybrid' || extractionMethod === 'hybrid')
      && fields.length > 0 && resumePhase !== 'backfill') {
      console.log(`[OCR] Running Step 3a/3b enrichment (${extractionMethod})...`);

      try {
        const preferredLang = getLanguageConfig(preferredLanguage);
        const langCode = preferredLang.code;
        // Fields per resumable slice. runStep3a/3b internally split this into
        // STEP3_CHUNK_SIZE batches and run them with bounded concurrency, so a
        // larger slice = more parallelism per invocation (and a budget checkpoint
        // between slices). 120 fields ≈ 12 concurrent chunks.
        const ENRICH_CHUNK = Number(process.env.OCR_ENRICH_CHUNK_SIZE || 120);
        const enrichStart = (resumePhase === 'enrich' && Number.isInteger(ocrState?.nextEnrichField))
          ? ocrState.nextEnrichField
          : 0;

        for (let start = enrichStart; start < fields.length; start += ENRICH_CHUNK) {
          if (overBudget()) {
            await checkpoint({ phase: 'enrich', nextEnrichField: start, fields, extractionMethod });
            console.log(`[OCR] Enrich budget hit; parked at field ${start}/${fields.length}`);
            return res.status(202).json({ inProgress: true, phase: 'enrich', done: start, total: fields.length });
          }
          const end = Math.min(start + ENRICH_CHUNK, fields.length);
          const slice = [];
          for (let i = start; i < end; i += 1) {
            slice.push({ position_index: i + 1, field_name: fields[i].field_name });
          }

          // ===== STEP 3a: English explanations =====
          let englishFields = await runStep3aExplanations(anthropic, slice, 'text-layer-explanations');
          if (!englishFields || !Array.isArray(englishFields)) {
            englishFields = slice.map((s) => ({ ...s, explanation: '', position_hint: '' }));
          }

          // ===== STEP 3b: translation (non-English only) =====
          let translatedFields = [];
          if (langCode !== 'en') {
            translatedFields = await runStep3bTranslations(
              anthropic, englishFields, preferredLang.name, langCode, 'text-layer-translation'
            );
          }

          // Merge this chunk back into fields by global position_index.
          for (let i = start; i < end; i += 1) {
            const englishField = englishFields.find((ef) => ef.position_index === i + 1);
            const translatedField = translatedFields.find((tf) => tf.position_index === i + 1);
            fields[i] = {
              ...fields[i],
              field_name: englishField?.field_name || fields[i].field_name,
              explanation: englishField?.explanation || '',
              position_hint: englishField?.position_hint || fields[i].position_hint || '',
              ...buildTranslationColumns(langCode, translatedField),
            };
          }
        }
      } catch (translationErr) {
        console.error('[OCR] Step 3a/3b failed for text-layer:', translationErr.message);
      }
    }

    // 5b. Vision label backfill (PRD §4.4): some AcroForm/XFA fields keep
    // technical names ("topmostSubform…f1_01") when the /TU tooltip is absent
    // and the position-based text match misses. Render the pages those fields
    // live on and have Claude read the visible printed label beside each box.
    // Runs in pre_setup (enterprise) AND full (personal) — personal users are
    // the least able to decode a raw "f2_01[0]", so they need humanized labels
    // most. Capped + best-effort (failures keep names); only fires when there
    // are technical/generic names left to fix, so clean docs pay nothing.
    if ((mode === 'pre_setup' || mode === 'full') && mediaType === 'application/pdf' && fields.length > 0) {
      try {
        const needs = fields
          .map((f, idx) => ({ f, idx }))
          .filter(({ f }) => f?.position?.page
            && (isGenericFieldLabel(f.field_name) || isTechnicalFieldName(f.field_name)));
        if (needs.length > 0) {
          const SUPABASE_URL = serverSupabaseUrl();
          const ANON = anonKey();
          const MAX_PAGES = Number(process.env.OCR_VISION_LABEL_MAX_PAGES || 8);
          const byPage = new Map();
          for (const item of needs) {
            const pg = Number(item.f.position.page) || 1;
            if (!byPage.has(pg)) byPage.set(pg, []);
            byPage.get(pg).push(item);
          }
          const pagesToDo = [...byPage.keys()].sort((a, b) => a - b).slice(0, MAX_PAGES);
          const pdfB64 = Buffer.from(fileBuffer).toString('base64');
          let labeled = 0;
          const renamedIdxs = [];
          startStep('vision-label-backfill');
          for (const pg of pagesToDo) {
            // Park before each page when the budget is hit. `needs`/`pagesToDo`
            // are recomputed from the current field names on resume, so already
            // humanized fields drop out and only the remaining pages are redone —
            // no per-page index to track.
            if (overBudget()) {
              await checkpoint({ phase: 'backfill', fields, extractionMethod });
              console.log(`[OCR] Backfill budget hit; parked with ${pagesToDo.length} page(s) pending`);
              return res.status(202).json({ inProgress: true, phase: 'backfill', pendingPages: pagesToDo.length });
            }
            let image = null;
            try {
              const imgRes = await fetch(`${SUPABASE_URL}/functions/v1/pdf-to-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` },
                body: JSON.stringify({ pdfBase64: pdfB64, pageNum: pg, scale: 2 }),
              });
              const imgJson = await imgRes.json();
              if (imgJson?.success && imgJson.image) image = imgJson.image;
            } catch (imgErr) {
              console.warn('[OCR] vision-label: render failed page', pg, imgErr.message);
            }
            const items = byPage.get(pg);
            const boxList = items.map((it, i) =>
              `${i + 1}. x=${(it.f.position.x ?? 0).toFixed(0)}% y=${(it.f.position.y ?? 0).toFixed(0)}% w=${(it.f.position.width ?? 0).toFixed(0)}%`
            ).join('\n');
            // Prefer a rendered image (vision via the pdf-to-image edge fn,
            // MuPDF/wasm); if rendering fails (transient CDN/wasm error, or a
            // page MuPDF can't rasterize), fall back to the page's extracted
            // text-with-positions so we can still infer labels.
            const pageText = Array.isArray(textItems)
              ? textItems.filter(t => (t.page || 1) === pg).slice(0, 260)
              : [];
            let content = null;
            let modelLabel = '';
            if (image) {
              content = [
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
                { type: 'text', text: `This is page ${pg} of a form. Below are ${items.length} blank fields a person fills in, with approximate positions (percent of page, origin top-left):\n${boxList}\n\nFor each numbered field, read the form image and return the SHORT human label for what belongs in that blank — use the visible printed label nearest the blank (e.g. "Last name", "Date of birth", "Signature", "City"). Return ONLY a JSON array: [{"n":1,"label":"…"}]. Use "" if you can't tell.` },
              ];
              modelLabel = `vision-label-page-${pg}`;
            } else if (pageText.length > 0) {
              const textBlock = pageText.map(t =>
                `"${String(t.text || '').slice(0, 60)}" @ x=${(t.x ?? 0).toFixed(0)}% y=${(t.y ?? 0).toFixed(0)}%`
              ).join('\n');
              content = [{ type: 'text', text: `Page ${pg} of a form. VISIBLE TEXT with positions (percent, origin top-left):\n${textBlock}\n\nBLANK FIELDS to label, with positions:\n${boxList}\n\nFor each numbered field, return the SHORT human label of what belongs in that blank — the visible printed label nearest/left-of/above the blank (e.g. "Last name", "Date of birth", "City", "Signature"). Return ONLY a JSON array: [{"n":1,"label":"…"}]. Use "" if unsure.` }];
              modelLabel = `text-label-page-${pg}`;
            } else {
              continue;
            }
            try {
              const resp = await callAnthropic(modelLabel, () => anthropic.messages.create({
                model: image ? 'claude-sonnet-4-5' : 'claude-haiku-4-5',
                max_tokens: 1500,
                messages: [{ role: 'user', content }],
              }), { page: pg, fields: items.length, mode: image ? 'vision' : 'text' }, 45000);
              const text = (resp?.content?.[0]?.text || '').trim();
              const match = text.match(/\[[\s\S]*\]/);
              if (!match) continue;
              const arr = JSON.parse(match[0]);
              for (const r of arr) {
                const n = Number(r?.n);
                const lbl = String(r?.label || '').trim();
                if (n >= 1 && n <= items.length && lbl && lbl.length <= 80) {
                  fields[items[n - 1].idx].field_name = lbl;
                  renamedIdxs.push(items[n - 1].idx);
                  labeled += 1;
                }
              }
            } catch (visErr) {
              console.warn('[OCR] label backfill: page', pg, 'failed:', visErr.message);
            }
          }
          endStep('vision-label-backfill', { needed: needs.length, labeled, pages: pagesToDo.length });
          console.log(`[OCR] Vision label backfill: labeled ${labeled}/${needs.length} technical fields across ${pagesToDo.length} page(s)`);

          // Re-explain + re-translate the fields we just renamed. Their original
          // explanation/translation were derived from opaque names (f2_01[0]),
          // which made Step 3a/3b mis-index on dense forms — the explanation and
          // the translated label ended up describing the wrong field. Re-running
          // on the now-humanized names makes label, explanation, and translation
          // all agree. Full mode only (pre_setup explains later, in post_setup).
          if (mode === 'full' && renamedIdxs.length > 0) {
            try {
              const reLang = getLanguageConfig(preferredLanguage);
              const reCode = reLang.code === 'en' ? null : reLang.code;
              const sortedRenamed = [...renamedIdxs].sort((a, b) => a - b);
              const reInput = sortedRenamed.map((i) => ({
                position_index: i + 1,
                field_name: fields[i].field_name,
                explanation: fields[i].explanation || '',
                position_hint: fields[i].position_hint || '',
              }));
              const reEng = await runStep3aExplanations(anthropic, reInput, 'backfill-reexplain');
              const engByIdx = new Map((reEng || []).map((e) => [e.position_index, e]));
              for (const i of sortedRenamed) {
                const e = engByIdx.get(i + 1);
                if (e) {
                  fields[i].explanation = e.explanation || fields[i].explanation || '';
                  fields[i].position_hint = e.position_hint || fields[i].position_hint || '';
                }
              }
              if (reCode) {
                const reText = sortedRenamed.map((i) => ({
                  position_index: i + 1,
                  field_name: fields[i].field_name,
                  explanation: fields[i].explanation || '',
                  position_hint: fields[i].position_hint || '',
                }));
                const reTr = await runStep3bTranslations(anthropic, reText, reLang.name, reLang.code, 'backfill-retranslate');
                const trByIdx = new Map((reTr || []).map((t) => [t.position_index, t]));
                for (const i of sortedRenamed) {
                  const t = trByIdx.get(i + 1);
                  if (t) Object.assign(fields[i], buildTranslationColumns(reCode, t));
                }
              }
              console.log(`[OCR] Re-explained/translated ${renamedIdxs.length} humanized field(s) for alignment`);
            } catch (reErr) {
              console.warn('[OCR] Post-backfill re-explain/translate skipped:', reErr.message);
            }
          }
        }
      } catch (backfillErr) {
        console.warn('[OCR] Vision label backfill skipped:', backfillErr.message);
      }
    }

    // 6. Save fields to database
    if (fields.length > 0) {
      // Snapshot user-entered values BEFORE the delete-all so a re-run (retry
      // button, worker resume) doesn't wipe what the user already typed. Values
      // are re-applied to the new rows by (name, page) identity below.
      let valueSnapshot = null;
      try {
        const { data: existingRows } = await supabase
          .from('fields')
          .select('field_name, field_value, position')
          .eq('document_id', documentId)
          .not('field_value', 'is', null);
        if (existingRows?.length) valueSnapshot = buildValueSnapshot(existingRows);
      } catch (snapErr) {
        console.warn('[OCR] value snapshot skipped:', snapErr.message);
      }

      // Delete ALL fields for this document first to avoid any constraint issues
      console.log('[OCR] Deleting all fields for document:', documentId);
      startStep('db-delete-fields');
      await supabase.from('fields').delete().eq('document_id', documentId);
      endStep('db-delete-fields');
      
      // Wait for delete to fully complete
      await new Promise(r => setTimeout(r, 500));

      // Deterministic checkbox/radio handling from the PDF's authoritative widget
      // export values (pdf-lib getOnValue). Two fixes:
      //  1. Re-type any field that sits on a real checkbox/radio widget to
      //     'checkbox' — the AcroForm extractor mis-types one side of a Yes/No
      //     radio pair as 'text', so the "No" box wasn't tickable.
      //  2. For radio groups, label each option from its export value and pair
      //     them under one question base (so both Yes AND No are selectable and
      //     belong together), instead of the AI's per-box guess.
      if (extractionMethod === 'hybrid' && mediaType === 'application/pdf') {
        try {
          const widgetExports = await extractCheckboxWidgetExports(fileBuffer);
          // Persist a compact debug summary so the real widget structure is
          // inspectable (which widgets/export values pdf-lib actually found).
          doc.phase1_data = { ...(doc.phase1_data || {}), ocrCheckboxDebug: widgetExports.slice(0, 80) };

          // Match each field to its widget (tight tolerance) and group by radio group.
          const groups = new Map();
          const claimedWidgets = new Set();
          let matched = 0;
          for (const f of fields) {
            const w = matchWidget(f, widgetExports, 1.2);
            if (!w) continue;
            matched += 1;
            claimedWidgets.add(w);
            const key = w.groupName || `__${w.page}_${Math.round(w.y)}_${Math.round(w.x)}`;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ field: f, widget: w });
          }

          // Option label for a radio widget: its export value when it's a real
          // token; PDF authors often use bare indices ('0','1','2'), where the
          // printed text just right of the box is the only human name.
          const optionLabel = (widget) => {
            const opt = displayOption(widget.exportValue);
            if (opt && !/^\d+$/.test(opt)) return opt;
            if (Array.isArray(textItems)) {
              let best = null;
              const wEnd = widget.x + (widget.w || 2);
              for (const t of textItems) {
                if ((t.page || 1) !== widget.page) continue;
                if (Math.abs((t.y || 0) - widget.y) > 1.6) continue;
                const tx = t.x || 0;
                if (tx < wEnd - 0.5 || tx - wEnd > 8) continue;
                if (!best || tx < (best.x || 0)) best = t;
              }
              const word = String(best?.text || '').trim().split(/\s{2,}/)[0].trim();
              if (word && word.length <= 30) return word;
            }
            return opt; // may be a bare index; still better than nothing
          };

          let retyped = 0;
          let relabeled = 0;
          const optionClones = [];
          for (const [, members] of groups) {
            const isRadio = members.some((m) => m.widget.fieldKind === 'radio');
            // One question base per radio group: the longest non-empty stripped name.
            let base = '';
            if (isRadio) {
              for (const m of members) {
                const s = stripOptionToken(m.field.field_name);
                if (s.length > base.length) base = s;
              }
            }
            for (const { field, widget } of members) {
              if (field.field_type !== 'checkbox') { field.field_type = 'checkbox'; retyped += 1; }
              // Only relabel radio options (a standalone checkbox's on-value is a
              // generic "Yes" and isn't a real option).
              if (widget.fieldKind === 'radio') {
                const opt = optionLabel(widget);
                if (opt) {
                  const want = base ? `${base} - ${opt}` : (field.field_name || opt);
                  if (want !== field.field_name) { field.field_name = want; relabeled += 1; }
                }
              }
            }
            // A radio GROUP is one AcroForm field with one widget per option, but
            // the extractor emits one field at the FIRST widget's rect — every
            // other option was invisible and un-tickable. Clone the group's field
            // onto each unclaimed sibling widget so each option gets its own box.
            if (isRadio) {
              const groupName = members[0].widget.groupName;
              const template = members[0].field;
              for (const w of widgetExports) {
                if (w.fieldKind !== 'radio' || w.groupName !== groupName || claimedWidgets.has(w)) continue;
                claimedWidgets.add(w);
                const opt = optionLabel(w);
                optionClones.push({
                  ...template,
                  field_name: base && opt ? `${base} - ${opt}` : (opt || `${template.field_name} (option)`),
                  field_type: 'checkbox',
                  position: { page: w.page, x: w.x, y: w.y, width: w.w || 2.5, height: w.h || 2, source: 'acroform' },
                });
              }
            }
          }
          if (optionClones.length) fields.push(...optionClones);
          console.log(`[OCR] checkbox widgets: ${widgetExports.length}, matched ${matched}, retyped→checkbox ${retyped}, relabeled ${relabeled}, radio options expanded ${optionClones.length}`);
        } catch (cbErr) {
          console.warn('[OCR] checkbox handling skipped:', cbErr.message);
        }
      }

      // Order fields in document reading order (page → top-to-bottom → left-to-
      // right) before assigning sort_order, instead of raw extraction order. The
      // AcroForm extractor appends checkbox/annotation widgets AFTER all text
      // fields, which otherwise dumps every checkbox at the bottom of the list
      // regardless of where it actually sits on the page (e.g. the "Loan Type"
      // boxes at the top of page 1). Fields without a position sort last, stably.
      const readingOrderKey = (f) => {
        const p = (f && f.position) || {};
        return {
          page: Number(p.page) || 999,
          y: typeof p.y === 'number' ? p.y : 9999,
          x: typeof p.x === 'number' ? p.x : 9999,
        };
      };
      fields = fields
        .map((f, i) => ({ f, i }))
        .sort((a, b) => {
          const ka = readingOrderKey(a.f);
          const kb = readingOrderKey(b.f);
          return (ka.page - kb.page) || (ka.y - kb.y) || (ka.x - kb.x) || (a.i - b.i);
        })
        .map((e) => e.f);

      const timestamp = Date.now() % 1000000; // Keep it within integer range

      const fieldsToInsert = fields.map((field, index) => {
        // Use timestamp + index to ensure uniqueness
        const sortOrder = timestamp + index;

        return {
          document_id: documentId,
          field_name: field.field_name,
          field_type: field.field_type || 'text',
          explanation: field.explanation || '',
          position_hint: field.position_hint || '',
          ...pickTranslationColumns(field),
          sort_order: sortOrder,
          position: field.position || null,
        };
      });
      
      console.log('[OCR] First 5 sort_orders:', fieldsToInsert.slice(0, 5).map(f => f.sort_order));

      if (valueSnapshot) {
        const { restored } = applyPreservedValues(fieldsToInsert, valueSnapshot);
        if (restored) console.log(`[OCR] Restored ${restored} user-entered value(s) across re-run`);
      }

      startStep('db-insert-fields');
      const { error: insertError } = await supabase
        .from('fields')
        .insert(fieldsToInsert);
      endStep('db-insert-fields', { count: fieldsToInsert.length });

      if (insertError) {
        console.error('Error inserting fields:', insertError);
        throw insertError;
      }
    }

    // A PDF that yielded ZERO fields, ZERO text, and nothing from the vision
    // fallback, and whose bytes carry an /Encrypt dictionary, is almost surely
    // protected by a user password (owner-password-only PDFs still open and
    // extract normally). "Completed" with an empty field list reads as a bug —
    // fail with an actionable message instead.
    if (
      fields.length === 0
      && mediaType === 'application/pdf'
      && fileBuffer && fileBuffer.includes('/Encrypt')
      && !(textItems && textItems.length)
    ) {
      const err = new Error('This PDF is password-protected and cannot be read. Please remove the password (for example, print/save it as a new PDF) and upload it again.');
      err.errorCode = 'encrypted_pdf';
      throw err;
    }

    const finalStatus = mode === 'full' ? 'completed' : 'ready';

    if (mode === 'pre_setup') {
      const positionSources = {};
      for (const f of fields) {
        const src = f.position?.source || 'none';
        positionSources[src] = (positionSources[src] || 0) + 1;
      }

      if (documentId) {
        console.log('[OCR] Status update:', { documentId, status: finalStatus });
        startStep('db-update-document');
        const setupRequiredResult = await updateDocumentsStrict(
          supabase,
          documentId,
          {
            lifecycle_status: 'setup_required',
            processing_status: 'idle',
            has_rect: canUseNativeRectPath,
            phase1_data: {
              ...(doc?.phase1_data || {}),
              documentType: documentContext.documentType,
              parties: documentContext.parties,
              isMultiParty: documentContext.isMultiParty,
              detectedRoles: documentContext.detectedRoles,
              // If this doc was resumed, retire its ocr checkpoint so the worker
              // stops adopting it. Absent for docs that never parked.
              ...(doc?.phase1_data?.ocr ? { ocr: { phase: 'done', mode, updatedAt: new Date().toISOString() } } : {}),
            },
          },
          {
            label: 'pre-setup document update',
            context: { mode: 'pre_setup' },
          }
        );
        if (!setupRequiredResult.success) {
          console.warn('[OCR] Failed to persist setup_required document state', {
            documentId,
            error: setupRequiredResult.error?.message,
            fallbackError: setupRequiredResult.fallbackError?.message,
          });
        }
        endStep('db-update-document', { status: finalStatus });
      }

      const clearResult = await clearProgress(supabase, documentId, finalStatus, {
        setStatus: false,
        processingStatus: 'idle',
      });
      if (!clearResult.success) {
        console.warn('[OCR] Pre-setup clearProgress failed', {
          documentId,
          error: clearResult.error?.message,
          fallbackError: clearResult.fallbackError?.message,
        });
      }

      return res.status(200).json({
        success: true,
        fields,
        fieldsCount: fields.length,
        extractionMethod,
        positionSources,
        metadata: {
          confirmedCount: fields.filter(f => f.status === 'confirmed').length,
          pendingCount: fields.filter(f => f.status === 'pending').length,
        },
        documentContext,
      });
    }

    // 7. Update document status, has_rect, and context
    if (documentId) {
      console.log('[OCR] Status update:', { documentId, status: finalStatus });
      const updateData = {
        status: finalStatus,
        has_rect: canUseNativeRectPath,
        // Mirror the classification into the real columns — chat grounding
        // (lib/chatContext) reads documents.document_type/is_multi_party and
        // previously always saw 'unknown' because only phase1_data was written.
        document_type: documentContext.documentType || null,
        is_multi_party: !!documentContext.isMultiParty,
        phase1_data: {
          ...(doc?.phase1_data || {}),
          documentType: documentContext.documentType,
          parties: documentContext.parties,
          isMultiParty: documentContext.isMultiParty,
          detectedRoles: documentContext.detectedRoles,
          // Persist how fields were detected so the viewer can show the
          // extraction-method badge after a reload (no column needed).
          extractionMethod,
          // If this doc was resumed, retire its ocr checkpoint so the worker
          // stops adopting it. Absent for docs that never parked.
          ...(doc?.phase1_data?.ocr ? { ocr: { phase: 'done', mode, updatedAt: new Date().toISOString() } } : {}),
        },
      };
      if (mode === 'full') {
        updateData.lifecycle_status = 'completed';
      }
      startStep('db-update-document');
      const documentUpdateResult = await updateDocumentsStrict(
        supabase,
        documentId,
        updateData,
        {
          label: 'final document update',
          context: { mode },
        }
      );
      if (!documentUpdateResult.success) {
        console.warn('[OCR] Failed to persist final document state', {
          documentId,
          error: documentUpdateResult.error?.message,
          fallbackError: documentUpdateResult.fallbackError?.message,
        });
      }
      endStep('db-update-document', { status: finalStatus });
    }

    // 8. Release queued sessions (send email or mark pending)
    if (mode === 'full') {
      startStep('db-release-queued-sessions');
      const queuedCount = await releaseQueuedSessions({
        supabase,
        documentId,
        documentName: doc.file_name,
      });
      endStep('db-release-queued-sessions', { count: queuedCount });
    }

    const positionSources = {};
    for (const f of fields) {
      const src = f.position?.source || 'none';
      positionSources[src] = (positionSources[src] || 0) + 1;
    }

    // Mark complete
    if (mode === 'pre_setup') {
      const clearResult = await clearProgress(supabase, documentId, finalStatus);
      if (!clearResult.success) {
        console.warn('[OCR] Pre-setup final clearProgress failed', {
          documentId,
          error: clearResult.error?.message,
          fallbackError: clearResult.fallbackError?.message,
        });
      }
    } else {
      const completeProgressResult = await updateProgress(supabase, documentId, 5, 'Complete!');
      if (!completeProgressResult.success) {
        console.warn('[OCR] Final completion progress update failed', {
          documentId,
          error: completeProgressResult.error?.message,
          fallbackError: completeProgressResult.fallbackError?.message,
        });
      }

      const clearResult = await clearProgress(supabase, documentId, finalStatus);
      if (!clearResult.success) {
        console.warn('[OCR] Final clearProgress failed', {
          documentId,
          error: clearResult.error?.message,
          fallbackError: clearResult.fallbackError?.message,
        });
      }
    }

    return res.status(200).json({
      success: true,
      fields,
      fieldsCount: fields.length,
      extractionMethod,
      positionSources,
      metadata: {
        confirmedCount: fields.filter(f => f.status === 'confirmed').length,
        pendingCount: fields.filter(f => f.status === 'pending').length,
      },
      documentContext,
    });
  } catch (error) {
    console.error('OCR error:', error);

    if (documentId) {
      console.log('[OCR] Status update: error', { documentId });
      if (mode === 'full') {
        const errorUpdateResult = await updateDocumentsStrict(
          supabase,
          documentId,
          { status: 'error', processing_status: 'error', metadata: null },
          {
            label: 'error document update',
            context: { mode: 'full' },
          }
        );
        if (!errorUpdateResult.success) {
          console.warn('[OCR] Failed to persist full-mode error state', {
            documentId,
            error: errorUpdateResult.error?.message,
            fallbackError: errorUpdateResult.fallbackError?.message,
          });
        }
      } else {
        const errorUpdateResult = await updateDocumentsStrict(
          supabase,
          documentId,
          { processing_status: 'error', metadata: null },
          {
            label: 'error document update',
            context: { mode },
          }
        );
        if (!errorUpdateResult.success) {
          console.warn('[OCR] Failed to persist non-full error state', {
            documentId,
            error: errorUpdateResult.error?.message,
            fallbackError: errorUpdateResult.fallbackError?.message,
          });
        }
      }
    }

    console.error('[OCR] Full error:', error);
    if (documentId) {
      if (mode === 'full') {
        const clearResult = await clearProgress(supabase, documentId, 'error');
        if (!clearResult.success) {
          console.warn('[OCR] Error clearProgress failed', {
            documentId,
            error: clearResult.error?.message,
            fallbackError: clearResult.fallbackError?.message,
          });
        }
      } else {
        const clearResult = await clearProgress(supabase, documentId, 'error', { setStatus: false, processingStatus: 'error' });
        if (!clearResult.success) {
          console.warn('[OCR] Error clearProgress failed', {
            documentId,
            error: clearResult.error?.message,
            fallbackError: clearResult.fallbackError?.message,
          });
        }
      }
    }
    if (error instanceof DocumentSourceNotAllowedError) {
      // The refusal's reason and details (host, address, URL) are for the
      // server log only; the caller gets a fixed message.
      console.warn('[OCR] Document source not allowed', { documentId, reason: error.message, details: error.details });
      return res.status(422).json({
        error: 'Document source not allowed',
        errorCode: error.errorCode,
        message: DOCUMENT_SOURCE_NOT_ALLOWED_MESSAGE,
      });
    }
    if (error?.errorCode === 'encrypted_pdf') {
      return res.status(422).json({
        error: 'Encrypted PDF',
        errorCode: 'encrypted_pdf',
        message: error.message,
      });
    }
    return res.status(500).json({
      error: 'OCR processing failed',
      errorCode: 'ocr_processing_failed',
    });
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
  // OCR runs many sequential Claude calls; dense forms (e.g. HUD-1) exceed 60s
  // and get killed mid-run, leaving the doc stuck in "prepping". 300s is the
  // Vercel Pro ceiling (Fluid Compute allows more). Requires a Pro plan to take
  // effect — on Hobby this is clamped to the plan limit.
  maxDuration: 300,
};
