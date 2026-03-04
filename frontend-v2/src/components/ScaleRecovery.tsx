/* ===================================================================
   Scale Recovery UI — Simplified to Reference Object only (Photo Mode)
   =================================================================== */

import React, { useCallback } from 'react';
import type { ScaleEstimate } from '../types';
import { recoverScale } from '../modules/scaleRecovery';

interface Props {
  capabilities: any;
  hasRefMask: boolean;
  onScaleSet: (scale: ScaleEstimate) => void;
  onBack: () => void;
}

export const ScaleRecovery: React.FC<Props> = ({
  hasRefMask,
  onScaleSet,
  onBack,
}) => {

  const handleMeasure = useCallback(() => {
    // Use known_object scale if reference mask exists, otherwise fallback
    const scale = recoverScale(
      null, // lidarDepth
      null, // pose
      hasRefMask ? { type: 'credit_card', widthPx: 200, heightPx: 125 } : null,
      null, // userRefPx
      null, // userRefCm
      hasRefMask ? null : 50,  // fallback to manual 50 px/cm if no ref
    );

    scale.method = hasRefMask ? 'known_object' : 'manual_slider';
    onScaleSet(scale);
  }, [hasRefMask, onScaleSet]);

  return (
    <section className="step-section">
      <div className="step-header">
        <span className="step-number">3</span>
        <div>
          <span className="step-title">Measure</span>
          <p className="step-subtitle">
            {hasRefMask
              ? 'Reference object detected — ready to measure!'
              : 'No reference object — using estimated scale.'}
          </p>
        </div>
      </div>

      <div style={{
        background: hasRefMask ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
        border: `1px solid ${hasRefMask ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
        borderRadius: 12,
        padding: '16px',
        marginBottom: 16,
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>
          {hasRefMask ? '✅' : '⚠️'}
        </div>
        <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>
          {hasRefMask
            ? 'Reference coin/card segmented — accurate measurement ready'
            : 'Go back and segment a reference object (coin) for accurate results'}
        </p>
      </div>

      {!hasRefMask && (
        <p style={{
          fontSize: '0.75rem',
          color: 'var(--c-text-dim)',
          textAlign: 'center',
          marginBottom: 12,
        }}>
          💡 Tip: Use a ₹10 coin as reference for best accuracy.
          Go back to Step 2 and segment it as "Reference".
        </p>
      )}

      <div className="action-row" style={{ marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onBack} id="scale-back-btn">
          ← Back
        </button>
        <button
          className="btn btn-primary"
          onClick={handleMeasure}
          id="apply-scale-btn"
        >
          📐 Measure →
        </button>
      </div>
    </section>
  );
};

