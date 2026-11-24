/**
 * PDF Text Layer Extraction
 * Extracts text items with precise positions from a PDF's text layer.
 * Used to find exact label positions and compute writable field areas.
 *
 * The text layer is read in the app's own process with pdfjs-dist
 * (lib/pdfjsTextItems.js). Native form fields still come from the Supabase
 * Edge Function `extract-form-fields`.
 */

import { serverSupabaseUrl, anonKey } from './supabaseEnv.js';
import { extractTextItemsInProcess } from './pdfjsTextItems.js';

/**
 * Extract native PDF form fields (AcroForms) from a PDF buffer.
 * Calls the Supabase Edge Function `extract-form-fields`.
 */
export async function extractFormFields(pdfBuffer) {
  const SUPABASE_URL = serverSupabaseUrl();
  const SUPABASE_ANON_KEY = anonKey();
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars');
  }

  const base64 = Buffer.from(
    pdfBuffer instanceof ArrayBuffer ? pdfBuffer : pdfBuffer
  ).toString('base64');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-form-fields`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ pdfBase64: base64 }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Edge function failed (${response.status}): ${errText}`);
  }

  const data = await response.json();

  console.log('[pdfTextExtraction] Edge function response:', JSON.stringify(data));

  if (!data.success) {
    throw new Error(data.error || 'Failed to extract form fields');
  }

  console.log(`[pdfTextExtraction] Extracted ${data.count} native form fields`);
  return {
    fields: data.fields,
    metadata: data.metadata,
  };
}

/**
 * Extract all text items with positions from a PDF buffer.
 * Reads the text layer in-process with pdfjs-dist; lib/pdfjsTextItems.js
 * describes the shape of each item.
 */
export async function extractTextItems(pdfBuffer) {
  const items = await extractTextItemsInProcess(pdfBuffer);
  console.log(`[pdfTextExtraction] Extracted ${items.length} text items in-process`);
  return items;
}

/**
 * Normalize a string for matching: lowercase, keep alphanumeric + spaces.
 */
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Check if a text item looks like it contains a field label with underscores
 * (e.g., "Contract Title: ____________________________")
 */
function hasUnderscores(text) {
  return /_{3,}/.test(text);
}

/**
 * Extract just the label portion before underscores or colon.
 * "Contract Title: ____________________________" → "Contract Title"
 * "Party 1 (Name): ____________________________" → "Party 1 (Name)"
 */
function extractLabelPart(text) {
  // Remove underscores and everything after
  let label = text.replace(/_{3,}.*$/, '').trim();
  // Remove trailing colon
  label = label.replace(/:$/, '').trim();
  return label;
}

/**
 * Find the best matching text label for a field name.
 * Much smarter matching that handles:
 *   - "Party A" vs "Party 1", "Party B" vs "Party 2"
 *   - Labels with underscores (inline fields)
 *   - Section headers (block fields)
 */
