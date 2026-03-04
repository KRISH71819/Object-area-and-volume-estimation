/* ===================================================================
   Scale Recovery — Priority-ordered scale estimation chain
   
   Methods (in order of priority):
   1. LiDAR raycasting (direct metric)
   2. VIO metric IMU data
   3. Known-object auto-detection (credit card, A4 paper)
   4. User-defined reference distance
   5. Manual scale slider fallback
   =================================================================== */

import type { ScaleEstimate, ScaleMethod, DepthFrame, CameraPose } from '../types';
import { hasLiDARDepth, estimateVIOScale } from './webxrManager';

/** Known reference object dimensions in cm */
const KNOWN_OBJECTS: Record<string, { widthCm: number; heightCm: number; aspectRatio: number }> = {
  credit_card: { widthCm: 8.56, heightCm: 5.398, aspectRatio: 8.56 / 5.398 },
  a4_paper: { widthCm: 29.7, heightCm: 21.0, aspectRatio: 29.7 / 21.0 },
  us_dollar_bill: { widthCm: 15.6, heightCm: 6.63, aspectRatio: 15.6 / 6.63 },
  business_card: { widthCm: 9.0, heightCm: 5.0, aspectRatio: 9.0 / 5.0 },
};

/**
 * Run the full scale recovery priority chain.
 * Returns the best available scale estimate.
 */
export function recoverScale(
  lidarDepth: DepthFrame | null,
  pose: CameraPose | null,
  detectedObject: { type: string; widthPx: number; heightPx: number } | null,
  userRefPx: number | null, // User reference distance in pixels
  userRefCm: number | null, // User reference distance in cm
  manualSlider: number | null, // Manual pixels_per_cm
): ScaleEstimate {
  // Priority 1: LiDAR
  if (lidarDepth && hasLiDARDepth()) {
    return {
      pixelsPerMeter: lidarDepth.width / 0.5, // LiDAR provides metric depth, this is approximate
      method: 'lidar',
      confidence: 0.95,
    };
  }

  // Priority 2: VIO scale
  if (pose) {
    const vioScale = estimateVIOScale();
    if (vioScale !== null) {
      return {
        pixelsPerMeter: 1.0 / vioScale, // VIO gives metric pose
        method: 'vio',
        confidence: 0.75,
      };
    }
  }

  // Priority 3: Known-object detection
  if (detectedObject) {
    const objInfo = KNOWN_OBJECTS[detectedObject.type];
    if (objInfo) {
      const pixelsPerCm = computePixelsPerCm(
        detectedObject.widthPx,
        detectedObject.heightPx,
        objInfo.widthCm,
        objInfo.heightCm
      );
      return {
        pixelsPerMeter: pixelsPerCm * 100,
        method: 'known_object',
        confidence: 0.8,
      };
    }
  }

  // Priority 4: User reference distance
  if (userRefPx && userRefCm && userRefPx > 0 && userRefCm > 0) {
    const pixelsPerCm = userRefPx / userRefCm;
    return {
      pixelsPerMeter: pixelsPerCm * 100,
      method: 'user_reference',
      confidence: 0.6,
    };
  }

  // Priority 5: Manual slider
  if (manualSlider && manualSlider > 0) {
    return {
      pixelsPerMeter: manualSlider * 100,
      method: 'manual_slider',
      confidence: 0.3,
    };
  }

  // Fallback: default estimate (50 px/cm)
  return {
    pixelsPerMeter: 5000,
    method: 'manual_slider',
    confidence: 0.1,
  };
}

/**
 * Compute pixels per cm using a known rectangular object.
 * Uses the average of width and height ratios for robustness.
 */
function computePixelsPerCm(
  widthPx: number,
  heightPx: number,
  widthCm: number,
  heightCm: number
): number {
  const ppcW = widthPx / widthCm;
  const ppcH = heightPx / heightCm;
  return (ppcW + ppcH) / 2;
}

/**
 * Detect if a segmented object matches a known reference object
 * based on aspect ratio analysis.
 */
export function detectKnownObject(
  maskContour: number[][], // [[x,y], ...]
): { type: string; widthPx: number; heightPx: number } | null {
  if (maskContour.length < 4) return null;

  // Compute bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [x, y] of maskContour) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const widthPx = maxX - minX;
  const heightPx = maxY - minY;
  if (widthPx < 20 || heightPx < 20) return null;

  const aspectRatio = Math.max(widthPx, heightPx) / Math.min(widthPx, heightPx);

  // Match against known objects
  const TOLERANCE = 0.15; // 15% aspect ratio tolerance
  for (const [type, info] of Object.entries(KNOWN_OBJECTS)) {
    if (Math.abs(aspectRatio - info.aspectRatio) / info.aspectRatio < TOLERANCE) {
      return { type, widthPx, heightPx };
    }
  }

  return null;
}

/**
 * Convert pixels_per_meter to a human-readable scale string.
 */
export function scaleToString(scale: ScaleEstimate): string {
  const ppc = scale.pixelsPerMeter / 100;
  return `${ppc.toFixed(1)} px/cm (${scale.method}, ${Math.round(scale.confidence * 100)}% confidence)`;
}

/**
 * Get method display name.
 */
export function methodDisplayName(method: ScaleMethod): string {
  const names: Record<ScaleMethod, string> = {
    lidar: '🎯 LiDAR Direct',
    vio: '📡 AR Motion Tracking',
    known_object: '📋 Known Object',
    user_reference: '📏 User Reference',
    manual_slider: '🎚️ Manual Scale',
  };
  return names[method];
}
