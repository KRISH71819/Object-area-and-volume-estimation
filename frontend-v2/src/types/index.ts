/* ===================================================================
   AR Measure — Type Definitions
   =================================================================== */

/** 2D point in pixel coordinates */
export interface Point2D {
  x: number;
  y: number;
}

/** 3D point in world coordinates (meters) */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/** Camera intrinsic parameters */
export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

/** Camera pose from VIO/WebXR */
export interface CameraPose {
  position: Point3D;
  orientation: { x: number; y: number; z: number; w: number };
  viewMatrix: Float32Array;
  projectionMatrix: Float32Array;
  timestamp: number;
}

/** Scale estimation result */
export interface ScaleEstimate {
  pixelsPerMeter: number;
  method: ScaleMethod;
  confidence: number; // 0-1
}

export type ScaleMethod =
  | 'lidar'
  | 'vio'
  | 'known_object'
  | 'user_reference'
  | 'manual_slider';

/** Depth source type */
export type DepthSource = 'lidar' | 'midas' | 'fused';

/** Single depth frame */
export interface DepthFrame {
  data: Float32Array;
  width: number;
  height: number;
  source: DepthSource;
  metersScale: number; // multiply data values by this to get meters
  timestamp: number;
}

/** Fused depth output */
export interface FusedDepth {
  depth: DepthFrame;
  pose?: CameraPose;
  scaleConfidence: number;
}

/** Metric measurement result */
export interface MetricMeasurement {
  lengthCm: number;
  widthCm: number;
  perimeterCm: number;
  areaCm2: number;
  confidence: number; // 0-100%
  scaleMethod: ScaleMethod;
  depthSource: DepthSource;
  planeNormal?: Point3D;
}

/** SAM segmentation response */
export interface SegmentationResult {
  success: boolean;
  mask: string; // base64 PNG
  overlay: string; // base64 PNG
}

/** Measurement response from backend */
export interface MeasureResponse {
  success: boolean;
  measurements: {
    area_cm2: number;
    width_cm: number;
    height_cm: number;
    pixels_per_cm: number;
  };
  depth_map: string | null;
  mesh_data: {
    vertices: number[];
    indices: number[];
    vertex_count: number;
    face_count: number;
  } | null;
}

/** Metric measurement response from backend */
export interface MetricMeasureResponse {
  success: boolean;
  measurements: {
    length_cm: number;
    width_cm: number;
    perimeter_cm: number;
    area_cm2: number;
    confidence: number;
    scale_method: string;
  };
  depth_map: string;
  contour_3d: number[][]; // [[x,y,z], ...]
}

/** Known reference object types */
export type ReferenceObjectType =
  | 'coin_10_inr'
  | 'coin_5_inr'
  | 'coin_2_inr'
  | 'coin_1_inr'
  | 'credit_card'
  | 'a4_paper';

/** Application step */
export type AppStep = 'capture' | 'segment' | 'scale' | 'measure' | 'results' | 'ar-measure' | 'idle';

/** Device capabilities */
export interface DeviceCapabilities {
  hasWebXR: boolean;
  hasLiDAR: boolean;
  hasARCore: boolean;
  hasCamera: boolean;
  hasTouchScreen: boolean;
  gpuTier: 'low' | 'mid' | 'high';
}

/** Confidence breakdown */
export interface ConfidenceBreakdown {
  overall: number; // 0-100
  depthVariance: number;
  vioDrift: number;
  scaleQuality: number;
  maskQuality: number;
  details: string;
}

/** AR 3D anchor point placed via hit-test */
export interface ARPoint {
  worldPos: Point3D;       // 3D position in meters (from ARCore)
  screenPos: Point2D;      // 2D screen coordinates for rendering labels
  id: number;
}

/** AR measurement result (computed from 3D anchors) */
export interface ARMeasurement {
  points: ARPoint[];
  distances: number[];     // distance between consecutive points in cm
  totalLength: number;     // sum of distances in cm
  perimeterCm: number;     // total perimeter if closed
  areaCm2: number;         // area if polygon is closed (3+ points)
  isClosed: boolean;       // whether the polygon is closed
}

