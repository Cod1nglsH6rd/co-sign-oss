/**
 * Text-layer field positioning (non-AcroForm docs).
 *
 * For PDFs with no real form-field rectangles we infer where each blank is by
 * matching the AI-detected label text against the extracted text layer. Pulled
 * out of pages/api/ocr.js so the matching logic is unit-testable in isolation.
 */

/**
 * Position a text-layer field's value in the BLANK rather than on the label.
 * Text-layer matches land on the text item that contains the label (e.g.
 * "Buyer Full Name: ______"), so placing the value at the item's x renders it
 * on top of the label. We instead find the blank — the underscore run, or the
 * position just after the label text — and use the item's measured width to
 * convert that character offset into an x %. Y is anchored ~2% above the
 * baseline so the viewer's flex-end value box sits on the line.
 */
export function positionValueInBlank(item, labelLower, fieldType, sameLineValueItem = null) {
  const text = String(item?.text || '');
  const totalLen = text.length || 1;
  const itemX = typeof item?.x === 'number' ? item.x : 0;
  const itemWidth = typeof item?.width === 'number' ? item.width : 0;
  const baselineY = typeof item?.y === 'number' ? item.y : 0;

  // Label:value templates render the answer as its OWN text item further along
  // the same line (often right-aligned, e.g. "INVOICE #        INV-2026-001").
  // Anchoring to the end of the label puts the box in the empty middle; when a
  // value-looking item shares the line, the real answer slot is where IT is.
  if (sameLineValueItem && typeof sameLineValueItem.x === 'number') {
    const vWidth = Math.max(Number(sameLineValueItem.width) || 0, 0);
    return {
      page: item?.page || 1,
      x: Math.round(Math.max(0, sameLineValueItem.x - 0.5) * 10) / 10,
      y: Math.round(Math.max(0, (typeof sameLineValueItem.y === 'number' ? sameLineValueItem.y : baselineY) - 2) * 10) / 10,
      width: Math.round(Math.min(Math.max(vWidth + 2, 12), 45) * 10) / 10,
      height: 3,
      source: 'text-match',
    };
  }

  let blankCharIdx = -1;
  const usIdx = text.search(/_{2,}/);
  if (usIdx >= 0) {
    blankCharIdx = usIdx;
  } else if (labelLower) {
    const li = text.toLowerCase().indexOf(labelLower);
    if (li >= 0) {
      let after = li + labelLower.length;
      while (after < text.length && /[:\s.\-]/.test(text[after])) after += 1;
      if (after < text.length) {
        blankCharIdx = after;
      } else if (li === 0) {
        // The item IS the label ("Social Security Number:") with nothing after
        // it — the answer slot lies beyond the item (drawn comb boxes, or plain
        // empty space). Anchoring at the item's end beats covering the label.
        blankCharIdx = text.length;
      }
    }
  }

  let valueX = itemX;
  if (blankCharIdx > 0 && itemWidth > 0) {
    valueX = itemX + (blankCharIdx / totalLen) * itemWidth;
  }
  const remaining = Math.max(8, (itemX + itemWidth) - valueX);
  const width = fieldType === 'signature'
    ? Math.min(Math.max(remaining, 20), 40)
    : Math.min(Math.max(remaining, 12), 45);

  return {
    page: item?.page || 1,
    x: Math.round(valueX * 10) / 10,
    y: Math.round(Math.max(0, baselineY - 2) * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: 3,
    source: 'text-match',
  };
}

/**
 * Find the answer slot for a label item: a separate text item on the same line,
 * to the right of the label, that looks like a fillable slot or a filled-in
 * value (underscore run, or contains a digit — covers dates, numbers, IDs).
 * The digit guard keeps side-by-side LABELS (e.g. table headers "Quantity |
 * Unit Price | Amount") from being mistaken for values.
 */
export function findSameLineValueItem(labelItem, items, usedItems) {
  if (!labelItem || !Array.isArray(items)) return null;
  const rowY = Number(labelItem.y) || 0;
  const labelEnd = (Number(labelItem.x) || 0) + (Number(labelItem.width) || 0);
  // Only the FIRST item to the right of the label may be its value — anything
  // further belongs to another column (e.g. "CUSTOMER | STATEMENT # | ST-…":
  // snapping CUSTOMER onto ST-… would steal STATEMENT #'s slot). Adjacency is
  // judged over ALL items — including ones already claimed as other fields'
  // labels — otherwise a claimed label between drops out of the scan and the
  // neighbor's value gets stolen anyway (order-dependent bug).
  let first = null;
  let firstIdx = -1;
  for (let idx = 0; idx < items.length; idx += 1) {
    const t = items[idx];
    if (!t || t === labelItem || t.page !== labelItem.page) continue;
    if (Math.abs((Number(t.y) || 0) - rowY) > 1.2) continue;
    const tx = Number(t.x) || 0;
    if (tx < labelEnd - 1) continue;
    if (!first || tx < (Number(first.x) || 0)) { first = t; firstIdx = idx; }
  }
  if (!first) return null;
  if (usedItems && usedItems.has(firstIdx)) return null; // it's another field's label
  if (/_{2,}|\d/.test(String(first.text || ''))) return first;
  return null;
}

/**
 * Label-above-value layouts ("CUSTOMER" over "Nguyen Van Minh"): when nothing
 * usable sits on the label's line, look for the first left-aligned item just
 * below it. No digit guard here — below-values are often names — but the item
 * must start where the label starts (±3%) and sit within one line gap.
 */
export function findBelowValueItem(labelItem, items, usedItems) {
  if (!labelItem || !Array.isArray(items)) return null;
  const labelX = Number(labelItem.x) || 0;
  const labelY = Number(labelItem.y) || 0;
  let best = null;
  let bestIdx = -1;
  for (let idx = 0; idx < items.length; idx += 1) {
    const t = items[idx];
    if (!t || t === labelItem || t.page !== labelItem.page) continue;
    const ty = Number(t.y) || 0;
    if (ty <= labelY + 0.5 || ty > labelY + 3.2) continue;
    if (Math.abs((Number(t.x) || 0) - labelX) > 3) continue;
    if (String(t.text || '').trim().length < 2) continue;
    if (!best || ty < (Number(best.y) || 0)) { best = t; bestIdx = idx; }
  }
  // Nearest-below judged over all items; if it's another field's claimed label,
  // there is no value slot here.
  if (best && usedItems && usedItems.has(bestIdx)) return null;
  return best;
}

/**
 * Sentence-wrap blanks: contracts often name the party at the END of one line
 * and put the blank at the START of the next ("…is entered into between the
 * Landlord,\n____________ , and the Tenant, ____________"). When the label item
 * closes its line (nothing to its right) and the next line OPENS with an
 * underscore run, that run is the label's slot. Restricted to underscore runs —
 * unlike findBelowValueItem there is no x-alignment to disambiguate, so only an
 * explicit blank is safe to claim.
 */
export function findWrappedLineBlankItem(labelItem, items, usedItems) {
  if (!labelItem || !Array.isArray(items)) return null;
  const rowY = Number(labelItem.y) || 0;
  const labelEnd = (Number(labelItem.x) || 0) + (Number(labelItem.width) || 0);
  let nextLineLeftmost = null;
  let nextLineLeftmostIdx = -1;
  for (let idx = 0; idx < items.length; idx += 1) {
    const t = items[idx];
    if (!t || t === labelItem || t.page !== labelItem.page) continue;
    const ty = Number(t.y) || 0;
    if (Math.abs(ty - rowY) <= 1.2) {
      // Same line: anything to the right means the sentence continues here,
      // so the blank cannot have wrapped.
      if ((Number(t.x) || 0) >= labelEnd - 1) return null;
      continue;
    }
    if (ty <= rowY + 0.5 || ty > rowY + 3.2) continue;
    if (!nextLineLeftmost || (Number(t.x) || 0) < (Number(nextLineLeftmost.x) || 0)) {
      nextLineLeftmost = t;
      nextLineLeftmostIdx = idx;
    }
  }
  if (!nextLineLeftmost) return null;
  if (usedItems && usedItems.has(nextLineLeftmostIdx)) return null;
  if (!/_{2,}/.test(String(nextLineLeftmost.text || ''))) return null;
  return nextLineLeftmost;
}

const BLANK_TYPE_PATTERNS = [
  [/signature|chữ ký/i, 'signature'],
  [/\bdate\b|ngày/i, 'date'],
  [/phone|\btel\b|điện thoại/i, 'tel'],
  [/e-?mail/i, 'email'],
  [/\bssn\b|social security/i, 'ssn'],
];

/**
 * Deterministic blank detection for widget-less pages of AcroForm documents.
 * A hybrid doc's fields come from its widgets, so a page with no widgets but
 * plain "Label: ______" text blanks (witness pages, addenda) contributed
 * nothing. This finds labeled underscore runs on those pages — no AI calls —
 * and positions them through matchFieldsToTextItems, so all the tested snap
 * rules (inline blank, same-line, claiming) apply.
 *
 * @param {Array} existingFields - fields already built (their position.page set marks widget pages)
 * @param {Array} textItems - full extracted text layer
 * @param {number} ts - sort_order base for the appended fields
 */
export function detectFlatPageBlanks(existingFields, textItems, ts = 0) {
  const widgetPages = new Set();
  for (const f of existingFields || []) {
    const p = f?.position?.page;
    if (p) widgetPages.add(p);
  }
  const byPage = new Map();
  for (const t of (Array.isArray(textItems) ? textItems : [])) {
    const pg = t?.page || 1;
    if (widgetPages.has(pg)) continue;
    if (!byPage.has(pg)) byPage.set(pg, []);
    byPage.get(pg).push(t);
  }
  const out = [];
  for (const [pg, pageItems] of byPage) {
    const pseudo = [];
    for (const t of pageItems) {
      const text = String(t.text || '');
      const usIdx = text.search(/_{3,}/);
      if (usIdx < 0) continue;
      let label = text.slice(0, usIdx).replace(/[:\s]+$/, '').trim();
      if (!label) {
        // Standalone underscore item — the label is the item ending just left.
        let best = null;
        for (const o of pageItems) {
          if (o === t || Math.abs((Number(o.y) || 0) - (Number(t.y) || 0)) > 1.2) continue;
          const oEnd = (Number(o.x) || 0) + (Number(o.width) || 0);
          if (oEnd > (Number(t.x) || 0) + 1 || (Number(t.x) || 0) - oEnd > 5) continue;
          if (/_{3,}/.test(String(o.text || ''))) continue;
          if (!best || oEnd > (Number(best.x) || 0) + (Number(best.width) || 0)) best = o;
        }
        label = String(best?.text || '').replace(/[:\s]+$/, '').trim();
      }
      if (label.length < 3 || label.length > 60) continue;
      const words = label.split(/\s+/);
      if (words.length > 6) label = words.slice(-6).join(' ');
      let type = 'text';
      for (const [re, ty] of BLANK_TYPE_PATTERNS) {
        if (re.test(label)) { type = ty; break; }
      }
      pseudo.push({ field_name: label, label_text: label, field_type: type, approx_page: pg, approx_y: t.y });
    }
    if (!pseudo.length) continue;
    for (const f of matchFieldsToTextItems(pseudo, pageItems, ts + out.length)) {
      if (f.position) out.push(f);
    }
  }
  return out;
}

/**
 * The checkbox glyph for an option almost always sits immediately LEFT of the
 * option's text ("[  ] Married", "☐ Email"). If a text item that looks like a
 * checkbox glyph ends just before the option item, snap onto it; the caller
 * falls back to a fixed left offset when the box is drawn as pure graphics
 * (invisible to the text layer).
 */
export function findGlyphLeftOfOption(optionItem, items) {
  if (!optionItem || !Array.isArray(items)) return null;
  const rowY = Number(optionItem.y) || 0;
  const optX = Number(optionItem.x) || 0;
  let best = null;
  for (const t of items) {
    if (!t || t === optionItem || t.page !== optionItem.page) continue;
    if (Math.abs((Number(t.y) || 0) - rowY) > 1.2) continue;
    const tEnd = (Number(t.x) || 0) + (Number(t.width) || 0);
    if (tEnd > optX + 0.5 || optX - tEnd > 4) continue;
    if (!/(^|\s)[[(]\s*\]?|[☐☑□▫❏❑◻○]/.test(String(t.text || ''))) continue;
    if (!best || (Number(t.x) || 0) > (Number(best.x) || 0)) best = t;
  }
  return best;
}

/**
 * Match AI-detected fields to text-layer items, returning fields with positions.
 *
 * Each text item can be claimed by only ONE field, so two fields that share a
 * label (e.g. a left "Listing … Phone:" column and a right "Selling … Phone:"
 * column both reading "Phone:") can't collapse onto the same coordinate. Within
 * the unused candidates the nearest row wins (row distance dominates ×100); the
 * small x term then routes column 1 vs column 2 in document/reading order.
 *
 * @param {Array} deduplicatedFields - AI fields: { field_name, label_text, field_type, approx_page, approx_y, ... }
 * @param {Array} textItems - extracted text layer: { page, x, y, width, text }
 * @param {number} ts - sort_order base
 */
export function matchFieldsToTextItems(deduplicatedFields, textItems, ts = 0) {
  if (!Array.isArray(deduplicatedFields) || deduplicatedFields.length === 0) return [];
  const items = Array.isArray(textItems) ? textItems : [];
  const usedItems = new Set();

  const claimItem = (labelLower, approxPage, approxY) => {
    const targetY = typeof approxY === 'number' ? approxY : null;
    let best = -1;
    let bestScore = Infinity;
    for (let idx = 0; idx < items.length; idx += 1) {
      if (usedItems.has(idx)) continue;
      const t = items[idx];
      if (!t.text || !t.text.toLowerCase().includes(labelLower)) continue;
      if (approxPage && t.page !== approxPage) continue;
      const dy = targetY != null ? Math.abs((t.y || 0) - targetY) : 0;
      const score = dy * 100 + (t.x || 0);
      if (score < bestScore) { bestScore = score; best = idx; }
    }
    if (best >= 0) { usedItems.add(best); return items[best]; }
    return null;
  };

  // Checkbox fields are named "<question> <option>" ("Marital Status Married");
  // the physical box sits at the OPTION's glyph, not at the question label. Two
  // layouts exist in real text layers: the glyph merged into the option's item
  // ("[  ] Married" as one item), or a separate pure-option item ("Married")
  // whose glyph is its own item to the left — or drawn graphics (no item at
  // all). Option words are pulled from the field/label's trailing words.
  const claimedOptionSpans = new Set();
  const positionCheckboxAtOption = (f) => {
    if (f.field_type !== 'checkbox') return null;
    const fullLabel = String(f.label_text || '').toLowerCase().replace(/[\s:]+$/, '').trim();
    const candidates = [];
    for (const src of [f.field_name, f.label_text]) {
      const words = String(src || '').toLowerCase().split(/[\s\-–—:]+/).filter(Boolean);
      for (let k = Math.min(3, words.length); k >= 1; k -= 1) {
        const suffix = words.slice(-k).join(' ');
        // The question label itself is never an option.
        if (suffix.length >= 2 && suffix !== fullLabel && !candidates.includes(suffix)) candidates.push(suffix);
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    const targetY = typeof f.approx_y === 'number' ? f.approx_y : null;
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    for (const cand of candidates) {
      // (a) glyph + option inside one item's text ("… [  ] Married …")
      const inlineRe = new RegExp(`([\\[\\(]\\s*[\\]\\)]?|[☐☑□❏❑◻])\\s*${esc(cand)}(?![a-z0-9])`, 'i');
      let best = null;
      for (let idx = 0; idx < items.length; idx += 1) {
        const t = items[idx];
        if (f.approx_page && t.page !== f.approx_page) continue;
        const text = String(t.text || '');
        const m = inlineRe.exec(text);
        if (!m || claimedOptionSpans.has(`${idx}:${m.index}`)) continue;
        const dy = targetY != null ? Math.abs((t.y || 0) - targetY) : 0;
        const score = dy * 100 + (t.x || 0);
        if (!best || score < best.score) best = { idx, t, m, score };
      }
      if (best) {
        claimedOptionSpans.add(`${best.idx}:${best.m.index}`);
        const { t, m } = best;
        const totalLen = String(t.text || '').length || 1;
        const itemW = Number(t.width) || 0;
        const x = (Number(t.x) || 0) + (m.index / totalLen) * itemW;
        const width = Math.max((m[1].length / totalLen) * itemW, 2.5);
        return {
          page: t.page || 1,
          x: Math.round(x * 10) / 10,
          y: Math.round(Math.max(0, (Number(t.y) || 0) - 2) * 10) / 10,
          width: Math.round(width * 10) / 10,
          height: 3,
          source: 'text-match',
        };
      }

      // (b) pure-option item ("Married") — glyph is its own item or drawn
      // graphics. Question labels are excluded (they end with ':').
      let pure = null;
      let pureIdx = -1;
      let pureScore = Infinity;
      for (let idx = 0; idx < items.length; idx += 1) {
        if (usedItems.has(idx)) continue;
        const t = items[idx];
        if (f.approx_page && t.page !== f.approx_page) continue;
        const raw = String(t.text || '').trim();
        if (raw.endsWith(':')) continue;
        if (raw.toLowerCase().replace(/^[\s.\-()[\]]+|[\s.\-()[\]]+$/g, '') !== cand) continue;
        const dy = targetY != null ? Math.abs((t.y || 0) - targetY) : 0;
        const score = dy * 100 + (t.x || 0);
        if (score < pureScore) { pureScore = score; pure = t; pureIdx = idx; }
      }
      if (pure) {
        usedItems.add(pureIdx);
        const glyph = findGlyphLeftOfOption(pure, items);
        const anchor = glyph || pure;
        const x = glyph
          ? Math.max(0, (Number(glyph.x) || 0) - 0.3)
          : Math.max(0, (Number(pure.x) || 0) - 3.8);
        const width = glyph ? Math.max((Number(glyph.width) || 0) + 0.6, 2.5) : 3;
        return {
          page: pure.page || 1,
          x: Math.round(x * 10) / 10,
          y: Math.round(Math.max(0, (Number(anchor.y) || 0) - 2) * 10) / 10,
          width: Math.round(width * 10) / 10,
          height: 3,
          source: 'text-match',
        };
      }
    }
    return null;
  };

  return deduplicatedFields.map((f, i) => {
    let position = null;

    // Checkbox fields bind to their option word first (see helper above).
    if (items.length > 0) position = positionCheckboxAtOption(f);

    // Match by label text — prefer the AI's page, then any page. Each match
    // consumes its item so the next same-labeled field gets a different one.
    if (!position && f.label_text && items.length > 0) {
      const labelLower = f.label_text.toLowerCase();
      let item = f.approx_page ? claimItem(labelLower, f.approx_page, f.approx_y) : null;
      if (!item) item = claimItem(labelLower, null, f.approx_y);
      if (item) {
        // Only look for a separate answer slot when the label item itself has
        // no inline blank to write on: first-right same-line value, then a
        // left-aligned value on the line below (label-above-value layouts).
        const hasInlineBlank = /_{2,}/.test(String(item.text || ''));
        const valueItem = hasInlineBlank
          ? null
          : (findSameLineValueItem(item, items, usedItems)
            || findBelowValueItem(item, items, usedItems)
            || findWrappedLineBlankItem(item, items, usedItems));
        position = positionValueInBlank(item, labelLower, f.field_type, valueItem);
      }
    }

    // Fallback: snap to the nearest UNUSED underscore run near the AI's approx y
    // (tight threshold avoids grabbing an unrelated blank). Else the AI's coord.
    if (!position && f.approx_page) {
      const approxY = typeof f.approx_y === 'number' ? f.approx_y : 50;
      let bestIdx = -1;
      let bestDy = Infinity;
      for (let idx = 0; idx < items.length; idx += 1) {
        if (usedItems.has(idx)) continue;
        const t = items[idx];
        if (t.page !== f.approx_page || !/_{3,}/.test(String(t.text || ''))) continue;
        const dy = Math.abs((t.y || 0) - approxY);
        if (dy < bestDy) { bestDy = dy; bestIdx = idx; }
      }
      if (bestIdx >= 0 && bestDy <= 2.5) {
        usedItems.add(bestIdx);
        position = positionValueInBlank(items[bestIdx], '', f.field_type);
        position.source = 'ai-estimated';
      } else {
        const pageText = items.find(t => t.page === f.approx_page);
        if (pageText) {
          position = {
            page: f.approx_page || 1,
            x: pageText.x || 10,
            y: approxY,
            width: f.field_type === 'signature' ? 25 : 15,
            height: 3,
            source: 'ai-estimated',
          };
        }
      }
    }

    return {
      field_name: f.field_name || `field_${i + 1}`,
      alternatives: f.alternatives || null,
      explanation: '',
      position_hint: f.position_hint || null,
      confidence: f.confidence || null,
      field_type: f.field_type || 'text',
      sort_order: ts + i,
      status: 'confirmed',
      position,
    };
  });
}