export function matchFieldToLabel(fieldName, textItems, page = null) {
  const candidates = page
    ? textItems.filter(t => t.page === page)
    : textItems;

  if (candidates.length === 0) return null;

  const fieldNorm = normalize(fieldName);

  let bestMatch = null;
  let bestScore = 0;

  for (const item of candidates) {
    if (item.text === '●' || item.text === '•') continue; // skip bullets

    const itemNorm = normalize(item.text);
    const labelPart = normalize(extractLabelPart(item.text));
    if (!itemNorm || !labelPart) continue;

    let score = 0;

    // 1. Exact label match (highest priority)
    if (labelPart === fieldNorm) {
      score = 1.0;
    }
    // 2. Label contains field name or vice versa
    else if (labelPart.includes(fieldNorm) || fieldNorm.includes(labelPart)) {
      score = 0.9;
    }
    // 3. Smart A/B ↔ 1/2 equivalence
    //    "party a" should match "party 1", "party b" should match "party 2"
    else {
      const fieldSwapped = fieldNorm
        .replace(/\bparty\s*a\b/, 'party 1')
        .replace(/\bparty\s*b\b/, 'party 2')
        .replace(/\ba\b$/, '1')
        .replace(/\bb\b$/, '2');

      if (labelPart === fieldSwapped || labelPart.includes(fieldSwapped) || fieldSwapped.includes(labelPart)) {
        score = 0.95;
      }
      // Also check reverse: field says "1" but label says "A"
      const fieldSwappedReverse = fieldNorm
        .replace(/\bparty\s*1\b/, 'party a')
        .replace(/\bparty\s*2\b/, 'party b')
        .replace(/\b1\b$/, 'a')
        .replace(/\b2\b$/, 'b');

      if (labelPart === fieldSwappedReverse || labelPart.includes(fieldSwappedReverse) || fieldSwappedReverse.includes(labelPart)) {
        score = Math.max(score, 0.95);
      }
    }

    // 4. Word overlap scoring for partial matches
    if (score === 0) {
      const fieldWords = fieldNorm.split(' ').filter(w => w.length >= 3);
      const labelWords = labelPart.split(' ').filter(w => w.length >= 3);
      if (fieldWords.length > 0 && labelWords.length > 0) {
        const matches = fieldWords.filter(fw => labelWords.some(lw => lw.includes(fw) || fw.includes(lw)));
        const overlap = matches.length / Math.max(fieldWords.length, 1);
        if (overlap >= 0.3 && matches.length >= 1) {
          score = 0.5 + overlap * 0.3; // 0.5 - 0.8
        }
      }
    }

    // Minimum threshold — must be a reasonable match
    if (score > bestScore && score >= 0.6) {
      bestScore = score;
      bestMatch = { ...item, score };
    }
  }

  // Also try concatenated neighboring items on same line
  if (bestScore < 0.8) {
    const byLine = {};
    for (const item of candidates) {
      if (item.text === '●' || item.text === '•') continue;
      const key = `${item.page}-${Math.round(item.y * 2)}`; // group by ~0.5% y tolerance
      if (!byLine[key]) byLine[key] = [];
      byLine[key].push(item);
    }

    for (const items of Object.values(byLine)) {
      if (items.length < 2) continue;
      items.sort((a, b) => a.x - b.x);
      const combined = items.map(i => i.text).join(' ').trim();
      const combinedLabel = normalize(extractLabelPart(combined));

      let score = 0;
      if (combinedLabel === fieldNorm || combinedLabel.includes(fieldNorm) || fieldNorm.includes(combinedLabel)) {
        score = 0.85;
      }

      if (score > bestScore && score >= 0.6) {
        bestScore = score;
        bestMatch = {
          ...items[0],
          text: combined,
          score,
          combinedWidth: items.reduce((s, i) => s + i.width, 0),
        };
      }
    }
  }

  return bestMatch;
}

/**
 * Compute where the writable area is for a matched label.
 *
 * Strategy:
 *   - If the label TEXT itself contains underscores (e.g., "Name: _____"),
 *     the writable area is ON those underscores (inline field).
 *   - If the label is a section header with no underscores,
 *     the writable area is on the next blank line below.
 */
export function computeWritablePosition(label, textItems) {
  const page = label.page;
  const pageItems = textItems.filter(t => t.page === page && t.text !== '●' && t.text !== '•');
  pageItems.sort((a, b) => a.y - b.y || a.x - b.x);

  const lineHeight = label.height || 1.5;
  const labelY = label.y;

  // CASE 1: Label contains underscores — inline field
  // e.g., "Party 1 (Name): ____________________________"
  // The writable area is ON those underscores
  if (hasUnderscores(label.text)) {
    const labelPart = extractLabelPart(label.text);
    // Estimate where the label text ends and underscores begin
    const labelTextRatio = labelPart.length / label.text.replace(/_{3,}/g, '').trim().length || 0.5;
    const labelTextWidth = (label.combinedWidth || label.width) * Math.min(labelTextRatio + 0.05, 0.6);
    const writableX = label.x + labelTextWidth;

    return {
      page,
      x: Math.round(writableX * 10) / 10,
      y: Math.round((labelY - lineHeight * 0.15) * 10) / 10,
      width: Math.round(Math.min(95 - writableX, 50) * 10) / 10,
      height: Math.round((lineHeight * 1.8) * 10) / 10,
      source: 'text-layer',
    };
  }

  // CASE 2: Label is a header/section — block field
  // e.g., "Scope of Work or Purpose:" with blank lines below
  // Find the next text item below this label
  const nextBelow = pageItems.find(t => t.y > labelY + lineHeight * 0.5);
  const gapBelow = nextBelow ? nextBelow.y - labelY : lineHeight * 4;

  return {
    page,
    x: Math.round(Math.max(label.x, 5) * 10) / 10,
    y: Math.round((labelY + lineHeight * 1.2) * 10) / 10,
    width: Math.round(Math.min(85 - label.x, 65) * 10) / 10,
    height: Math.round(Math.max(gapBelow - lineHeight * 1.5, lineHeight * 2) * 10) / 10,
    source: 'text-layer',
  };
}

