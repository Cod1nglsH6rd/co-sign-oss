/**
 * SignatureCanvas Component
 * Canvas-based signature drawing with mouse and touch support
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import { FiTrash2, FiCheck } from 'react-icons/fi';

export default function SignatureCanvas({ value, onChange }) {
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isEmpty, setIsEmpty] = useState(!value);
  const [hasSignature, setHasSignature] = useState(!!value);
  const lastPos = useRef(null);

  // Keep canvas in sync with external value updates (load and clear).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      setIsEmpty(true);
      setHasSignature(false);
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      setIsEmpty(false);
      setHasSignature(true);
    };
    img.src = value;

    return () => {
      cancelled = true;
    };
  }, [value]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const pos = getPos(e, canvas);
    lastPos.current = pos;
    setIsDrawing(true);
    setIsEmpty(false);

    // Draw a dot for click/tap
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = '#1a1a2e';
    ctx.fill();
  }, []);

  const draw = useCallback((e) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);

    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1a1a2e';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    lastPos.current = pos;
  }, [isDrawing]);

  const stopDrawing = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    setHasSignature(true);

    // Save as PNG base64
    const canvas = canvasRef.current;
    const dataUrl = canvas.toDataURL('image/png');
    onChange(dataUrl);
  }, [isDrawing, onChange]);

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    setHasSignature(false);
    onChange('');
  };

  return (
    <div className="space-y-2">
      <div className="relative border-2 border-dashed border-slateish-300 rounded-xl overflow-hidden bg-white hover:border-brand-400 transition-colors"
        style={{ cursor: 'crosshair' }}
      >
        {/* signature baseline (visual only; not captured in the saved PNG) */}
        <div className="pointer-events-none absolute left-6 right-6 bottom-10 border-b border-slateish-200" />
        {/* Placeholder text */}
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <p className="text-sm text-slateish-400 select-none">Draw your signature here</p>
          </div>
        )}

        <canvas
          ref={canvasRef}
          aria-label="Signature pad"
          width={520}
          height={160}
          className="w-full touch-none block"
          style={{ height: '160px' }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clearSignature}
          className="flex items-center gap-1.5 text-xs text-slateish-500 hover:text-red-500 transition-colors px-2 py-1 rounded hover:bg-red-50"
        >
          <FiTrash2 className="w-3 h-3" />
          Clear
        </button>

        {hasSignature && (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <FiCheck className="w-3 h-3" />
            Signature saved
          </span>
        )}
      </div>
    </div>
  );
}
