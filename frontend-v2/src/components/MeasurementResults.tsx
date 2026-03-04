/* ===================================================================
   Measurement Results — Clean area-only display (Apple style)
   =================================================================== */

import React from 'react';
import type { MetricMeasurement, ConfidenceBreakdown, ScaleEstimate } from '../types';

interface Props {
  measurement: MetricMeasurement;
  confidence: ConfidenceBreakdown | null;
  depthMapB64: string | null;
  meshData: any;
  scaleEstimate: ScaleEstimate | null;
  onNewMeasurement: () => void;
}

export const MeasurementResults: React.FC<Props> = ({
  measurement,
  onNewMeasurement,
}) => {

  return (
    <section className="step-section">
      <div className="step-header">
        <span className="step-number">✓</span>
        <div>
          <span className="step-title">Result</span>
          <p className="step-subtitle">Object area measurement</p>
        </div>
      </div>

      {/* Area Result — Big prominent display */}
      <div className="area-result-card" id="result-area">
        <div className="area-result-icon">📐</div>
        <div className="area-result-value">
          {measurement.areaCm2 > 0 ? measurement.areaCm2.toFixed(1) : '--'}
        </div>
        <div className="area-result-unit">cm²</div>
        <div className="area-result-label">Estimated Area</div>
      </div>

      {/* New Measurement Button */}
      <button
        className="btn btn-primary btn-full btn-lg"
        onClick={onNewMeasurement}
        id="new-measurement-btn"
        style={{ marginTop: 20 }}
      >
        📷 New Measurement
      </button>
    </section>
  );
};

