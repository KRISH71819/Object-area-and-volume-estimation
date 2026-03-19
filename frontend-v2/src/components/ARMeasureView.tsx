import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ARPoint, ARMeasurement, Point3D } from '../types';

interface Props {
  onBack: () => void;
}

function dist3D(a: Point3D, b: Point3D): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function polygonArea3D(points: Point3D[]): number {
  if (points.length < 3) return 0;

  let nx = 0;
  let ny = 0;
  let nz = 0;

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
    distances.push(dist3D(points[i - 1].worldPos, points[i].worldPos) * 100);
  }

  if (closed && points.length > 2) {
    distances.push(dist3D(points[points.length - 1].worldPos, points[0].worldPos) * 100);
  }

  const totalLength = distances.reduce((sum, distance) => sum + distance, 0);
  const areaCm2 =
    closed && points.length >= 3
      ? polygonArea3D(points.map((point) => point.worldPos)) * 10000
      : 0;

  return {
    points,
    distances,
    totalLength,
    perimeterCm: totalLength,
    areaCm2,
    isClosed: closed,
  };
}

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

  const xrSessionRef = useRef<XRSession | null>(null);
  const xrRefSpaceRef = useRef<XRReferenceSpace | null>(null);
  const hitTestSourceRef = useRef<XRHitTestSource | null>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const lastHitRef = useRef<XRHitTestResult | null>(null);
  const reticleVisibleRef = useRef(false);
  const pointIdRef = useRef(0);
  const pointsRef = useRef<ARPoint[]>([]);
  const hitBufferRef = useRef<Point3D[]>([]);
  const HIT_BUFFER_SIZE = 5;

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    (async () => {
      if (!('xr' in navigator)) {
        setSupported(false);
        return;
      }

      try {
        const ok = await (navigator as any).xr.isSessionSupported('immersive-ar');
        setSupported(ok);
      } catch {
        setSupported(false);
      }
    })();
  }, []);

  const drawOverlay = useCallback((_frame: XRFrame) => {
    // DOM overlay is styled with CSS. Camera passthrough is handled by WebXR.
  }, []);

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
      if (!gl) {
        throw new Error('WebGL2 not available');
      }

      glRef.current = gl;

      await session.updateRenderState({
        baseLayer: new XRWebGLLayer(session, gl),
      });

      const refSpace = await session.requestReferenceSpace('local-floor');
      xrRefSpaceRef.current = refSpace;

      const viewerSpace = await session.requestReferenceSpace('viewer');
      const hitTestSource = await session.requestHitTestSource!({ space: viewerSpace });
      hitTestSourceRef.current = hitTestSource ?? null;

      setSessionActive(true);
      setStatusText('Move your phone slowly to detect surfaces...');

      session.requestAnimationFrame(function onFrame(_time: number, frame: XRFrame) {
        if (!xrSessionRef.current) return;

        const activeSession = xrSessionRef.current;
        const glLayer = activeSession.renderState.baseLayer!;
        const currentGl = glRef.current!;

        currentGl.bindFramebuffer(currentGl.FRAMEBUFFER, glLayer.framebuffer);
        currentGl.clearColor(0, 0, 0, 0);
        currentGl.clear(currentGl.COLOR_BUFFER_BIT | currentGl.DEPTH_BUFFER_BIT);

        if (hitTestSourceRef.current) {
          const results = frame.getHitTestResults(hitTestSourceRef.current);

          if (results.length > 0) {
            const hitPose = results[0].getPose(xrRefSpaceRef.current!);

            if (hitPose) {
              const position = hitPose.transform.position;
              const hitPoint: Point3D = { x: position.x, y: position.y, z: position.z };
              const matrix = hitPose.transform.matrix;
              const upY = matrix[5];
              const isHorizontal = Math.abs(upY) > 0.8;

              if (isHorizontal) {
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

        drawOverlay(frame);
        activeSession.requestAnimationFrame(onFrame);
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
  }, [drawOverlay, tracking]);

  const placePoint = useCallback(() => {
    if (!xrRefSpaceRef.current || isClosed) return;

    const buffer = hitBufferRef.current;
    if (buffer.length < 2) {
      setStatusText('Hold steady for a moment...');
      return;
    }

    const average: Point3D = { x: 0, y: 0, z: 0 };
    for (const point of buffer) {
      average.x += point.x;
      average.y += point.y;
      average.z += point.z;
    }

    average.x /= buffer.length;
    average.y /= buffer.length;
    average.z /= buffer.length;

    if (pointsRef.current.length > 0) {
      const lastPoint = pointsRef.current[pointsRef.current.length - 1].worldPos;
      const distance = dist3D(lastPoint, average);

      if (distance < 0.01) {
        setStatusText('Too close to last point. Move further.');
        return;
      }
    }

    const newPoint: ARPoint = {
      worldPos: average,
      screenPos: { x: 0, y: 0 },
      id: pointIdRef.current++,
    };

    if ('vibrate' in navigator) {
      navigator.vibrate(30);
    }

    hitBufferRef.current = [];

    const updated = [...pointsRef.current, newPoint];
    setPoints(updated);
    setMeasurement(computeARMeasurement(updated, false));
    setStatusText(
      `${updated.length} point${updated.length > 1 ? 's' : ''} placed. ` +
        `${updated.length >= 3 ? 'Tap "Close" to compute area.' : 'Place more points.'}`
    );
  }, [isClosed]);

  const closePath = useCallback(() => {
    if (points.length < 3) return;

    setIsClosed(true);
    setMeasurement(computeARMeasurement(points, true));
    setStatusText('Measurement complete!');
  }, [points]);

  const undoPoint = useCallback(() => {
    if (points.length === 0) return;

    setIsClosed(false);
    const updated = points.slice(0, -1);
    setPoints(updated);
    setMeasurement(updated.length > 1 ? computeARMeasurement(updated, false) : null);
  }, [points]);

  const clearAll = useCallback(() => {
    setPoints([]);
    setMeasurement(null);
    setIsClosed(false);
    setStatusText('Surface detected! Tap + to place a point.');
  }, []);

  const endSession = useCallback(async () => {
    if (xrSessionRef.current) {
      await xrSessionRef.current.end();
    }

    onBack();
  }, [onBack]);

  if (supported === false) {
    return (
      <section className="ar-unsupported">
        <div className="ar-unsupported-card">
          <div className="ar-unsupported-icon">AR</div>
          <h2>AR Not Available</h2>
          <p>
            WebXR AR requires <strong>Android Chrome 79+</strong>.
          </p>
          <p className="ar-unsupported-hint">
            iOS Safari does not support WebXR AR sessions. Use the Photo + Reference Object
            mode instead.
          </p>
          <button className="btn btn-primary" onClick={onBack}>
            Use Photo Mode
          </button>
        </div>
      </section>
    );
  }

  if (supported === null) {
    return (
      <section className="ar-loading">
        <div className="ar-spinner"></div>
        <p>Checking AR support...</p>
      </section>
    );
  }

  return (
    <div className="ar-container">
      <canvas ref={canvasRef} className="ar-canvas" />

      <div ref={overlayRef} className="ar-overlay">
        <div className="ar-status-bar">
          <div className="ar-status-text">{statusText}</div>
        </div>

        {tracking && !isClosed && (
          <div className="ar-reticle">
            <div className="ar-reticle-ring" />
            <div className="ar-reticle-dot" />
          </div>
        )}

        {measurement && measurement.distances.length > 0 && (
          <>
            <div className="ar-summary-card">
              {measurement.isClosed && measurement.areaCm2 > 0 && (
                <div className="ar-area-label">
                  <span className="ar-summary-kicker">Area</span>
                  <strong>{measurement.areaCm2.toFixed(1)} cm2</strong>
                </div>
              )}

              {measurement.totalLength > 0 && (
                <div className="ar-total-label">
                  <span className="ar-summary-kicker">
                    {measurement.isClosed ? 'Perimeter' : 'Total length'}
                  </span>
                  <strong>{measurement.totalLength.toFixed(1)} cm</strong>
                </div>
              )}
            </div>

            <div className="ar-measurements">
              <div className="ar-measurements-header">
                <span>Segments</span>
                <span>{measurement.distances.length}</span>
              </div>

              <div className="ar-distance-list">
                {measurement.distances.map((distance, index) => (
                  <div key={index} className="ar-distance-label">
                    <span className="ar-distance-index">#{index + 1}</span>
                    <span>{distance.toFixed(1)} cm</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {points.length > 0 && (
          <div className="ar-points-count">
            {points.length} point{points.length !== 1 ? 's' : ''}
          </div>
        )}

        <div className="ar-controls">
          {!sessionActive ? (
            <button className="ar-btn ar-btn-start" onClick={startSession}>
              <span className="ar-btn-icon">AR</span>
              <span>Start AR Measure</span>
            </button>
          ) : (
            <>
              <div className="ar-btn-row">
                <button
                  className="ar-btn ar-btn-secondary"
                  onClick={undoPoint}
                  disabled={points.length === 0 || isClosed}
                >
                  Undo
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
                  Close
                </button>
              </div>

              <div className="ar-btn-row">
                <button className="ar-btn ar-btn-ghost" onClick={clearAll}>
                  Clear
                </button>
                <button className="ar-btn ar-btn-ghost" onClick={endSession}>
                  Exit AR
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
