/* ===================================================================
   PixScale — Main Application Component
   Orchestrates: Capture → Segment → Measure → Results
   =================================================================== */

import React, { useState, useCallback, useEffect } from 'react';
import type {
  AppStep,
  ScaleEstimate,
  MetricMeasurement,
  DeviceCapabilities,
} from './types';
import { Header } from './components/Header';
import { CameraCapture } from './components/CameraCapture';
import { SegmentationCanvas } from './components/SegmentationCanvas';
import { ScaleRecovery } from './components/ScaleRecovery';
import { MeasurementResults } from './components/MeasurementResults';
import { LoadingOverlay } from './components/LoadingOverlay';
import { ARMeasureView } from './components/ARMeasureView';
import { detectCapabilities } from './modules/webxrManager';
import { measureObject } from './api/samApi';

export default function App() {
  const [step, setStep] = useState<AppStep>('capture');
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(null);

  // Image state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);

  // Segmentation state
  const [objectMask, setObjectMask] = useState<string | null>(null);
  const [referenceMask, setReferenceMask] = useState<string | null>(null);

  // Measurement state
  const [measurement, setMeasurement] = useState<MetricMeasurement | null>(null);

  // Detect device capabilities on mount
  useEffect(() => {
    detectCapabilities().then(setCapabilities);
  }, []);

  // Handle image captured/uploaded
  const handleImageCapture = useCallback((file: File, img: HTMLImageElement) => {
    setImageFile(file);
    setImageElement(img);
    setStep('segment');
  }, []);

  // Handle segmentation complete
  const handleSegmentComplete = useCallback(
    (objMask: string, refMask: string | null) => {
      setObjectMask(objMask);
      setReferenceMask(refMask);
      setStep('scale');
    },
    []
  );

  // Handle scale set and run measurement
  const handleScaleSet = useCallback(
    async (scale: ScaleEstimate) => {
      if (!imageFile || !objectMask) return;

      setLoading(true);
      setLoadingText('Measuring object...');

      try {
        // Call backend to measure the object
        const backendResult = await measureObject(
          imageFile,
          objectMask,
          referenceMask ?? undefined,
          'coin_10_inr'
        );

        if (backendResult.success) {
          setMeasurement({
            lengthCm: backendResult.measurements.width_cm,
            widthCm: backendResult.measurements.height_cm,
            perimeterCm: 0,
            areaCm2: backendResult.measurements.area_cm2,
            confidence: scale.confidence * 100,
            scaleMethod: scale.method,
            depthSource: 'midas',
          });
        } else {
          alert('Measurement failed. Please try again.');
        }

        setStep('results');
      } catch (err) {
        console.error('Measurement failed:', err);
        alert('Measurement failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [imageFile, objectMask, referenceMask]
  );

  // Reset to start
  const handleReset = useCallback(() => {
    setStep('capture');
    setImageFile(null);
    setImageElement(null);
    setObjectMask(null);
    setReferenceMask(null);
    setMeasurement(null);
  }, []);

  return (
    <div className="app-shell">
      <Header capabilities={capabilities} />

      {/* AR/Photo Mode Toggle — Switch between standard and AR measurements */}
      {step !== 'ar-measure' && (
        <div style={{ textAlign: 'center', padding: '12px 16px 0' }}>
          <div className="header-mode-toggle">
            <button
              className="header-mode-btn active"
              onClick={handleReset}
            >
              📸 Photo Mode
            </button>
            <button
              className="header-mode-btn"
              onClick={() => setStep('ar-measure')}
            >
              📐 AR Measure
            </button>
          </div>
        </div>
      )}

      {step === 'ar-measure' && (
        <ARMeasureView onBack={handleReset} />
      )}

      {step === 'capture' && (
        <CameraCapture onCapture={handleImageCapture} />
      )}

      {step === 'segment' && imageFile && imageElement && (
        <SegmentationCanvas
          imageFile={imageFile}
          imageElement={imageElement}
          onComplete={handleSegmentComplete}
          onBack={handleReset}
        />
      )}

      {step === 'scale' && (
        <ScaleRecovery
          capabilities={capabilities}
          hasRefMask={!!referenceMask}
          onScaleSet={handleScaleSet}
          onBack={() => setStep('segment')}
        />
      )}

      {step === 'results' && measurement && (
        <MeasurementResults
          measurement={measurement}
          confidence={null}
          depthMapB64={null}
          meshData={null}
          scaleEstimate={null}
          onNewMeasurement={handleReset}
        />
      )}

      <LoadingOverlay active={loading} text={loadingText} />
    </div>
  );
}
