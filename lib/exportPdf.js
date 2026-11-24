/**
 * PDF Export Utility
 * Loads the ORIGINAL uploaded document and overlays filled field values
 * directly on it using position data from OCR.
 * Text is placed inside the field bounding box, auto-sized to fit.
 */

import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readJpegOrientation } from './jpegOrientation';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function sanitize(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\xFF]/g, '?')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .trim();
}

/**
 * Keep every character the embedded Unicode font can render (Vietnamese
 * diacritics in particular); strip-to-base-letter or '?' only for the rest.
 */
export function sanitizeForFont(text, charset) {
  if (!text) return '';
  let out = '';
  for (const ch of String(text).replace(/[\x00-\x1F\x7F]/g, ' ')) {
    const cp = ch.codePointAt(0);
    if (charset.has(cp)) { out += ch; continue; }
    const stripped = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const scp = stripped ? stripped.codePointAt(0) : null;
    out += (scp && charset.has(scp)) ? stripped : '?';
  }
  return out.trim();
}

/**
 * Embed a Unicode text font (Noto Sans, public/fonts/NotoSans-Regular.ttf) so
 * exported answers keep their diacritics. The caller may pass the font file's
 * bytes (the server has no relative URL to fetch from); otherwise, in a
 * browser, it is fetched from /fonts. Falls back to Helvetica + Latin-1
 * sanitize when neither works (offline, server-side without bytes, bad asset).
 */
async function embedTextFont(pdfDoc, fontBytes = null) {
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  try {
    let bytes = fontBytes;
    if (!bytes) {
      if (typeof fetch !== 'function' || typeof window === 'undefined') throw new Error('no browser fetch');
      const resp = await fetch('/fonts/NotoSans-Regular.ttf');
      if (!resp.ok) throw new Error(`font fetch ${resp.status}`);
      bytes = await resp.arrayBuffer();
    }
    pdfDoc.registerFontkit(fontkit);
    // ccmp off: Noto Sans's ccmp splits some precomposed Vietnamese letters
    // (ị, ọ) into a base glyph plus a combining dot. They still look right, but
    // the PDF's text layer then reads "Ngọ c" / "Thi" when copied or searched.
    // With it off, each letter is drawn with its own precomposed glyph.
    const font = await pdfDoc.embedFont(bytes, { subset: true, features: { ccmp: false } });
    const charset = new Set(font.getCharacterSet());
    // NFC so decomposed input (base letter + combining mark) also uses the
    // precomposed glyphs.
    const clean = (t) => sanitizeForFont(t == null ? t : String(t).normalize('NFC'), charset);
    return { font, clean, unicode: true };
  } catch (err) {
    console.warn('Unicode export font unavailable, falling back to Helvetica:', err?.message);
    return { font: helvetica, clean: sanitize, unicode: false };
  }
}

function isDataUrl(str) {
  return typeof str === 'string' && str.startsWith('data:image/');
}

/**
 * Break a single long word into chunks that fit within maxWidth
 */
function breakWord(word, font, fontSize, maxWidth) {
  const chunks = [];
  let start = 0;
  while (start < word.length) {
    let end = start + 1;
    while (end <= word.length && font.widthOfTextAtSize(word.slice(start, end), fontSize) <= maxWidth) {
      end++;
    }
    // Back off one char if we overshot (unless we only have 1 char)
    if (end <= word.length && end - start > 1) end--;
    chunks.push(word.slice(start, end));
    start = end;
  }
  return chunks;
}

/**
 * Wrap text to fit within maxWidth, returns array of lines.
 * Handles long words without spaces by breaking at character level.
 */