/**
 * Check if extracted text items constitute a valid text layer.
 * If there are fewer than 5 items, likely a scanned/image PDF.
 */
export function hasTextLayer(textItems) {
  return textItems && textItems.length >= 5;
}

/**
 * Format text items as structured text for Claude to analyze.
 * Groups by page, includes coordinates so Claude can reference them.
 */
export function formatTextForClaude(textItems) {
  const byPage = {};
  for (const item of textItems) {
    if (!byPage[item.page]) byPage[item.page] = [];
    byPage[item.page].push(item);
  }

  let output = '';
  for (const page of Object.keys(byPage).sort((a, b) => a - b)) {
    const items = byPage[page].sort((a, b) => a.y - b.y || a.x - b.x);
    output += `\n--- PAGE ${page} ---\n`;
    for (const item of items) {
      const text = item.text.trim();
      if (!text) continue;
      output += `"${text}" at (x:${item.x.toFixed(1)}%, y:${item.y.toFixed(1)}%, w:${item.width.toFixed(1)}%, h:${item.height.toFixed(1)}%)\n`;
    }
  }
  return output;
}

/**
 * Match Claude-identified fields to text items and assign precise positions.
 * Uses the existing matchFieldToLabel + computeWritablePosition logic.
 */
export function matchFieldsToTextItems(fields, textItems) {
  const usedItems = new Set();

  return fields.map(field => {
    if (!field.field_name) return field;

    const label = matchFieldToLabel(field.field_name, textItems);
    if (!label) {
      return {
        ...field,
        position: { page: 1, x: 10, y: 10, width: 40, height: 3, source: 'ai-estimated' },
      };
    }

    const labelKey = `${label.page}-${label.x.toFixed(1)}-${label.y.toFixed(1)}`;
    if (usedItems.has(labelKey)) {
      const remaining = textItems.filter(t => {
        const k = `${t.page}-${t.x.toFixed(1)}-${t.y.toFixed(1)}`;
        return !usedItems.has(k);
      });
      const altLabel = matchFieldToLabel(field.field_name, remaining);
      if (altLabel) {
        const altKey = `${altLabel.page}-${altLabel.x.toFixed(1)}-${altLabel.y.toFixed(1)}`;
        usedItems.add(altKey);
        return { ...field, position: computeWritablePosition(altLabel, textItems) };
      }
      return {
        ...field,
        position: field.position ? { ...field.position, source: 'ai-estimated' } : null,
      };
    }

    usedItems.add(labelKey);
    return { ...field, position: computeWritablePosition(label, textItems) };
  });
}

/**
 * Refine existing fields with text-layer positions when available.
 * Falls back to existing positions if the PDF has no usable text layer.
 */
export async function refineFieldPositions(pdfBuffer, fields) {
  const textItems = await extractTextItems(pdfBuffer);
  if (!hasTextLayer(textItems)) {
    return fields.map(field => ({
      ...field,
      position: field.position ? { ...field.position, source: field.position.source || 'ai-estimated' } : null,
    }));
  }

  return matchFieldsToTextItems(fields, textItems).map(field => ({
    ...field,
    position: field.position ? { ...field.position, source: 'text-layer' } : null,
  }));
}
