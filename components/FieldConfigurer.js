/**
 * FieldConfigurer — Step 1 of Manual Mode
 * Shows PDF with draggable/resizable field boxes.
 * User adjusts positions, then clicks "Done" to proceed to filling.
 *
 * Props:
 *   fileUrl    - URL of the PDF/image
 *   fileName   - file name
 *   fileType   - 'pdf' | 'png' | 'jpg' etc.
 *   fields     - array of field objects with positions
 *   onPositionsUpdate(fields) - called when positions change
 *   onDone()   - called when user clicks "Done Configuring"
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import DraggableFieldBox from './DraggableFieldBox';
import {
  FiChevronLeft, FiChevronRight, FiZoomIn, FiZoomOut,
  FiCheck, FiRotateCcw, FiLoader, FiMove
} from 'react-icons/fi';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export default function FieldConfigurer({
  fileUrl,
  fileName,
  fileType,
  fields,
  onPositionsUpdate,
  onDone,
  onFileLoadError,
}) {
  const [numPages, setNumPages] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1.0);
  const [pageLoading, setPageLoading] = useState(true);
  const [activeFieldId, setActiveFieldId] = useState(null);
  const [renderedPageSize, setRenderedPageSize] = useState({ width: 0, height: 0 });
  const [fileLoadError, setFileLoadError] = useState('');
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Store original positions for reset
  const [originalPositions] = useState(() =>
    fields.reduce((acc, f) => {
      acc[f.id] = f.position ? { ...f.position } : null;
      return acc;
    }, {})
  );

  const isPdf = fileType === 'pdf' || fileName?.toLowerCase().endsWith('.pdf');

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

  useEffect(() => {
    setPageLoading(true);
    setFileLoadError('');
  }, [fileUrl, isPdf]);

  const goToPage = (p) => setCurrentPage(Math.max(1, Math.min(p, numPages || 1)));
  const adjustZoom = (d) => setZoom(prev => Math.max(0.5, Math.min(2.5, +(prev + d).toFixed(2))));

  // Fields on current page
  const currentPageFields = useMemo(() => {
    return fields.filter(f => {
      if (!f.position) return false;
      return (f.position.page || 1) === currentPage;
    });
  }, [fields, currentPage]);

  // Handle position change from a draggable box
  const handlePositionChange = useCallback((fieldId, newPos) => {
    const updated = fields.map(f =>
      f.id === fieldId ? { ...f, position: newPos } : f
    );
    onPositionsUpdate(updated);
  }, [fields, onPositionsUpdate]);

  // Reset all positions to original
  const handleReset = () => {
    const reset = fields.map(f => ({
      ...f,
      position: originalPositions[f.id] ? { ...originalPositions[f.id] } : f.position,
    }));
    onPositionsUpdate(reset);
  };

  // Click on empty area deselects
  const handleBackgroundClick = () => setActiveFieldId(null);

  // Scroll sidebar to active field
  const activeField = fields.find(f => f.id === activeFieldId);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* PDF area with draggable overlays */}
      <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center justify-center py-2 px-4 bg-amber-50 border-b border-amber-200">
          <div className="flex items-center gap-2 text-amber-800 text-xs font-medium mr-4">
            <FiMove className="w-4 h-4" />
            <span>Drag fields to position them. Resize with handles.</span>
          </div>
          <div className="bg-white/95 rounded-full shadow px-3 py-1.5 flex items-center gap-2 border border-gray-200/50">
            {isPdf && (
              <>
                <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}
                  className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30 transition-colors">
                  <FiChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-gray-500 font-medium">{currentPage}/{numPages || '?'}</span>
                <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= (numPages || 1)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-600 disabled:opacity-30 transition-colors">
                  <FiChevronRight className="w-3.5 h-3.5" />
                </button>
                <div className="w-px h-4 bg-gray-200 mx-1" />
              </>
            )}
            <button onClick={() => adjustZoom(-0.15)} className="p-1 rounded hover:bg-gray-100 text-gray-600 transition-colors">
              <FiZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-medium text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
            <button onClick={() => adjustZoom(0.15)} className="p-1 rounded hover:bg-gray-100 text-gray-600 transition-colors">
              <FiZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* PDF + overlays */}
        <div
          className="flex-1 overflow-auto flex justify-center px-6 pb-6 pt-4"
          style={{ background: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)' }}
          onClick={handleBackgroundClick}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            {pageLoading && isPdf && (
              <div className="flex flex-col items-center justify-center py-20">
                <FiLoader className="w-8 h-8 text-amber-500 animate-spin mb-3" />
                <p className="text-sm text-gray-500">Loading document...</p>
              </div>
            )}

            {fileLoadError && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <FiLoader className="w-8 h-8 text-gray-300 mb-3" />
                <p className="text-sm text-gray-700 font-semibold">Unable to load document</p>
                <p className="text-xs text-gray-500 mt-1 max-w-[320px]">{fileLoadError}</p>
              </div>
            )}

            {isPdf ? (
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
                <div className="bg-white rounded-xl shadow-xl overflow-visible ring-1 ring-black/5 relative">
                  <Page
                    pageNumber={currentPage}
                    width={pageWidth}
                    loading={<div className="flex items-center justify-center py-20" style={{ width: pageWidth, minHeight: 400 }}><FiLoader className="w-6 h-6 text-gray-400 animate-spin" /></div>}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    onRenderSuccess={onPageRenderSuccess}
                  />
                  {/* Draggable field boxes */}
                  {renderedPageSize.width > 0 && currentPageFields.map((field, i) => (
                    <DraggableFieldBox
                      key={field.id}
                      field={field}
                      pageWidth={renderedPageSize.width}
                      pageHeight={renderedPageSize.height}
                      isActive={activeFieldId === field.id}
                      onSelect={setActiveFieldId}
                      onPositionChange={(newPos) => handlePositionChange(field.id, newPos)}
                      colorIndex={fields.findIndex(f => f.id === field.id)}
                    />
                  ))}
                </div>
              </Document>
            ) : (
              <div className="bg-white rounded-xl shadow-xl overflow-visible ring-1 ring-black/5 relative">
                <img
                  src={fileUrl}
                  alt={fileName}
                  className="w-full h-auto"
                  style={{ maxWidth: `${680 * zoom}px`, display: 'block' }}
                  onLoad={(e) => setRenderedPageSize({ width: e.target.clientWidth, height: e.target.clientHeight })}
                  onError={(err) => {
                    setFileLoadError('Failed to load document image.');
                    if (onFileLoadError) onFileLoadError(err);
                  }}
                />
                {renderedPageSize.width > 0 && currentPageFields.map((field, i) => (
                  <DraggableFieldBox
                    key={field.id}
                    field={field}
                    pageWidth={renderedPageSize.width}
                    pageHeight={renderedPageSize.height}
                    isActive={activeFieldId === field.id}
                    onSelect={setActiveFieldId}
                    onPositionChange={(newPos) => handlePositionChange(field.id, newPos)}
                    colorIndex={fields.findIndex(f => f.id === field.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sidebar — field list + actions */}
      <div className="w-80 bg-white border-l border-gray-200 flex flex-col flex-shrink-0 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-amber-50">
          <h3 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
            <FiMove className="w-4 h-4 text-amber-600" />
            Step 1: Configure Field Positions
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Drag and resize each field box on the document so it covers the blank area where users write.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {fields.map((field, index) => {
            const isActive = activeFieldId === field.id;
            const color = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
              '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6'][index % 10];

            return (
              <button
                key={field.id}
                onClick={() => {
                  setActiveFieldId(field.id);
                  // Navigate to the field's page
                  if (field.position?.page && field.position.page !== currentPage) {
                    setCurrentPage(field.position.page);
                  }
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                  isActive
                    ? 'bg-amber-50 ring-1 ring-amber-300'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 truncate text-xs">{field.field_name}</div>
                  <div className="text-[10px] text-gray-400">
                    {field.position
                      ? `${field.position.x?.toFixed(1)}%, ${field.position.y?.toFixed(1)}% — ${field.position.width?.toFixed(1)}×${field.position.height?.toFixed(1)}`
                      : 'No position'}
                  </div>
                </div>
                {field.position?.source === 'manual' && (
                  <span className="text-[10px] text-amber-600 font-medium flex-shrink-0">adjusted</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Actions */}
        <div className="p-3 border-t border-gray-200 space-y-2">
          <button
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <FiRotateCcw className="w-3.5 h-3.5" />
            Reset All Positions
          </button>
          <button
            onClick={onDone}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
          >
            <FiCheck className="w-4 h-4" />
            Done — Fill Fields
          </button>
        </div>
      </div>
    </div>
  );
}
