/* ===================================================================
   ARMeasureView — True WebXR AR Measurement (Apple Measure-style)
   Uses WebXR hit-testing to place 3D world anchors and compute
   metric distances/areas without any reference object.
   =================================================================== */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ARPoint, ARMeasurement, Point3D } from '../types';

interface Props {
  onBack: () => void;
}

// ─── 3D math helpers ───────────────────────────────────────────────
function dist3D(a: Point3D, b: Point3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function polygonArea3D(points: Point3D[]): number {
  if (points.length < 3) return 0;
  // Newell's method for 3D polygon area
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < points.length; i++) {
    const cur = points[i];
    const next = points[(i + 1) % points.length];
    nx += (cur.y - next.y) * (cur.z + next.z);
    ny += (cur.z - next.z) * (cur.x + next.x);
    nz += (cur.x - next.x) * (cur.y + next.y);
  }
  return 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
}

function computeARMeasurement(points: ARPoint[], closed: boolean): ARMeasurement {
  const distances: number[] = [];
  for (let i = 1; i < points.length; i++) {
    distances.push(dist3D(points[i - 1].worldPos, points[i].worldPos) * 100); // m → cm
  }
  if (closed && points.length > 2) {
    distances.push(dist3D(points[points.length - 1].worldPos, points[0].worldPos) * 100);
  }
  const totalLength = distances.reduce((s, d) => s + d, 0);
  const areaCm2 = closed && points.length >= 3
    ? polygonArea3D(points.map(p => p.worldPos)) * 10000 // m² → cm²
    : 0;

  return { points, distances, totalLength, perimeterCm: totalLength, areaCm2, isClosed: closed };
}

