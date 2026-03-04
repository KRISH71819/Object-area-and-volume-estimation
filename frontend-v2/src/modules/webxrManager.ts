/* ===================================================================
   WebXR Manager — AR session, LiDAR depth, and VIO pose tracking
   Provides metric depth on LiDAR devices and camera pose via VIO.
   =================================================================== */

import type { CameraPose, DepthFrame, DeviceCapabilities, CameraIntrinsics, Point3D } from '../types';

let xrSession: XRSession | null = null;
let xrRefSpace: XRReferenceSpace | null = null;
let depthSensingSupported = false;
let latestPose: CameraPose | null = null;
let latestDepth: DepthFrame | null = null;
let poseHistory: CameraPose[] = [];

/**
 * Detect device AR capabilities.
 */
export async function detectCapabilities(): Promise<DeviceCapabilities> {
  const caps: DeviceCapabilities = {
    hasWebXR: false,
    hasLiDAR: false,
    hasARCore: false,
    hasCamera: false,
    hasTouchScreen: 'ontouchstart' in window,
    gpuTier: 'mid',
  };

  // Check camera
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    caps.hasCamera = devices.some(d => d.kind === 'videoinput');
  } catch { /* no camera */ }

  // Check WebXR
  if ('xr' in navigator) {
    try {
      caps.hasWebXR = await (navigator as any).xr.isSessionSupported('immersive-ar');
      // LiDAR detection: check if depth-sensing feature is supported
      if (caps.hasWebXR) {
        caps.hasLiDAR = await checkDepthSensing();
        caps.hasARCore = /android/i.test(navigator.userAgent);
      }
    } catch { /* no WebXR */ }
  }

  // Simple GPU tier detection
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL).toLowerCase();
        if (/apple gpu|a1[2-9]|m[1-4]/.test(renderer)) caps.gpuTier = 'high';
        else if (/adreno 6|mali-g7|geforce|radeon/.test(renderer)) caps.gpuTier = 'high';
        else if (/adreno 5|mali-g5/.test(renderer)) caps.gpuTier = 'mid';
        else caps.gpuTier = 'low';
      }
    }
  } catch { /* fallback to mid */ }

  return caps;
}

