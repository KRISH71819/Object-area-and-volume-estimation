/* ===================================================================
   Measurement Results — Displays area + dimension cards (Apple style)
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
  const fmt = (v: number) => (v > 0 ? v.toFixed(1) : '--');

  return (
    <section className="step-section">
      <div className="step-header">
        <span className="step-number">✓</span>
        <div>
          <span className="step-title">Result</span>
          <p className="step-subtitle">Object measurements</p>
        </div>
      </div>

      {/* Area — hero card */}
      <div className="area-result-card" id="result-area">
        <div className="area-result-icon">📐</div>
        <div className="area-result-value">{fmt(measurement.areaCm2)}</div>
        <div className="area-result-unit">cm²</div>
        <div className="area-result-label">Estimated Area</div>
      </div>

      {/* Width × Height dimension pills */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginTop: 16,
        }}
      >
        <div className="metric-pill" id="result-width">
          <span className="metric-pill-icon">↔</span>
          <span className="metric-pill-value">{fmt(measurement.lengthCm)}</span>
          <span className="metric-pill-unit">cm</span>
          <span className="metric-pill-label">Width</span>
        </div>
        <div className="metric-pill" id="result-height">
          <span className="metric-pill-icon">↕</span>
          <span className="metric-pill-value">{fmt(measurement.widthCm)}</span>
          <span className="metric-pill-unit">cm</span>
          <span className="metric-pill-label">Height</span>
        </div>
      </div>

      {/* Confidence badge */}
      {measurement.confidence > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 16,
            padding: '10px 16px',
            borderRadius: 10,
            background:
              measurement.confidence >= 70
                ? 'rgba(16,185,129,0.1)'
                : measurement.confidence >= 40
                ? 'rgba(245,158,11,0.1)'
                : 'rgba(239,68,68,0.1)',
            border: `1px solid ${
              measurement.confidence >= 70
                ? 'rgba(16,185,129,0.25)'
                : measurement.confidence >= 40
                ? 'rgba(245,158,11,0.25)'
                : 'rgba(239,68,68,0.25)'
            }`,
            fontSize: '0.8rem',
            fontWeight: 600,
            color: 'var(--c-text)',
          }}
          id="result-confidence"
        >
          <span>
            {measurement.confidence >= 70 ? '🟢' : measurement.confidence >= 40 ? '🟡' : '🔴'}
          </span>
          <span>{Math.round(measurement.confidence)}% confidence</span>
          <span style={{ color: 'var(--c-text-dim)', fontWeight: 400 }}>
            · {measurement.scaleMethod.replace(/_/g, ' ')}
          </span>
        </div>
      )}

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