// ─── Component ─────────────────────────────────────────────────────
export const ARMeasureView: React.FC<Props> = ({ onBack }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const [supported, setSupported] = useState<boolean | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [points, setPoints] = useState<ARPoint[]>([]);
  const [measurement, setMeasurement] = useState<ARMeasurement | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const [statusText, setStatusText] = useState('Initializing AR...');

  // WebXR refs
  const xrSessionRef = useRef<XRSession | null>(null);
  const xrRefSpaceRef = useRef<XRReferenceSpace | null>(null);
  const hitTestSourceRef = useRef<XRHitTestSource | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const lastHitRef = useRef<XRHitTestResult | null>(null);
  const reticleVisibleRef = useRef(false);
  const pointIdRef = useRef(0);
  const pointsRef = useRef<ARPoint[]>([]);

  // Hit-test averaging buffer (smooth out jitter)
  const hitBufferRef = useRef<Point3D[]>([]);
  const HIT_BUFFER_SIZE = 5;

  // Keep pointsRef in sync
  useEffect(() => { pointsRef.current = points; }, [points]);

  // ─── Check WebXR support ─────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (!('xr' in navigator)) { setSupported(false); return; }
      try {
        const ok = await (navigator as any).xr.isSessionSupported('immersive-ar');
        setSupported(ok);
      } catch { setSupported(false); }
    })();
  }, []);

  // ─── Start WebXR session ─────────────────────────────────────────
  const startSession = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setStatusText('Starting AR session...');
      const session: XRSession = await (navigator as any).xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'local-floor'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: overlayRef.current ? { root: overlayRef.current } : undefined,
      });

      xrSessionRef.current = session;

      const gl = canvasRef.current.getContext('webgl2', { xrCompatible: true });
      if (!gl) throw new Error('WebGL2 not available');
      glRef.current = gl;

      await session.updateRenderState({
        baseLayer: new XRWebGLLayer(session, gl),
      });

      const refSpace = await session.requestReferenceSpace('local-floor');
      xrRefSpaceRef.current = refSpace;

      // Request hit-test source for viewer (center of screen)
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const hitTestSource = await session.requestHitTestSource!({ space: viewerSpace });
      hitTestSourceRef.current = hitTestSource!;

      setSessionActive(true);
      setStatusText('Move your phone slowly to detect surfaces...');

      // Frame loop
      session.requestAnimationFrame(function onFrame(_time: number, frame: XRFrame) {
        if (!xrSessionRef.current) return;
        const sess = xrSessionRef.current;
        const glLayer = sess.renderState.baseLayer!;
        const curGl = glRef.current!;

        curGl.bindFramebuffer(curGl.FRAMEBUFFER, glLayer.framebuffer);
        curGl.clearColor(0, 0, 0, 0);
        curGl.clear(curGl.COLOR_BUFFER_BIT | curGl.DEPTH_BUFFER_BIT);

        // Hit test with averaging
        if (hitTestSourceRef.current) {
          const results = frame.getHitTestResults(hitTestSourceRef.current);
          if (results.length > 0) {
            const hitPose = results[0].getPose(xrRefSpaceRef.current!);
            if (hitPose) {
              const hp = hitPose.transform.position;
              const hitPoint: Point3D = { x: hp.x, y: hp.y, z: hp.z };

              // Validate: check if hit is on a roughly horizontal plane
              // The pose's orientation matrix Y-axis should point up
              const mat = hitPose.transform.matrix;
              const upY = mat[5]; // Y component of the Y-axis (should be ~1 for horizontal)
              const isHorizontal = Math.abs(upY) > 0.8; // Allow ~36° tilt

              if (isHorizontal) {
                // Add to averaging buffer
                hitBufferRef.current.push(hitPoint);
                if (hitBufferRef.current.length > HIT_BUFFER_SIZE) {
                  hitBufferRef.current.shift();
                }

                lastHitRef.current = results[0];
                reticleVisibleRef.current = true;
                if (!tracking) {
                  setTracking(true);
                  setStatusText('Surface detected! Tap + to place a point.');
                }
              }
            }
          } else {
            reticleVisibleRef.current = false;
            hitBufferRef.current = [];
          }
        }

        // Draw overlay (points + lines)
        drawOverlay(frame);

        sess.requestAnimationFrame(onFrame);
      });

      session.addEventListener('end', () => {
        xrSessionRef.current = null;
        hitTestSourceRef.current = null;
        setSessionActive(false);
        setTracking(false);
      });

    } catch (err: any) {
      console.error('WebXR start failed:', err);
      setStatusText(`AR failed: ${err.message}`);
    }
  }, [tracking]);

  // ─── Place a point ───────────────────────────────────────────────
  const placePoint = useCallback(() => {
    if (!xrRefSpaceRef.current || isClosed) return;

    // Use averaged hit position for accuracy
    const buf = hitBufferRef.current;
    if (buf.length < 2) {
      setStatusText('Hold steady for a moment...');
      return;
    }

    // Average the buffered positions
    const avg: Point3D = { x: 0, y: 0, z: 0 };
    for (const p of buf) {
      avg.x += p.x; avg.y += p.y; avg.z += p.z;
    }
    avg.x /= buf.length; avg.y /= buf.length; avg.z /= buf.length;

    // Minimum distance check: reject if too close to last point (< 1cm)
    if (pointsRef.current.length > 0) {
      const lastPt = pointsRef.current[pointsRef.current.length - 1].worldPos;
      const distance = dist3D(lastPt, avg);
      if (distance < 0.01) { // 1cm minimum
        setStatusText('Too close to last point. Move further.');
        return;
      }
    }

    const newPoint: ARPoint = {
      worldPos: avg,
      screenPos: { x: 0, y: 0 },
      id: pointIdRef.current++,
    };

    // Haptic feedback
    if ('vibrate' in navigator) {
      navigator.vibrate(30);
    }

    // Clear buffer after placing
    hitBufferRef.current = [];

    const updated = [...pointsRef.current, newPoint];
    setPoints(updated);
    setMeasurement(computeARMeasurement(updated, false));
    setStatusText(`${updated.length} point${updated.length > 1 ? 's' : ''} placed. ${updated.length >= 3 ? 'Tap "Close" to compute area.' : 'Place more points.'}`);
  }, [isClosed]);

  // ─── Close polygon ───────────────────────────────────────────────
  const closePath = useCallback(() => {
    if (points.length < 3) return;
    setIsClosed(true);
    const m = computeARMeasurement(points, true);
    setMeasurement(m);
    setStatusText('Measurement complete!');
  }, [points]);

  // ─── Undo last point ────────────────────────────────────────────
  const undoPoint = useCallback(() => {
    if (points.length === 0) return;
    setIsClosed(false);
    const updated = points.slice(0, -1);
    setPoints(updated);
    setMeasurement(updated.length > 1 ? computeARMeasurement(updated, false) : null);
  }, [points]);

  // ─── Clear all ──────────────────────────────────────────────────
  const clearAll = useCallback(() => {
    setPoints([]);
    setMeasurement(null);
    setIsClosed(false);
    setStatusText('Surface detected! Tap + to place a point.');
  }, []);

  // ─── Draw overlay ───────────────────────────────────────────────
  const drawOverlay = useCallback((_frame: XRFrame) => {
    // The overlay drawing is done via the DOM overlay (CSS-based points and lines).
    // The actual 3D rendering is handled by WebXR's camera passthrough.
  }, []);

  // ─── End session ────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    if (xrSessionRef.current) {
      await xrSessionRef.current.end();
    }
    onBack();
  }, [onBack]);

  // ─── Unsupported browser ────────────────────────────────────────
  if (supported === false) {
    return (
      <section className="ar-unsupported">
        <div className="ar-unsupported-card">
          <div className="ar-unsupported-icon">📱</div>
          <h2>AR Not Available</h2>
          <p>WebXR AR requires <strong>Android Chrome 79+</strong>.</p>
          <p className="ar-unsupported-hint">
            iOS Safari does not support WebXR AR sessions.
            Use the Photo + Reference Object mode instead.
          </p>
          <button className="btn btn-primary" onClick={onBack}>
            ← Use Photo Mode
          </button>
        </div>
      </section>
    );
  }

  // ─── Loading check ──────────────────────────────────────────────
  if (supported === null) {
    return (
      <section className="ar-loading">
        <div className="ar-spinner"></div>
        <p>Checking AR support...</p>
      </section>
    );
  }

  // ─── Main AR UI ─────────────────────────────────────────────────
  return (
    <div className="ar-container">
      {/* WebXR canvas (hidden behind DOM overlay) */}
      <canvas ref={canvasRef} className="ar-canvas" />

      {/* DOM Overlay — all UI rendered on top of camera */}
      <div ref={overlayRef} className="ar-overlay">

        {/* Status bar */}
        <div className="ar-status-bar">
          <div className="ar-status-text">{statusText}</div>
        </div>

        {/* Reticle crosshair */}
        {tracking && !isClosed && (
          <div className="ar-reticle">
            <div className="ar-reticle-ring" />
            <div className="ar-reticle-dot" />
          </div>
        )}

        {/* Measurement labels */}
        {measurement && measurement.distances.length > 0 && (
          <div className="ar-measurements">
            {measurement.distances.map((d, i) => (
              <div key={i} className="ar-distance-label">
                {d.toFixed(1)} cm
              </div>
            ))}
            {measurement.isClosed && measurement.areaCm2 > 0 && (
              <div className="ar-area-label">
                Area: {measurement.areaCm2.toFixed(1)} cm²
              </div>
            )}
            {measurement.totalLength > 0 && (
              <div className="ar-total-label">
                {measurement.isClosed ? 'Perimeter' : 'Total'}: {measurement.totalLength.toFixed(1)} cm
              </div>
            )}
          </div>
        )}

        {/* Points indicator */}
        {points.length > 0 && (
          <div className="ar-points-count">
            {points.length} point{points.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* Bottom controls */}
        <div className="ar-controls">
          {!sessionActive ? (
            <button className="ar-btn ar-btn-start" onClick={startSession}>
              <span className="ar-btn-icon">📐</span>
              <span>Start AR Measure</span>
            </button>
          ) : (
            <>
              {/* Top row: main actions */}
              <div className="ar-btn-row">
                <button
                  className="ar-btn ar-btn-secondary"
                  onClick={undoPoint}
                  disabled={points.length === 0 || isClosed}
                >
                  ↩ Undo
                </button>

                <button
                  className="ar-btn ar-btn-add"
                  onClick={placePoint}
                  disabled={!tracking || isClosed}
                >
                  <span className="ar-plus">+</span>
                </button>

                <button
                  className="ar-btn ar-btn-secondary"
                  onClick={closePath}
                  disabled={points.length < 3 || isClosed}
                >
                  ◯ Close
                </button>
              </div>

              {/* Bottom row */}
              <div className="ar-btn-row">
                <button className="ar-btn ar-btn-ghost" onClick={clearAll}>
                  🔄 Clear
                </button>
                <button className="ar-btn ar-btn-ghost" onClick={endSession}>
                  ✕ Exit AR
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
