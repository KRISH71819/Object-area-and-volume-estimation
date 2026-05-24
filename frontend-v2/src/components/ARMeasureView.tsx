import React, { useRef, useState, useCallback, useEffect } from 'react';
import type { ARPoint, ARMeasurement, Point3D, VolumeFrame, VolumeResponse } from '../types';
import { estimateVolume3D } from '../api/samApi';

interface Props {
  onBack: () => void;
}

// =====================================================================
//  2D Math helpers — UNTOUCHED from original
// =====================================================================

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

// =====================================================================
//  Component
// =====================================================================

export const ARMeasureView: React.FC<Props> = ({ onBack }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // --- Core AR state ---
  const [supported, setSupported] = useState<boolean | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [statusText, setStatusText] = useState('Initializing AR...');

  // === STRICT MODE STATE ===
  const [appMode, setAppMode] = useState<'2d' | '3d'>('2d');

  // === 2D Area Measurement state ===
  const [points, setPoints] = useState<ARPoint[]>([]);
  const [measurement, setMeasurement] = useState<ARMeasurement | null>(null);
  const [isClosed, setIsClosed] = useState(false);

  // === 3D Volume Estimation state (completely isolated from 2D) ===
  const [volumeAnchor, setVolumeAnchor] = useState<Point3D | null>(null);
  const [capturedFrames, setCapturedFrames] = useState<VolumeFrame[]>([]);
  const [volumeResult, setVolumeResult] = useState<VolumeResponse | null>(null);
  const [volumeError, setVolumeError] = useState<string | null>(null);
  const [volumeProcessing, setVolumeProcessing] = useState(false);
  const MIN_FRAMES = 3;

  // --- XR internals ---
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

  // Camera matrix refs (updated every frame for 3D capture)
  const lastViewMatrixRef = useRef<Float32Array | null>(null);
  const lastProjMatrixRef = useRef<Float32Array | null>(null);

  // Keep pointsRef in sync
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  // Check WebXR support
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

  // ---------------------------------------------------------------
  //  Start XR Session — render loop ALWAYS updates hitBufferRef
  // ---------------------------------------------------------------
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

      const viewerSpace = await session.requestReferenceSpace('viewer');
      const hitTestSource = await session.requestHitTestSource!({ space: viewerSpace });
      hitTestSourceRef.current = hitTestSource ?? null;

      setSessionActive(true);
      setStatusText('Move your phone slowly to detect surfaces...');

      // === THE RENDER LOOP — runs ALWAYS regardless of appMode ===
      session.requestAnimationFrame(function onFrame(_time: number, frame: XRFrame) {
        if (!xrSessionRef.current) return;

        const activeSession = xrSessionRef.current;
        const glLayer = activeSession.renderState.baseLayer!;
        const currentGl = glRef.current!;

        currentGl.bindFramebuffer(currentGl.FRAMEBUFFER, glLayer.framebuffer);
        currentGl.clearColor(0, 0, 0, 0);
        currentGl.clear(currentGl.COLOR_BUFFER_BIT | currentGl.DEPTH_BUFFER_BIT);

        // Always store camera matrices for 3D capture
        const pose = frame.getViewerPose(xrRefSpaceRef.current!);
        if (pose && pose.views.length > 0) {
          const view = pose.views[0];
          lastViewMatrixRef.current = new Float32Array(view.transform.inverse.matrix);
          lastProjMatrixRef.current = new Float32Array(view.projectionMatrix);
        }

        // Always run hit-testing — NEVER blocked by appMode
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
                  setStatusText('Surface detected! Tap + to begin.');
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

  // ---------------------------------------------------------------
  //  2D: Place a measurement point — ORIGINAL LOGIC UNTOUCHED
  // ---------------------------------------------------------------
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

  // ---------------------------------------------------------------
  //  3D: Place volume anchor at the reticle position
  // ---------------------------------------------------------------
  const placeVolumeAnchor = useCallback(() => {
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

    if ('vibrate' in navigator) navigator.vibrate(40);
    hitBufferRef.current = [];

    setVolumeAnchor(average);
    setStatusText('⚓ Anchor placed. Now capture frames around the object.');
  }, []);

  // ---------------------------------------------------------------
  //  UNIFIED TAP HANDLER — dispatches based on appMode
  // ---------------------------------------------------------------
  const handleTap = useCallback(() => {
    if (appMode === '2d') {
      placePoint();
    } else if (appMode === '3d' && !volumeAnchor) {
      placeVolumeAnchor();
    }
  }, [appMode, volumeAnchor, placePoint, placeVolumeAnchor]);

  // ---------------------------------------------------------------
  //  3D: Capture a single frame from the WebGL framebuffer
  // ---------------------------------------------------------------
  const captureFrame = useCallback(() => {
    const gl = glRef.current;
    const session = xrSessionRef.current;
    if (!gl || !session) return;

    const glLayer = session.renderState.baseLayer;
    if (!glLayer) return;

    const width = glLayer.framebufferWidth;
    const height = glLayer.framebufferHeight;

    // Read pixels from WebGL framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    // Convert to canvas → JPEG base64 (flip vertically — WebGL is bottom-up)
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = width;
    tmpCanvas.height = height;
    const ctx = tmpCanvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);

    for (let y = 0; y < height; y++) {
      const srcRow = (height - 1 - y) * width * 4;
      const dstRow = y * width * 4;
      for (let x = 0; x < width * 4; x++) {
        imageData.data[dstRow + x] = pixels[srcRow + x];
      }
    }
    ctx.putImageData(imageData, 0, 0);

    const dataUrl = tmpCanvas.toDataURL('image/jpeg', 0.85);
    const imageBase64 = dataUrl.split(',')[1];

    const viewMat = lastViewMatrixRef.current;
    const projMat = lastProjMatrixRef.current;
    if (!viewMat || !projMat) {
      setStatusText('⚠️ Could not capture — no camera data yet.');
      return;
    }

    const frame: VolumeFrame = {
      imageBase64,
      viewMatrix: Array.from(viewMat),
      projectionMatrix: Array.from(projMat),
      width,
      height,
    };

    if ('vibrate' in navigator) navigator.vibrate(25);

    setCapturedFrames(prev => {
      const updated = [...prev, frame];
      setStatusText(`📸 ${updated.length} frame${updated.length > 1 ? 's' : ''} captured — move to a new angle.`);
      return updated;
    });
  }, []);

  // ---------------------------------------------------------------
  //  3D: Submit frames + anchor to backend for voxel carving
  // ---------------------------------------------------------------
  const computeVolume = useCallback(async () => {
    if (capturedFrames.length < MIN_FRAMES || !volumeAnchor) return;

    setVolumeProcessing(true);
    setVolumeError(null);
    setStatusText('⏳ Computing 3D volume...');

    try {
      const result = await estimateVolume3D(capturedFrames, volumeAnchor);
      setVolumeResult(result);
      setStatusText(`✅ Volume: ${result.volume_cm3.toFixed(1)} cm³`);
      if ('vibrate' in navigator) navigator.vibrate([50, 50, 50]);
    } catch (err: any) {
      console.error('Volume estimation failed:', err);
      setVolumeError(err.message || 'Volume estimation failed');
      setStatusText('❌ Volume estimation failed.');
    } finally {
      setVolumeProcessing(false);
    }
  }, [capturedFrames, volumeAnchor]);

  // ---------------------------------------------------------------
  //  Mode switching
  // ---------------------------------------------------------------
  const switchTo3D = useCallback(() => {
    setAppMode('3d');
    setVolumeAnchor(null);
    setCapturedFrames([]);
    setVolumeResult(null);
    setVolumeError(null);
    setVolumeProcessing(false);
    setStatusText('3D Volume mode. Aim at the object and tap + to place anchor.');
  }, []);

  const switchTo2D = useCallback(() => {
    setAppMode('2d');
    setVolumeAnchor(null);
    setCapturedFrames([]);
    setVolumeResult(null);
    setVolumeError(null);
    setVolumeProcessing(false);
    setStatusText(tracking ? 'Surface detected! Tap + to place a point.' : 'Detecting surfaces...');
  }, [tracking]);

  const resetVolumeScan = useCallback(() => {
    setVolumeAnchor(null);
    setCapturedFrames([]);
    setVolumeResult(null);
    setVolumeError(null);
    setStatusText('3D Volume mode. Aim at the object and tap + to place anchor.');
  }, []);

  // ---------------------------------------------------------------
  //  Render
  // ---------------------------------------------------------------

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
        {/* Status bar + Mode toggle */}
        <div className="ar-status-bar">
          <div className="ar-status-text">{statusText}</div>
          {sessionActive && (
            <div className="ar-mode-toggle">
              <button
                className={`ar-mode-btn ${appMode === '2d' ? 'ar-mode-btn-active' : ''}`}
                onClick={switchTo2D}
                disabled={volumeProcessing}
              >
                📐 2D Area
              </button>
              <button
                className={`ar-mode-btn ${appMode === '3d' ? 'ar-mode-btn-active' : ''}`}
                onClick={switchTo3D}
                disabled={volumeProcessing}
              >
                📦 3D Volume
              </button>
            </div>
          )}
        </div>

        {/* Reticle: always visible when tracking, hidden only when 2D path is closed */}
        {tracking && !(appMode === '2d' && isClosed) && (
          <div className="ar-reticle">
            <div className="ar-reticle-ring" />
            <div className="ar-reticle-dot" />
          </div>
        )}

        {/* === 3D: "Place anchor" hint === */}
        {appMode === '3d' && !volumeAnchor && !volumeProcessing && !volumeResult && (
          <div className="ar-volume-capture-overlay">
            <p className="ar-volume-capture-hint">
              Aim the reticle at the object and tap + to place anchor
            </p>
          </div>
        )}

        {/* === 3D: Frame capture counter === */}
        {appMode === '3d' && volumeAnchor && !volumeResult && !volumeProcessing && (
          <div className="ar-volume-capture-overlay">
            <div className="ar-volume-capture-ring">
              <div className="ar-volume-capture-count">{capturedFrames.length}</div>
            </div>
            <p className="ar-volume-capture-hint">
              {capturedFrames.length === 0
                ? 'Move to a new angle and tap Capture Frame'
                : `${capturedFrames.length} frame${capturedFrames.length > 1 ? 's' : ''} — move to a new angle`}
            </p>
          </div>
        )}

        {/* === 3D: Processing spinner === */}
        {volumeProcessing && (
          <div className="ar-volume-capture-overlay">
            <div className="ar-volume-processing-spinner" />
            <p className="ar-volume-capture-hint">Computing 3D volume...</p>
          </div>
        )}

        {/* === 3D: Volume result card === */}
        {volumeResult && (
          <div className="ar-summary-card ar-volume-result-card">
            <div className="ar-volume-result-icon">📦</div>
            <div className="ar-area-label">
              <span className="ar-summary-kicker">3D Volume</span>
              <strong>{volumeResult.volume_cm3.toFixed(1)} cm³</strong>
            </div>
            <div className="ar-volume-meta">
              <span>{volumeResult.voxel_count.toLocaleString()} voxels</span>
              <span>·</span>
              <span>{volumeResult.frames_used} views</span>
            </div>
            {volumeResult.bounding_box_cm && (
              <div className="ar-volume-bbox">
                Bounding box: {volumeResult.bounding_box_cm[0].toFixed(1)} × {volumeResult.bounding_box_cm[1].toFixed(1)} × {volumeResult.bounding_box_cm[2].toFixed(1)} cm
              </div>
            )}
          </div>
        )}

        {/* === 3D: Error card === */}
        {volumeError && (
          <div className="ar-summary-card ar-volume-error-card">
            <span>❌ {volumeError}</span>
          </div>
        )}

        {/* === 2D: Measurement display (only in 2D mode) === */}
        {appMode === '2d' && measurement && measurement.distances.length > 0 && (
          <>
            <div className="ar-summary-card">
              {measurement.isClosed && measurement.areaCm2 > 0 && (
                <div className="ar-area-label">
                  <span className="ar-summary-kicker">Area</span>
                  <strong>{measurement.areaCm2.toFixed(1)} cm²</strong>
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

        {appMode === '2d' && points.length > 0 && (
          <div className="ar-points-count">
            {points.length} point{points.length !== 1 ? 's' : ''}
          </div>
        )}

        {/* === Controls === */}
        <div className="ar-controls">
          {!sessionActive ? (
            <button className="ar-btn ar-btn-start" onClick={startSession}>
              <span className="ar-btn-icon">AR</span>
              <span>Start AR Measure</span>
            </button>
          ) : (
            <>
              <div className="ar-btn-row">
                {/* --- 2D mode controls --- */}
                {appMode === '2d' && (
                  <>
                    <button
                      className="ar-btn ar-btn-secondary"
                      onClick={undoPoint}
                      disabled={points.length === 0 || isClosed}
                    >
                      Undo
                    </button>

                    <button
                      className="ar-btn ar-btn-add"
                      onClick={handleTap}
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
                  </>
                )}

                {/* --- 3D mode: + for anchor, then Capture/Compute --- */}
                {appMode === '3d' && !volumeProcessing && !volumeResult && (
                  <>
                    {!volumeAnchor && (
                      <button
                        className="ar-btn ar-btn-add"
                        onClick={handleTap}
                        disabled={!tracking}
                      >
                        <span className="ar-plus">+</span>
                      </button>
                    )}

                    {volumeAnchor && (
                      <>
                        <button
                          className="ar-btn ar-btn-volume"
                          onClick={captureFrame}
                          disabled={!tracking}
                        >
                          📸 Capture Frame
                        </button>
                        <button
                          className="ar-btn ar-btn-secondary"
                          onClick={computeVolume}
                          disabled={capturedFrames.length < MIN_FRAMES}
                        >
                          Compute ({capturedFrames.length})
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* 3D: Scan Again after result */}
                {appMode === '3d' && volumeResult && (
                  <button className="ar-btn ar-btn-volume" onClick={resetVolumeScan}>
                    🔄 Scan Again
                  </button>
                )}
              </div>

              <div className="ar-btn-row">
                {appMode === '2d' && (
                  <button className="ar-btn ar-btn-ghost" onClick={clearAll}>
                    Clear
                  </button>
                )}
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
