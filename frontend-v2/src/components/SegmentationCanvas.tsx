/* ===================================================================
   Segmentation Canvas — Interactive SAM segmentation
   Supports click, draw (polygon), and box modes.
   SAM API calls are UNCHANGED — same endpoints as original app.
   =================================================================== */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { segmentByClick, segmentByBox, segmentByPolygon, base64ToImage } from '../api/samApi';

type SegMode = 'click' | 'draw' | 'box';
type SelectTarget = 'main' | 'reference';

interface Props {
  imageFile: File;
  imageElement: HTMLImageElement;
  onComplete: (objectMask: string, refMask: string | null) => void;
  onBack: () => void;
}

export const SegmentationCanvas: React.FC<Props> = ({
  imageFile,
  imageElement,
  onComplete,
  onBack,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SegMode>('click');
  const [target, setTarget] = useState<SelectTarget>('main');
  const [objectMask, setObjectMask] = useState<string | null>(null);
  const [refMask, setRefMask] = useState<string | null>(null);
  const [segmenting, setSegmenting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Mutable refs for drawing state (avoids stale closure issues)
  const drawingRef = useRef(false);
  const drawPointsRef = useRef<number[][]>([]);
  const boxStartRef = useRef<number[] | null>(null);
  const overlayImgRef = useRef<HTMLImageElement | null>(null);

  // Draw image on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageElement) return;

    const maxW = 440;
    const scale = Math.min(maxW / imageElement.naturalWidth, 1);
    canvas.width = Math.round(imageElement.naturalWidth * scale);
    canvas.height = Math.round(imageElement.naturalHeight * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
  }, [imageElement]);

  // --- Core helpers ---

  const getCanvasPoint = useCallback((clientX: number, clientY: number): number[] => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return [
      Math.round((clientX - rect.left) * sx),
      Math.round((clientY - rect.top) * sy),
    ];
  }, []);

  const scaleToImage = useCallback((pts: number[][]): number[][] => {
    const canvas = canvasRef.current;
    if (!canvas || !imageElement) return pts;
    const s = imageElement.naturalWidth / canvas.width;
    return pts.map(([x, y]) => [Math.round(x * s), Math.round(y * s)]);
  }, [imageElement]);

  const redrawCanvas = useCallback((overlayImg?: HTMLImageElement | null) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    // Draw base image or overlay
    const base = overlayImg || overlayImgRef.current || imageElement;
    ctx.drawImage(base, 0, 0, canvas.width, canvas.height);

    const color = target === 'main' ? '#10b981' : '#f59e0b';
    const pts = drawPointsRef.current;

    // Draw polyline for draw mode
    if (mode === 'draw' && pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Draw bounding box for box mode
    if (mode === 'box' && boxStartRef.current && pts.length === 1) {
      const [x0, y0] = boxStartRef.current;
      const [x1, y1] = pts[0];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
    }
  }, [imageElement, mode, target]);

  // --- Segmentation API calls ---

  const doClickSegment = useCallback(async (pt: number[]) => {
    if (segmenting) return;
    setSegmenting(true);
    setErrorMsg(null);

    try {
      const scaledPts = scaleToImage([pt]);
      const result = await segmentByClick(imageFile, scaledPts, [1]);
      if (result.success) {
        const overlay = await base64ToImage(result.overlay);
        overlayImgRef.current = overlay;
        redrawCanvas(overlay);
        if (target === 'main') setObjectMask(result.mask);
        else setRefMask(result.mask);
      } else {
        setErrorMsg('Segmentation failed. Try a different point.');
      }
    } catch (err: any) {
      console.error('Click segment error:', err);
      setErrorMsg('Backend not responding. Make sure python main.py is running.');
    }
    setSegmenting(false);
  }, [segmenting, imageFile, target, redrawCanvas]);

  const doPolygonSegment = useCallback(async (pts: number[][]) => {
    if (segmenting || pts.length < 4) return;
    setSegmenting(true);
    setErrorMsg(null);

    try {
      const scaledPts = scaleToImage(pts);
      const result = await segmentByPolygon(imageFile, scaledPts);
      if (result.success) {
        const overlay = await base64ToImage(result.overlay);
        overlayImgRef.current = overlay;
        redrawCanvas(overlay);
        if (target === 'main') setObjectMask(result.mask);
        else setRefMask(result.mask);
      } else {
        setErrorMsg('Segmentation failed. Try drawing a bigger region.');
      }
    } catch (err: any) {
      console.error('Polygon segment error:', err);
      setErrorMsg('Backend not responding. Make sure python main.py is running.');
    }
    setSegmenting(false);
  }, [segmenting, imageFile, target, redrawCanvas]);

  const doBoxSegment = useCallback(async (start: number[], end: number[]) => {
    if (segmenting) return;
    setSegmenting(true);
    setErrorMsg(null);

    const box = [
      Math.min(start[0], end[0]),
      Math.min(start[1], end[1]),
      Math.max(start[0], end[0]),
      Math.max(start[1], end[1]),
    ];

    try {
      const scaledBoxPts = scaleToImage([[box[0], box[1]], [box[2], box[3]]]).flat();
      const result = await segmentByBox(imageFile, scaledBoxPts);
      if (result.success) {
        const overlay = await base64ToImage(result.overlay);
        overlayImgRef.current = overlay;
        redrawCanvas(overlay);
        if (target === 'main') setObjectMask(result.mask);
        else setRefMask(result.mask);
      } else {
        setErrorMsg('Segmentation failed. Try a bigger box.');
      }
    } catch (err: any) {
      console.error('Box segment error:', err);
      setErrorMsg('Backend not responding. Make sure python main.py is running.');
    }
    setSegmenting(false);
  }, [segmenting, imageFile, target, redrawCanvas]);

  // --- Native event handlers (touch + mouse) ---
  // Using native listeners via useEffect to: 
  // 1. Set passive: false for touch events (prevent scrolling)
  // 2. Avoid stale closure issues with React synthetic events

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // --- Pointer start (mousedown / touchstart) ---
    const onPointerStart = (clientX: number, clientY: number) => {
      if (segmenting) return;
      const pt = getCanvasPoint(clientX, clientY);

      if (mode === 'click') {
        doClickSegment(pt);
      } else if (mode === 'draw') {
        drawingRef.current = true;
        drawPointsRef.current = [pt];
      } else if (mode === 'box') {
        drawingRef.current = true;
        boxStartRef.current = pt;
        drawPointsRef.current = [];
      }
    };

    // --- Pointer move (mousemove / touchmove) ---
    const onPointerMove = (clientX: number, clientY: number) => {
      if (!drawingRef.current || segmenting) return;
      const pt = getCanvasPoint(clientX, clientY);

      if (mode === 'draw') {
        drawPointsRef.current = [...drawPointsRef.current, pt];
        redrawCanvas();
      } else if (mode === 'box') {
        drawPointsRef.current = [pt];
        redrawCanvas();
      }
    };

    // --- Pointer end (mouseup / touchend) ---
    const onPointerEnd = () => {
      if (!drawingRef.current || segmenting) return;
      drawingRef.current = false;

      if (mode === 'draw') {
        const pts = [...drawPointsRef.current];
        drawPointsRef.current = [];
        if (pts.length > 3) {
          doPolygonSegment(pts);
        }
      } else if (mode === 'box') {
        const start = boxStartRef.current;
        const end = drawPointsRef.current[0];
        drawPointsRef.current = [];
        boxStartRef.current = null;
        if (start && end) {
          doBoxSegment(start, end);
        }
      }
    };

    // --- Mouse event listeners ---
    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      onPointerStart(e.clientX, e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      onPointerMove(e.clientX, e.clientY);
    };
    const onMouseUp = (e: MouseEvent) => {
      onPointerEnd();
    };

    // --- Touch event listeners ---
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault(); // Prevent scroll/zoom
      if (e.touches.length === 1) {
        onPointerStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault(); // Prevent scroll/zoom
      if (e.touches.length === 1) {
        onPointerMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      onPointerEnd();
    };

    // Register all listeners
    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [mode, segmenting, getCanvasPoint, scaleToImage, redrawCanvas, doClickSegment, doPolygonSegment, doBoxSegment]);

  // --- Reset ---
  const handleReset = useCallback(() => {
    setObjectMask(null);
    setRefMask(null);
    setErrorMsg(null);
    overlayImgRef.current = null;
    drawPointsRef.current = [];
    boxStartRef.current = null;
    drawingRef.current = false;
    // Redraw clean image
    const canvas = canvasRef.current;
    if (canvas && imageElement) {
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
    }
  }, [imageElement]);

  const hintText = segmenting
    ? '⏳ Segmenting...'
    : mode === 'click'
      ? '👆 Tap on the object to segment it'
      : mode === 'draw'
        ? '✏️ Draw around the object boundary'
        : '⬜ Draw a box around the object';

  return (
    <section className="step-section">
      <div className="step-header">
        <span className="step-number">2</span>
        <div>
          <span className="step-title">Select Objects</span>
          <p className="step-subtitle">Segment the object and optionally a reference</p>
        </div>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 12,
          padding: '10px 14px',
          marginBottom: 12,
          fontSize: '0.8125rem',
          color: '#f87171',
        }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {/* Mode Toggle */}
      <div className="mode-toggle" id="mode-toggle">
        <button
          className={`mode-btn ${mode === 'click' ? 'active' : ''}`}
          onClick={() => { setMode('click'); drawPointsRef.current = []; }}
          id="click-mode-btn"
        >
          👆 Click
        </button>
        <button
          className={`mode-btn ${mode === 'draw' ? 'active' : ''}`}
          onClick={() => { setMode('draw'); drawPointsRef.current = []; }}
          id="draw-mode-btn"
        >
          ✏️ Draw
        </button>
        <button
          className={`mode-btn ${mode === 'box' ? 'active' : ''}`}
          onClick={() => { setMode('box'); drawPointsRef.current = []; }}
          id="box-mode-btn"
        >
          ⬜ Box
        </button>
      </div>

      {/* Canvas */}
      <div className="canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          id="seg-canvas"
          style={{
            cursor: segmenting ? 'wait' : 'crosshair',
            touchAction: 'none',       /* Prevent scroll/zoom on touch */
            userSelect: 'none',         /* Prevent text selection */
            WebkitUserSelect: 'none',
          }}
        />
        <div className="canvas-hint">
          <p>{hintText}</p>
        </div>
      </div>

      {/* Object Selection */}
      <div className="obj-select-row">
        <button
          className={`obj-btn ${target === 'main' ? 'active' : ''} ${objectMask ? 'done' : ''}`}
          onClick={() => setTarget('main')}
          id="select-object-btn"
        >
          🎯 Object
        </button>
        <button
          className={`obj-btn ref ${target === 'reference' ? 'active' : ''} ${refMask ? 'done' : ''}`}
          onClick={() => setTarget('reference')}
          id="select-ref-btn"
        >
          🪙 Reference
        </button>
      </div>

      {/* Actions */}
      <div className="action-row">
        <button className="btn btn-ghost" onClick={handleReset} id="reset-btn">
          🔄 Reset
        </button>
        <button className="btn btn-ghost" onClick={onBack} id="back-btn">
          ← Back
        </button>
        <button
          className="btn btn-primary"
          disabled={!objectMask}
          onClick={() => objectMask && onComplete(objectMask, refMask)}
          id="next-btn"
        >
          📐 Next →
        </button>
      </div>
    </section>
  );
};
