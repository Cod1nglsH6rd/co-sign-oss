/**
 * Extract Form Fields Edge Function
 * Uses pdfjs-dist for accurate text extraction with positions
 */

import { getDocument } from 'pdfjs-dist';

Deno.serve(async (req) => {
  try {
    const { pdfBase64 } = await req.json();

    if (!pdfBase64) {
      return Response.json({ success: false, error: "No PDF provided" }, { status: 400 });
    }

    console.log('[extract-form-fields] Starting extraction');
    
    const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));
    
    const PDFLib = await import("pdf-lib");
    const { PDFDocument } = PDFLib;

    // Real-world PDFs are often permissions-encrypted (empty user password —
    // they open normally everywhere; e.g. SSA's SS-5) or slightly malformed in
    // ways pdf-lib rejects. Never let pdf-lib failures kill extraction: the
    // raw-annotation and pdfjs methods below don't need its object graph.
    let pdfDoc = null;
    let pages: any[] = [];
    try {
      pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
      pages = pdfDoc.getPages();
      console.log('[extract-form-fields] PDF loaded, page count:', pages.length);
    } catch (loadErr) {
      console.log('[extract-form-fields] pdf-lib load failed (continuing without it):', loadErr.message);
    }

    const extractedFields = [];

    // Method 1: Standard AcroForm extraction
    console.log('[extract-form-fields] Method 1: Standard AcroForm');
    let formFields: unknown[] = [];
    try {
      formFields = pdfDoc ? pdfDoc.getForm().getFields() : [];
    } catch (formErr) {
      console.log('[extract-form-fields] AcroForm read failed (continuing):', formErr.message);
    }
    console.log('[extract-form-fields] AcroForm fields:', formFields.length);

    if (formFields.length > 0) {
      for (const field of formFields) {
        try {
          const name = field.getName();
          const type = field.constructor.name;
          
          let rect = null;
          let value = null;
          let label = null;
          let page = null;
          
          try {
            const fieldRect = field.getRectangle();
            if (fieldRect) {
              rect = {
                x: fieldRect.x,
                y: fieldRect.y,
                width: fieldRect.width,
                height: fieldRect.height,
              };
            }
          } catch (e) {}

          // Fallback: many AcroForms expose geometry on widgets, not field-level rectangles.
          if (!rect) {
            try {
              const widgets = field.acroField?.getWidgets?.() || [];
              const firstWidget = widgets[0];
              const widgetRect = firstWidget?.getRectangle?.();
              if (widgetRect) {
                rect = {
                  x: widgetRect.x,
                  y: widgetRect.y,
                  width: widgetRect.width,
                  height: widgetRect.height,
                };
              }
            } catch (e) {}
          }

          // Get field value
          try {
            if (type === 'PDFTextField') {
              value = field.getText() || '';
            } else if (type === 'PDFCheckBox') {
              value = field.isChecked() ? 'true' : 'false';
            }
          } catch (e) {}

          // Get field type
          let fieldType = 'text';
          if (type === 'PDFCheckBox') fieldType = 'checkbox';
          else if (type === 'PDFDropdown') fieldType = 'select';
          else if (type === 'PDFRadioGroup') fieldType = 'radio';
          else if (type === 'PDFSignatureField') fieldType = 'signature';

          // Try to get tooltip/label
          try {
            // pdf-lib may have a getAlternateName or similar
            // For now, we'll use the name as-is
            label = name;
          } catch (e) {}

          extractedFields.push({
            name: name || `field_${extractedFields.length + 1}`,
            internalName: name,
            label: label,
            textLabel: null,
            type: fieldType,
            value: value,
            rect,
            page,
            source: 'acroform',
          });
        } catch (e) {
          console.log('[extract-form-fields] Field error:', e.message);
        }
      }
    }

    // Method 2: Parse raw PDF for ALL annotation types
    console.log('[extract-form-fields] Method 2: Raw PDF parsing');
    
    const pdfStr = new TextDecoder().decode(pdfBytes);
    const objects: Record<string, string> = {};
    
    // First pass: collect all objects
    const objPattern = /(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
    let match;
    while ((match = objPattern.exec(pdfStr)) !== null) {
      objects[match[1]] = match[2];
    }
    console.log('[extract-form-fields] Parsed', Object.keys(objects).length, 'objects');

    // Build annotation-object -> page map from each page's /Annots refs.
    const annotationObjectToPage = new Map<string, number>();
    const parseObjectNumber = (ref: unknown): string | null => {
      if (!ref) return null;
      if (typeof ref === 'string') {
        const m = ref.match(/(\d+)\s+\d+\s+R/);
        if (m) return m[1];
      }

      if (typeof ref === 'object') {
        const candidate = ref as { objectNumber?: number; number?: number; toString?: () => string };
        if (typeof candidate.objectNumber === 'number') return String(candidate.objectNumber);
        if (typeof candidate.number === 'number') return String(candidate.number);
        if (typeof candidate.toString === 'function') {
          const rendered = candidate.toString();
          const m = rendered?.match?.(/(\d+)\s+\d+\s+R/);
          if (m) return m[1];
        }
      }

      return null;
    };

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx += 1) {
      const pageObj = pages[pageIdx]?.node;
      if (!pageObj) continue;

      try {
        const annotsRef = pageObj.Annots?.();
        if (!annotsRef) continue;

        const refs = Array.isArray(annotsRef)
          ? annotsRef
          : typeof annotsRef?.asArray === 'function'
            ? annotsRef.asArray()
            : [annotsRef];

        for (const ref of refs) {
          const objNum = parseObjectNumber(ref);
          if (objNum) annotationObjectToPage.set(objNum, pageIdx + 1);
        }
      } catch {
        // Ignore page annotation parsing errors for robust fallback behavior.
      }
    }

    // Annotation types to extract
    const annotationTypes = [
      'Widget',      // Form fields
      'FreeText',    // Text boxes
      'Square',      // Square annotations
      'Text',        // Text comments
      'Link',        // Hyperlinks
      'Circle',      // Circle annotations
      'Line',        // Line annotations
    ];

    // Second pass: find all annotations
    for (const [objNum, objContent] of Object.entries(objects)) {
      let subtype = null;
      let isAnnotation = false;

      // Check for standard /Subtype /X
      const standardSubtype = objContent.match(/\/Subtype\s*\/(\w+)/);
      if (standardSubtype) {
        subtype = standardSubtype[1];
        isAnnotation = true;
      }

      // Check for non-standard /Subtype/X (PDFium)
      const nonStandardSubtype = objContent.match(/\/Subtype\/(\w+)/);
      if (nonStandardSubtype && !subtype) {
        subtype = nonStandardSubtype[1];
        isAnnotation = true;
      }

      if (!isAnnotation || !subtype || !annotationTypes.includes(subtype)) continue;

      // Extract common annotation properties
      let name = null;
      let label = null;  // Human-readable name from /TU
      let rect = null;
      let value = null;
      let fieldType = 'text';

      // Name from /T (internal name)
      const nameMatch = objContent.match(/\/T<([^>]+)>/);
      if (nameMatch) {
        name = decodeFieldName(nameMatch[1]);
      }
      if (!name) {
        const nameParenMatch = objContent.match(/\/T\s*\(([^)]*)\)/);
        if (nameParenMatch) {
          name = nameParenMatch[1];
        }
      }

      // Label from /TU (tooltip/human-readable name)
      const labelMatch = objContent.match(/\/TU\s*\(([^)]*)\)/);
      if (labelMatch) {
        label = labelMatch[1];
      }
      // Also try /TU with hex encoding
      if (!label) {
        const tuHexMatch = objContent.match(/\/TU<([^>]+)>/);
        if (tuHexMatch) {
          label = decodeFieldName(tuHexMatch[1]);
        }
      }

      // Also check parent for /TU
      if (!label) {
        const parentMatch = objContent.match(/\/Parent\s+(\d+)\s+(\d+)\s+R/);
        if (parentMatch && objects[parentMatch[1]]) {
          const parentContent = objects[parentMatch[1]];
          const parentLabelMatch = parentContent.match(/\/TU\s*\(([^)]*)\)/);
          if (parentLabelMatch) {
            label = parentLabelMatch[1];
          }
          // Try parent /T if no /TU
          if (!label) {
            const parentNameMatch = parentContent.match(/\/T<([^>]+)>/);
            if (parentNameMatch) {
              label = decodeFieldName(parentNameMatch[1]);
            }
            if (!label) {
              const parentNameParenMatch = parentContent.match(/\/T\s*\(([^)]*)\)/);
              if (parentNameParenMatch) {
                label = parentNameParenMatch[1];
              }
            }
          }
        }
      }

      // Rect coordinates
      const rectMatch = objContent.match(/\/Rect\s*\[\s*([^\]]+)\]/);
      if (rectMatch) {
        const coords = rectMatch[1].trim().split(/\s+/).map(Number);
        if (coords.length === 4 && !isNaN(coords[0])) {
          rect = {
            x: Math.min(coords[0], coords[2]),
            y: Math.min(coords[1], coords[3]),
            width: Math.abs(coords[2] - coords[0]),
            height: Math.abs(coords[3] - coords[1]),
          };
        }
      }

      // Field type from /FT
      const ftMatch = objContent.match(/\/FT\s*\/(\w+)/);
      if (ftMatch) {
        const ft = ftMatch[1];
        if (ft === 'Tx') fieldType = 'text';
        else if (ft === 'Btn') fieldType = 'checkbox';
        else if (ft === 'Ch') fieldType = 'select';
        else if (ft === 'Sig') fieldType = 'signature';
      }

      // For Widget annotations, try to get value
      if (subtype === 'Widget') {
        const vMatch = objContent.match(/\/V\s*<([^>]+)>/);
        if (vMatch) {
          value = decodeFieldName(vMatch[1]);
        }
        
        // Try /DV (default value)
        if (!value) {
          const dvMatch = objContent.match(/\/DV\s*<([^>]+)>/);
          if (dvMatch) {
            value = decodeFieldName(dvMatch[1]);
          }
        }

        // Try /AS (appearance state for checkboxes)
        const asMatch = objContent.match(/\/AS\s*\/(\w+)/);
        if (asMatch) {
          value = asMatch[1];
          fieldType = 'checkbox';
        }
      }

      // For FreeText, get the default text
      if (subtype === 'FreeText') {
        const contentsMatch = objContent.match(/\/Contents\s*\(([^)]*)\)/);
        if (contentsMatch) {
          value = contentsMatch[1];
        }
        fieldType = 'freetext';
      }

      // Skip if no meaningful data
      if (!name && !rect && !value) continue;

      // Determine if this is a form field (has name or is Widget)
      const isFormField = subtype === 'Widget' || (name && name.trim().length > 0);

      // Use label as name if available, otherwise use internal name
      const displayName = label || name;

      if (isFormField || rect) {
        extractedFields.push({
          name: displayName || `${subtype.toLowerCase()}_${objNum}`,
          internalName: name,  // Original internal name
          label: label,        // Human-readable label
          textLabel: null,     // Label from text layer
          type: fieldType,
          value: value || '',
          rect,
          page: annotationObjectToPage.get(objNum) || null,
          subtype,
          source: 'annotation',
        });
      }
    }

    console.log(`[extract-form-fields] Annotation parsing found ${extractedFields.length} fields`);

    // Method 2b: pdfjs annotation extraction. pdfjs tolerates documents that
    // defeat both pdf-lib (encryption, malformed objects) and the raw regex
    // scan (widgets inside compressed object streams — e.g. SSA's SS-5). Runs
    // whenever the methods above produced no positioned widgets.
    const pdfjsPageDims: Record<number, { width: number; height: number }> = {};
    if (!extractedFields.some(f => f.rect)) {
      console.log('[extract-form-fields] Method 2b: pdfjs annotations');
      try {
        const loadingTask = getDocument({ data: pdfBytes });
        const jsDoc = await loadingTask.promise;
        for (let pageNum = 1; pageNum <= jsDoc.numPages; pageNum += 1) {
          const page = await jsDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });
          pdfjsPageDims[pageNum] = { width: viewport.width, height: viewport.height };
          const annots = await page.getAnnotations();
          for (const a of annots) {
            if (!a?.fieldName || !a?.rect) continue;
            const [x0, y0, x1, y1] = a.rect;
            let fieldType = 'text';
            if (a.fieldType === 'Btn') fieldType = 'checkbox';
            else if (a.fieldType === 'Ch') fieldType = 'select';
            else if (a.fieldType === 'Sig') fieldType = 'signature';
            extractedFields.push({
              name: a.alternativeText || a.fieldName,
              internalName: a.fieldName,
              label: a.alternativeText || null,
              textLabel: null,
              type: fieldType,
              value: typeof a.fieldValue === 'string' ? a.fieldValue : null,
              rect: {
                x: Math.min(x0, x1),
                y: Math.min(y0, y1),
                width: Math.abs(x1 - x0),
                height: Math.abs(y1 - y0),
              },
              page: pageNum,
              subtype: 'Widget',
              source: 'annotation',
            });
          }
        }
        console.log('[extract-form-fields] pdfjs annotations found:', extractedFields.length);
      } catch (jsErr) {
        console.log('[extract-form-fields] pdfjs annotation extraction failed:', jsErr.message);
      }
    }

    // Method 3: If still no fields, try graphics rectangles (last resort)
    if (pdfDoc && extractedFields.length === 0) {
      console.log('[extract-form-fields] Method 3: Graphics rectangle detection');
      
      for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
        const page = pages[pageIdx];
        const { width, height } = page.getSize();
        
        try {
          const pageObj = page.node;
          const contentsRef = pageObj.Contents();
          
          if (contentsRef) {
            const contentRefs = Array.isArray(contentsRef) ? contentsRef : [contentsRef];
            
            for (const ref of contentRefs) {
              try {
                const streamObj = pdfDoc.context.lookup(ref);
                if (streamObj) {
                  let content = '';
                  try {
                    content = streamObj.getString();
                  } catch (e) {}
                  
                  if (content && content.length > 0) {
                    // Match rectangle commands: x y width height re
                    const rectMatches = content.matchAll(/(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+(\d+\.?\d*)\s+re/g);
                    
                    for (const rm of rectMatches) {
                      const x = parseFloat(rm[1]);
                      const y = parseFloat(rm[2]);
                      const w = parseFloat(rm[3]);
                      const h = parseFloat(rm[4]);
                      
                      // Filter: reasonable size for form fields
                      if (w > 20 && h > 3 && h < 100) {
                        extractedFields.push({
                          name: `rect_${extractedFields.length + 1}`,
                          internalName: null,
                          label: null,
                          textLabel: null,
                          type: 'text',
                          value: '',
                          rect: { x, y, width: w, height: h },
                          page: pageIdx + 1,
                          subtype: 'rect',
                          source: 'graphics',
                        });
                      }
                    }
                  }
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    }

    // Backfill AcroForm field page from same-name annotation when available.
    const annotationPageByName = new Map<string, number>();
    for (const field of extractedFields) {
      if (field?.source !== 'annotation' || !field?.page) continue;
      const key = String(field.internalName || field.name || '').trim();
      if (!key) continue;
      if (!annotationPageByName.has(key)) annotationPageByName.set(key, field.page);
    }
    for (const field of extractedFields) {
      if (field?.source !== 'acroform') continue;
      if (field?.page) continue;
      const key = String(field.internalName || field.name || '').trim();
      field.page = annotationPageByName.get(key) || 1;
    }

    // Deduplicate overlapping Method 1/2 results while preserving the best candidate.
    const rectHash = (rect: { x: number; y: number; width: number; height: number } | null) => {
      if (!rect) return 'none';
      return [
        Math.round(rect.x * 10) / 10,
        Math.round(rect.y * 10) / 10,
        Math.round(rect.width * 10) / 10,
        Math.round(rect.height * 10) / 10,
      ].join(':');
    };

    const fieldScore = (field: Record<string, unknown>) => {
      let score = 0;
      if (field.rect) score += 5;
      if (field.label || field.textLabel) score += 2;
      if (field.internalName) score += 1;
      if (field.source === 'annotation') score += 1;
      return score;
    };

    const dedupedMap = new Map<string, Record<string, unknown>>();
    const makeBaseKey = (field: Record<string, unknown>) => {
      const name = String(field.internalName || field.label || field.name || '').trim().toLowerCase();
      const page = Number(field.page) > 0 ? Number(field.page) : 1;
      const type = String(field.type || '').trim().toLowerCase();
      const subtype = String(field.subtype || '').trim().toLowerCase();
      return { name, page, type, subtype };
    };

    for (const field of extractedFields as Record<string, unknown>[]) {
      const { name, page, type, subtype } = makeBaseKey(field);
      const baseKey = name
        ? `named|${name}|${page}`
        : `anon|${page}|${type}|${subtype}|${rectHash(field.rect as { x: number; y: number; width: number; height: number } | null)}`;

      let key = baseKey;
      const existing = dedupedMap.get(baseKey);
      if (existing) {
        const existingHash = rectHash(existing.rect as { x: number; y: number; width: number; height: number } | null);
        const currentHash = rectHash(field.rect as { x: number; y: number; width: number; height: number } | null);

        // Keep distinct repeated named fields when they have truly different rectangles.
        if (name && existingHash !== 'none' && currentHash !== 'none' && existingHash !== currentHash) {
          key = `${baseKey}|${currentHash}`;
        } else {
          const currentScore = fieldScore(field);
          const existingScore = fieldScore(existing);
          if (currentScore > existingScore || (currentScore === existingScore && existingHash === 'none' && currentHash !== 'none')) {
            dedupedMap.set(baseKey, field);
          }
          continue;
        }
      }

      dedupedMap.set(key, field);
    }

    const dedupedFields = Array.from(dedupedMap.values());
    console.log('[extract-form-fields] Deduplicated fields:', { before: extractedFields.length, after: dedupedFields.length });
    extractedFields.length = 0;
    extractedFields.push(...dedupedFields);

    // Method 4: Extract text layer using pdfjs-dist for accurate text positions
    if (extractedFields.length > 0) {
      console.log('[extract-form-fields] Method 4: pdfjs-dist text extraction');
      
      try {
        // Load PDF with pdfjs-dist
        const loadingTask = getDocument({ data: pdfBytes });
        const pdfDoc2 = await loadingTask.promise;
        
        console.log(`[extract-form-fields] pdfjs loaded ${pdfDoc2.numPages} pages`);
        
        // Extract text from each page with positions
        const textItems: Array<{ str: string; x: number; y: number; page: number }> = [];
        
        for (let pageNum = 1; pageNum <= pdfDoc2.numPages; pageNum++) {
          const page = await pdfDoc2.getPage(pageNum);
          const textContent = await page.getTextContent();
          
          // Transform to PDF coordinates
          const viewport = page.getViewport({ scale: 1 });
          
          for (const item of textContent.items) {
            if ('str' in item && item.str) {
              // Get transform matrix for position
              const transform = item.transform;
              // transform[4] = x, transform[5] = y in PDF coordinates
              textItems.push({
                str: item.str,
                x: transform[4],
                y: viewport.height - transform[5], // Flip Y for top-left origin
                page: pageNum,
              });
            }
          }
        }
        
        console.log(`[extract-form-fields] Extracted ${textItems.length} text items with positions`);
        
        // Match text labels to fields based on position
        for (const field of extractedFields) {
          if (field.textLabel) continue;
          if (!field.rect) continue;
          const candidateTextItems = field.page
            ? textItems.filter(t => t.page === field.page)
            : textItems;
          
          const fieldTop = field.rect.y + field.rect.height;
          const fieldBottom = field.rect.y;
          const fieldLeft = field.rect.x;
          const fieldRight = field.rect.x + field.rect.width;
          
          // Find text ABOVE the field (label is typically above)
          const aboveTexts = candidateTextItems.filter(t => {
            const isAbove = t.y < fieldBottom + 10 && t.y > fieldBottom - 40;
            const isAligned = t.x > fieldLeft - 100 && t.x < fieldRight + 50;
            return isAbove && isAligned && t.str.trim().length > 1;
          });
          
          // Find text to the LEFT of the field
          const leftTexts = candidateTextItems.filter(t => {
            const isLeft = t.x < fieldLeft + 10 && t.x > fieldLeft - 180;
            const isAligned = Math.abs(t.y - fieldTop) < 15;
            return isLeft && isAligned && t.str.trim().length > 1;
          });
          
          // Use the best match
          const labels = [...aboveTexts, ...leftTexts];
          
          if (labels.length > 0) {
            // Find closest to field
            const best = labels.reduce((best, curr) => {
              const bestDist = Math.abs(best.y - fieldTop);
              const currDist = Math.abs(curr.y - fieldTop);
              return currDist < bestDist ? curr : best;
            }, labels[0]);
            
            if (best.str && best.str.trim().length > 0) {
              field.textLabel = best.str.trim();
            }
          }
        }
        
      } catch (e) {
        console.log('[extract-form-fields] pdfjs error:', e.message);
      }
    }

    console.log('[extract-form-fields] Total fields:', extractedFields.length);

    // Convert to final format with positions
    // Get page dimensions for each page (pdfjs dims fill in when pdf-lib
    // couldn't read the page tree)
    const pageDimensions: Record<number, { width: number, height: number }> = { ...pdfjsPageDims };
    for (let i = 0; i < pages.length; i++) {
      const { width, height } = pages[i].getSize();
      pageDimensions[i + 1] = { width, height };
    }

    const fieldsWithPositions = extractedFields.map((f, i) => {
      let position = null;
      
      const pageNum = Number(f.page) > 0 ? Number(f.page) : 1;
      const dims = pageDimensions[pageNum] || { width: 612, height: 792 };
      
      if (f.rect) {
        const x = (f.rect.x / dims.width) * 100;
        const y = ((dims.height - f.rect.y - f.rect.height) / dims.height) * 100;
        const w = (f.rect.width / dims.width) * 100;
        const h = (f.rect.height / dims.height) * 100;
        
        position = {
          page: pageNum,
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
          width: Math.round(w * 10) / 10,
          height: Math.round(h * 10) / 10,
          source: f.source,
        };
      }

      // Use textLabel if available, otherwise use label, otherwise use internal name
      const displayName = f.textLabel || f.label || f.internalName || f.name;

      return {
        name: displayName,
        internalName: f.internalName || null,
        label: f.label || null,
        textLabel: f.textLabel || null,
        alternatives: null,          // To be filled by AI
        explanation: null,           // To be filled by AI  
        confidence: null,            // To be filled by AI
        status: f.label || f.textLabel ? "confirmed" : "pending",  // Has /TU or textLabel = confirmed
        type: f.type,
        value: f.value || null,
        page: pageNum,
        position,
        subtype: f.subtype || null,
      };
    });

    return Response.json({
      success: true,
      fields: fieldsWithPositions,
      count: fieldsWithPositions.length,
      metadata: {
        hasRect: fieldsWithPositions.some(f => f.position !== null),
        hasLabel: fieldsWithPositions.some(f => f.label !== null),
        confirmedCount: fieldsWithPositions.filter(f => f.status === "confirmed").length,
        pendingCount: fieldsWithPositions.filter(f => f.status === "pending").length,
        needsAI: fieldsWithPositions.some(f => f.status === "pending"),  // true if any field needs AI labeling
      },
    });

  } catch (error) {
    console.log('[extract-form-fields] Error:', error.message, error.stack);
    return Response.json({ 
      success: false, 
      error: error.message,
    }, { status: 500 });
  }
});

function decodeFieldName(hex: string): string {
  try {
    // Handle different encodings
    let cleanHex = hex;
    
    // Remove BOM markers
    cleanHex = cleanHex.replace(/^FEFF/, '').replace(/^FFFE/, '');
    
    // Check if it's ASCII (no encoding needed)
    const asciiTest = cleanHex.replace(/[0-9A-F]/g, '');
    if (asciiTest.length === 0 || /^[0-9A-F]+$/i.test(cleanHex)) {
      // Try UTF-16BE
      let result = '';
      for (let i = 0; i < cleanHex.length; i += 4) {
        const code = parseInt(cleanHex.substring(i, i + 4), 16);
        if (code && code < 0xFFFE) {
          result += String.fromCharCode(code);
        }
      }
      if (result.length > 0) return result;
    }
    
    return hex;
  } catch (e) {
    return hex;
  }
}
