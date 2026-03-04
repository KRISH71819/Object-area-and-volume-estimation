/* ===================================================================
   SAM Backend API Client
   Calls existing segmentation endpoints — these are NOT modified.
   =================================================================== */

import type { SegmentationResult, MeasureResponse, MetricMeasureResponse } from '../types';

const API_BASE = '';

/** Segment by click points (calls POST /segment/click) */
export async function segmentByClick(
  imageFile: File,
  points: number[][],
  labels?: number[]
): Promise<SegmentationResult> {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('points', JSON.stringify(points));
  if (labels) fd.append('labels', JSON.stringify(labels));

  const res = await fetch(`${API_BASE}/segment/click`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Segment click failed: ${res.statusText}`);
  return res.json();
}

/** Segment by bounding box (calls POST /segment/box) */
export async function segmentByBox(
  imageFile: File,
  box: number[]
): Promise<SegmentationResult> {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('box', JSON.stringify(box));

  const res = await fetch(`${API_BASE}/segment/box`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Segment box failed: ${res.statusText}`);
  return res.json();
}

/** Segment by drawn polygon (calls POST /segment/polygon) */
export async function segmentByPolygon(
  imageFile: File,
  polygon: number[][]
): Promise<SegmentationResult> {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('polygon', JSON.stringify(polygon));

  const res = await fetch(`${API_BASE}/segment/polygon`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Segment polygon failed: ${res.statusText}`);
  return res.json();
}

/** Measure object — existing reference-based method (calls POST /measure) */
export async function measureObject(
  imageFile: File,
  objectMask: string,
  refMask?: string,
  refType: string = 'coin_10_inr'
): Promise<MeasureResponse> {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('object_mask', objectMask);
  if (refMask) {
    fd.append('ref_mask', refMask);
    fd.append('ref_type', refType);
  }

  const res = await fetch(`${API_BASE}/measure`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Measure failed: ${res.statusText}`);
  return res.json();
}

/** Metric measurement — new endpoint with depth + scale data */
export async function measureMetric(
  imageFile: File,
  objectMask: string,
  depthData: string, // base64 float32 depth
  scaleMethod: string,
  scaleValue: number,
  cameraParams?: object
): Promise<MetricMeasureResponse> {
  const fd = new FormData();
  fd.append('image', imageFile);
  fd.append('object_mask', objectMask);
  fd.append('depth_data', depthData);
  fd.append('scale_method', scaleMethod);
  fd.append('scale_value', String(scaleValue));
  if (cameraParams) fd.append('camera_params', JSON.stringify(cameraParams));

  const res = await fetch(`${API_BASE}/measure/metric`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Metric measure failed: ${res.statusText}`);
  return res.json();
}

/** Auto-detect known objects for scale */
export async function detectScaleObject(
  imageFile: File
): Promise<{ success: boolean; detected: string | null; pixels_per_cm: number | null }> {
  const fd = new FormData();
  fd.append('image', imageFile);

  const res = await fetch(`${API_BASE}/scale/detect`, { method: 'POST', body: fd });
  if (!res.ok) throw new Error(`Scale detect failed: ${res.statusText}`);
  return res.json();
}

/** Health check */
export async function healthCheck(): Promise<{ status: string; models_loaded: boolean }> {
  const res = await fetch(`${API_BASE}/health`);
  return res.json();
}

/** Preload models */
export async function preloadModels(): Promise<void> {
  await fetch(`${API_BASE}/preload`, { method: 'POST' });
}

/** Convert base64 PNG to Image element */
export function base64ToImage(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/png;base64,${b64}`;
  });
}