/** Check if depth sensing (LiDAR) is available */
async function checkDepthSensing(): Promise<boolean> {
  try {
    const supported = await (navigator as any).xr.isSessionSupported('immersive-ar');
    // Attempt to create a session with depth-sensing to see if it's truly supported
    // This is a heuristic — iOS Safari with LiDAR supports this
    return supported && /iPhone|iPad/.test(navigator.userAgent) &&
      /Pro|iPad Pro/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

/**
 * Start a WebXR AR session for pose tracking and optional depth sensing.
 */
export async function startXRSession(
  canvas: HTMLCanvasElement,
  onPose?: (pose: CameraPose) => void,
  onDepth?: (depth: DepthFrame) => void
): Promise<boolean> {
  if (xrSession) return true;

  try {
    const requiredFeatures: string[] = ['local-floor'];
    const optionalFeatures: string[] = ['depth-sensing', 'hit-test'];

    xrSession = await (navigator as any).xr.requestSession('immersive-ar', {
      requiredFeatures,
      optionalFeatures,
      depthSensing: {
        usagePreference: ['cpu-optimized'],
        dataFormatPreference: ['float32'],
      },
    });

    xrRefSpace = await xrSession!.requestReferenceSpace('local-floor');
    depthSensingSupported = !!(xrSession as any).depthUsage;

    const gl = canvas.getContext('webgl2', { xrCompatible: true });
    if (!gl) throw new Error('WebGL2 required for WebXR');

    await xrSession!.updateRenderState({
      baseLayer: new XRWebGLLayer(xrSession!, gl),
    });

    // Start frame loop
    xrSession!.requestAnimationFrame(function onFrame(time: number, frame: XRFrame) {
      if (!xrSession) return;

      const pose = frame.getViewerPose(xrRefSpace!);
      if (pose) {
        const view = pose.views[0];
        const p = pose.transform.position;
        const q = pose.transform.orientation;

        const cameraPose: CameraPose = {
          position: { x: p.x, y: p.y, z: p.z },
          orientation: { x: q.x, y: q.y, z: q.z, w: q.w },
          viewMatrix: new Float32Array(view.transform.inverse.matrix),
          projectionMatrix: new Float32Array(view.projectionMatrix),
          timestamp: time,
        };

        latestPose = cameraPose;
        poseHistory.push(cameraPose);
        if (poseHistory.length > 300) poseHistory.shift(); // Keep ~10s at 30fps

        if (onPose) onPose(cameraPose);

        // Try to get depth data (LiDAR)
        if (depthSensingSupported) {
          try {
            const depthInfo = (frame as any).getDepthInformation(view);
            if (depthInfo) {
              const depthFrame: DepthFrame = {
                data: new Float32Array(depthInfo.data),
                width: depthInfo.width,
                height: depthInfo.height,
                source: 'lidar',
                metersScale: 1.0, // LiDAR gives metric depth directly
                timestamp: time,
              };
              latestDepth = depthFrame;
              if (onDepth) onDepth(depthFrame);
            }
          } catch { /* depth not available this frame */ }
        }
      }

      xrSession!.requestAnimationFrame(onFrame);
    });

    console.log('[WebXR] AR session started, depth sensing:', depthSensingSupported);
    return true;
  } catch (err) {
    console.warn('[WebXR] Failed to start AR session:', err);
    return false;
  }
}

/** Stop the WebXR session */
export async function stopXRSession(): Promise<void> {
  if (xrSession) {
    await xrSession.end();
    xrSession = null;
    xrRefSpace = null;
    latestPose = null;
    latestDepth = null;
    poseHistory = [];
  }
}

/** Get the latest camera pose */
export function getLatestPose(): CameraPose | null {
  return latestPose;
}

/** Get the latest LiDAR depth frame */
export function getLatestDepth(): DepthFrame | null {
  return latestDepth;
}

/** Check if LiDAR depth is available */
export function hasLiDARDepth(): boolean {
  return depthSensingSupported && latestDepth !== null;
}

/** Check if VIO pose is available */
export function hasVIOPose(): boolean {
  return latestPose !== null;
}

/**
 * Estimate VIO-based metric scale from camera motion.
 * Uses the travel distance of the camera to establish scale.
 * Returns meters per unit, or null if insufficient motion.
 */
export function estimateVIOScale(): number | null {
  if (poseHistory.length < 30) return null; // Need ~1 second of data

  let totalDistance = 0;
  for (let i = 1; i < poseHistory.length; i++) {
    const p0 = poseHistory[i - 1].position;
    const p1 = poseHistory[i].position;
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const dz = p1.z - p0.z;
    totalDistance += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // ARKit/ARCore provide metric scale from VIO, so scale is 1.0
  // The pose values are already in meters
  if (totalDistance > 0.01) return 1.0; // Sufficient motion detected
  return null;
}

/**
 * Estimate VIO drift over time.
 * Returns drift estimate in meters (lower is better).
 */
export function estimateVIODrift(): number {
  if (poseHistory.length < 60) return 0.1; // Unknown, assume moderate

  // Simple drift heuristic: compare early and late motion smoothness
  const recentN = Math.min(30, poseHistory.length);
  let jitter = 0;
  for (let i = poseHistory.length - recentN; i < poseHistory.length - 1; i++) {
    const p0 = poseHistory[i].position;
    const p1 = poseHistory[i + 1].position;
    const dt = poseHistory[i + 1].timestamp - poseHistory[i].timestamp;
    if (dt > 0) {
      const vel = Math.sqrt(
        (p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2 + (p1.z - p0.z) ** 2
      ) / (dt / 1000);
      jitter += vel;
    }
  }
  jitter /= recentN;

  // High jitter → high drift risk
  return Math.min(1.0, jitter * 0.01);
}

/**
 * Cast a ray from screen pixel through the camera.
 * Returns a direction vector in world space.
 */
export function cameraRay(
  pixelX: number,
  pixelY: number,
  intrinsics: CameraIntrinsics
): Point3D {
  const { fx, fy, cx, cy } = intrinsics;
  const x = (pixelX - cx) / fx;
  const y = (pixelY - cy) / fy;
  const len = Math.sqrt(x * x + y * y + 1);
  return { x: x / len, y: y / len, z: 1 / len };
}

/** Check if WebXR session is active */
export function isXRActive(): boolean {
  return xrSession !== null;
}