function wrapText(text, font, fontSize, maxWidth) {
  if (maxWidth <= 0) return [text];
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    // If this single word is wider than maxWidth, break it at char level
    if (font.widthOfTextAtSize(word, fontSize) > maxWidth) {
      // Flush current line first
      if (current) {
        lines.push(current);
        current = '';
      }
      const chunks = breakWord(word, font, fontSize, maxWidth);
      for (let i = 0; i < chunks.length; i++) {
        if (i < chunks.length - 1) {
          lines.push(chunks[i]);
        } else {
          current = chunks[i]; // last chunk continues as current
        }
      }
      continue;
    }

    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Find the best font size that fits text into the field box.
 * Tries to use as large a font as possible (up to maxSize),
 * wrapping if needed, and shrinks if it still doesn't fit.
 */
function fitText(text, font, fieldW, fieldH, maxSize = 12, minSize = 6) {
  for (let size = maxSize; size >= minSize; size -= 0.5) {
    const lines = wrapText(text, font, size, fieldW - 4);
    const totalH = lines.length * (size + 2);
    if (totalH <= fieldH + 2) {
      return { lines, fontSize: size };
    }
  }
  // Last resort: use min size and truncate
  const lines = wrapText(text, font, minSize, fieldW - 4);
  const maxLines = Math.max(1, Math.floor(fieldH / (minSize + 2)));
  return { lines: lines.slice(0, maxLines), fontSize: minSize };
}

/**
 * Pick the AcroForm field for an answer named fieldName, skipping those in
 * `used`: exact (case-insensitive, trimmed) name first, then a contains()
 * match only when exactly one candidate fits. Returns null when none does.
 */
export function matchFormField(formFields, fieldName, used) {
  const norm = (s) => String(s || '').toLowerCase().trim();
  const target = norm(fieldName);
  if (!target) return null;
  const exact = formFields.find((ff) => !used.has(ff) && norm(ff.getName()) === target);
  if (exact) return exact;
  const candidates = formFields.filter((ff) => {
    if (used.has(ff)) return false;
    const n = norm(ff.getName());
    return n.includes(target) || target.includes(n);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export async function generateFilledPdf({
  documentName,
  fileUrl,
  fileType,
  fields,
  locale = 'en',
  sourceBytes = null,
  // Optional bytes of public/fonts/NotoSans-Regular.ttf. Pass them on the
  // server, where the browser fetch of /fonts/... is not possible.
  fontBytes = null,
}) {
  let pdfDoc;
  const isPdf = fileType === 'pdf' || documentName?.toLowerCase().endsWith('.pdf');

  // ============ LOAD ORIGINAL DOCUMENT ============
  if (isPdf && (sourceBytes || fileUrl)) {
    try {
      const originalBytes = sourceBytes
        ? sourceBytes
        : await (async () => {
          const response = await fetch(fileUrl);
          return response.arrayBuffer();
        })();
      pdfDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    } catch (err) {
      console.warn('Could not load original PDF:', err);
      pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([612, 792]);
    }
  } else if (sourceBytes || fileUrl) {
    pdfDoc = await PDFDocument.create();
    try {
      const imageBuffer = sourceBytes
        ? sourceBytes
        : await (async () => {
          const response = await fetch(fileUrl);
          return response.arrayBuffer();
        })();
      const imageBytes = new Uint8Array(imageBuffer);
      // The file's first bytes say what it is; its name may have no extension.
      const isPng = PNG_SIGNATURE.every((byte, i) => imageBytes[i] === byte);
      const image = isPng
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);
      const orientation = isPng ? 1 : readJpegOrientation(imageBytes);
      // 6 and 8 turn the picture a quarter turn, so the page's sides swap.
      const turned = orientation === 6 || orientation === 8;
      const uprightW = turned ? image.height : image.width;
      const uprightH = turned ? image.width : image.height;

      const maxW = 612;
      const maxH = 792;
      const scale = Math.min(maxW / uprightW, maxH / uprightH, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      const page = pdfDoc.addPage([uprightW * scale, uprightH * scale]);
      if (orientation === 6) {
        page.drawImage(image, { x: 0, y: w, width: w, height: h, rotate: degrees(-90) });
      } else if (orientation === 8) {
        page.drawImage(image, { x: h, y: 0, width: w, height: h, rotate: degrees(90) });
      } else {
        page.drawImage(image, { x: 0, y: 0, width: w, height: h });
      }
    } catch (err) {
      console.warn('Could not embed image:', err);
      pdfDoc.addPage([612, 792]);
    }
  } else {
    pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([612, 792]);
  }

  // One text font for both passes below, so AcroForm values keep their
  // diacritics too (not only the overlay).
  const { font: textFont, clean, unicode } = await embedTextFont(pdfDoc, fontBytes);

  // ============ TRY ACROFORM FILL FIRST ============
  // Match rules: exact (case-insensitive) name first, then a fuzzy contains()
  // match only when it's UNAMBIGUOUS — a field named "Name" must not spray its
  // value into First/Last/Company Name. Each AcroForm widget is filled at most
  // once, and fields filled here are excluded from the overlay pass below so
  // the value isn't drawn a second time on the flattened page.
  const acroFilledFieldIds = new Set();
  try {
    const form = pdfDoc.getForm();
    const formFields = form.getFields();
    if (formFields.length > 0) {
      let filled = false;
      const usedFormFields = new Set();
      for (const field of fields) {
        if (!field.field_value) continue;
        const match = matchFormField(formFields, field.field_name, usedFormFields);
        if (!match) continue;
        try {
          if (match.constructor.name === 'PDFTextField') {
            match.setText(clean(field.field_value));
            usedFormFields.add(match);
            acroFilledFieldIds.add(field.id);
            filled = true;
          } else if (match.constructor.name === 'PDFCheckBox') {
            if (field.field_value === 'true') match.check();
            usedFormFields.add(match);
            acroFilledFieldIds.add(field.id);
            filled = true;
          }
        } catch {}
      }
      if (filled) {
        // flatten() would otherwise draw the field appearances in Helvetica,
        // which cannot encode Vietnamese letters (pdf-lib throws on them).
        if (unicode) form.updateFieldAppearances(textFont);
        form.flatten();
      }
    }
  } catch {}

  // ============ OVERLAY FIELD VALUES ON PAGES ============
  const pages = pdfDoc.getPages();
  const textColor = rgb(0.05, 0.05, 0.4);

  for (const field of fields) {
    if (!field.field_value || field.field_value === 'false') continue;
    // Already written into the (flattened) AcroForm — don't draw it again.
    if (acroFilledFieldIds.has(field.id)) continue;

    const pos = field.position;
    if (!pos || pos.x == null || pos.y == null) continue;

    const pageIndex = (pos.page || 1) - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) continue;

    const page = pages[pageIndex];
    const { width: pageW, height: pageH } = page.getSize();

    // Convert percentage positions to absolute coordinates
    // pos.x, pos.y are percentages from top-left
    // PDF coords: (0,0) is bottom-left, y increases upward
    let absX = (pos.x / 100) * pageW;
    const absYFromTop = (pos.y / 100) * pageH;
    let fieldW = ((pos.width || 40) / 100) * pageW;
    const fieldH = ((pos.height || 3) / 100) * pageH;

    // Clamp: don't let text overflow past right edge of page
    const rightMargin = 20;
    if (absX + fieldW > pageW - rightMargin) {
      fieldW = pageW - rightMargin - absX;
    }
    if (absX < 10) absX = 10;
    if (fieldW < 30) fieldW = 30;

    // Bottom of the field box in PDF coords (y from bottom)
    const fieldBottom = pageH - absYFromTop - fieldH;

    const isSignature = field.field_type === 'signature' && isDataUrl(field.field_value);

    if (isSignature) {
      try {
        const base64Data = field.field_value.replace(/^data:image\/png;base64,/, '');
        const pngBytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const pngImage = await pdfDoc.embedPng(pngBytes);

        const sigH = Math.min(fieldH, 35);
        const sigW = sigH * (pngImage.width / pngImage.height);

        page.drawImage(pngImage, {
          x: absX + 2,
          y: fieldBottom + 1,
          width: Math.min(sigW, fieldW - 4),
          height: sigH,
        });
      } catch {}
    } else if (field.field_type === 'checkbox') {
      if (field.field_value === 'true') {
        const size = Math.min(fieldH * 0.8, 11);
        page.drawText('X', {
          x: absX + 2,
          y: fieldBottom + (fieldH - size) / 2,
          size,
          font: textFont,
          color: textColor,
        });
      }
    } else {
      // Regular text — auto-fit into the field box. Native date inputs store
      // ISO (2026-07-04); US forms expect MM/DD/YYYY, so reformat on the way out.
      let raw = field.field_value;
      if (field.field_type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(raw))) {
        const [y, m, d] = String(raw).split('-');
        raw = `${m}/${d}/${y}`;
      }
      const value = clean(raw);
      const maxFontSize = Math.min(fieldH * 0.85, 12);
      const { lines, fontSize } = fitText(value, textFont, fieldW, fieldH, maxFontSize, 6);
      const lineHeight = fontSize + 2;

      // Bottom-align: text sits on the baseline (like handwriting on a line)
      // For single line: place text just above the bottom of the field
      // For multi-line: stack lines upward from the bottom
      let startY = fieldBottom + (lines.length - 1) * lineHeight + 2;

      for (const line of lines) {
        if (startY < fieldBottom - 2) break; // don't draw below box
        page.drawText(line, {
          x: absX + 2,
          y: startY,
          size: fontSize,
          font: textFont,
          color: textColor,
        });
        startY -= lineHeight;
      }
    }
  }

  // With the Unicode font, field appearances were already drawn with it above.
  // Letting save() redraw any leftover ones in Helvetica would throw on
  // Vietnamese letters and lose the whole export.
  return await pdfDoc.save({ updateFieldAppearances: !unicode });
}

export { generateFilledPdf as generateFieldsPdf };
