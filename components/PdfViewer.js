/**
 * DocuSign-inspired PDF Viewer with real-time field overlays.
 * Renders the PDF via react-pdf and positions field values
 * on top of the rendered page using absolute CSS positioning.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut,
  FiMaximize2, FiMinimize2, FiLoader
} from 'react-icons/fi';
import { colorForIndex } from '../lib/fieldColors';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

function toFiniteNumber(value) {
  const num = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(num) ? num : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeFieldPosition(position) {
  if (!position || typeof position !== 'object') return null;

  let x = toFiniteNumber(position.x);
  let y = toFiniteNumber(position.y);
  let width = toFiniteNumber(position.width ?? position.w);
  let height = toFiniteNumber(position.height ?? position.h);
  const page = toFiniteNumber(position.page) || 1;

  if ((x === null || y === null || width === null || height === null) && Array.isArray(position.rect) && position.rect.length === 4) {
    const [left, top, right, bottom] = position.rect.map(toFiniteNumber);
    if ([left, top, right, bottom].every((v) => v !== null)) {
      x = left;
      y = top;
      width = right - left;
      height = bottom - top;
    }
  }

  if ((x === null || y === null || width === null || height === null) &&
    toFiniteNumber(position.left) !== null &&
    toFiniteNumber(position.top) !== null &&
    toFiniteNumber(position.right) !== null &&
    toFiniteNumber(position.bottom) !== null) {
    const left = toFiniteNumber(position.left);
    const top = toFiniteNumber(position.top);
    const right = toFiniteNumber(position.right);
    const bottom = toFiniteNumber(position.bottom);
    x = left;
    y = top;
    width = right - left;
    height = bottom - top;
  }

  if (x === null || y === null || width === null || height === null) return null;
  if (width <= 0 || height <= 0) return null;

  // Fractional coordinates (0..1)
  if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && width > 0 && width <= 1 && height > 0 && height <= 1) {
    x *= 100;
    y *= 100;
    width *= 100;
    height *= 100;
  }

  // Legacy absolute coordinates fallback
  if (x > 100 || y > 100 || width > 100 || height > 100) {
    const DEFAULT_PAGE_WIDTH = 612;
    const DEFAULT_PAGE_HEIGHT = 792;
    x = (x / DEFAULT_PAGE_WIDTH) * 100;
    y = (y / DEFAULT_PAGE_HEIGHT) * 100;
    width = (width / DEFAULT_PAGE_WIDTH) * 100;
    height = (height / DEFAULT_PAGE_HEIGHT) * 100;
  }

  x = clamp(x, 0, 100);
  y = clamp(y, 0, 100);
  width = clamp(width, 0.5, 100);
  height = clamp(height, 0.5, 100);

  return {
    page,
    x: Math.round(x * 10) / 10,
    y: Math.round(y * 10) / 10,
    width: Math.round(width * 10) / 10,
    height: Math.round(height * 10) / 10,
    source: position.source || 'unknown',
  };
}

export default function PdfViewer({ fileUrl, fileName, fileType, fields = [], onLoadError, labels = {}, highlightFieldIds = null, focusField = null }) {
  const loadingLabel = labels.loading || 'Loading document...';
  const pageLabelFn = typeof labels.pageLabel === 'function'
    ? labels.pageLabel
    : (c, t) => `Page ${c} of ${t}`;
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [isFullWidth, setIsFullWidth] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [pdfError, setPdfError] = useState('');
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);
  const [renderedPageSize, setRenderedPageSize] = useState({ width: 0, height: 0 });

  const isPdf = fileType === 'pdf' || fileName?.toLowerCase().endsWith('.pdf');

  useEffect(() => {
    setPageLoading(true);
    setPdfError('');
  }, [fileUrl, isPdf]);

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

  const onDocumentLoadSuccess = useCallback(({ numPages }) => {
    setNumPages(numPages);
    setPageLoading(false);
    setPdfError('');
  }, []);

  const onPageRenderSuccess = useCallback((page) => {
    // Get actual rendered dimensions
    setRenderedPageSize({ width: page.width, height: page.height });
  }, []);

  // Stable per-field color keyed by index in the ordered field list — matches
  // the sidebar, which uses the same list + index.
  const colorByFieldId = useMemo(() => {
    const m = new Map();
    fields.forEach((f, i) => { if (f && f.id != null) m.set(f.id, colorForIndex(i)); });
    return m;
  }, [fields]);

  const highlightSet = highlightFieldIds instanceof Set ? highlightFieldIds : null;

  // Jump to the page of the field the user just focused (expanded in the sidebar).
  useEffect(() => {
    if (!focusField) return;
    const pos = normalizeFieldPosition(focusField.position);
    const page = pos?.page || focusField.page || null;
    if (page) setCurrentPage((p) => (p === page ? p : Math.max(1, Math.min(page, numPages || page))));
  }, [focusField, numPages]);

  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, numPages || 1)));
  };

  const adjustZoom = (delta) => {
    setZoom(prev => Math.max(0.5, Math.min(2.5, +(prev + delta).toFixed(2))));
  };

  const pageWidth = Math.min(containerWidth, isFullWidth ? containerWidth : 680) * zoom;

  // Positioned fields on the current page (value filtering happens at render time
  // so highlighted-but-empty fields still draw their box).
  const currentPageFields = useMemo(() => {
    return fields
      .map((field) => ({
        ...field,
        _normalizedPosition: normalizeFieldPosition(field.position),
      }))
      .filter((field) => field._normalizedPosition
        && (field._normalizedPosition.page || 1) === currentPage);
  }, [fields, currentPage]);

  // Render field overlays on the PDF page
  const renderFieldOverlays = () => {
    if (!renderedPageSize.width || currentPageFields.length === 0) return null;

    const pw = renderedPageSize.width;
    const ph = renderedPageSize.height;

    return currentPageFields.map((field) => {
      const pos = field._normalizedPosition;
      if (!pos) return null;
      const highlighted = !!(highlightSet && highlightSet.has(field.id));
      const hasValue = field.field_value && field.field_value !== 'false';
      // Show nothing for empty, non-active fields (keeps the page uncluttered).
      if (!highlighted && !hasValue) return null;

      const left = (pos.x / 100) * pw;
      const top = (pos.y / 100) * ph;
      const width = ((pos.width || 40) / 100) * pw;
      const height = ((pos.height || 3) / 100) * ph;

      const isSignature = field.field_type === 'signature' && field.field_value?.startsWith('data:image/');
      const isCheckbox = field.field_type === 'checkbox';

      // Auto-size font based on field height
      const fontSize = Math.min(Math.max(height * 0.65, 7), 14) * zoom;
      const color = colorByFieldId.get(field.id);

      // Field being filled (expanded in the sidebar): a color-matched box, slightly
      // inflated so it's visible around small fields, showing the live value.
      if (highlighted && color) {
        const pad = 3;
        const boxH = Math.max(height, 14);
        return (
          <div
            key={field.id}
            style={{
              position: 'absolute',
              left: `${left - pad}px`,
              top: `${top - pad}px`,
              width: `${width + pad * 2}px`,
              height: `${boxH + pad * 2}px`,
              pointerEvents: 'none',
              border: `2px solid ${color.border}`,
              background: color.bg,
              borderRadius: '3px',
              boxShadow: `0 0 0 3px ${color.bg}`,
              display: 'flex',
              alignItems: 'flex-end',
              padding: '0 3px 1px',
              overflow: 'hidden',
              zIndex: 5,
            }}
          >
            {isSignature ? (
              <img src={field.field_value} alt="Signature" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : isCheckbox ? (
              <span style={{ fontSize: `${Math.min(boxH * 0.85, 16)}px`, color: color.border, fontWeight: 'bold', lineHeight: 1, margin: 'auto' }}>
                {field.field_value === 'true' ? '✕' : ''}
              </span>
            ) : (
              <span style={{ fontSize: `${fontSize}px`, color: '#0d1a66', fontFamily: 'Helvetica, Arial, sans-serif', lineHeight: 1.25, wordBreak: 'break-all', overflowWrap: 'anywhere', whiteSpace: 'normal', overflow: 'hidden', display: 'block', width: '100%' }}>
                {field.field_value || <span style={{ color: color.border, opacity: 0.55 }}>…</span>}
              </span>
            )}
          </div>
        );
      }

      return (
        <div
          key={field.id}
          style={{
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${width}px`,
            height: `${height}px`,
            pointerEvents: 'none',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'flex-end',
            padding: '0 2px 1px',
          }}
        >
          {isSignature ? (
            <img
              src={field.field_value}
              alt="Signature"
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
              }}
            />
          ) : isCheckbox ? (
            field.field_value === 'true' && (
              <span style={{
                fontSize: `${Math.min(height * 0.8, 14)}px`,
                color: '#0d1a66',
                fontWeight: 'bold',
                lineHeight: 1,
              }}>
                X
              </span>
            )
          ) : (
            <span style={{
              fontSize: `${fontSize}px`,
              color: '#0d1a66',
              fontFamily: 'Helvetica, Arial, sans-serif',
              lineHeight: 1.25,
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              whiteSpace: 'normal',
              overflow: 'hidden',
              display: 'block',
              width: '100%',
              maxHeight: `${height}px`,
            }}>
              {field.field_value}
            </span>
          )}
        </div>
      );
    });
  };

  if (!isPdf) {
    return (
      <div ref={containerRef} className="flex-1 overflow-auto flex items-start justify-center p-6" style={{ background: 'linear-gradient(135deg, #f0f2f5 0%, #e8ebef 100%)' }}>
        <div className="relative" style={{ maxWidth: `${680 * zoom}px`, transition: 'max-width 0.3s ease' }}>
          <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm rounded-full shadow-lg px-3 py-1.5 flex items-center gap-2 z-10 border border-slateish-200/50">
            <button onClick={() => adjustZoom(-0.15)} className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 transition-colors">
              <FiZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-slateish-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => adjustZoom(0.15)} className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 transition-colors">
              <FiZoomIn className="w-4 h-4" />
            </button>
          </div>
          <div className="bg-white rounded-xl shadow-xl overflow-hidden ring-1 ring-black/5 relative">
            <img
              src={fileUrl}
              alt={fileName}
              className="w-full h-auto"
              style={{ display: 'block' }}
              onLoad={(e) => {
                setRenderedPageSize({ width: e.target.clientWidth, height: e.target.clientHeight });
                setPdfError('');
              }}
              onError={(err) => {
                setPdfError('Failed to load document image.');
                if (onLoadError) onLoadError(err);
              }}
            />
            {/* Real-time field overlays for images */}
            {renderFieldOverlays()}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center justify-center py-3 px-4" style={{ background: 'linear-gradient(135deg, #f0f2f5 0%, #e8ebef 100%)' }}>
        <div className="bg-white/95 backdrop-blur-sm rounded-full shadow-lg px-4 py-2 flex items-center gap-3 border border-slateish-200/50">
          <button
            onClick={() => goToPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FiChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-1.5 text-sm">
            <input
              type="number"
              value={currentPage}
              onChange={(e) => goToPage(parseInt(e.target.value) || 1)}
              min={1}
              max={numPages || 1}
              className="w-10 text-center bg-slateish-50 border border-slateish-200 rounded-md py-0.5 text-sm font-medium text-slateish-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
            <span className="text-slateish-400">/</span>
            <span className="text-slateish-500 font-medium">{numPages || '?'}</span>
          </div>
          <button
            onClick={() => goToPage(currentPage + 1)}
            disabled={currentPage >= (numPages || 1)}
            className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <FiChevronRight className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-slateish-200 mx-1" />
          <button onClick={() => adjustZoom(-0.15)} className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 transition-colors">
            <FiZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-medium text-slateish-500 w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => adjustZoom(0.15)} className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 transition-colors">
            <FiZoomIn className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-slateish-200 mx-1" />
          <button
            onClick={() => setIsFullWidth(!isFullWidth)}
            className="p-1 rounded-md hover:bg-slateish-100 text-slateish-600 transition-colors"
            title={isFullWidth ? 'Fit to default' : 'Fit to width'}
          >
            {isFullWidth ? <FiMinimize2 className="w-4 h-4" /> : <FiMaximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* PDF rendering area */}
      <div
        className="flex-1 overflow-auto flex justify-center px-6 pb-6"
        style={{ background: 'linear-gradient(135deg, #f0f2f5 0%, #e8ebef 100%)' }}
      >
        <div className="relative">
          {pdfError && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FiLoader className="w-8 h-8 text-slateish-300 mb-3" />
              <p className="text-sm text-slateish-600 font-semibold">Unable to load document</p>
              <p className="text-xs text-slateish-400 mt-1 max-w-[280px]">{pdfError}</p>
            </div>
          )}
          {pageLoading && (
            <div className="flex flex-col items-center justify-center py-20">
              <FiLoader className="w-8 h-8 text-brand-600 animate-spin mb-3" />
              <p className="text-sm text-slateish-500">{loadingLabel}</p>
            </div>
          )}

          <Document
            file={fileUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(err) => {
              const message = err?.message || 'Failed to load PDF file.';
              setPdfError(message);
              setPageLoading(false);
              console.error('PDF load error:', err);
              if (onLoadError) onLoadError(err);
            }}
            loading={null}
            className="flex flex-col items-center gap-4"
          >
            <div className="bg-white rounded-xl shadow-xl overflow-hidden ring-1 ring-black/5 transition-all duration-200 relative">
              <Page
                pageNumber={currentPage}
                width={pageWidth}
                loading={
                  <div className="flex items-center justify-center py-20" style={{ width: pageWidth || 600, minHeight: 400 }}>
                    <FiLoader className="w-6 h-6 text-slateish-400 animate-spin" />
                  </div>
                }
                renderTextLayer={false}
                renderAnnotationLayer={true}
                onRenderSuccess={onPageRenderSuccess}
              />
              {/* Real-time field overlays */}
              {renderFieldOverlays()}
            </div>
          </Document>

          {numPages > 1 && (
            <div className="flex justify-center mt-4 mb-2">
              <div className="bg-white/80 backdrop-blur-sm rounded-full px-3 py-1 text-xs text-slateish-500 shadow-sm border border-slateish-200/50">
                {pageLabelFn(currentPage, numPages)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
