import React, { useRef, useState, useCallback, useEffect } from 'react';

interface Props {
  onCapture: (file: File, img: HTMLImageElement) => void;
}

export const CameraCapture: React.FC<Props> = ({ onCapture }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [streamRef, setStreamRef] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Cleanup camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef) {
        streamRef.getTracks().forEach(t => t.stop());
      }
    };
  }, [streamRef]);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const img = new Image();
    img.onload = () => onCapture(file, img);
    img.src = URL.createObjectURL(file);
  }, [onCapture]);

  // Start live camera
  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Rear camera
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      setStreamRef(stream);
      setCameraActive(true);

      // Wait for video element to be available
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      });
    } catch (err: any) {
      console.error('Camera access failed:', err);
      if (err.name === 'NotAllowedError') {
        setCameraError('Camera permission denied. Please allow camera access and try again.');
      } else if (err.name === 'NotFoundError') {
        setCameraError('No camera found on this device.');
      } else if (err.name === 'NotReadableError') {
        setCameraError('Camera is in use by another app.');
      } else {
        setCameraError('Could not access camera. Try using the file upload instead.');
      }
    }
  }, []);

  // Capture frame from live camera
  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'capture.jpg', { type: 'image/jpeg' });
      const img = new Image();
      img.onload = () => {
        // Stop camera
        if (streamRef) {
          streamRef.getTracks().forEach(t => t.stop());
          setStreamRef(null);
        }
        setCameraActive(false);
        onCapture(file, img);
      };
      img.src = URL.createObjectURL(blob);
    }, 'image/jpeg', 0.92);
  }, [streamRef, onCapture]);

  // Stop camera
  const stopCamera = useCallback(() => {
    if (streamRef) {
      streamRef.getTracks().forEach(t => t.stop());
      setStreamRef(null);
    }
    setCameraActive(false);
  }, [streamRef]);

  return (
    <section className="step-section">
      <div className="step-header">
        <span className="step-number">1</span>
        <div>
          <span className="step-title">Capture Image</span>
          <p className="step-subtitle">Take a photo of the object you want to measure</p>
        </div>
      </div>

      {/* Hidden input for FILE PICKER (no capture attr = opens file explorer) */}
      <input
        type="file"
        ref={inputRef}
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
        id="file-upload-input"
      />

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Camera Error */}
      {cameraError && (
        <div style={{
          background: 'rgba(239,68,68,0.12)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 12,
          padding: '12px 16px',
          marginBottom: 16,
          fontSize: '0.8125rem',
          color: '#f87171',
        }}>
          ⚠️ {cameraError}
        </div>
      )}

      {!cameraActive ? (
        <>
          {/* Live Camera Button */}
          <div
            className="upload-area"
            onClick={startCamera}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && startCamera()}
            id="live-camera-btn"
            style={{ marginBottom: 12 }}
          >
            <span className="upload-icon">📹</span>
            <p>Tap to open live camera</p>
            <p className="hint">
              Uses rear camera — point at the object to measure
            </p>
          </div>

          {/* File Upload Button */}
          <div
            className="upload-area"
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
            id="upload-area"
          >
            <span className="upload-icon">📁</span>
            <p>Or upload an existing image</p>
            <p className="hint">
              Include a reference object (coin, card) for best accuracy
            </p>
          </div>
        </>
      ) : (
        /* Live Camera View */
        <div style={{ position: 'relative' }}>
          <div className="canvas-wrap">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              id="camera-preview"
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: 420,
                display: 'block',
                borderRadius: 12,
                transform: 'scaleX(1)', // Do NOT mirror rear camera
              }}
            />
            <div className="canvas-hint">
              <p>Point at the object, then tap Capture</p>
            </div>
          </div>

          <div className="action-row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost" onClick={stopCamera} id="stop-camera-btn">
              ✕ Cancel
            </button>
            <button className="btn btn-primary btn-lg" onClick={captureFrame} id="capture-btn">
              📸 Capture
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
