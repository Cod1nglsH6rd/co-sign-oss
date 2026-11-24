/**
 * DraggableFieldBox
 * A draggable + resizable field overlay positioned on top of a PDF page.
 * Uses pointer events for drag/resize (no external drag library needed for this).
 *
 * Props:
 *   field       - { id, field_name, field_type, position: {x, y, width, height} }
 *   pageWidth   - rendered page width in pixels
 *   pageHeight  - rendered page height in pixels
 *   isActive    - whether this box is selected/active
 *   onSelect    - callback when clicked
 *   onPositionChange - callback({x, y, width, height}) with new percentages
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

const COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#6366f1', '#14b8a6',
];

export default function DraggableFieldBox({
  field,
  pageWidth,
  pageHeight,
  isActive,
  onSelect,
  onPositionChange,
  colorIndex = 0,
}) {
  const boxRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(null); // null | 'br' | 'r' | 'b'
  const dragStart = useRef({ mx: 0, my: 0, ox: 0, oy: 0, ow: 0, oh: 0 });

  const pos = useMemo(() => field.position || { x: 10, y: 10, width: 30, height: 3 }, [field.position]);
  const source = pos?.source;
  const color = source === 'text-layer' ? '#10b981' 
             : source === 'ai-estimated' ? '#f59e0b' 
             : COLORS[colorIndex % COLORS.length];

  // Convert percentages to pixels
  const left = (pos.x / 100) * pageWidth;
  const top = (pos.y / 100) * pageHeight;
  const width = ((pos.width || 30) / 100) * pageWidth;
  const height = ((pos.height || 3) / 100) * pageHeight;

  const handleMouseDown = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(field.id);
    setDragging(true);
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: pos.x,
      oy: pos.y,
      ow: pos.width || 30,
      oh: pos.height || 3,
    };
  }, [field.id, pos, onSelect]);

  const handleResizeDown = useCallback((corner) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect?.(field.id);
    setResizing(corner);
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      ox: pos.x,
      oy: pos.y,
      ow: pos.width || 30,
      oh: pos.height || 3,
    };
  }, [field.id, pos, onSelect]);

  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMove = (e) => {
      const dx = e.clientX - dragStart.current.mx;
      const dy = e.clientY - dragStart.current.my;
      const dxPct = (dx / pageWidth) * 100;
      const dyPct = (dy / pageHeight) * 100;

      if (dragging) {
        const newX = Math.max(0, Math.min(100 - dragStart.current.ow, dragStart.current.ox + dxPct));
        const newY = Math.max(0, Math.min(100 - dragStart.current.oh, dragStart.current.oy + dyPct));
        onPositionChange?.({
          x: Math.round(newX * 10) / 10,
          y: Math.round(newY * 10) / 10,
          width: dragStart.current.ow,
          height: dragStart.current.oh,
          page: pos.page || 1,
          source: 'manual',
        });
      } else if (resizing) {
        let newW = dragStart.current.ow;
        let newH = dragStart.current.oh;

        if (resizing.includes('r') || resizing === 'br') {
          newW = Math.max(5, Math.min(100 - dragStart.current.ox, dragStart.current.ow + dxPct));
        }
        if (resizing.includes('b') || resizing === 'br') {
          newH = Math.max(1.5, Math.min(100 - dragStart.current.oy, dragStart.current.oh + dyPct));
        }

        onPositionChange?.({
          x: dragStart.current.ox,
          y: dragStart.current.oy,
          width: Math.round(newW * 10) / 10,
          height: Math.round(newH * 10) / 10,
          page: pos.page || 1,
          source: 'manual',
        });
      }
    };

    const handleUp = () => {
      setDragging(false);
      setResizing(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragging, resizing, pageWidth, pageHeight, onPositionChange, pos.page]);

  const minH = Math.max(height, 18);

  return (
    <div
      ref={boxRef}
      onMouseDown={handleMouseDown}
      onClick={(e) => { e.stopPropagation(); onSelect?.(field.id); }}
      style={{
        position: 'absolute',
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${minH}px`,
        border: `2px ${isActive ? 'solid' : 'dashed'} ${color}`,
        backgroundColor: isActive ? `${color}22` : `${color}11`,
        cursor: dragging ? 'grabbing' : 'grab',
        zIndex: isActive ? 30 : 20,
        userSelect: 'none',
        borderRadius: '3px',
        transition: dragging || resizing ? 'none' : 'border-color 0.15s, background-color 0.15s',
      }}
    >
      {/* Field name label */}
      <div
        style={{
          position: 'absolute',
          top: '-18px',
          left: '-1px',
          background: color,
          color: 'white',
          fontSize: '10px',
          fontWeight: 600,
          padding: '1px 6px',
          borderRadius: '3px 3px 0 0',
          whiteSpace: 'nowrap',
          maxWidth: `${width + 40}px`,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          lineHeight: '15px',
          pointerEvents: 'none',
        }}
      >
        {field.display_name || field.field_name}
      </div>

      {/* Resize handle — bottom-right corner */}
      {isActive && (
        <>
          <div
            onMouseDown={handleResizeDown('br')}
            style={{
              position: 'absolute',
              right: '-4px',
              bottom: '-4px',
              width: '8px',
              height: '8px',
              background: color,
              borderRadius: '2px',
              cursor: 'nwse-resize',
            }}
          />
          <div
            onMouseDown={handleResizeDown('r')}
            style={{
              position: 'absolute',
              right: '-3px',
              top: '50%',
              transform: 'translateY(-50%)',
              width: '6px',
              height: '14px',
              background: color,
              borderRadius: '2px',
              cursor: 'ew-resize',
            }}
          />
          <div
            onMouseDown={handleResizeDown('b')}
            style={{
              position: 'absolute',
              bottom: '-3px',
              left: '50%',
              transform: 'translateX(-50%)',
              width: '14px',
              height: '6px',
              background: color,
              borderRadius: '2px',
              cursor: 'ns-resize',
            }}
          />
        </>
      )}
    </div>
  );
}
